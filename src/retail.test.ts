import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { addToCart, changeCartQuantity, checkout, correctSale, db, exportDatabase, getReport, initialize, removeCartItem, reportTotals, resetDatabase, restoreDatabase, saveProduct, setOwnerCredential, undoCartRemoval, type CartItem } from './db'
import { allocate, cartPricing } from './pricing'
import { applyStocktake, clockEmployee, closeShift, combineTickets, createPurchase, decodeWeightBarcode, editCartItem, expectedCash, finishPurchase, getRetailSettings, moveCash, openShift, resumeTicket, saveCustomer, saveEmployee, saveRetailSettings, saveSupplier, saveTicket, signInEmployee, signOutEmployee, splitTicket } from './retail'
import { catalogCSV, parseCatalog } from './catalog'
import { retailDefaults, retailTables } from './retail-types'
import { createOwnerCredential, lockOwner, unlockOwner } from './owner'
import { validateBackup } from './validation'

const code = '4800016000013'
beforeEach(async () => { signOutEmployee(); await db.settings.delete('owner'); lockOwner(); await resetDatabase(); await db.settings.clear(); await initialize() })
afterEach(() => { signOutEmployee(); lockOwner() })
async function pay(options: Parameters<typeof checkout>[4] = {}) { const cart = await db.cart.toArray(); return checkout(cart, 'cash', cartPricing(cart, options).total, 'Owner', options) }
async function customer() { await saveCustomer({ name: 'Ana', phone: '09123456789', email: '', address: '', notes: '', card: 'ANA-001', balance: 99999 }); return (await db.customers.toArray())[0] }
async function supplier() { await saveSupplier({ name: 'Wholesale shop', phone: '', email: '', notes: '' }); return (await db.suppliers.toArray())[0] }

describe('retail pricing and corrections', () => {
  it('restores item notes and discounts without merging them into a different cart row', async () => {
    await addToCart(code); const first = (await db.cart.toArray())[0]
    await editCartItem(first.id!, 1000, 'Keep separate')
    const removed = await removeCartItem(first.id!)
    await addToCart(code); await undoCartRemoval(removed)
    const rows = await db.cart.toArray()
    expect(rows).toHaveLength(2); expect(rows.map(row => row.quantity)).toEqual([1, 1])
    expect(rows.find(row => row.note === 'Keep separate')!.discountRate).toBe(1000)
    expect(cartPricing(rows).total).toBe(4750)
  })
  it('starts a fresh order after all items of a resumed customer order were removed', async () => {
    const c = await customer(); await addToCart(code)
    await saveTicket('Ana order', await db.cart.toArray(), 'Ana delivery', 'delivery', c.id)
    await resumeTicket((await db.tickets.toArray())[0].id!)
    await removeCartItem((await db.cart.toArray())[0].id!)
    await addToCart(code)
    expect(await db.settings.get('cartContext')).toBeUndefined()
    expect((await pay()).customerId).toBeUndefined()
  })
  it('keeps cost snapshots separate when stock costs change during an open cart', async () => {
    const product = (await db.products.where('barcode').equals(code).first())!
    await saveProduct({ ...product, cost: 1000 }); await addToCart(code)
    await saveProduct({ ...product, cost: 1500 }); await addToCart(code)
    expect((await db.cart.toArray()).map(row => row.cost)).toEqual([1000, 1500])
    expect((await pay()).cost).toBe(2500)
  })
  it('allocates every cent deterministically without unsafe multiplication', () => { expect(allocate(5, [1, 1, 1])).toEqual([2, 2, 1]); expect(allocate(99_999_999_999, [99_999_999_999, 99_999_999_999])).toEqual([50_000_000_000, 49_999_999_999]) })
  it('combines item discounts, receipt discounts, redemption, and tax into matching lines', () => {
    const rows = [{ price: 1000, quantity: 2, discountRate: 1000 }, { price: 333, quantity: 1 }] as CartItem[]
    const result = cartPricing(rows, { discountType: 'percent', discountValue: 500, redeem: 100, taxMode: 'added', taxRate: 1200 })
    expect(result.subtotal).toBe(2333); expect(result.discount).toBe(307); expect(result.tax).toBe(231); expect(result.total).toBe(2157); expect(result.lineTotals.reduce((a, b) => a + b, 0)).toBe(result.total)
    expect(() => cartPricing(rows, { discountValue: 99999 })).toThrow('cannot exceed')
    expect(() => cartPricing(rows, { taxRate: -1 })).toThrow('between')
  })
  it('includes tax in the existing price without charging it twice', async () => {
    await addToCart(code); const sale = await pay({ taxMode: 'included', taxRate: 1200 })
    expect(sale.total).toBe(2500); expect(sale.tax).toBe(268); expect(reportTotals(await getReport(sale.sessionId)).value).toBe(2500)
    expect(validateBackup(await exportDatabase()).sales[0].tax).toBe(268)
  })
  it('allows several partial refunds, rejects excess, and refunds every cent only once', async () => {
    const product = (await db.products.where('barcode').equals(code).first())!
    await saveProduct({ ...product, price: 101, stock: 10 }); for (let i = 0; i < 3; i++) await addToCart(code)
    const sale = await pay({ discountValue: 2 }), row = (await db.scans.toArray())[0]
    await correctSale(sale.id!, 'refund', 'One returned', true, [{ scanId: row.id!, quantity: 1 }])
    expect((await db.sales.get(sale.id!))!.status).toBe('completed'); expect((await db.corrections.toArray())[0].amount).toBe(100)
    await expect(correctSale(sale.id!, 'refund', 'Too many', true, [{ scanId: row.id!, quantity: 3 }])).rejects.toThrow('exceeds')
    await expect(correctSale(sale.id!, 'void', 'Cannot void now', true)).rejects.toThrow('partly refunded')
    await correctSale(sale.id!, 'refund', 'Rest returned', true)
    expect((await db.sales.get(sale.id!))!.status).toBe('refunded'); expect((await db.sales.get(sale.id!))!.refundedAmount).toBe(301)
    expect((await db.products.get(product.id!))!.stock).toBe(10); expect(reportTotals(await getReport(sale.sessionId)).value).toBe(0)
    expect(validateBackup(await exportDatabase()).corrections).toHaveLength(2)
  })
  it('applies split payments and refunds cash proportionally without changing the original receipt', async () => {
    await openShift(1000); await addToCart(code); const rows = await db.cart.toArray()
    await expect(checkout(rows, 'split', 2500, 'Owner', { payments: [{ method: 'cash', amount: 1000 }, { method: 'gcash', amount: 1400, ref: 'REF1' }] })).rejects.toThrow('exactly')
    const sale = await checkout(rows, 'split', 2500, 'Owner', { payments: [{ method: 'cash', amount: 1000 }, { method: 'gcash', amount: 1500, ref: 'REF123' }] })
    expect(sale.payments).toEqual([{ method: 'cash', amount: 1000 }, { method: 'gcash', amount: 1500, ref: 'REF123' }])
    const shift = (await db.shifts.toArray())[0]; expect(await expectedCash(shift.id!)).toBe(2000)
    await correctSale(sale.id!, 'refund', 'Returned', false); expect(await expectedCash(shift.id!)).toBe(1000)
    expect((await db.sales.get(sale.id!))!.payments).toEqual(sale.payments)
  })
  it('earns and redeems loyalty, reversing both on refund', async () => {
    const c = await customer(); expect(c.balance).toBe(0)
    await saveRetailSettings({ ...retailDefaults, loyaltyRate: 1000 }); await addToCart(code)
    const first = await pay({ customerId: c.id }); expect((await db.customers.get(c.id!))!.balance).toBe(250)
    await addToCart(code); const second = await pay({ customerId: c.id, redeem: 200 }); expect(second.total).toBe(2300); expect((await db.customers.get(c.id!))!.balance).toBe(280)
    await correctSale(second.id!, 'refund', 'Returned', false); expect((await db.customers.get(c.id!))!.balance).toBe(250)
    await correctSale(first.id!, 'refund', 'Returned first', false); expect((await db.customers.get(c.id!))!.balance).toBe(0)
  })
  it('restores redeemed points even when they paid the entire receipt', async () => {
    const c = await customer(); await db.customers.update(c.id!, { balance: 2500 }); await addToCart(code)
    const sale = await pay({ customerId: c.id, redeem: 2500 }); expect(sale.total).toBe(0); expect((await db.customers.get(c.id!))!.balance).toBe(0)
    await correctSale(sale.id!, 'refund', 'Returned', false); expect((await db.customers.get(c.id!))!.balance).toBe(2500)
    expect(validateBackup(await exportDatabase()).sales[0].status).toBe('refunded')
  })
  it('does not let two windows spend the same loyalty balance', async () => {
    const c = await customer(); await db.customers.update(c.id!, { balance: 100 }); await addToCart(code); const rows = await db.cart.toArray()
    const results = await Promise.allSettled([checkout(rows, 'cash', 2400, 'Owner', { customerId: c.id, redeem: 100 }), checkout(rows, 'cash', 2400, 'Owner', { customerId: c.id, redeem: 100 })])
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1); expect(await db.sales.count()).toBe(1)
  })
  it('retains item notes and selected add-ons through receipt and backup', async () => {
    const product = (await db.products.where('barcode').equals(code).first())!
    await saveProduct({ ...product, cost: 1000, modifiers: [{ name: 'Ice', price: 500 }], variant: 'Small bottle' }); await addToCart(code, undefined, { modifiers: ['Ice'], note: 'No straw' })
    const row = (await db.cart.toArray())[0]; expect(row.price).toBe(3000); await editCartItem(row.id!, 1000, row.note!)
    const sale = await pay(); expect(sale.total).toBe(2700); expect((await db.scans.toArray())[0].note).toBe('No straw'); expect(sale.cost).toBe(1000)
    expect(validateBackup(await exportDatabase()).products[0].modifiers).toEqual([{ name: 'Ice', price: 500 }])
  })
})

describe('purchasing, stock counts, orders, and cash', () => {
  it('receives a purchase atomically once and updates stock and unit cost', async () => {
    const s = await supplier(), product = (await db.products.toArray())[0]
    await createPurchase(s.id!, [{ productId: product.id!, name: 'ignored', quantity: 12, cost: 1200 }], 'Delivery')
    const order = (await db.purchases.toArray())[0]; await finishPurchase(order.id!, true)
    expect((await db.products.get(product.id!))!.stock).toBe(12); expect((await db.products.get(product.id!))!.cost).toBe(1200)
    await expect(finishPurchase(order.id!, true)).rejects.toThrow('already'); expect(await db.stockMovements.count()).toBe(1)
  })
  it('rolls back the entire purchase if a product was deleted', async () => {
    const s = await supplier(), products = await db.products.toArray()
    await createPurchase(s.id!, products.slice(0, 2).map(product => ({ productId: product.id!, name: product.name, quantity: 5, cost: 1000 })), '')
    await db.products.delete(products[1].id!); await expect(finishPurchase((await db.purchases.toArray())[0].id!, true)).rejects.toThrow('no longer exists')
    expect((await db.products.get(products[0].id!))!.stock).toBeUndefined(); expect(await db.stockMovements.count()).toBe(0)
  })
  it('rejects stale counts without overwriting stock changed during counting', async () => {
    const product = (await db.products.toArray())[0]; await saveProduct({ ...product, stock: 10 }); await addToCart(product.barcode); await pay()
    await expect(applyStocktake([{ id: product.id!, stock: 10, counted: 12 }], 'Weekly')).rejects.toThrow('changed while')
    expect((await db.products.get(product.id!))!.stock).toBe(9)
    await applyStocktake([{ id: product.id!, stock: 9, counted: 12 }], 'Weekly'); expect((await db.products.get(product.id!))!.stock).toBe(12)
  })
  it('holds and resumes orders without counting revenue, retaining metadata and original prices', async () => {
    await addToCart(code); await saveTicket('Table 1', await db.cart.toArray(), 'No bag', 'takeaway')
    expect(await db.cart.count()).toBe(0); expect(await db.sales.count()).toBe(0)
    const ticket = (await db.tickets.toArray())[0], product = (await db.products.toArray())[0]; await db.products.update(product.id!, { price: 5000 })
    await resumeTicket(ticket.id!); expect((await db.cart.toArray())[0].price).toBe(2500); expect((await db.settings.get('cartContext'))!.value).toEqual({ notes: 'No bag', dining: 'takeaway' })
    await expect(resumeTicket(ticket.id!)).rejects.toThrow('current cart'); expect(await db.tickets.count()).toBe(0)
  })
  it('splits and combines saved orders without losing quantities or metadata', async () => {
    await addToCart(code); await addToCart(code); await saveTicket('Table 1', await db.cart.toArray(), 'No bag', 'takeaway')
    const first = (await db.tickets.toArray())[0]; await splitTicket(first.id!, 'Table 2', [{ rowId: first.rows[0].id!, quantity: 1 }])
    expect((await db.tickets.toArray()).map(ticket => ticket.rows[0].quantity)).toEqual([1, 1])
    await combineTickets((await db.tickets.toArray()).map(ticket => ticket.id!)); expect(await db.tickets.count()).toBe(1)
    await resumeTicket(first.id!); expect((await db.cart.toArray()).reduce((sum, row) => sum + row.quantity, 0)).toBe(2)
    expect(validateBackup(await exportDatabase()).cart).toHaveLength(2)
  })
  it('deducts weighed bags in grams, limits bag counts, and restores the returned weight', async () => {
    const product = (await db.products.toArray())[0]; await saveProduct({ ...product, unit: 'kg', price: 8000, cost: 6000, stock: 2500, lowStock: 500 })
    await addToCart(code, undefined, { modifiers: [], note: '', weightGrams: 250 }); const row = (await db.cart.toArray())[0]
    expect(row.price).toBe(2000); expect(row.cost).toBe(1500); expect(row.name).toContain('0.25 kg'); await changeCartQuantity(row.id!, 2)
    await expect(changeCartQuantity(row.id!, 11)).rejects.toThrow('enough stock')
    const sale = await pay(); expect((await db.products.get(product.id!))!.stock).toBe(2000)
    await correctSale(sale.id!, 'refund', 'One bag returned', true, [{ scanId: (await db.scans.toArray())[0].id!, quantity: 1 }])
    expect((await db.products.get(product.id!))!.stock).toBe(2250); expect(validateBackup(await exportDatabase()).scans[0].weightGrams).toBe(250)
  })
  it('round-trips kilogram catalog quantities and receives kilogram purchases correctly', async () => {
    const product = (await db.products.toArray())[0], s = await supplier(); const weighted = { ...product, unit: 'kg' as const, price: 8000, cost: 6000, stock: 2500, lowStock: 500 }
    expect(parseCatalog(catalogCSV([weighted]))[0]).toEqual({ ...weighted, id: undefined })
    await saveProduct(weighted); await createPurchase(s.id!, [{ productId: product.id!, name: product.name, quantity: 1500, cost: 5500, unit: 'kg' }], '1.5 kg')
    await finishPurchase((await db.purchases.toArray())[0].id!, true); expect((await db.products.get(product.id!))!.stock).toBe(4000); expect(validateBackup(await exportDatabase()).purchases[0].lines[0].unit).toBe('kg')
  })
  it('decodes only the explicitly configured weight label format and rejects invalid checksums', () => {
    const prefix = '200012300250'; const sum = [...prefix].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0), code = prefix + (10 - sum % 10) % 10
    expect(decodeWeightBarcode(code, '20')).toEqual({ barcode: '00123', weightGrams: 250 }); expect(decodeWeightBarcode(code, '')).toBeUndefined(); expect(decodeWeightBarcode(code, '21')).toBeUndefined(); expect(() => decodeWeightBarcode(prefix + ((Number(code[12]) + 1) % 10), '20')).toThrow('check digit')
  })
  it('tracks paid-in/out amounts, refunds, and closing cash discrepancy', async () => {
    await openShift(5000); const shift = (await db.shifts.toArray())[0]; await moveCash('in', 1000, 'Float'); await moveCash('out', 500, 'Supplies'); await addToCart(code); const sale = await pay()
    expect(await expectedCash(shift.id!)).toBe(8000); await correctSale(sale.id!, 'refund', 'Returned', false); expect(await expectedCash(shift.id!)).toBe(5500)
    await closeShift(shift.id!, 5400); expect((await db.shifts.get(shift.id!))!.expected).toBe(5500); await expect(moveCash('in', 100, 'Too late')).rejects.toThrow('Open a cash shift')
    expect(validateBackup(await exportDatabase()).shifts[0].counted).toBe(5400)
  })
  it('round-trips all new tables and rejects corruption before replacing records', async () => {
    await customer(); const s = await supplier(), product = (await db.products.toArray())[0]; await createPurchase(s.id!, [{ productId: product.id!, name: product.name, quantity: 5, cost: 1000 }], '')
    await finishPurchase((await db.purchases.toArray())[0].id!, true); await openShift(0); await moveCash('in', 100, 'Opening extra'); await addToCart(code); await saveTicket('Saved', await db.cart.toArray(), '', 'retail')
    const backup = await exportDatabase(), bad = structuredClone(backup); bad.purchases[0].supplierId = 999
    await expect(restoreDatabase(bad)).rejects.toThrow('supplier'); expect(await db.tickets.count()).toBe(1)
    await resetDatabase(); await restoreDatabase(backup); const restored = await exportDatabase(); for (const name of retailTables) expect(restored[name]).toEqual(backup[name])
  })
  it('restores a schema-2 backup with no new records', async () => { const backup = await exportDatabase(); const legacy = { ...backup, schemaVersion: 2 }; for (const name of retailTables) delete (legacy as Record<string, unknown>)[name]; await restoreDatabase(legacy); expect(await db.products.count()).toBe(8); expect(await db.customers.count()).toBe(0) })
  it('upgrades a real version-2 database, preserving receipts and allowing several refunds per sale', async () => {
    await addToCart(code); const first = await pay(); await correctSale(first.id!, 'refund', 'Old full refund', false); const backup = await exportDatabase()
    db.close(); await Dexie.delete(db.name)
    const legacy = new Dexie(db.name)
    legacy.version(2).stores({ products: '++id, &barcode, name, category', sessions: '++id, date, status, [date+status]', scans: '++id, sessionId, [sessionId+barcode], saleId', settings: '&key', cart: '++id, barcode', sales: '++id, sessionId, createdAt', corrections: '++id, &saleId, sessionId', audit: '++id, createdAt' })
    await legacy.transaction('rw', legacy.tables, async () => { for (const name of ['products', 'sessions', 'scans', 'settings', 'cart', 'sales', 'corrections', 'audit'] as const) await legacy.table(name).bulkAdd(backup[name]) })
    legacy.close(); await db.open(); expect(await db.products.count()).toBe(8); expect(await db.sales.count()).toBe(1); expect(await db.corrections.count()).toBe(1)
    await addToCart(code); await addToCart(code); const sale = await pay(), row = (await db.scans.where('saleId').equals(sale.id!).toArray())[0]
    await correctSale(sale.id!, 'refund', 'First item', false, [{ scanId: row.id!, quantity: 1 }]); await correctSale(sale.id!, 'refund', 'Second item', false, [{ scanId: row.id!, quantity: 1 }]); expect(await db.corrections.count()).toBe(3); expect(validateBackup(await exportDatabase()).sales).toHaveLength(2)
  })
})
describe('gcash reference and account', () => {
  it('saves an optional reference for gcash sales, and saves the store account', async () => {
    await addToCart(code); let rows = await db.cart.toArray()
    const plainTotal = cartPricing(rows).total
    const plainSale = await checkout(rows, 'gcash', plainTotal, 'Owner')
    expect(plainSale.payments).toEqual([{ method: 'gcash', amount: plainTotal }])
    await addToCart(code); rows = await db.cart.toArray()
    const total = cartPricing(rows).total
    const sale = await checkout(rows, 'gcash', total, 'Owner', { payments: [{ method: 'gcash', amount: total, ref: 'GC-12345' }] })
    expect(sale.payments).toEqual([{ method: 'gcash', amount: total, ref: 'GC-12345' }])
    expect(validateBackup(await exportDatabase()).sales.find(s => s.id === sale.id)?.payments?.[0].ref).toBe('GC-12345')
    await expect(saveRetailSettings({ ...retailDefaults, gcashName: 'Maria', gcashNumber: '' })).rejects.toThrow('both')
    await saveRetailSettings({ ...retailDefaults, gcashName: 'Maria Santos', gcashNumber: '09171234567' })
    expect((await getRetailSettings()).gcashNumber).toBe('09171234567')
  })
})
describe('local staff access and time clock', () => {
  it('requires an owner PIN before employee accounts are enabled', async () => { await expect(saveEmployee('Cashier', 'cashier', '123456')).rejects.toThrow('owner PIN') })
  it('identifies cashier sales, blocks manager changes, and clocks authenticated shifts', async () => {
    const owner = await createOwnerCredential('987654'); await setOwnerCredential(owner); await unlockOwner('987654', owner); await saveEmployee('Ana', 'cashier', '123456'); const employee = (await db.employees.toArray())[0]; lockOwner()
    await expect(signInEmployee(employee.id!, '000000')).rejects.toThrow('Incorrect'); await signInEmployee(employee.id!, '123456')
    await addToCart(code); const sale = await checkout(await db.cart.toArray(), 'cash', 2500, 'Impersonated manager'); expect(sale.operator).toBe('Ana')
    await expect(saveProduct({ ...(await db.products.toArray())[0], price: 1 })).rejects.toThrow('manager'); await expect(correctSale(sale.id!, 'refund', 'Unauthorized', true)).rejects.toThrow('manager')
    await clockEmployee(employee.id!, '123456'); await clockEmployee(employee.id!, '123456'); expect((await db.timeEntries.toArray())[0].endedAt).toBeTruthy()
    signOutEmployee(); await addToCart(code); await expect(pay()).rejects.toThrow('Unlock owner'); await expect(saveProduct({ ...(await db.products.toArray())[0], price: 1 })).rejects.toThrow('Unlock owner'); await unlockOwner('987654', owner); const backup = await exportDatabase(); await restoreDatabase(backup); expect(await db.employees.count()).toBe(1); expect(await db.timeEntries.count()).toBe(1)
  })
})
