# Tindahan 3.0 — store features

This release adds the Loyverse features that fit a local, single-device retail POS. The comparison uses [Loyverse's official feature list](https://loyverse.com/features). Tindahan remains an independent app; it does not connect to a Loyverse account or exchange data with Loyverse.

Open **Store tools** in the header to choose Customers, Saved orders, Inventory, Purchasing, Cash drawer, Employees, Analytics, or Checkout settings. The five main navigation buttons stay in place on phones. Product cards retain their spacing and Manage product action.

| Workflow | Available here | Scope |
|---|---|---|
| Sales and offline use | Durable cart, checkout, receipts, sale history, offline reopening | Records stay in this browser profile |
| Payment methods | Cash, GCash, card, split cash + GCash/card | Payment is collected externally; a split must match the total exactly |
| Discounts | Percentage discounts on individual cart rows; percentage or amount discounts on the order | Manager / owner access required; receipt discounts follow item discounts |
| Tax | No calculation, tax included in prices, or tax added to the total | One configurable receipt rate; configure it for the store's actual requirements |
| Customers | Names, phone, email, address, notes, loyalty-card barcode, purchase history, visit count, net spending | Local customer records; customer management requires owner / manager access |
| Loyalty | Configurable earning percentage, point redemption at checkout, reversal on refund | 1 point = ₱1; stored to two decimal places; negative balances can result when earned points were already spent |
| Saved orders | Hold a cart, reopen it, combine orders, split quantities into another order | Original prices retained; stock is checked when opening and checking out, and is not reserved |
| Order details | Item notes, order notes, retail/dine-in/takeaway/delivery labels | Notes appear on receipts and saved orders |
| Returns | Selected quantities, repeated partial refunds, full refunds, full-sale voids | No double returns; full voids limited to the current open day |
| Variants | Size, color, or pack description on each product | Each variant is a separate product with a unique barcode |
| Add-ons | Named optional additions with selling prices | Add-on stock and ingredient costs are not tracked separately |
| Weighed goods | Price/cost per kilogram, weight entered for each bag, kilogram stock display | Grams stored as integers; cart quantity is the number of bags of the selected weight |
| Weight barcodes | Optional EAN-13 scale-label parsing | Only the explicitly configured prefix + five-digit item code + five-digit gram weight format |
| Scanning | Keyboard scanner, manual barcode, rear-camera barcode detection | Camera requires a supported browser and permission; manual entry remains available |
| Inventory | Stock, low-stock banners, adjustments, movement history, counts | Stock counts reject concurrent changes; history view shows the latest 100 movements |
| Inventory valuation | Stock cost and potential sales value | Missing costs explicitly counted; values use the current catalog |
| Suppliers/purchases | Supplier records, purchase orders, CSV purchase export, receive/cancel | Receiving applies the entire order once, increasing stock and setting unit costs atomically |
| Cash shifts | Opening cash, paid in/out, expected drawer cash, counted cash, discrepancy | Cash sales and refunds link to an open shift; transactions outside a shift are excluded |
| Staff | Employee PINs, cashier/manager roles, employee sale identity | An owner PIN must be configured first; local app access controls, not server authentication |
| Time clock | PIN-verified clock in/out, timestamps, CSV hours | Latest 100 entries shown/exported; all records retained in backups |
| Analytics | Date range, daily trend, top products, category, employee/operator, payment, hour, discounts, tax, estimated profit | Philippine time; product/category/operator/payment/hour breakdowns show sales before refunds; summary and daily trend subtract refunds on the date recorded |
| Export | Catalog, sales, refund, purchase, time-clock, and activity CSV; receipt/report PDF | Spreadsheet formula prefixes escaped in CSV text |
| Printing | Browser receipt printing and Code 128 barcode labels | Uses the device's browser/OS print support; verify actual printer and label size |
| Customer display | Live cart and latest receipt in another browser window | Same browser profile and device; no phone-to-tablet or local-network connection |
| Display | Light/dark theme, readable system fonts, phone cards, required-field asterisks | Theme saved locally |
| Recovery | Full backups include every new table; optional encrypted export; validated atomic restore | Backup versions 1 and 2 remain readable by version 3 |

## Money and stock rules

Prices and amounts use integer centavos. Order discounts and tax are allocated to item rows so their totals equal the receipt total. Partial refunds use cumulative rounding: all remaining units together refund exactly the amount originally paid. Cash and tax reversals also use cumulative rounding. Original receipt rows remain unchanged.

Loyalty earning excludes calculated tax and uses the configured percentage of the amount paid. Refunds proportionally reverse earned and redeemed points; a free receipt paid entirely with points restores its redeemed points when returned. Redemption, sale, stock changes, snapshots, and cart clearing are one transaction, preventing two windows from spending the same balance.

Stock for kilogram products is stored in grams. A 0.25 kg bag appears as one item at its calculated price; changing its quantity to 2 sells two bags, deducting 0.5 kg. Partial refunds select bags and return the corresponding gram quantity. To sell a different weight, add another weighed bag. Prices and costs are rounded to centavos per bag.

Tax settings and reports do not provide BIR accreditation or a statutory invoice workflow. Estimated profit excludes expenses and treats missing costs as zero; add-on ingredient costs are not recorded. Items-sold counts retain original receipt quantities, with returns recorded separately.

## Features requiring another integration

These are not implemented by this local release:

- Cloud backup/synchronization, remote dashboards, multiple stores, and stock transfers between stores: need a shared backend, authenticated users, conflict handling, and hosting configuration.
- Automatic email receipts or low-stock emails, accounting/ecommerce APIs, and online ordering: need configured services and credentials. PDFs and CSV files are available for manual sharing/import.
- Integrated payment terminals, automatic cash-drawer opening, and native Ethernet/Bluetooth kitchen printing: need a selected provider or hardware bridge and tests on the actual equipment.
- Networked customer/kitchen displays: need device pairing and a communication service. The current customer display works within one device only.
- Restaurant ingredient recipes, composite-item production, and kitchen routing: need a restaurant-specific stock and fulfillment model. This release targets small retail stores.

## Upgrade and recovery

1. Export and retain a full backup from the current app before installing this release. Verify that the file is retained off the store device.
2. Keep the same production origin. Close other old app tabs/windows, update the app, and reopen it.
3. IndexedDB version 3 adds the new tables and indexes, and removes the one-correction-per-sale index to support partial refunds. Existing products, sessions, sale snapshots, and corrections are retained. No existing table is cleared by the upgrade.
4. Test a disposable sale, stock return, and backup restoration before live use. Version-3 exports include every new table and can be restored by this release.

An older app build cannot directly reopen a database upgraded to version 3, and cannot restore a version-3 backup. For emergency recovery to an older release, use a fresh browser profile and the retained pre-upgrade backup. Keep the upgraded profile and its version-3 backup: transactions recorded after the upgrade require the newer app. Reinstalling an older build at the existing origin does not downgrade IndexedDB. Never clear the store's data as a rollback shortcut.

The deployed Vercel URL, Android installation, actual camera, scanner, and printer still require testing on the store's equipment. Browser camera tests simulate detection and cleanup; they do not prove physical barcode recognition.
