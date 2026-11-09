<p align="center">
  <img src="public/kitsunegate-mark.svg" width="128" alt="KitsuneGate logo">
</p>

<h1 align="center">KitsuneGate</h1>

<p align="center">
  <strong>An HAProxy-powered control plane for resilient proxy pools, automatic failover, and multi-ingress routing.</strong>
</p>

KitsuneGate turns VLESS, VMess, Shadowsocks, Trojan, Hysteria2, and SOCKS outbounds into reliable local or server-side proxy pools. Each pool owns a listener port, a routing policy, independent health checks, and live traffic telemetry. HAProxy distributes production traffic on Linux and Docker while sing-box provides the outbound protocol stack.

> KitsuneGate is an independent project and is not affiliated with or endorsed by HAProxy Technologies or the sing-box project.

## Highlights

- Real data plane backed by HAProxy and sing-box—no simulated routing or health results
- Unlimited proxy groups, each with its own listen address and port
- Load balancing, failover, lowest-latency, and fixed-node policies
- Weighted least-connections, weighted round-robin, and weighted-random algorithms
- Real HTTP/HTTPS checks through every node's dedicated sing-box SOCKS adapter
- Configurable check URLs, intervals, timeouts, failure/recovery thresholds, and latency tolerance
- Manual forms, sing-box/Xray outbound JSON, and share-link imports
- VLESS, VMess, Shadowsocks, Trojan, Hysteria2, and SOCKS support
- Encrypted node credentials stored locally with AES-256-GCM
- Live bidirectional throughput, active connections, per-port totals, and 30-minute to 7-day trends
- Searchable HAProxy, sing-box, control-plane, and configuration event logs
- Configurable one-second to 60-second sampling and data-retention policies
- English by default, with Simplified Chinese, Japanese, French, and Korean interfaces
- Responsive web dashboard with server-persisted settings
- Docker image support for `linux/amd64` and `linux/arm64`

Built-in demonstration nodes use reserved `example.com` addresses and are disabled automatically. Add real node credentials before enabling traffic.

## Architecture

```text
Client :1188 ─┐                         ┌─ VLESS node A
Client :2288 ─┼─> HAProxy listeners ───┼─ Shadowsocks node B
Client :3388 ─┘        │                └─ Trojan/Hysteria2 node C
                       │
                 KitsuneGate API
                 ├─ health checks
                 ├─ routing policy
                 ├─ runtime reloads
                 ├─ traffic samples
                 └─ web dashboard

Each HAProxy backend points to a dedicated local sing-box SOCKS adapter.
```

## Quick start with Docker Compose

Linux with Docker Engine and Docker Compose v2 is required. Host networking lets newly created proxy-group ports become available without editing the Compose file.

```bash
git clone https://github.com/touka2014/kitsunegate.git
cd kitsunegate
cp .env.example .env
```

Edit `.env` and set a strong password. The default command pulls the official prebuilt image and starts it:

```bash
docker compose up -d
docker compose ps
docker compose logs -f kitsunegate
```

Open `http://SERVER_IP:8080` and sign in with the credentials from `.env`. Proxy clients connect to `SERVER_IP:GROUP_PORT`, such as `SERVER_IP:1188`.

To force a build from the checked-out source instead:

```bash
KITSUNEGATE_IMAGE=kitsunegate:local docker compose up -d --build
```

## Configuration

| Variable                     | Default                                | Purpose                                                               |
| ---------------------------- | -------------------------------------- | --------------------------------------------------------------------- |
| `KITSUNEGATE_IMAGE`          | `ghcr.io/touka2014/kitsunegate:latest` | Container image; override with `kitsunegate:local` for a source build |
| `KITSUNEGATE_WEB_ORIGIN`     | `http://localhost:8080`                | Browser origin allowed by the management API                          |
| `KITSUNEGATE_ADMIN_USER`     | `kitsunegate`                          | HTTP Basic Authentication username                                    |
| `KITSUNEGATE_ADMIN_PASSWORD` | none                                   | Required management password                                          |
| `KITSUNEGATE_DATA_DIR`       | `/app/data` in Docker                  | SQLite database and credential key location                           |
| `KITSUNEGATE_RUNTIME_DIR`    | `/app/runtime` in Docker               | Generated HAProxy and sing-box configuration                          |
| `KITSUNEGATE_SECRET`         | generated locally                      | Optional stable secret used to derive the credential-encryption key   |
| `KITSUNEGATE_BALANCER`       | `haproxy` in Docker                    | Set to `builtin` only when HAProxy is unavailable                     |

Keep `deployment-data/` and `.env` out of version control. Back up the database and `.secret` together; encrypted node credentials cannot be recovered without the matching secret.

## Local development

Node.js `22.13+` is required; Node.js 24 is recommended.

```powershell
npm install
npm run core:install
npm run dev
```

Open `http://localhost:3000` and sign in as `kitsunegate`. For local development the first start generates a password in `data/.admin-password`. You can instead set `KITSUNEGATE_ADMIN_USER` and `KITSUNEGATE_ADMIN_PASSWORD` before starting. The local API binds to `127.0.0.1:8787` and requires the same credentials. In Docker, Nginx reaches the API through a private Unix socket. `/readyz` returns HTTP 503 when the data plane is unavailable. API clients must send `Content-Type: application/json` on writes. Windows uses KitsuneGate's built-in TCP balancer because HAProxy does not provide an official native Windows distribution; sing-box still carries real proxy traffic and health checks.

Test a listener with:

```powershell
curl.exe --proxy socks5h://127.0.0.1:1188 https://www.gstatic.com/generate_204
```

Health-check targets accept one URL per line, optionally followed by a space and an expected HTTP status, e.g. `https://example.org/check 204`. The default is 204 for `/generate_204` and any 2xx response elsewhere. Testing draft settings leaves saved health counters and routing untouched.

## Data and upgrades

- `data/kitsunegate.db`: groups, nodes, settings, events, logs, and traffic samples
- `data/.secret`: local credential-encryption key
- `runtime/bin/sing-box.exe`: Windows core installed by `npm run core:install`
- `runtime/generated/`: active HAProxy and sing-box configurations

Existing RelayDeck installations are migrated in place: `relaydeck.db` is renamed to `kitsunegate.db`, and legacy `RELAYDECK_*` environment variables remain accepted for the transition. User-created groups, nodes, statistics, and encryption keys are preserved.

## Validation

```bash
npm run lint
npm test
npm run build
docker compose build
```

The container build runs linting, automated tests, and the production web build before producing an image.

## Publishing images

The included GitHub Actions workflow publishes multi-platform images to GitHub Container Registry whenever a semantic version tag is pushed:

```bash
git tag -a v0.1.0 -m "KitsuneGate v0.1.0 — First Tail"
git push origin v0.1.0
```

It publishes the following image tags:

```text
ghcr.io/touka2014/kitsunegate:0.1.0
ghcr.io/touka2014/kitsunegate:0.1
ghcr.io/touka2014/kitsunegate:latest
```

The workflow generates an SBOM, build provenance, and `amd64`/`arm64` manifests, then creates the matching GitHub Release. Add curated notes at `docs/releases/<tag>.md`; when that file is absent, GitHub-generated notes are used instead. No Docker Hub account is required.

After the first tagged build, open the package settings on GitHub and set the container package visibility to **Public**. This lets users pull the image without signing in to GHCR.

KitsuneGate keeps machine-readable SemVer tags and gives each GitHub Release an artistic codename. The first planned release is `v0.1.0 — First Tail`; later codenames can follow the nine-tailed fox motif without changing normal version ordering or image tags.

## Security

- Do not expose port `8080` over the public internet without HTTPS.
- Restrict the management port by firewall or private network.
- Use a unique, high-entropy management password.
- Never commit `.env`, `deployment-data/`, `data/`, database files, or `.secret`.
- Review imported outbound JSON before saving it.

## License

KitsuneGate is released under the [MIT License](LICENSE).
