FROM node:24-trixie-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run lint && npm test && KITSUNEGATE_API_SOCKET=/run/kitsunegate/api.sock npm run build

FROM node:24-trixie-slim AS core
RUN apt-get update && apt-get install -y --no-install-recommends unzip ca-certificates && rm -rf /var/lib/apt/lists/*
COPY scripts/install-core.mjs /tmp/install-core.mjs
RUN node /tmp/install-core.mjs /core

FROM node:24-trixie-slim
RUN apt-get update \
  && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends ca-certificates curl haproxy nginx openssl tini \
  && rm -rf /var/lib/apt/lists/*
COPY --from=core /core/xray /usr/local/bin/xray

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
    XRAY_BIN=/usr/local/bin/xray \
    HAPROXY_BIN=/usr/sbin/haproxy \
    KITSUNEGATE_API_SOCKET=/run/kitsunegate/api.sock \
    KITSUNEGATE_BALANCER=haproxy

EXPOSE 8080
HEALTHCHECK --interval=20s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:8080/readyz >/dev/null || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "scripts/container.mjs"]
