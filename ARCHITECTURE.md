# Architecture - Tindahan (v3.0.0)

Single-device, offline-first POS. No backend, no payment processing, no telemetry, no runtime CDN. All state lives in the browser profile.

## Stack

- React 19 + TypeScript + Vite 6 (`src/App.tsx`, `src/main.tsx`, `vite.config.ts`)
- Dexie 4 over IndexedDB, database name `tindahan-local` (`src/db.ts`)
- `dexie-react-hooks` `useLiveQuery` for reactive reads
- Tailwind CSS 4 via `@tailwindcss/vite`, system fonts, light/dark theme via `documentElement.dataset.theme`
- PWA via `vite-plugin-pwa`, `registerType: prompt`, Workbox precache, `navigateFallback: /index.html`
- jsPDF for receipts/reports, JsBarcode for Code 128 labels, `lucide-react` icons, DM Sans font (bundled)
- Tests: Vitest unit (`npm test`), Playwright Chrome desktop/mobile (`npm run test:e2e`)

## Runtime layout

- `src/App.tsx`: Sell / Products / Sales / Reports / Settings / Store tools shell, scanner input queue, dialogs, toasts, SW update state.
- `src/views.tsx`: Products, Sales history, Daily reports, Settings screens.
- `src/retail-views.tsx` + `src/sell-extras.tsx`: Customers, Saved orders, Inventory, Purchasing, Cash drawer, Employees, Analytics, Checkout settings, camera scanner, customer display window.
- `src/checkout-dialog.tsx` + `src/components.tsx`: checkout form, product form, modals, quantity controls.
- `src/work.ts`: serializes mutating work (`runWork`, browser locks) so scans, checkouts, and SW updates do not race.
- `src/storage.ts` + `src/useInstall.ts`: quota estimates, pressure handling, install prompt.

## Data and money rules

Database versions (`src/db.ts:StoreDatabase`):

- v1: `products`, `sessions`, `scans`, `settings`
- v2: adds `cart`, `sales`, `corrections`, `audit`; indexes `saleId` on scans
- v3: adds `customers`, `suppliers`, `purchases`, `stockMovements`, `tickets`, `shifts`, `cashMovements`, `employees`, `timeEntries`; drops one-correction-per-sale unique index to allow repeated partial refunds

Key invariants (see `src/pricing.ts`, `src/validation.ts`, `src/retail-types.ts`):

- Money in integer centavos. Discounts and tax are allocated to item rows so row totals equal receipt total. Refunds use cumulative rounding.
- Checkout is one Dexie transaction: payment record, immutable sale + scan snapshots, stock deductions, loyalty earn/redeem, cart clear, audit entry. Stale or duplicate checkout is rejected.
- Corrections never mutate the original sale row. Void is current-day only and blocked after any partial refund. Repeated partial refunds cannot exceed original quantity or amount paid.
- Kilogram goods store stock in integer grams. Cart quantity is bag count for a fixed `weightGrams`.
- Dates use `Asia/Manila` (`today()` in `src/db.ts`). Closed daily reports are frozen; refunds on old sales land in the current day and can make it negative.

## Backup, security, deployment

- Backup: compact validated JSON (`src/backup-format.ts`, `src/backup.ts`, `src/backup.worker.ts`). Same schema and limits enforced on export and restore. Plain JSON max 25 MiB, encrypted file max 36 MiB. Record caps in `src/validation.ts:backupLimits`. v1/v2 backups restorable; v3 adds new tables.
- Optional encryption: PBKDF2-SHA-256 600k iterations + random salt, AES-256-GCM + random IV. Protects the file only, not IndexedDB. No recovery.
- Access control: optional 6-12 digit owner PIN and employee PINs (`src/owner.ts`, `src/staff-access.ts`). Enforced at the DB API layer, 15-min unlock per window, 8-hr staff session. Does not encrypt storage; activity log is not tamper-proof.
- Web security (`security/headers.ts`, `vite.config.ts:productionSecurity`): same-origin only, no inline scripts/styles, no frames/objects, generated `dist/_headers` and `dist/security-headers.nginx.conf`. Dev server stays permissive for HMR; strict CSP is verified in `preview`/prod.
- Deploy: serve `dist/` at root of a dedicated HTTPS origin, keep the same origin across releases. Vercel uses root `vercel.json`; Nginx uses `deploy/nginx.conf.example`. Keep prior build + hashed assets for rollback; old builds cannot reopen a v3 DB.

Related: `README.md`, `FEATURES.md`, `DEPLOYMENT-NOTE.md`, `DEPLOYMENT-REVIEW.md`, `CHANGELOG.md`, `DECISIONS.md`, `ROADMAP.md`.
