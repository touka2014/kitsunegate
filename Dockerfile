FROM node:24-trixie-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run lint && npm test && KITSUNEGATE_API_SOCKET=/run/kitsunegate/api.sock npm run build

FROM node:24-trixie-slim

ARG TARGETARCH
ARG SING_BOX_VERSION=1.14.0
ARG SING_BOX_SHA256_AMD64=e0a40801e1dc5d8bb467aa06493a2b5c45fe3d1e2d7ecb8d1bde8a439283d0d0
ARG SING_BOX_SHA256_ARM64=49421502a47263f07a06e1d9ace649fd52818e11b885fc366e9e79ccc4e102f4

RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl haproxy nginx openssl tini \
  && rm -rf /var/lib/apt/lists/* \
  && arch="${TARGETARCH:-$(dpkg --print-architecture)}" \
  && case "$arch" in \
       amd64) checksum="${SING_BOX_SHA256_AMD64}" ;; \
       arm64) checksum="${SING_BOX_SHA256_ARM64}" ;; \
       *) echo "Unsupported target architecture: $arch" >&2; exit 1 ;; \
     esac \
  && curl -fsSL -o /tmp/sing-box.tar.gz "https://github.com/SagerNet/sing-box/releases/download/v${SING_BOX_VERSION}/sing-box-${SING_BOX_VERSION}-linux-${arch}-glibc.tar.gz" \
  && echo "${checksum}  /tmp/sing-box.tar.gz" | sha256sum -c - \
  && tar -xzf /tmp/sing-box.tar.gz -C /tmp \
  && install -m 0755 "/tmp/sing-box-${SING_BOX_VERSION}-linux-${arch}-glibc/sing-box" /usr/local/bin/sing-box \
  && rm -rf /tmp/sing-box*

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/react ./dist/standalone/node_modules/react
COPY --from=build /app/node_modules/react-dom ./dist/standalone/node_modules/react-dom
COPY --from=build /app/node_modules/react-server-dom-webpack ./dist/standalone/node_modules/react-server-dom-webpack
COPY --from=build /app/node_modules/scheduler ./dist/standalone/node_modules/scheduler
COPY --from=build /app/server ./server
COPY --from=build /app/scripts/container.mjs ./scripts/container.mjs
COPY deploy/nginx.conf /etc/nginx/nginx.conf

RUN mkdir -p /app/data /app/runtime/generated /run/kitsunegate

ENV NODE_ENV=production \
    KITSUNEGATE_DATA_DIR=/app/data \
    KITSUNEGATE_RUNTIME_DIR=/app/runtime \
    SING_BOX_BIN=/usr/local/bin/sing-box \
    HAPROXY_BIN=/usr/sbin/haproxy \
    KITSUNEGATE_API_SOCKET=/run/kitsunegate/api.sock \
    KITSUNEGATE_BALANCER=haproxy

EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/readyz >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/container.mjs"]
