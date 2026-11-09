# 0009. Apply distribution security updates to runtime images

- Status: accepted
- Date: 2026-11-09

## Context

The image scan on PR #12 found four fixable HIGH findings in the backend's
Debian packages (apt, libapt-pkg7.0 and zlib1g), and ten HIGH/CRITICAL findings
in the frontend's Alpine packages (brotli-libs, curl, libcurl, libexpat, musl,
musl-utils and zlib). These packages come from the runtime base images.

## Decision

Apply distribution package upgrades in both runtime stages. This keeps the
existing Python and nginx versions while taking available OS security fixes.
The frontend uses root only for the upgrade and restores UID 101 immediately;
the backend retains UID/GID 10001. Remove downloaded package indexes and retain
the existing vulnerability gate without new ignores or weaker checks.

## Consequences

Package versions follow each base image's configured distribution repositories.
New advisories require rebuilding with fresh package layers (`docker compose
build --pull --no-cache`) and running `bash scripts/scan_images.sh gate`.
The scan remains the verification of the resulting image's vulnerabilities.
