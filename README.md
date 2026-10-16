# preorder-manager

Embedded Shopify app for managing pre-orders: product pre-order tags plus per-variant pre-order flags and ship dates, all from one screen.

## What it does

- **Products page:** search as you type, expand a product to see its variants, switch pre-order on or off per variant, pick a ship date, then save everything at once with the save bar. A pre-order variant can't be saved without a ship date.
- **Stat cards:** All, Active, Inactive, Not on pre-order, and **Overdue** (ship date has passed). Click a card to filter the list.
- **Pre-orders page:** every active or inactive pre-order product, with each variant's ship date countdown and a Deactivate button.
- **Product page:** add or remove tags, bulk-edit variants.

## Data it uses

| Where | Key | Meaning |
|---|---|---|
| Product tag | `_pre_order:true` / `_pre_order:false` | Product is (in)active for pre-order |
| Product tag | `_status:pre-order` | Legacy marker; left untouched |
| Variant metafield | `custom.is_pre_order` (boolean) | Variant is sold as pre-order |
| Variant metafield | `custom.pre_order_ship_date` (date) | Expected ship date |

The theme reads these values. The app creates both metafield definitions on install if they don't exist.

**Rules**
- Product tags follow the variants: if any variant is on pre-order, the tags switch to `:true`. When the last variant is turned off, `_xxx:true` tags switch to `:false`.
- Turning a variant off clears its ship date.
- Deactivate turns every variant off and switches the tags to `:false`.

## Development

Requirements: Node 22.12+, [Shopify CLI](https://shopify.dev/docs/apps/tools/cli) (`npm install -g @shopify/cli`).

```bash
npm install
shopify app dev                                  # runs on the linked dev store
shopify app dev --store=other-store.myshopify.com  # switch dev store
```

App config: `shopify.app.preorder-manager.toml`.

Code map:
- `app/preorder.server.ts`: all Shopify Admin API calls (products, tags, metafields, overdue scan, tag sync)
- `app/preorder.ts`: shared constants, types and date helpers
- `app/routes/app._index.tsx`: Products page
- `app/routes/app.preorders.tsx`: Pre-orders page
- `app/routes/app.products.$id.tsx`: product page
- `app/components/ui.tsx`, `app/styles/app.css`: shared UI

Checks: `npm run typecheck && npm run lint && npm run build`

## Production (Netlify + Neon)

- Hosting: Netlify free plan (`netlify.toml`). The server runs as one Netlify Function.
- Database: Neon Postgres. It stores only Shopify sessions (`prisma/schema.prisma`).
- Shopify app: `shopify.app.production.toml` → https://preorder-manager.netlify.app

Netlify deploys **only from the `production` branch**, because each deploy uses free-plan credits. To release:

```bash
git push origin main:production          # deploy the current main
shopify app deploy --config production   # only when the app config changed
```

Netlify environment variables: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, `SHOPIFY_APP_URL`, `SCOPES`, `DATABASE_URL`, `DIRECT_URL`.

Local dev needs a `.env` pointing at the Neon `dev` branch (see `.env.example`).

## Versions

Git tags mark approved versions: `v0.1-working`, `v0.2-modern-ui`.
