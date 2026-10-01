# Decisions - Tindahan

Lightweight decision log. Newest first. Each entry: context, decision, consequence. Code refs are the enforcement point.

## 2026-09-28 - Stay single-device offline, no backend

Context: Small Philippine store needs checkout during internet loss; no ops budget for servers or payment integration.

Decision: All records in IndexedDB (`tindahan-local` via Dexie). Payments recorded, collected externally. PWA precache for offline reopen.

Consequence: Phones do not share stock/customers/sales. Multi-store, cloud sync, and online payments are non-goals (see `ROADMAP.md`). Moving origins requires export/restore.

Enforced in: `src/db.ts`, `vite.config.ts (VitePWA)`, `README.md`.

## 2026-09-28 - Money in integer centavos with allocated discounts/tax

Context: Floating peso math drifts on splits, discounts, tax, and refunds.

Decision: Store and compute in integer centavos. Allocate order discount and tax to item rows so rows sum to receipt total. Partial refunds and cash/tax reversals use cumulative rounding.

Consequence: Original rows stay exact; all remaining units together refund exactly what was paid.

Enforced in: `src/pricing.ts`, `src/db.ts:Sale/Correction`, `src/checkout.test.ts`.

## 2026-09-28 - Checkout as one atomic transaction with immutable snapshots

Context: Two windows, reloads, and retries must not double-charge, double-deduct, or double-spend loyalty.

Decision: Checkout commits payment, sale + scan snapshots, stock moves, loyalty deltas, cart clear, and audit in one Dexie transaction. Catalog edits later do not rewrite receipts. Stale/duplicate checkout rejected.

Consequence: Receipts are historical facts; catalog deletion never erases them; stock cannot return to a deleted or unit-changed product.

Enforced in: `src/db.ts`, `src/retail.ts`, `src/operational-loops.test.ts`.

## 2026-09-28 - Corrections append, never edit; void is current-day only

Context: Day reports must stay auditable after close.

Decision: Voids/refunds append `Correction` rows with reason, operator, timestamp, amounts, and stock-return flag. Void allowed only in the current open day and blocked after any partial refund. Refunds on old sales record in the current day.

Consequence: Closed reports frozen; current day can go negative; repeated partials capped at original quantity/amount.

Enforced in: `src/db.ts`, `src/views.tsx:SalesView`, `FEATURES.md#money-and-stock-rules`.

## 2026-09-28 - IndexedDB v3 adds tables, drops one-correction-per-sale index

Context: v3 needs customers, suppliers, purchases, movements, tickets, shifts, cash moves, employees, time entries, plus multiple refunds per sale.

Decision: `this.version(3)` adds the new tables and changes `corrections` index from `&saleId` (unique) to `saleId` (non-unique). Upgrade preserves existing records; no table cleared.

Consequence: Old builds cannot reopen a v3 DB or restore a v3 backup. Rollback requires a fresh profile + pre-upgrade backup.

Enforced in: `src/db.ts:StoreDatabase`, `src/db.test.ts`, `FEATURES.md#upgrade-and-recovery`.

## 2026-09-28 - Bounded backups with worker-side validation

Context: Unbounded exports produce files the app cannot restore.

Decision: Same schema + byte + record limits on export and restore. Plain JSON 25 MiB, encrypted 36 MiB. Parse/decrypt/validate in `backup.worker.ts` with 20s timeout, then re-validate before atomic replace.

Consequence: Oversized exports fail before download with a clear message. Caps documented in `README.md#backups-and-owner-controls`.

Enforced in: `src/validation.ts:backupLimits`, `src/backup-format.ts`, `src/backup.ts`.

## 2026-09-28 - File-only encryption (PBKDF2 600k + AES-256-GCM)

Context: Stores want portable backup privacy without server key management.

Decision: Optional password (12-200 chars), PBKDF2-SHA-256 600k + random salt, AES-256-GCM + random IV. No recovery.

Consequence: Export file protected; live IndexedDB stays unencrypted. Lost password means lost file.

Enforced in: `src/owner.ts:passwordKey`, `src/backup-format.ts:encodeBackup/decodeBackup`.

## 2026-09-28 - PINs restrict UI actions, not storage

Context: Shared device needs cashier/manager separation without a server.

Decision: Owner PIN (6-12 digits) + employee PINs enforced at the DB API layer (`assertOwner`). 15-min owner unlock per window, 8-hr staff session. Hashes salted with PBKDF2 + cooldown.

Consequence: Blocks normal app actions but not raw profile access. Activity log not tamper-proof. Device lock and backup privacy still required.

Enforced in: `src/owner.ts`, `src/staff-access.ts`, `src/security.test.ts`.

## 2026-09-28 - PWA prompt update with locks, not forced reload

Context: Forced SW activation can lose pending sales or unsaved forms across windows.

Decision: `registerType: prompt`. Pending ops and dirty forms hold shared browser locks + broadcast channel; update takes exclusive lock and defers while work is pending.

Consequence: Users finish work in all windows before updating; stalled activation releases for retry.

Enforced in: `src/work.ts`, `src/App.tsx:updateServiceWorker`, `vite.config.ts`.

## 2026-09-28 - Strict CSP only in prod, generated host headers

Context: Vite HMR needs inline scripts; prod must block them.

Decision: Dev server permissive; prod injects CSP meta + emits `dist/_headers` and `dist/security-headers.nginx.conf` from `security/headers.ts`. Same-origin only, no frames/objects/external connections. Vercel mirrors them in `vercel.json`.

Consequence: Preview/prod checks required; uploading `dist` alone to a non-Vercel host without headers leaves policy unenforced.

Enforced in: `security/headers.ts`, `vite.config.ts:productionSecurity`, `vercel.json`.

## 2026-09-28 - Philippine timezone and plain-language UI

Context: Daily close, reports, and analytics must agree on "today"; staff need readable screens.

Decision: All day logic in `Asia/Manila` via `today()`/`dateLabel()`. UI uses system fonts, plain labels, red required asterisks + native validation, focus-trapped dialogs, phone bottom nav.

Consequence: Tests and reports assume Manila time; layout verified at 320-480 px in Chrome, not yet on physical devices.

Enforced in: `src/db.ts:today`, `src/components.tsx`, `DEPLOYMENT-NOTE.md#store-acceptance-checks`.
