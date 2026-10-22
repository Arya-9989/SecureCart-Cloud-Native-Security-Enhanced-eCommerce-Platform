# 0001. Container image scanning with Trivy

- Status: accepted
- Date: 2026-10-23

## Context

The stack runs three images in production shape: the Django API (`backend/Dockerfile`,
Debian slim), the SPA behind nginx (`frontend/Dockerfile`, Alpine) and the official
PostgreSQL image. Nothing checked them for known vulnerabilities. Base images age quickly:
the first scan of `nginxinc/nginx-unprivileged:1.29.8-alpine` found 44 HIGH findings that
already had fixes (curl, OpenSSL, expat, pcre2, util-linux).

We want CI to fail when an image we ship contains a HIGH or CRITICAL vulnerability that has
a fix available, without drowning in findings nobody can act on, and without trusting a
scanner whose own supply chain is unverified.

## Options considered

1. **`aquasecurity/trivy-action`.** Convenient, but it downloads Trivy at run time from a
   tag, and in March 2026 an attacker force-pushed most of its version tags to
   credential-stealing code
   ([GHSA-69fq-xp46-6x23](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23)).
   Pinning the action to a SHA does not pin the Trivy binary it fetches. The `aquasec/trivy`
   Docker Hub image was also briefly poisoned in the same month (v0.69.5 and v0.69.6).
2. **Docker Scout or Grype.** Scout needs a Docker account. Grype is a fine scanner, but
   Trivy is already the verified tool on the development machines, and one tool everywhere
   keeps local and CI results comparable.
3. **The Trivy release binary, verified in the workflow.** Download a fixed version and
   check its SHA-256 against a value recorded in the workflow. The value was taken from the
   release's checksums file after verifying that file's Sigstore bundle with
   `cosign verify-blob` (identity `https://github.com/aquasecurity/trivy/...`, issuer
   `https://token.actions.githubusercontent.com`).

## Decision

Option 3, wrapped in `scripts/scan_images.sh` so CI and developers run the same thing.

- **What is scanned:** every image `docker compose config --images` lists, so a new compose
  service is scanned without touching the script.
- **Gate:** images that ship (ours and runtime dependencies) fail on any HIGH or CRITICAL
  finding **with a fixed version** (`--ignore-unfixed`). Findings without a fix are visible
  in the uploaded JSON reports but cannot be acted on, so they do not block.
- **Report only:** local emulators (Mailpit, MinIO, stripe-mock) are never deployed. They are
  scanned and reported, but never block.
- **Accepted risk:** `.trivyignore.yaml`, one entry per CVE, scoped with `paths` to the exact
  file, with a statement and an `expired_at` at most 90 days out. An expired entry stops
  matching, so the gate fails again and forces a re-review. This was checked by rewriting
  the dates to the past: the PostgreSQL scan then failed with 26 findings.
- **Vulnerability database:** cached per day with `actions/cache`, pulled from
  `mirror.gcr.io` first and `ghcr.io` second, to avoid registry rate limits.
- **Dockerfiles** are linted with hadolint (pinned by digest) at warning level in the same job.

The only accepted findings today are 26 Go standard-library CVEs reported against `gosu` in
`postgres:17.11-alpine`. gosu only drops privileges and execs PostgreSQL. Its binary
contains no function symbols from any vulnerable package (`net`, `net/http`, `crypto/tls`,
`crypto/x509`, `net/url`, `net/mail`, `mime`, `encoding/asn1`, `encoding/xml`,
`html/template`, `os.Root`). The reproduction steps are in the ignore file's header.

## Consequences

- Upgrading `nginx-unprivileged` to `1.30.6-alpine3.24` (the current stable line) cleared
  all 44 frontend findings. The backend image had none with a fix.
- A new upstream advisory can turn CI red without any code change. That is intended: the fix
  is usually a base-image bump, and the JSON reports are uploaded as an artifact.
- Bumping Trivy means re-verifying the new release's checksums file and updating
  `TRIVY_SHA256`.
