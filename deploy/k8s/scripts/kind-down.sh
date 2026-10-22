#!/usr/bin/env bash
# Delete the local kind cluster created by kind-up.sh (and its generated files).
set -euo pipefail
KIND="${KIND:-kind}"
CLUSTER="${CLUSTER:-securecart}"
k8s="$(cd "$(dirname "$0")/.." && pwd)"
"$KIND" delete cluster --name "$CLUSTER"
rm -f "$k8s/overlays/kind/secrets.env" "$k8s/overlays/kind/local-ca.crt"
