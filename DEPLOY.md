# Deploying Kenya Airways to the public web

This guide takes the full stack from a fresh VPS to a **public, Google-indexable
HTTPS site** using a free subdomain (no purchased domain required). It is the
companion to `docker-compose.prod.yml`, `Caddyfile` and `.env.production.example`.

## 0. What you end up with

| Host                               | What                                                             | Searchable?                                                |
| ---------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `https://<you>.duckdns.org`        | Traveller web app (Next.js)                                      | Yes — robots.txt + sitemap.xml + JSON-LD + OG tags         |
| `https://admin.<you>.duckdns.org`  | Admin console                                                    | No — HTTP basic auth at the edge + `X-Robots-Tag: noindex` |
| `https://<you>.duckdns.org/api/v1` | Public API (used by the web app same-origin and the Android app) | No (not indexed)                                           |

Every piece of SEO plumbing lives in `apps/web/src/app` (`robots.ts`, `sitemap.ts`,
`layout.tsx` JSON-LD, per-route `metadata`/`noindex`). Nothing here needs editing
for a new domain — it all reads `SITE_URL` at runtime.

## 1. Prerequisites

- A VPS (any provider, 1 vCPU / 2 GB RAM is plenty) running a recent
  Debian/Ubuntu with Docker + the Compose plugin installed:
  ```bash
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker $USER   # then log out and back in
  ```
- Ports **80 and 443** open in the provider's firewall (Let's Encrypt needs 80
  for the HTTP-01 challenge; 443 serves the site).
- A free subdomain. **DuckDNS** is the easiest (no signup friction, no expiry):
  1. Sign in at https://www.duckdns.org with GitHub/Google.
  2. Create a subdomain, e.g. `kenyaairways-flight13.duckdns.org`.
  3. Set its IP to your VPS's public IP.
  4. (Optional but recommended) create a second one for the admin console,
     e.g. `kenyaairways-flight13-admin.duckdns.org`, pointing at the same IP.
- The repository cloned on the VPS:
  ```bash
  git clone https://github.com/thao-glitch/kenyaairways.git
  cd kenyaairways
  ```

## 2. Configure the environment

```bash
cp .env.production.example .env
```

Edit `.env` and replace every placeholder:

- `SITE_URL=https://kenyaairways-flight13.duckdns.org`
- `ADMIN_URL=https://kenyaairways-flight13-admin.duckdns.org`
- `NEXT_PUBLIC_ADMIN_URL=https://kenyaairways-flight13-admin.duckdns.org`
- `ACME_EMAIL=you@example.com`
- `POSTGRES_PASSWORD=` a strong random value (also update `DATABASE_URL`)
- The five secrets (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`,
  `SESSION_COOKIE_SECRET`, `ENCRYPTION_KEY`, `MPESA_CALLBACK_SECRET`) — generate
  with the same one-liners `pnpm bootstrap` uses, or any 32+ byte random string.
- `ADMIN_USER` / `ADMIN_PASSWORD_HASH` — see step 3.
- `MPESA_CALLBACK_BASE_URL` should be `https://…/api/v1` if you switch
  `MPESA_MODE` to `live`.

Generate the admin basic-auth hash:

```bash
docker run --rm caddy:2-alpine caddy hash-password --plaintext 'choose-a-strong-password'
```

Paste the resulting `$2a$…` hash into `ADMIN_PASSWORD_HASH=` (keep the quotes
off — the value contains `$`, which is fine inside `.env`).

## 3. Build and start

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

First build takes ~10 minutes (Node images + pnpm install + Next.js build).
Afterwards the stack starts in dependency order: Postgres → Redis → API → web/admin → Caddy.

Seed the database once (idempotent — safe to re-run):

```bash
docker compose -f docker-compose.prod.yml exec api pnpm db:seed
```

Check everything is healthy:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs --tail=20 caddy
```

## 4. Verify the site is crawlable

```bash
curl -sS https://kenyaairways-flight13.duckdns.org/robots.txt
curl -sS https://kenyaairways-flight13.duckdns.org/sitemap.xml | head -8
curl -sS https://kenyaairways-flight13.duckdns.org/ | grep -o '<meta property="og:image"[^>]*>'
```

You should see `Host: kenyaairways-flight13.duckdns.org` (bare hostname, no scheme)
and every sitemap URL prefixed with your `https://` domain.

Validate structured data before submitting:

- https://search.google.com/test/rich-results — paste the homepage URL, expect an
  **Airline** entity with no errors.
- https://search.google.com/test/mobile-friendly — expect "Page is mobile friendly".

## 5. Submit to Google

1. Open https://search.google.com/search-console and add a **URL prefix** property
   for `https://kenyaairways-flight13.duckdns.org`.
2. Verify ownership via the **HTML tag** method: copy the `<meta name="google-site-verification" …>`
   tag into `apps/web/src/app/layout.tsx` (inside `generateMetadata` → `verification.google`)
   and rebuild/redeploy. Or use the DNS TXT method if your subdomain provider
   supports it (DuckDNS does not support arbitrary TXT records — use the HTML tag).
3. In Search Console → **Sitemaps** → submit `https://kenyaairways-flight13.duckdns.org/sitemap.xml`.
4. Request indexing for the homepage and a couple of key pages (Flights, Plan, Manage).
5. Expect 1–7 days before results appear; the admin console must never appear in
   results (it is `noindex` + basic-auth + `X-Robots-Tag`).

## 6. Point the Android app at the new backend

In the app's **Settings → Server**, set the API URL to

```
https://kenyaairways-flight13.duckdns.org/api/v1
```

(or rebuild the APK with `F13_API_URL` set — see `build-apk.sh`).

## 7. Updating

```bash
cd kenyaairways
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Compose rebuilds only changed services. Database data persists in the `pgdata`
volume.

## 8. Troubleshooting

- **"Not secure" / cert not issued**: confirm ports 80/443 are open and the
  subdomain's A record points at this box. Caddy retries automatically; watch
  `docker compose logs caddy`.
- **502 Bad Gateway**: the API container is still starting (Prisma migrate at
  boot). Wait ~30 s and retry; check `docker compose logs api`.
- **Google shows "Discovered – currently not indexed"**: normal for a new site;
  keep the sitemap submitted and request indexing for the top pages. Make sure
  the host is **not** `localhost` in `/robots.txt` (that means `SITE_URL` was
  missing at build/runtime — set it in `.env` and recreate the web container).
- **Admin console reachable without a password**: check `ADMIN_PASSWORD_HASH` is
  set in `.env` and the Caddy container was recreated after editing it.
- **Uploads (site photos) disappear after a redeploy**: they live in the
  `uploads` named volume — do not `docker compose down -v`.
