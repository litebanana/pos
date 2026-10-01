# Changelog

## v3.1.0 — 2026-10-01

- Sell-day attention chips: low stock, saved orders, open shift, cash-difference review, stale open days
- Low-stock banner drafts a purchase order (refill to 2x threshold); receiving clears the alert
- Cash variance review: differences block day close until reviewed, stay visible after reload
- Storage guard: polling blocks checkout under pressure, keeps export available, resumes below threshold
- Product sorting by name, price, and stock; stock adjust UX and toolbar fixes
- Privacy policy and Terms of Use dialogs with sidebar links

Validation: 79 unit + 68 browser tests passed (8 phone-only skipped on desktop),
prod build passed, dependency audit 0 vulns. Deployed URL and physical-device
checks still open. See DEPLOYMENT-NOTE.md.

## v3.0.0 — 2026-09-28

Retail expansion for single-device offline POS. See FEATURES.md for full scope.

- Customers and loyalty (earn/redeem, reversal on refund)
- Receipt/item discounts, receipt tax, split cash + GCash/card payments
- Saved orders (hold, reopen, combine, split), order notes, dine-in/takeaway labels
- Repeated partial refunds, full refunds, current-day voids
- Weighted products (kg), EAN-13 scale labels, variants, add-ons
- Suppliers, purchase orders, receiving, stocktakes, movement history, valuation
- Cash shifts, employee PIN sessions, time clock, analytics
- Camera barcode detection where supported, same-device customer display, dark theme
- IndexedDB v3 upgrade: preserves existing records, supports multiple corrections per sale
- Backup v1/v2 remain restorable; v3 exports include new tables

Breaking: older builds cannot reopen a v3 database or restore a v3 backup.
Recovery: fresh browser profile + pre-upgrade backup. Keep same origin.

Validation: 71 unit + 60 browser tests passed, prod build passed,
dependency audit 0 vulns. Deployed URL and physical-device checks still open.
See DEPLOYMENT-NOTE.md and DEPLOYMENT-REVIEW.md.
