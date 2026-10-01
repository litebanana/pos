# Explain - what each file in `src/` does

Plain-language guide to the app's source code. Each entry is one file and what it is responsible for. Technical details live in `ARCHITECTURE.md`; decisions live in `DECISIONS.md`.

## App shell and screens

- `main.tsx` — The front door. It loads the styles, puts the app on the page, and wraps everything in an error catcher so a crash shows a recovery screen instead of a blank page.
- `App.tsx` — The main screen and traffic controller. It holds the Sell/Products/Sales/Reports/Settings/Store-tools navigation, the barcode scanner box, the cart, the checkout and receipt popups, the daily totals, the low-stock/saved-order/shift reminder chips, and the backup/storage warnings. Almost everything you see starts here.
- `views.tsx` — The five main pages: Products (list, search, sort, CSV import/export, stock adjustment), Sales history (voids and refunds), Daily reports (view, close day, download PDF), and Settings (store details, backups, owner PIN, recent activity + activity CSV export). Also holds the `downloadText` helper every CSV export uses.
- `retail-views.tsx` — The Store tools pages: Customers, Saved orders, Inventory, Purchasing, Cash drawer, Employees, Analytics, and Checkout settings. Also holds the shared `csv()` spreadsheet-safe export helper (now re-exported from `components.tsx`).
- `sell-extras.tsx` — The smaller Sell helpers: editing an item's discount/note, saving a cart as a named order, adding a product with add-ons or bag weight, the camera barcode scanner, and the customer display screen that shows the cart in a second window.
- `checkout-dialog.tsx` — The checkout popup. It collects payment method (cash, GCash, card, split), amount received, customer and loyalty points, discounts, tax, and order notes, then completes the sale in one safe step. It refuses to finish when storage is too full.
- `components.tsx` — The reusable building blocks: labeled form fields, accessible popup dialogs (focus trapping, Escape to close), the product form, the quantity stepper, the error recovery screen, and the shared `csv()` export helper.
- `legal.tsx` — The Privacy Policy and Terms of Use texts shown in the app, plus their effective date.
- `styles.css` — All visual styling: layout, light/dark themes, phone layouts, dialogs, receipts, and print rules for receipts and barcode labels.

## Data and money

- `db.ts` — The heart of the app. It defines the local database (products, sales, cart, customers, shifts, and more), and every action that changes data: scanning, checkout, voids/refunds, stock adjustments, day close, and backup export/restore. Checkout always saves payment, receipt, stock change, and loyalty points together so nothing can half-save.
- `pricing.ts` — The money math. It keeps all amounts in whole centavos (no floating-point drift), splits discounts and tax across items so rows add up exactly, and converts kilogram weights to grams. Also holds the `plain()` text-length guard used on every typed input.
- `validation.ts` — The bouncer for backups and products. It re-checks every record in a backup file (lengths, amounts, dates, links between records) and rejects anything oversized, malformed, or inconsistent before anything is replaced. Nothing from a file touches your data without passing here.
- `retail-validation.ts` — Same bouncer job for the store tables (customers, suppliers, purchases, saved orders, shifts, employees, time entries) plus checkout settings.
- `retail-types.ts` — The shape dictionary for store records: what a customer, supplier, purchase order, saved order, shift, employee, or time entry looks like, plus default settings.
- `catalog.ts` — The product CSV import and export: reading a spreadsheet file, previewing it, checking every row, and saving it all at once, or exporting the current catalog back out.

## Backups, security, and access

- `backup.ts` — Reads a backup file using a background worker with a 20-second limit, so a huge or malicious file cannot freeze the app.
- `backup.worker.ts` — That background worker. It parses and decrypts the file off the main thread and reports back only clean, validated data or an error.
- `backup-format.ts` — Packs backups for download and unpacks them for restore, including optional password encryption. It refuses to create a file the app could not restore.
- `owner.ts` — The owner PIN system: creating the PIN, checking it, locking after 5 wrong tries, and auto-locking after 15 minutes. PINs are stored as salted hashes, never as plain digits. Also provides the password-based encryption used for backups.
- `staff-access.ts` — Employee sign-in: checking employee PINs (same lockout rules) and keeping an 8-hour session so sales record who sold them.
- `security/headers.ts` (in `security/`, used by the build) — The browser security rules: only load things from this app itself, no inline scripts, no frames, plus frame/clickjacking and sniffing protections.

## Staying safe offline

- `work.ts` — The traffic cop for data changes. It lines up scans, checkouts, and saves so they never race each other, warns before closing the page with unsaved work, and makes app updates wait until all windows are idle so no sale is lost mid-update.
- `storage.ts` — The storage fuel gauge. It checks how full the browser's storage is and pauses checkout above 80% with a message to export a backup first.
- `useInstall.ts` — The "install this app" logic. It listens for the browser's install offer, tracks whether the app is already installed, and triggers the install prompt.
- `pdf.ts` — Makes the PDF files: sales receipts and daily reports, including weighed items, discounts, tax, loyalty lines, and corrections.
- `vite-env.d.ts` — A one-line TypeScript helper so the code editor understands Vite-specific features. No app behavior.

## Tests (how we prove it works)

- `db.test.ts` — Unit tests for the database core: carts, prices, stock, day reports, and upgrades from old databases.
- `checkout.test.ts` — Unit tests for checkout: atomic sales, stale/duplicate rejection, rollbacks, and backup password handling.
- `retail.test.ts` — Unit tests for store features: loyalty math, refunds, saved orders, weighed goods, shifts, and employees.
- `security.test.ts` — Unit tests for hostile backups (oversized notes, invisible characters, fake totals are all rejected with records untouched) plus security-header checks.
- `operational-loops.test.ts` — Unit tests for the daily loops: low-stock purchase suggestions, cash-difference reviews blocking day close, and the storage guard.
- `tests/e2e/*.spec.ts` (in `tests/`) — Full browser tests that click through the real app on desktop and phone sizes: scanning, checkout, refunds, backups, updates, and layout.
