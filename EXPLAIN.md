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

## Core functions — what the important pieces of code do

Same files, one level deeper. `name()` means "when the app runs this, this is what happens."

### `App.tsx` (inside the main screen)

- `scan(code)` — Takes a barcode from the scanner box, finds the product, and drops it in the cart with a beep. If the barcode is unknown, opens the "new product" form; if it is a scale weight label or needs options, opens the right popup instead.
- `beginCheckout()` — First checks storage is not too full, grabs the current cart plus checkout settings, and opens the checkout popup.
- `beginClose(id?)` — Refuses when the cart is not empty, loads the day's report, and opens the "Close day?" popup (resetting the backup acknowledgment).
- `finishDay(report)` — Makes the day's PDF, archives the day so its numbers freeze, closes the popup, and reminds you to export a backup.
- `downloadReport(report)` — Downloads a daily report PDF without closing anything.
- `navigate(next)` — Switches pages, but refuses while a save or update is running so you never lose work mid-click.
- `closeDialog()` — Closes any popup, clears the backup acknowledgment, and puts the cursor back in the scanner box.

### `db.ts` (database actions)

- `initialize()` — First-run setup: creates the 8 example products and default settings. Does nothing on later opens.
- `today()` — Returns today's date in Philippine time, so "today" always means Manila time.
- `addToCart(barcode, ...)` — Adds one item to the durable cart (survives reloads). Handles variants, add-ons, notes, and weighed bags; groups repeat scans unless you turned grouping off.
- `checkout(cart, payment, tendered, operator, options)` — The big one: in a single all-or-nothing step it records the payment, freezes the receipt and item snapshots, deducts stock, adds/takes loyalty points, clears the cart, and logs the sale. Rejects stale or duplicate checkouts so two windows cannot charge twice.
- `correctSale(...)` — Records a void or refund as a new correction row (never edits the original sale), optionally returning stock, reversing loyalty proportionally.
- `adjustStock(id, stock, reason)` — Sets a new stock count with a written reason and records the movement.
- `archiveReport(report)` — Closes the day: marks the session closed, keeps its frozen numbers.
- `exportDatabase()` / `restoreDatabase(file)` — Collects every table into one validated backup, or replaces everything from a validated backup file.
- `logAction(action, detail)` — Writes one line to the activity log (capped at 500 characters).
- `requireOwner()` — Throws unless owner access is unlocked; this is what locks catalog, stock, corrections, and backup buttons for cashiers.
- `getReport(id)` / `reportTotals(report)` — Builds a day's report and its totals (net sales, items, refunds).
- `undoCartRemoval(row)` / `removeCartItem(id)` — Removes a cart row and can put it back.

### `retail.ts` (store features)

- `saveCustomer()` / `saveSupplier()` — Saves a customer or supplier after checking lengths and formats (owner access required).
- `suggestPurchase(products)` — Looks at low-stock products and drafts refill quantities (up to twice the alert level).
- `createPurchase()` / `finishPurchase(id, receive)` — Creates a purchase order, then receives it all at once: stock goes up and unit costs update together, or the whole thing rolls back.
- `saveTicket()` / `resumeTicket()` / `discardTicket()` / `combineTickets()` / `splitTicket()` — Hold a cart as a named order, reopen it later, delete it, merge orders, or split items into a new order.
- `openShift()` / `moveCash()` / `closeShift()` / `expectedCash()` / `reviewShiftVariance()` — Opens a cash shift, records cash in/out, closes with a counted amount, computes what the drawer should hold, and records a manager review of any difference.
- `saveEmployee()` / `signInEmployee()` / `clockEmployee()` — Manages employee PINs, 8-hour sign-in sessions, and clock in/out stamps.
- `editCartItem()` — Changes one cart row's discount or note (discounts need manager/owner).
- `decodeWeightBarcode(code, prefix)` — Reads an EAN-13 scale label into product code plus grams.
- `getRetailSettings()` / `saveRetailSettings()` — Loads/saves checkout defaults: discounts, tax, loyalty rate, theme, scale prefix, GCash details.

### `pricing.ts` (money math)

- `cartPricing(rows, options)` — Totals the cart with item discounts, order discount, tax, and loyalty redemption.
- `allocate(amount, weights)` — Splits one amount across rows so the parts add up to the exact total (no lost centavos).
- `plain(value, max, label)` — The text guard: rejects over-long text and invisible/control characters on every typed input.
- `cents()` / `rate()` / `count()` — Reject bad money, percentage, and quantity inputs before they reach the database.
- `lineAmount(row)` — One row's subtotal (uses the frozen value when present).
- `lowStockAt()` / `stockFactor()` / `stockText()` — Low-stock threshold, grams-per-unit for weighed goods, and human-readable stock text.

### `validation.ts` + `retail-validation.ts` (backup bouncers)

- `validateBackup(raw)` — Re-checks an entire backup file: record counts, lengths, amounts, dates, and that every link (sale to day, refund to sale, totals to items) is consistent. Throws on the first problem; nothing is replaced until everything passes.
- `validateProduct()` / `validatePreferences()` / `validateOwnerCredential()` — Check one product, settings, or owner PIN record.
- `validateRetailSettings()` / `validateRetailRecords()` / `validateContext()` — Same checks for the store tables and checkout settings.

### `catalog.ts` (product spreadsheets)

- `parseCatalog(text)` — Reads CSV text (max 2 MB) into product rows with strict format checks.
- `importCatalog(products)` — Previews then saves all rows at once, matching by barcode; sales history keeps old prices.
- `catalogCSV(products)` — Exports the catalog with spreadsheet-formula escaping.

### `pdf.ts` (receipts and reports)

- `createPDF(report, receipt?)` — Builds the daily-report PDF with sales, refunds, and totals.
- `createReceiptPDF(sale, scans, ...)` — Builds one receipt PDF with items, notes, discounts, tax, loyalty, and payment lines.
- `pdfFilename(report)` — Names the file by store and date.

### `components.tsx` (building blocks)

- `Field(label, ...)` — A labeled input with required-field asterisk handling.
- `Modal(title, ...)` — An accessible popup: traps keyboard focus, closes on Escape or backdrop click, freezes the background.
- `ProductForm(...)` — The add/edit product form with price, stock, cost, variant, and add-on fields plus inline error messages.
- `QuantityControl(row, ...)` — The minus/plus/stepper for cart quantities with atomic updates.
- `ErrorBoundary` — Catches crashes and shows the recovery screen without wiping data.
- `csv(rows)` — Makes spreadsheet-safe CSV text (BOM plus formula-prefix escaping).

### `views.tsx` (main pages)

- `ProductsView(...)` — Product list with search, category filter, name/price/stock sorting, pagination, CSV export/import with preview, and stock adjustment.
- `SalesView(...)` — Every sale with receipt view, void/refund actions, and correction history.
- `HistoryView(...)` — Daily reports list with search/date/status filters, PDF download, and day close.
- `SettingsView(...)` — Store details, backup export/restore/size check, persistence toggle, owner PIN setup/unlock, recent activity with CSV export, and danger-zone reset.
- `Pagination(...)` — Page buttons for long lists.
- `downloadText(contents, name)` — Triggers any file download (CSV, JSON) from the browser.

### `retail-views.tsx` + `sell-extras.tsx` + `checkout-dialog.tsx`

- `StoreTools(...)` — The Store tools shell that switches between the eight tool sections and shows the low-stock replenish draft when asked.
- `CartItemDetails(...)` — Popup to edit one cart row's discount and note.
- `SaveOrderDialog(...)` — Names and saves the current cart as a held order.
- `CustomizeProductDialog(...)` — Picks add-ons, note, and bag weight before adding a special product.
- `CameraScanner(...)` — Uses the phone/browser camera to read one barcode, then releases the camera.
- `CustomerDisplay()` — A second-window screen showing the live cart and latest receipt (same device only).
- `CheckoutDialog(...)` — The full checkout form and sale completion described above.

### Backups, access, offline safety

- `readBackupFile(file, ...)` (`backup.ts`) — Reads a backup through a background worker with a 20-second timeout and size cap.
- `serializeBackup()` / `encodeBackup()` / `decodeBackup()` (`backup-format.ts`) — Validates, optionally password-encrypts (AES-256-GCM), and decrypts backup files; refuses to make files the app could not restore.
- `createOwnerCredential()` / `unlockOwner()` / `lockOwner()` / `assertOwner()` (`owner.ts`) — Creates, checks (5 tries then 30-second cooldown), expires (15 minutes), and enforces the owner PIN.
- `verifyStaffPin()` / `acceptStaff()` / `staffSession()` (`staff-access.ts`) — Checks employee PINs with the same cooldown and holds the 8-hour session.
- `runWork()` / `safeUpdate()` / `setFormDirty()` / `useWorkState()` (`work.ts`) — Runs data changes one at a time under a shared lock, blocks app updates until all windows are idle, tracks unsaved forms, and warns before closing the page mid-save.
- `estimateStorage()` / `storageUnderPressure()` / `assertCheckoutStorage()` (`storage.ts`) — Measures browser storage and stops checkout above 80% full.
- `useInstall()` (`useInstall.ts`) — Captures the browser install prompt and tracks installed state.
- `PrivacyPolicy()` / `TermsOfUse()` (`legal.tsx`) — The legal texts.
- `saveProduct` bootstrapping and `ErrorBoundary` wiring (`main.tsx`) — Puts the app on the page (see file section above).
