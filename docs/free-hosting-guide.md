# Free hosting guide: preorder-manager

How the **preorder-manager** Shopify app is hosted for **$0/month** and installed on a store in another organization (Snoga Athletics, Shopify Plus). It covers every step we took, the settings we used, and how to release updates.

---

## 1. Overview

| Piece | Service | Plan | Cost |
|---|---|---|---|
| Code | [GitHub](https://github.com/TarikBouich/preorder-app) | Free | $0 |
| App hosting (server) | [Netlify](https://app.netlify.com) | Free (300 credits/month) | $0 |
| Database (Shopify login sessions only) | [Neon](https://console.neon.tech) Postgres | Free (0.5 GB) | $0 |
| Shopify app + install link | [Shopify Dev Dashboard](https://dev.shopify.com) | Custom distribution | $0 |

**Live app URL:** https://preorder-manager.netlify.app

```
Snoga admin ──opens──▶ preorder-manager (embedded app)
                              │
                              ▼
               Netlify Function (React Router server)
                     │                    │
                     ▼                    ▼
          Shopify Admin API        Neon Postgres
          (products, tags,         (login sessions)
           variant metafields)
```

The app keeps no product data of its own. Tags and variant metafields live in Shopify. The database only stores Shopify login sessions.

---

## 2. Two Shopify apps: dev and production

We use **two separate apps** with the same code, so testing never touches the live store.

| | Dev app | Production app |
|---|---|---|
| Client ID | `0f0737f0…` | `9e4affc1…` |
| Config file | `shopify.app.preorder-manager.toml` (CLI default) | `shopify.app.production.toml` |
| Runs on | Your laptop (`shopify app dev`, temporary tunnel URL) | Netlify (`https://preorder-manager.netlify.app`) |
| Installed on | Dev stores (e.g. Clive App DEV) | Snoga (and stores you generate links for) |
| Database | Neon branch **dev** | Neon branch **main** |

The production app was created with:

```bash
shopify app config link
# Organization: ours → Create new app → name: preorder-manager → config name: production
```

The production config sets `automatically_update_urls_on_dev = false`, so a laptop can never point the live app at a temporary tunnel.

> `shopify app config link` switches the CLI's default to the new app. We switched it back with
> `shopify app config use shopify.app.preorder-manager.toml`, so `shopify app dev` always uses the dev app.

---

## 3. Choosing the free host

| Option | Result |
|---|---|
| **Render** (free web service) | ❌ Asks for a credit card (temporary $1 hold) even on the free plan. Dropped. |
| **Aiven** | ❌ Hosts databases only, not Node.js apps. |
| **Vercel** (Hobby) | ❌ No card needed, but the free plan is for non-commercial use only. |
| Fly.io / Railway | ❌ No real free tier for new accounts. |
| **Netlify** (free) | ✅ No card, commercial use allowed. **Chosen.** |

**Netlify free-plan rules to remember**

- 300 credits per month. When they run out, Netlify **pauses the site until next month** (no surprise bill).
- Each production deploy costs about **15 credits**. Deploy previews are free.
- The server runs as a serverless function, so there's no sleeping. The first request after a pause takes about 1–2 seconds.

---

## 4. Code changes made for free hosting

| File | Change | Why |
|---|---|---|
| `prisma/schema.prisma` | `provider = "postgresql"`, `url = env("DATABASE_URL")`, `directUrl = env("DIRECT_URL")` | Free hosts wipe local files on restart, so the SQLite session file would be lost. Sessions now live in Neon. |
| `prisma/schema.prisma` | `binaryTargets = ["native", "rhel-openssl-3.0.x"]` | Netlify Functions run on Amazon Linux and need Prisma's Linux engine. |
| `prisma/migrations/20261016000000_init_postgres/` | New Postgres migration for the `Session` table | The old migration was SQLite-only. |
| `vite.config.ts` | Added `netlifyReactRouter()` from `@netlify/vite-plugin-react-router@3.1.1` | Packages the server as a Netlify Function on build. (v4 needs Node ≥ 22.22, so we used v3.1.1.) |
| `netlify.toml` | Build command, publish dir, Node 22, Prisma engine included in the function, secret-scan exceptions | Netlify settings stored in the repo. |
| `shopify.app.production.toml` | `application_url` and `redirect_urls` → `https://preorder-manager.netlify.app` | Tells Shopify where the production app lives. |
| `.env.example`, `.gitignore` | Local DB settings template; `.env` and `.netlify` ignored | Keeps passwords out of Git. |

`netlify.toml`:

```toml
[build]
  command = "npx prisma migrate deploy && npm run build"
  publish = "build/client"

[build.environment]
  NODE_VERSION = "22"
  SECRETS_SCAN_OMIT_KEYS = "SHOPIFY_API_KEY,SHOPIFY_APP_URL,SCOPES"

[functions]
  included_files = [
    "node_modules/.prisma/client/libquery_engine-rhel-openssl-3.0.x.so.node",
    "node_modules/.prisma/client/schema.prisma",
  ]
```

---

## 5. Step by step: what we did

### Step 1: Put the code on GitHub

1. Created the repo: https://github.com/TarikBouich/preorder-app
2. Connected the existing local folder (no move needed):
   ```bash
   git branch -m master main
   git remote add origin git@github.com:TarikBouich/preorder-app.git
   git push -u origin main --tags
   ```
3. All commits are authored as **Tarik Bouich &lt;tarik.bouich14@gmail.com&gt;**.

### Step 2: Neon database

1. Created a project **preorder-manager** at https://console.neon.tech
2. Created two **branches**:
   - `main`: production (Netlify)
   - `dev`: local development (laptop)
3. Got connection strings from **Connect → choose branch**:
   - **Connection pooling ON** → `DATABASE_URL` (host contains `-pooler`)
   - **Connection pooling OFF** → `DIRECT_URL` (same host without `-pooler`)
   - Removed `&channel_binding=require` from the end of both strings, so each ends with `?sslmode=require`.
4. Local development: put the **dev** branch strings in `.env` (see `.env.example`). The table was created with:
   ```bash
   npx prisma migrate deploy
   npx prisma generate
   ```
5. Reset the **main** branch password (**Connect → main → Reset password**) before using it in Netlify.

### Step 3: Production Shopify app

1. Created it with `shopify app config link` (see section 2).
2. Its credentials:
   ```bash
   shopify app env show --config production
   # prints SHOPIFY_API_KEY, SHOPIFY_API_SECRET, SCOPES
   ```
   Or: **Dev Dashboard → Apps → preorder-manager (Client ID `9e4a…`) → Settings → Client credentials**.

### Step 4: Netlify site

1. https://app.netlify.com → **Add new project → Import an existing project → GitHub → TarikBouich/preorder-app**
2. **Project name:** `preorder-manager` → URL `https://preorder-manager.netlify.app`
3. **Branch to deploy:** `production` (not `main`; see section 6)
4. Build settings come from `netlify.toml` and were left as is.
5. **Environment variables:**

   | Key | Value |
   |---|---|
   | `SHOPIFY_API_KEY` | `9e4affc129bc14ae2bf8ca10e7e26880` (public Client ID) |
   | `SHOPIFY_API_SECRET` | Production app's client secret |
   | `SHOPIFY_APP_URL` | `https://preorder-manager.netlify.app` |
   | `SCOPES` | `read_products,write_products` |
   | `DATABASE_URL` | Neon **main**, pooling ON, without `channel_binding` |
   | `DIRECT_URL` | Neon **main**, pooling OFF, without `channel_binding` |

6. **Deploy.** Opening https://preorder-manager.netlify.app shows the app's public landing page with the "Shop domain" box, which means it's live.

### Step 5: Register the URL with Shopify

```bash
shopify app deploy --config production
```

This pushes the production config (URL, permissions, webhooks) to Shopify and releases a new app version.

### Step 6: Install on Snoga (custom distribution)

1. **Dev Dashboard → Apps → preorder-manager (`9e4a…`) → Distribution → Custom distribution.** This choice can't be changed later.
2. Entered Snoga's `.myshopify.com` domain. Snoga is on **Plus**, so other stores in the same Plus organization can be allowed too.
3. **Generate link** and send it to Snoga's **store owner** (or staff with "Manage and install apps and channels"). Collaborator accounts are often blocked from installing these apps.
4. The owner opens the link while logged into Snoga's admin and clicks **Install**.

On first open, the app **checks whether the variant metafield definitions exist** and creates only the missing ones. Snoga's existing `custom.is_pre_order` and `custom.pre_order_ship_date` are never changed.

---

## 6. Releasing updates (no new install link needed)

The install link is needed **once per store**. After that, updates reach Snoga automatically.

```bash
# 1. Develop and test locally on a dev store
shopify app dev

# 2. Save to GitHub (free; does not deploy)
git add -A && git commit -m "describe the change"
git push

# 3. Publish to Netlify / Snoga (~15 credits)
git push origin main:production

# 4. Only if the app config changed (name, scopes, webhooks, URL)
shopify app deploy --config production
```

| Change | Command | Does Snoga need to do anything? |
|---|---|---|
| Features, design, fixes | `git push origin main:production` | No |
| App name or webhooks | + `shopify app deploy --config production` | No |
| New permissions (scopes) | + `shopify app deploy --config production` | Yes, the owner approves once in the admin |
| App was uninstalled | New install link | Yes, reinstall |

**Why a separate `production` branch?** Each Netlify production deploy costs credits. Pushing everyday work to `main` costs nothing, and we publish deliberately.

**Rollback:** Netlify → **Deploys** → pick an earlier deploy → **Publish deploy**. Or restore a git tag (`v0.1-working`, `v0.2-modern-ui`, …) and push it to `production`.

---

## 7. Problems we hit and how we fixed them

| Problem | Cause | Fix |
|---|---|---|
| `shopify app dev` showed nothing for minutes | The first run downloads `cloudflared` (~19 MB) over a slow connection | Wait; it only happens once |
| `dyld: Library not loaded: libicui18n.73.dylib` | Old Homebrew `shopify` and Node were found first in `PATH` | `nvm alias default 22.18.0`, `hash -r`, optionally `brew uninstall shopify-cli` |
| App permissions became `scopes = ""` | `shopify app config link` overwrote the TOML with the remote config | Restored `scopes = "read_products,write_products"` |
| Render asked for a card | Render's identity check, even on the free plan | Switched to Netlify |
| `npm install @netlify/vite-plugin-react-router` failed | v4 needs Node ≥ 22.22 | Used v3.1.1 |
| Prisma: `Environment variable not found: DATABASE_URL` | Client generated before `.env` existed | `npx prisma generate` again |
| Netlify build failed: "Secrets scanning found secrets" | The public Client ID is in `shopify.app.production.toml` | `SECRETS_SCAN_OMIT_KEYS = "SHOPIFY_API_KEY,SHOPIFY_APP_URL,SCOPES"`; real secrets are still scanned |

---

## 8. Security notes

- Secrets (`SHOPIFY_API_SECRET`, `DATABASE_URL`, `DIRECT_URL`) live **only** in Netlify environment variables and the local `.env`. They're never in Git.
- `SHOPIFY_API_KEY` (the Client ID) is public by design.
- If a secret leaks:
  - Shopify: rotate it under **Dev Dashboard → app → Settings**, then update Netlify.
  - Neon: **Reset password** for that branch, then update Netlify and/or `.env`.

---

## 9. Useful links

- GitHub repo: https://github.com/TarikBouich/preorder-app
- Live app: https://preorder-manager.netlify.app
- Netlify dashboard: https://app.netlify.com
- Neon console: https://console.neon.tech
- Shopify Dev Dashboard: https://dev.shopify.com
- Shopify: select a distribution method: https://shopify.dev/docs/apps/distribution/select-distribution-method
- Shopify CLI app config: https://shopify.dev/docs/apps/tools/cli/configuration
- Netlify React Router adapter: https://www.npmjs.com/package/@netlify/vite-plugin-react-router
- Netlify secrets scanning: https://ntl.fyi/configure-secrets-scanning
- Netlify pricing / credits: https://www.netlify.com/pricing/
- Neon pricing: https://neon.com/pricing
- Prisma with Neon: https://neon.com/docs/guides/prisma
