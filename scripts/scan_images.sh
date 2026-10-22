#!/usr/bin/env bash
# Scan every image docker-compose.yml runs with Trivy.
#
#   scripts/scan_images.sh gate     images that ship (ours + runtime dependencies):
#                                   exit 1 on any HIGH/CRITICAL vulnerability with a fix
#   scripts/scan_images.sh report   local-only emulators (Mailpit, MinIO, stripe-mock):
#                                   full report, never fails; they are not deployed
#
# The image list comes from `docker compose config --images`, so a service added to compose
# is scanned without touching this script. Built images must exist locally
# (`docker compose build`); third-party images are pulled. Accepted risks live in
# .trivyignore.yaml, each with a statement and an expiry date: once an entry expires the
# finding fails the gate again and has to be re-reviewed.
#
# Env: TRIVY (binary, default "trivy"), TRIVY_CACHE_DIR, COMPOSE_PROJECT_NAME,
#      REPORT_DIR (default trivy-reports).
set -euo pipefail

mode="${1:-gate}"
trivy="${TRIVY:-trivy}"
report_dir="${REPORT_DIR:-trivy-reports}"
root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
mkdir -p "$report_dir"

# Emulators used only for local runs and tests. Anything else compose runs is gated.
emulators='^(axllent/mailpit|cgr.dev/chainguard/minio|minio/minio|stripe/stripe-mock)[:@]'

# `compose config` refuses to render without the required secrets; scanning needs none.
images="$(DJANGO_SECRET_KEY="${DJANGO_SECRET_KEY:-scan-only}" \
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-scan-only}" \
  docker compose config --images | sort -u)"

selected=()
while IFS= read -r image; do
  [ -n "$image" ] || continue
  if [[ "$image" =~ $emulators ]]; then
    [ "$mode" = "report" ] && selected+=("$image")
  else
    [ "$mode" = "gate" ] && selected+=("$image")
  fi
done <<< "$images"

if [ "${#selected[@]}" -eq 0 ]; then
  echo "No images to scan in '$mode' mode."
  exit 0
fi

status=0
for image in "${selected[@]}"; do
  # Built images have no registry to pull from; everything else is pulled at its pinned tag.
  docker image inspect "$image" > /dev/null 2>&1 || docker pull --quiet "$image" > /dev/null
  safe_name="$(echo "$image" | tr '/:@' '___')"
  json="$report_dir/$safe_name.json"
  echo "::group::Trivy ($mode): $image"
  if [ "$mode" = "gate" ]; then
    set +e
    "$trivy" image --quiet --scanners vuln --severity HIGH,CRITICAL --ignore-unfixed \
      --ignorefile .trivyignore.yaml --exit-code 1 --format json --output "$json" "$image"
    code=$?
    set -e
  else
    "$trivy" image --quiet --scanners vuln --ignorefile .trivyignore.yaml \
      --exit-code 0 --format json --output "$json" "$image"
    code=0
  fi
  if [ ! -s "$json" ]; then
    echo "::endgroup::"
    echo "ERROR $image: Trivy produced no report (exit $code)"
    status=1
    continue
  fi
  "$trivy" convert --format table "$json"
  echo "::endgroup::"
  if [ "$code" -ne 0 ]; then
    echo "FAIL $image: fixable HIGH/CRITICAL vulnerabilities (see the table above)"
    status=1
  else
    echo "PASS $image"
  fi
done
exit "$status"
