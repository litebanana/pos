# Roadmap - Tindahan

Source of truth for what is done, what is next, and what is explicitly out of scope. Details of current behavior are in `FEATURES.md`; release steps are in `DEPLOYMENT-NOTE.md`.

## Done (v3.0.0, 2026-09-28)

Offline single-device retail expansion per `FEATURES.md` and `CHANGELOG.md`:

- Customers + loyalty earn/redeem with reversal on refund
- Item and receipt discounts, receipt tax modes, split cash + GCash/card recording
- Saved orders (hold, reopen, combine, split), order/item notes, dining labels
- Repeated partial refunds, full refunds, current-day voids
- Weighted kg goods, EAN-13 scale labels, variants, add-ons
- Suppliers, purchase orders, receiving, stocktakes, movement history, valuation
- Cash shifts, employee PINs, time clock, analytics, camera scan where supported, same-device customer display, dark theme
- IndexedDB v3 upgrade preserving records; v1/v2 backups restorable
- Validation at release: 71 unit + 60 browser tests passed, prod build passed, audit 0 vulns (see `DEPLOYMENT-NOTE.md`)

## Next (store acceptance, requires device + host)

These are open checks from `DEPLOYMENT-NOTE.md`, not code TODOs. No code change ships until they pass on the real setup:

- [ ] Deploy `dist/` to the stable HTTPS origin (Vercel source import or static host) and verify CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, MIME types, and HTML/worker revalidation
- [ ] Install on the actual phone/tablet (Chrome Android + Safari if iPhone supported), reopen in airplane mode, run scan, checkout, receipt, stock, day-close, history
- [ ] Test real scanner hardware, rapid scanning, weighted labels, and physical receipt/barcode-label printing
- [ ] Test camera scan on the store browser, split payment with discounts/tax, partial refund, loyalty, saved orders, receiving, stocktake, shift close, employee sign-in
- [ ] Export backup off-device and restore into a separate browser/profile with disposable data; compare prices, stock, cart, sales, corrections, reports, totals
- [ ] Verify installed-app update with two windows and unsaved/pending work
- [ ] Replace the 8 starter products or import the real CSV; set store/operator names and owner PIN

## Later (maintenance candidates, unscheduled)

- Backup-size monitoring as tables grow toward the 25 MiB / record caps in `src/validation.ts`
- Stock movement history view is capped at latest 100; evaluate pagination if stores ask for it
- Time entries view/export capped at latest 100; same pagination question
- Printer/label-size presets only if a specific store printer is selected and available for testing

## Non-goals (need a backend, service, or hardware bridge)

From `FEATURES.md#features-requiring-another-integration`. Not planned for this offline release:

- Cloud sync/backup, remote dashboards, multi-store, store-to-store transfers
- Auto email receipts, low-stock emails, accounting/ecommerce APIs, online ordering
- Integrated payment terminals, auto cash-drawer kick, native Ethernet/Bluetooth kitchen printing
- Networked customer/kitchen displays (current display is same-device window only)
- Ingredient recipes, composite production, kitchen routing (this release targets small retail)
- BIR-accredited invoicing (tax settings are recording only)
