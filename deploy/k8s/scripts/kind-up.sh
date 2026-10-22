#!/usr/bin/env bash
# Bring SecureCart up on a local kind cluster behind Traefik with TLS, then smoke-test it.
#
#   deploy/k8s/scripts/kind-up.sh        # https://securecart.localtest.me:5403
#   deploy/k8s/scripts/kind-down.sh      # delete the cluster
#
# Needs docker, kind, kubectl, kustomize, helm and openssl (override the binaries with
# KIND=..., KUBECTL=..., KUSTOMIZE=..., HELM=...). localtest.me resolves to 127.0.0.1.
# Host ports: HTTPS_PORT (5403) and HTTP_PORT (5404, redirects to HTTPS).
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows: keep "/CN=..." and paths literal

KIND="${KIND:-kind}"
KUBECTL="${KUBECTL:-kubectl}"
KUSTOMIZE="${KUSTOMIZE:-kustomize}"
HELM="${HELM:-helm}"
CLUSTER="${CLUSTER:-securecart}"
HTTPS_PORT="${HTTPS_PORT:-5403}"
HTTP_PORT="${HTTP_PORT:-5404}"
HOST="securecart.localtest.me"
NODE_IMAGE="kindest/node:v1.37.0@sha256:a1ed56cfb0e7b93589bdf97c8cd566405a265939e3620fc4f5de89adff580ae5"
TRAEFIK_CHART_VERSION="42.1.3"
# SHA-256 of traefik-42.1.3.tgz as published in https://traefik.github.io/charts/index.yaml
TRAEFIK_CHART_SHA256="10ec2b032fd7ec9fa04a8816872e20ba0fafc47231f6394b5cb5d522f3b0ef50"

here="$(cd "$(dirname "$0")" && pwd)"
k8s="$(cd "$here/.." && pwd)"
repo="$(cd "$k8s/../.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
kc() { "$KUBECTL" --context "kind-$CLUSTER" "$@"; }
# Windows binaries (Git Bash) need Windows paths; elsewhere this is a no-op.
native() { if command -v cygpath > /dev/null; then cygpath -m "$1"; else echo "$1"; fi; }

echo "==> kind cluster '$CLUSTER'"
cat > "$work/kind.yaml" <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
    image: $NODE_IMAGE
    extraPortMappings:
      - { containerPort: 30443, hostPort: $HTTPS_PORT, listenAddress: "127.0.0.1" }
      - { containerPort: 30080, hostPort: $HTTP_PORT, listenAddress: "127.0.0.1" }
EOF
if ! "$KIND" get clusters | grep -qx "$CLUSTER"; then
  "$KIND" create cluster --name "$CLUSTER" --config "$(native "$work/kind.yaml")" --wait 120s
fi

echo "==> images (built locally, loaded into the node)"
(cd "$repo" && DJANGO_SECRET_KEY=build POSTGRES_PASSWORD=build REDIS_PASSWORD=build \
  MINIO_ROOT_PASSWORD=build docker compose build backend frontend)
"$KIND" load docker-image --name "$CLUSTER" securecart-backend:local securecart-frontend:local

echo "==> Traefik ingress controller (chart $TRAEFIK_CHART_VERSION, checksum-verified)"
curl -fsSLo "$(native "$work/traefik.tgz")" \
  "https://traefik.github.io/charts/traefik/traefik-${TRAEFIK_CHART_VERSION}.tgz"
echo "$TRAEFIK_CHART_SHA256  $work/traefik.tgz" | sha256sum --check --strict
"$HELM" upgrade --install traefik "$(native "$work/traefik.tgz")" \
  --kube-context "kind-$CLUSTER" --namespace traefik --create-namespace --wait \
  --set service.type=NodePort \
  --set ports.web.nodePort=30080 \
  --set ports.websecure.nodePort=30443 \
  --set 'ports.web.http.redirections.entryPoint.to=websecure' \
  --set 'ports.web.http.redirections.entryPoint.scheme=https' \
  --set 'ports.web.http.redirections.entryPoint.permanent=true' \
  --set ingressClass.enabled=true \
  --set ingressClass.isDefaultClass=false \
  --set providers.kubernetesCRD.enabled=false \
  --set providers.kubernetesGateway.enabled=false

echo "==> secrets (random, written to overlays/kind/secrets.env, never committed)"
secrets="$k8s/overlays/kind/secrets.env"
if [ ! -f "$secrets" ] || ! grep -q '^DATABASE_URL=' "$secrets"; then
  pg="$(openssl rand -hex 24)"
  redis="$(openssl rand -hex 24)"
  minio="$(openssl rand -hex 24)"
  {
    echo "DJANGO_SECRET_KEY=$(openssl rand -hex 48)"
    echo "POSTGRES_PASSWORD=$pg"
    echo "DATABASE_URL=postgres://securecart:$pg@postgres:5432/securecart"
    echo "REDIS_PASSWORD=$redis"
    echo "REDIS_URL=redis://:$redis@redis:6379/0"
    echo "MEDIA_S3_ACCESS_KEY=securecart"
    echo "MEDIA_S3_SECRET_KEY=$minio"
    echo "EMAIL_HOST_USER="
    echo "EMAIL_HOST_PASSWORD="
    echo "STRIPE_SECRET_KEY="
    echo "STRIPE_WEBHOOK_SECRET="
  } > "$secrets"
fi

echo "==> TLS: self-signed certificate for $HOST (cert-manager issues it in production)"
openssl req -x509 -newkey rsa:2048 -sha256 -nodes -days 30 \
  -keyout "$(native "$work/tls.key")" -out "$(native "$k8s/overlays/kind/local-ca.crt")" \
  -subj "/CN=$HOST" -addext "subjectAltName=DNS:$HOST" 2> /dev/null
cp "$k8s/overlays/kind/local-ca.crt" "$work/tls.crt"
"$KUSTOMIZE" build "$(native "$k8s/overlays/kind")" > "$work/manifests.yaml"
kc apply -f - <<EOF > /dev/null
apiVersion: v1
kind: Namespace
metadata:
  name: securecart
EOF
kc -n securecart create secret tls securecart-tls \
  --cert="$(native "$work/tls.crt")" --key="$(native "$work/tls.key")" --dry-run=client -o yaml |
  kc apply -f -

echo "==> apply the kind overlay"
kc delete job -n securecart migrate seed-demo --ignore-not-found > /dev/null
kc apply -f "$(native "$work/manifests.yaml")"
kc -n securecart wait --for=condition=complete job/migrate --timeout=300s
kc -n securecart wait --for=condition=complete job/seed-demo --timeout=300s
for deploy in backend frontend scheduler redis minio mailpit; do
  kc -n securecart rollout status "deploy/$deploy" --timeout=300s
done

echo "==> smoke test over HTTPS (verified against the local certificate)"
base="https://$HOST:$HTTPS_PORT"
ca="$(native "$k8s/overlays/kind/local-ca.crt")"
curl -fsS --cacert "$ca" "$base/api/health/"
echo
curl -fsS --cacert "$ca" "$base/api/products/?search=lamp" | grep -q "Halo Table Lamp"
sink="$(native "$work/body")" # Windows curl cannot open /dev/null with path conversion off
curl -fsS --cacert "$ca" -o "$sink" -D - "$base/" | grep -qi "content-security-policy"
test "$(curl -s --cacert "$ca" -o "$sink" -w '%{http_code}' "$base/api/admin/dashboard/")" = "401"
code="$(curl -s -o "$sink" -w '%{http_code}' "http://$HOST:$HTTP_PORT/")"
case "$code" in 301 | 308) ;; *) echo "expected an HTTPS redirect, got $code"; exit 1 ;; esac
echo "SecureCart is up at $base (CA: $ca)"
