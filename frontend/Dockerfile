# syntax=docker/dockerfile:1.7

# ---- build the static SPA -------------------------------------------------------------
FROM node:24.22.1-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
# Set to "false" to hide the demo-account shortcuts on the sign-in page.
ARG VITE_DEMO_MODE=true
ENV VITE_DEMO_MODE=${VITE_DEMO_MODE}
RUN npm run build
# Pre-compress text assets once at the highest level, so nginx (gzip_static) never has to.
RUN find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.html' \
        -o -name '*.txt' \) -size +1k -exec gzip -9 -k -n {} +

# ---- serve with unprivileged nginx (runs as uid 101, listens on 8080) -----------------
FROM nginxinc/nginx-unprivileged:1.30.6-alpine3.24 AS runtime
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
