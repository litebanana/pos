# Implementation review — 2026-09-28

The original readiness review identified database recovery, restorable exports, update coordination, and missing store workflows. Tindahan 3.0 includes those changes and the offline retail expansion documented in [FEATURES.md](FEATURES.md).

## Retail expansion in 3.0

Customers and loyalty, receipt/item discounts, tax, split payment recording, repeated partial refunds, saved orders with splitting/combining, weighted products, add-ons and notes, supplier purchases and receiving, stocktakes and movement history, barcode labels, cash shifts, employee PIN sessions and time clocks, analytics, camera scanning where the browser supports it, a same-device customer display, and a dark theme are available through checkout and Store tools.

The version-3 database upgrade preserves existing records and allows multiple corrections per sale. Version-1 and version-2 backups remain restorable. A real version-2 database upgrade, financial rounding, concurrency, transactional stock receiving, staff restrictions, and backup validation are covered by tests. Export a backup before updating and follow the rollback instructions in [FEATURES.md](FEATURES.md).

## Current 3.0 validation

- All 71 unit tests passed across four test files, including refund rounding, loyalty races, purchasing rollback, stock counts, weighed items, saved orders, staff sessions, migration, and validated backups.
- All 60 applicable desktop/mobile Chrome browser tests passed. Eight phone-only cases were intentionally skipped on desktop. The new workflows and the existing offline, backup, security, installation-interaction, and coordinated-update cases are covered.
- The production TypeScript/Vite/PWA build passed. The runtime dependency audit reported zero known vulnerabilities.
- Layout inspection at 320, 360, 390, 412, and 480 px found no horizontal overflow or clipped placeholders. Phone Products spacing, Store tools, and light/dark screenshots were inspected. The barcode scanner stays above the additional checkout shortcuts.
- Camera tests simulate a detector and media stream and verify cleanup; actual camera recognition and physical printing are not verified by these tests. No production deployment was performed during this expansion.

## Existing 2.0 foundation

- **Database recovery:** a top-level error boundary displays a recovery screen on read/render failures. It does not reset data. Blocked storage disables scanning; storage/save errors and offline setup failures are visible.
- **Restorable backup exports:** compact JSON is validated against the same schema, byte limits, and record limits as restore before downloading. Unsupported exports fail explicitly. The app shows last-export reminders, persistence status, storage estimates, and a backup-size check. Export timestamps do not prove successful file retention.
- **Optional encrypted backups:** AES-256-GCM with a fresh random IV and PBKDF2-SHA-256, 600,000 iterations, and a fresh random salt. Import decryption/validation run in a bounded worker. Wrong passwords and altered ciphertext leave current records intact.
- **Coordinated updates:** pending operations use shared browser locks. Unsaved forms hold a separate shared lock, including forms in background windows. Update activation takes exclusive locks and checks a broadcast channel. Controller changes explicitly reload coordinated windows; a stalled activation releases the updating state for retry.
- **Checkout:** durable cart, cash/GCash/card method recording, received amount, cash change, named operator, numbered receipts, and PDF downloads. Checkout atomically commits snapshots and stock changes and clears the cart. A stale or duplicate checkout is rejected.
- **Undo and corrections:** cart removal supports undo. Full-sale voids/refunds retain original sale rows and record reason, operator, timestamp, amount, and stock-return choice. Corrections apply to the current day. Older closed reports remain unchanged.
- **Inventory:** optional stock counts, low-stock thresholds, checkout deductions, restocks/adjustments with reasons, and optional stock return on correction.
- **Owner controls:** optional PIN restricts protected actions at the database API layer. Cashier checkout remains available. Unlocks expire after 15 minutes and are isolated to the current window. PINs restrict normal app actions; they do not secure raw browser storage or prove staff identity.
- **Catalog CSV:** bounded parsing, duplicate/barcode/price validation, import preview, atomic upsert, and spreadsheet-safe export. Sales retain their original catalog snapshots.
- **Simpler interface:** system fonts, larger text, neutral colors with a single green accent, plain headings, red required-field asterisks, native input validation, and keyboard focus handling. Phones use bottom navigation and checkout within the page, with labeled list rows, visible search labels, short placeholder hints, and dialogs that fit the viewport.
- **Compatibility:** an actual version-1 database upgrade and version-1 backup restoration are covered by tests. Historical tally records are retained without inventing missing payment information. Store names now persist after day close.
- **Deployment configuration:** generated static-host headers now revalidate all paths, including the root document. Root Vercel configuration includes build/output settings and matching security/cache headers. HTTPS/Nginx examples and release instructions remain available.

## Previous 2.0 validation

- 45 unit tests passed: financial transactions/rollback, concurrent actions, stock, corrections, owner restrictions, backup round trips/encryption, CSV, migration, and input validation.
- Production TypeScript/Vite/PWA build passed.
- 36 browser tests passed across desktop and mobile Chrome: offline checkout/PDFs, backups, owner controls, stock/refunds, CSV, multi-window checkout, recovery UI, CSP, layout, PDF bounds, install interactions, and a real service-worker replacement with another window's unsaved form. Four additional desktop cases were intentionally skipped because they exercise phone-only layouts.
- Dependency audit reported zero known vulnerabilities for the installed dependency tree.
- Desktop and mobile screenshots were inspected for readability and layout.

The complete browser suite was rerun after the phone layout and placeholder fixes: all 36 applicable tests passed. Four dedicated phone checks cover 320, 360, 412, and 480 px, sequential typing, list overflow, and reduced-height dialogs. Separate layout inspection also covered 390 px. The earlier unit run passed all 45 tests, including rollback after a stock failure occurs partway through checkout; no financial or storage logic changed in this UI follow-up.

## Release work requiring the deployment environment

The user selected Vercel, but the actual production URL has not been supplied for inspection. Actual response headers/MIME/cache verification, installed-app acceptance on the store device, scanner hardware, physical printing, and a restore drill on a separate device still require that environment. Follow [DEPLOYMENT-NOTE.md](DEPLOYMENT-NOTE.md).

Backups remain bounded to 25 MiB of plain JSON and the documented table limits; this is not an unlimited archive format. Full and partial refunds are supported. Payments are recorded and must be collected externally. Local IndexedDB and activity records remain unencrypted and are not tamper-proof. Export encryption is optional and passwords cannot be recovered. Cloud synchronization, multiple connected store devices, remote customer/kitchen displays, online payment integrations, and native printer/scales integrations require additional services or equipment; they are not part of this offline release.

## References used

- [React error boundaries](https://react.dev/reference/react/Component#catching-rendering-errors-with-an-error-boundary)
- [Browser storage and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- [Web Locks API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API)
- [Vite PWA update prompts](https://vite-pwa-org.netlify.app/guide/prompt-for-update)
- [Web Crypto key derivation](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/deriveKey)
- [Web Crypto encryption](https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/encrypt)
- [Dexie database upgrades](https://dexie.org/docs/Version/Version.upgrade())
- [Viewport resizing for an on-screen keyboard](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport)
