import Dexie, { type Table } from 'dexie'
import { checkedAdd, checkedTotals, validateBackup, validatePreferences, validateProduct } from './validation'
import { assertOwner, lockOwner, type OwnerCredential } from './owner'
import { cartPricing, cents, count, lineAmount, plain, proportion } from './pricing'
import { staffSession, signOutStaff } from './staff-access'
import { validateRetailSettings } from './retail-validation'
import { retailDefaults } from './retail-types'
import { retailTables, type Customer, type Supplier, type PurchaseOrder, type StockMovement, type Ticket, type Shift, type CashMovement, type Employee, type TimeEntry, type Modifier, type CheckoutOptions } from './retail-types'
export { categories, categoryColor, safeColor } from './validation'

export interface Product {
  id?: number
  barcode: string
  name: string
  price: number // integer centavos
  category: string
  color: string
  stock?: number
  lowStock?: number
  cost?: number
  variant?: string
  modifiers?: Modifier[]
  unit?: 'kg'
}
export interface Session {
  id?: number
  date: string
  status: 'open' | 'closed'
  storeName: string
  paper: 'a4' | 'letter'
  createdAt: string
  closedAt?: string
}
export interface Scan {
  id?: number
  sessionId: number
  barcode: string
  name: string
  price: number
  category: string
  color: string
  quantity: number
  saleId?: number
  productId?: number
  lineTotal?: number
  cost?: number
  note?: string
  weightGrams?: number
}
export interface CartItem extends Product { quantity: number; productId: number; discountRate?: number; note?: string; selectedModifiers?: string[]; weightGrams?: number }
export type Payment = 'cash' | 'gcash' | 'card' | 'split'
export interface Sale {
  id?: number; sessionId: number; total: number; payment: Payment; tendered: number; change: number
  createdAt: string; operator: string; storeName: string; status: 'completed' | 'voided' | 'refunded'
  subtotal?: number; discount?: number; tax?: number; taxRate?: number; taxMode?: 'none' | 'included' | 'added'
  customerId?: number; customerName?: string; earned?: number; redeemed?: number; notes?: string; dining?: Ticket['dining']
  payments?: { method: Payment; amount: number; ref?: string }[]; shiftId?: number; cost?: number; refundedAmount?: number
  employeeId?: number
}
export interface Correction {
  id?: number; saleId: number; sessionId: number; amount: number; items: number
  action: 'void' | 'refund'; reason: string; operator: string; createdAt: string; returnStock: boolean
  lines?: { scanId: number; quantity: number; amount: number }[]; cashAmount?: number; taxAmount?: number; shiftId?: number; loyaltyDelta?: number
}
export interface AuditEntry { id?: number; action: string; detail: string; operator: string; createdAt: string }
export interface Preferences {
  storeName: string
  increment: boolean
  sound: boolean
  paper: 'a4' | 'letter'
  operator?: string
}
interface Setting { key: string; value: unknown }
export interface Report { session: Session; scans: Scan[]; corrections?: Correction[] }

class StoreDatabase extends Dexie {
  products!: Table<Product, number>
  sessions!: Table<Session, number>
  scans!: Table<Scan, number>
  settings!: Table<Setting, string>
  cart!: Table<CartItem, number>
  sales!: Table<Sale, number>
  corrections!: Table<Correction, number>
  audit!: Table<AuditEntry, number>
  customers!: Table<Customer, number>
  suppliers!: Table<Supplier, number>
  purchases!: Table<PurchaseOrder, number>
  stockMovements!: Table<StockMovement, number>
  tickets!: Table<Ticket, number>
  shifts!: Table<Shift, number>
  cashMovements!: Table<CashMovement, number>
  employees!: Table<Employee, number>
  timeEntries!: Table<TimeEntry, number>
  constructor() {
    super('tindahan-local')
    this.version(1).stores({
      products: '++id, &barcode, name, category',
      sessions: '++id, date, status, [date+status]',
      scans: '++id, sessionId, [sessionId+barcode]',
      settings: '&key',
    })
    this.version(2).stores({
      cart: '++id, barcode', sales: '++id, sessionId, createdAt',
      corrections: '++id, &saleId, sessionId', audit: '++id, createdAt',
      scans: '++id, sessionId, [sessionId+barcode], saleId',
    })
    this.version(3).stores({
      customers: '++id, name, card', suppliers: '++id, name', purchases: '++id, supplierId, status, createdAt',
      stockMovements: '++id, productId, createdAt', tickets: '++id, createdAt', shifts: '++id, status',
      cashMovements: '++id, shiftId', employees: '++id, name', timeEntries: '++id, employeeId',
      corrections: '++id, saleId, sessionId', sales: '++id, sessionId, createdAt, customerId, shiftId',
    })
  }
}
export const db = new StoreDatabase()
export const defaults: Preferences = { storeName: '', increment: true, sound: true, paper: 'a4' }

export function today() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  return `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`
}
export function dateLabel(date: string, long = false) {
  return new Date(`${date}T12:00:00+08:00`).toLocaleDateString('en-PH', {
    timeZone: 'Asia/Manila', month: long ? 'long' : 'short', day: 'numeric', year: 'numeric',
  })
}
export const money = (centavos: number) => new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(centavos / 100)
export const totals = checkedTotals

export async function initialize() {
  await db.transaction('rw', db.settings, db.products, async () => {
    if (!await db.settings.get('initialized')) {
      // A small, editable starter catalog. No sales or historical data are fabricated.
      await db.products.bulkAdd([
        { barcode: '4800016000013', name: 'Coca-Cola Original', price: 2500, category: 'Beverages', color: 'peach' },
        { barcode: '4800016000020', name: 'Lucky Me! Pancit Canton', price: 1800, category: 'Pantry', color: 'mint' },
        { barcode: '4800016000037', name: 'Piattos Cheese', price: 2000, category: 'Snacks', color: 'purple' },
        { barcode: '4800016000044', name: 'Kopiko Brown Coffee', price: 1000, category: 'Beverages', color: 'sand' },
        { barcode: '4800016000051', name: 'SkyFlakes Crackers', price: 850, category: 'Snacks', color: 'blue' },
        { barcode: '4800016000068', name: 'Silver Swan Soy Sauce', price: 1500, category: 'Pantry', color: 'pink' },
        { barcode: '4800016000075', name: 'Safeguard Pure White', price: 3800, category: 'Personal care', color: 'mint' },
        { barcode: '4800016000082', name: 'Surf Powder Detergent', price: 700, category: 'Household', color: 'purple' },
      ])
      await db.settings.put({ key: 'preferences', value: defaults })
      await db.settings.put({ key: 'initialized', value: true })
    }
  })
}
export async function getPreferences(): Promise<Preferences> {
  return { ...defaults, ...(await db.settings.get('preferences'))?.value as Partial<Preferences> }
}
export async function setPreferences(changes: Partial<Preferences>) {
  await db.transaction('rw', db.settings, db.employees, async () => {
    if (changes.storeName !== undefined || changes.paper !== undefined) await requireOwner()
    const value = validatePreferences({ ...await getPreferences(), ...changes })
    await db.settings.put({ key: 'preferences', value })
  })
}
export async function saveProduct(raw: Product) {
  const product = validateProduct(raw)
  return db.transaction('rw', db.products, db.settings, db.audit, db.employees, db.stockMovements, async () => {
    await requireOwner()
    const old = product.id ? await db.products.get(product.id) : undefined
    const key = product.id ? await db.products.put(product) : await db.products.add(product)
    if (product.stock !== undefined && product.stock !== old?.stock) await stockLog({ ...product, id: key }, old?.stock ?? 0, product.stock, 'Product stock saved')
    await logAction('product', `Saved ${product.name}; price ${money(product.price)}; stock ${product.stock ?? 'untracked'}`)
    return key
  })
}
export async function currentSession(date = today()) {
  return db.sessions.where('[date+status]').equals([date, 'open']).first()
}
export async function recordScan(barcode: string, newProduct?: Product): Promise<Product | null> {
  if (!barcode.trim() || barcode.length > 100) throw new Error('Enter a barcode between 1 and 100 characters.')
  return db.transaction('rw', db.products, db.sessions, db.scans, db.settings, async () => {
    let product = await db.products.where('barcode').equals(barcode).first()
    if (!product && newProduct) {
      product = validateProduct({ ...newProduct, barcode })
      product.id = await db.products.add(product)
    }
    if (!product) return null
    const preferences = await getPreferences()
    let session = await currentSession()
    if (!session) {
      session = { date: today(), status: 'open', storeName: preferences.storeName, paper: preferences.paper, createdAt: new Date().toISOString() }
      session.id = await db.sessions.add(session)
    }
    const sessionRows = await db.scans.where('sessionId').equals(session.id!).toArray()
    checkedAdd(totals(sessionRows).value, product.price)
    const existing = preferences.increment
      ? await db.scans.where('[sessionId+barcode]').equals([session.id!, barcode]).filter(row => row.price === product!.price && row.name === product!.name).last()
      : undefined
    if (existing) {
      if (existing.quantity >= 9999) throw new Error('This row has reached 9,999 items. Turn off repeat grouping to start a new row.')
      await db.scans.update(existing.id!, { quantity: existing.quantity + 1 })
    } else {
      await db.scans.add({ sessionId: session.id!, barcode, name: product.name, price: product.price, category: product.category, color: product.color, quantity: 1 })
    }
    return product
  })
}
export async function changeQuantity(id: number, quantity: number) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new Error('Quantity must be a whole number from 1 to 9,999.')
  await db.transaction('rw', db.scans, db.sessions, async () => {
    const row = await db.scans.get(id)
    if (!row || (await db.sessions.get(row.sessionId))?.status !== 'open') throw new Error('This day has already been archived.')
    const sessionRows = await db.scans.where('sessionId').equals(row.sessionId).toArray()
    totals(sessionRows.map(item => item.id === id ? { ...item, quantity } : item))
    await db.scans.update(id, { quantity })
  })
}
export async function removeScan(id: number) {
  await db.transaction('rw', db.scans, db.sessions, async () => {
    const row = await db.scans.get(id)
    if (!row || (await db.sessions.get(row.sessionId))?.status !== 'open') throw new Error('This day has already been archived.')
    await db.scans.delete(id)
  })
}
export async function getReport(id: number): Promise<Report> {
  return db.transaction('r', db.sessions, db.scans, db.settings, db.corrections, async () => {
    const session = await db.sessions.get(id)
    if (!session) throw new Error('This report could not be found.')
    const preferences = await getPreferences()
    const scans = await db.scans.where('sessionId').equals(id).toArray()
    return { session: session.status === 'open' && session.date === today() ? { ...session, storeName: preferences.storeName, paper: preferences.paper } : session, scans, corrections: await db.corrections.where('sessionId').equals(id).toArray() }
  })
}
export async function archiveReport(report: Report) {
  await db.transaction('rw', db.sessions, db.scans, db.settings, db.corrections, db.cart, async () => {
    const session = await db.sessions.get(report.session.id!)
    if (!session || session.status !== 'open') throw new Error('This day was already closed in another window. Find its PDF in History.')
    const scans = await db.scans.where('sessionId').equals(session.id!).toArray()
    const preferences = await getPreferences()
    const corrections = await db.corrections.where('sessionId').equals(session.id!).toArray()
    if (await db.cart.count()) throw new Error('Complete checkout or empty the cart before closing the day.')
    const isCurrentDay = session.date === today()
    if (JSON.stringify(scans) !== JSON.stringify(report.scans) || JSON.stringify(corrections) !== JSON.stringify(report.corrections ?? []) || (isCurrentDay && (preferences.storeName !== report.session.storeName || preferences.paper !== report.session.paper))) {
      throw new Error('The day changed in another window. Review the latest totals and close it again.')
    }
    if (!scans.length && !corrections.length) throw new Error('Record a sale before closing the day.')
    await db.sessions.put({ ...report.session, status: 'closed', closedAt: new Date().toISOString() })
  })
}
export async function exportDatabase() {
  return db.transaction('r', db.tables, async () => ({
    app: 'Tindahan' as const, schemaVersion: 3 as const, exportedAt: new Date().toISOString(),
    products: await db.products.toArray(), sessions: await db.sessions.toArray(),
    scans: await db.scans.toArray(), settings: await db.settings.toArray(),
    cart: await db.cart.toArray(), sales: await db.sales.toArray(), corrections: await db.corrections.toArray(), audit: await db.audit.toArray(),
    customers: await db.customers.toArray(), suppliers: await db.suppliers.toArray(), purchases: await db.purchases.toArray(), stockMovements: await db.stockMovements.toArray(), tickets: await db.tickets.toArray(), shifts: await db.shifts.toArray(), cashMovements: await db.cashMovements.toArray(), employees: await db.employees.toArray(), timeEntries: await db.timeEntries.toArray(),
  }))
}
export async function resetDatabase() {
  await db.transaction('rw', db.tables, async () => {
    await requireOwner()
    for (const table of db.tables) await table.clear()
    // Reset stays empty instead of silently recreating the starter catalog.
    await db.settings.put({ key: 'initialized', value: true })
    await db.settings.put({ key: 'preferences', value: defaults })
  })
  lockOwner()
  signOutStaff()
}

export async function restoreDatabase(raw: unknown) {
  // Validation completes before the write transaction, which rolls back on any write failure.
  const data = validateBackup(raw)
  await db.transaction('rw', db.tables, async () => {
    await requireOwner()
    for (const table of db.tables) await table.clear()
    await db.products.bulkAdd(data.products)
    await db.sessions.bulkAdd(data.sessions)
    await db.scans.bulkAdd(data.scans)
    await db.settings.bulkPut(data.settings)
    await db.cart.bulkAdd(data.cart)
    await db.sales.bulkAdd(data.sales)
    await db.corrections.bulkAdd(data.corrections)
    await db.audit.bulkAdd(data.audit)
    for (const name of retailTables) await db.table(name).bulkAdd(data[name])
  })
  lockOwner()
  signOutStaff()
}

export interface HistorySummary {
  session: Session
  items: number
  value: number
  lines: number
  dateText: string
  searchText: string
}
export function summarizeHistory(sessions: Session[], scans: Scan[], corrections: Correction[] = []): HistorySummary[] {
  const sums = new Map<number, { items: number; value: number; lines: number }>()
  // Each scan is visited once, instead of filtering all scans for every day.
  for (const scan of scans) {
    const sum = sums.get(scan.sessionId) || { items: 0, value: 0, lines: 0 }
    const row = { items: scan.quantity, value: lineAmount(scan) }
    sums.set(scan.sessionId, { items: checkedAdd(sum.items, row.items), value: checkedAdd(sum.value, row.value), lines: sum.lines + 1 })
  }
  for (const correction of corrections) {
    const sum = sums.get(correction.sessionId) || { items: 0, value: 0, lines: 0 }
    sums.set(correction.sessionId, { ...sum, value: sum.value - correction.amount })
  }
  const labels = new Map<string, string>()
  const summaries: HistorySummary[] = []
  for (const session of sessions) {
    const sum = sums.get(session.id!)
    if (!sum) continue
    let dateText = labels.get(session.date)
    if (!dateText) { dateText = dateLabel(session.date, true); labels.set(session.date, dateText) }
    summaries.push({ session, ...sum, dateText, searchText: `${session.storeName} ${session.date} ${dateText}`.toLowerCase() })
  }
  return summaries
}
export async function getHistorySummaries() {
  return db.transaction('r', db.sessions, db.scans, db.corrections, async () => summarizeHistory(
    await db.sessions.orderBy('date').reverse().toArray(), await db.scans.toArray(), await db.corrections.toArray(),
  ))
}

export async function requireOwner() {
  const staff = staffSession()
  if (staff) {
    const employee = await db.employees.get(staff.id)
    if (!employee?.active || employee.credential.hash !== staff.hash) { signOutStaff(); throw new Error('Sign in again. Employee settings changed.') }
    if (employee.role !== 'manager') throw new Error('This action requires a manager. Sign out and unlock owner access in Settings.')
  }
  assertOwner((await db.settings.get('owner'))?.value as OwnerCredential | undefined)
}
export async function logAction(action: string, detail: string, operator?: string) {
  await db.audit.add({ action, detail: detail.slice(0, 500), operator: operator || (await getPreferences()).operator || 'Owner', createdAt: new Date().toISOString() })
}
export async function setOwnerCredential(credential?: OwnerCredential) {
  await db.transaction('rw', db.settings, db.audit, db.employees, async () => {
    await requireOwner()
    if (credential) await db.settings.put({ key: 'owner', value: credential })
    else await db.settings.delete('owner')
    await logAction('owner', credential ? 'Owner PIN set' : 'Owner PIN removed')
  })
  lockOwner()
}
export async function deleteProduct(id: number) {
  await db.transaction('rw', db.products, db.settings, db.audit, db.employees, async () => {
    await requireOwner()
    const product = await db.products.get(id)
    if (!product) throw new Error('Product no longer exists.')
    await db.products.delete(id)
    await logAction('product', `Deleted ${product.name}`)
  })
}
export async function addToCart(barcode: string, newProduct?: Product, customization?: { modifiers: string[]; note: string; weightGrams?: number }) {
  if (!barcode.trim() || barcode.length > 100) throw new Error('Enter a barcode between 1 and 100 characters.')
  return db.transaction('rw', db.products, db.cart, db.settings, db.audit, db.employees, async () => {
    let product = await db.products.where('barcode').equals(barcode).first()
    if (!product && newProduct) {
      await requireOwner()
      product = validateProduct({ ...newProduct, barcode })
      product.id = await db.products.add(product)
      await logAction('product', `Added ${product.name}`)
    }
    if (!product) return null
    const selected = customization?.modifiers ?? []
    if (selected.length > 20 || new Set(selected).size !== selected.length || selected.some(name => !product!.modifiers?.some(modifier => modifier.name === name))) throw new Error('Choose valid product add-ons.')
    const note = plain(customization?.note ?? '', 200, 'item note')
    const weightGrams = product.unit === 'kg' ? count(customization?.weightGrams ?? 1000, 'Weight in grams', 9_999_000) : undefined
    if (weightGrams === 0) throw new Error('Weight must be greater than zero.')
    const stockPerItem = weightGrams ?? 1
    const price = Math.round(product.price * (weightGrams ?? 1000) / 1000) + selected.reduce((sum, name) => sum + product!.modifiers!.find(modifier => modifier.name === name)!.price, 0)
    cents(price, 'Unit price', 99_999_999)
    const cost = product.cost === undefined ? undefined : Math.round(product.cost * (weightGrams ?? 1000) / 1000)
    if (cost !== undefined) cents(cost, 'Unit cost', 99_999_999)
    const rows = await db.cart.toArray()
    if (!rows.length) await db.settings.delete('cartContext')
    const quantity = rows.filter(row => row.productId === product.id).reduce((sum, row) => sum + row.quantity * (row.weightGrams ?? 1), 0)
    if (product.stock !== undefined && quantity + stockPerItem > product.stock) throw new Error(`${product.name} has insufficient stock. Update its stock in Products.`)
    checkedAdd(totals(rows).value, price)
    const prefs = await getPreferences()
    const suffix = [...(product.variant ? [product.variant] : []), ...(weightGrams ? [`${weightGrams / 1000} kg`] : []), ...selected]
    const name = suffix.length ? `${product.name} (${suffix.join(', ')})` : product.name
    if (name.length > 120) throw new Error('The product and add-on names exceed 120 characters. Shorten them in Products.')
    const existing = prefs.increment ? rows.find(row => row.productId === product.id && row.price === price && row.cost === cost && row.name === name && (row.note ?? '') === note && !row.discountRate) : undefined
    if (existing) {
      if (existing.quantity >= 9999) throw new Error('The quantity limit is 9,999 per row.')
      await db.cart.update(existing.id!, { quantity: existing.quantity + 1 })
    } else {
      await db.cart.add({ ...product, id: undefined, productId: product.id!, name, price, ...(cost !== undefined ? { cost } : {}), quantity: 1, ...(weightGrams ? { weightGrams } : {}), ...(note ? { note } : {}), ...(selected.length ? { selectedModifiers: selected } : {}) })
    }
    return product
  })
}
export async function changeCartQuantity(id: number, value: number, relative = false) {
  await db.transaction('rw', db.cart, db.products, async () => {
    const row = await db.cart.get(id)
    if (!row) throw new Error('The cart changed. Review the latest items.')
    const quantity = relative ? row.quantity + value : value
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 9999) throw new Error('Quantity must be a whole number from 1 to 9,999.')
    const rows = await db.cart.toArray()
    const updated = rows.map(item => item.id === id ? { ...item, quantity } : item)
    totals(updated)
    const product = await db.products.get(row.productId)
    if (product?.stock !== undefined && updated.filter(item => item.productId === row.productId).reduce((sum, item) => sum + item.quantity * (item.weightGrams ?? 1), 0) > product.stock) throw new Error('There is not enough stock for this quantity.')
    await db.cart.update(id, { quantity })
  })
}
export async function removeCartItem(id: number) {
  return db.transaction('rw', db.cart, async () => {
    const row = await db.cart.get(id)
    if (!row) throw new Error('The cart changed. Review the latest items.')
    await db.cart.delete(id)
    return row
  })
}
export async function undoCartRemoval(row: CartItem) {
  await db.transaction('rw', db.cart, db.products, async () => {
    const product = await db.products.get(row.productId)
    if (!product) throw new Error('This product was deleted. Add it to the catalog before restoring the item.')
    const rows = await db.cart.toArray()
    const existing = rows.find(item => item.productId === row.productId && item.price === row.price && item.cost === row.cost && item.name === row.name && (item.note ?? '') === (row.note ?? '') && (item.discountRate ?? 0) === (row.discountRate ?? 0) && item.weightGrams === row.weightGrams && JSON.stringify(item.selectedModifiers ?? []) === JSON.stringify(row.selectedModifiers ?? []))
    const quantity = (existing?.quantity ?? 0) + row.quantity
    if (quantity > 9999) throw new Error('Restoring would exceed the quantity limit.')
    if (product.stock !== undefined && rows.filter(item => item.productId === row.productId).reduce((sum, item) => sum + item.quantity * (item.weightGrams ?? 1), 0) + row.quantity * (row.weightGrams ?? 1) > product.stock) throw new Error('There is not enough stock to restore this item.')
    totals([...rows, row])
    if (existing) await db.cart.update(existing.id!, { quantity })
    else await db.cart.add({ ...row, id: undefined })
  })
}
async function ensureSession() {
  let session = await currentSession()
  if (!session) {
    const prefs = await getPreferences()
    session = { date: today(), status: 'open', storeName: prefs.storeName, paper: prefs.paper, createdAt: new Date().toISOString() }
    session.id = await db.sessions.add(session)
  }
  return session
}
export async function checkout(expected: CartItem[], payment: Payment, tendered: number, operator: string, options: CheckoutOptions = {}) {
  if (!['cash', 'gcash', 'card', 'split'].includes(payment)) throw new Error('Choose a payment method.')
  operator = operator.trim()
  if (!operator || operator.length > 100 || /[\u0000-\u001f\u007f-\u009f]/u.test(operator)) throw new Error('Enter an operator name with up to 100 characters.')
  return db.transaction('rw', db.tables, async () => {
    const staff = staffSession()
    if (staff) {
      const employee = await db.employees.get(staff.id)
      if (!employee?.active || employee.credential.hash !== staff.hash) throw new Error('Sign in again. Employee settings changed.')
      operator = employee.name
    }
    else if (await db.employees.filter(employee => employee.active).count()) await requireOwner()
    const rows = await db.cart.toArray()
    if (!rows.length) throw new Error('Add an item to the cart first.')
    if (JSON.stringify(rows) !== JSON.stringify(expected)) throw new Error('The cart changed in another window. Review it before checkout.')
    const pricing = cartPricing(rows, options), total = pricing.total
    const config = validateRetailSettings({ ...retailDefaults, ...(await db.settings.get('retail'))?.value as object })
    if (pricing.discount || ((options.taxMode ?? 'none') !== config.taxMode || (options.taxRate ?? 0) !== config.taxRate)) await requireOwner()
    const customer = options.customerId ? await db.customers.get(options.customerId) : undefined
    if (options.customerId && !customer) throw new Error('This customer no longer exists.')
    if (pricing.redeemed && (!customer || customer.balance < pricing.redeemed)) throw new Error('This customer does not have enough loyalty points.')
    let payments = options.payments
    if (payment === 'split') {
      if (!payments || payments.length < 2 || payments.length > 3 || new Set(payments.map(part => part.method)).size !== payments.length || payments.some(part => !['cash', 'gcash', 'card'].includes(part.method) || cents(part.amount, 'Payment') <= 0) || payments.reduce((sum, part) => sum + part.amount, 0) !== total) throw new Error('Split payments must cover the total exactly, using distinct payment methods.')
      payments = payments.map(part => ({ method: part.method, amount: part.amount, ...(typeof part.ref === 'string' && part.ref.trim() ? { ref: plain(part.ref, 50, 'payment reference') } : {}) }))
    } else {
      const ref = (options.payments?.[0] as { ref?: unknown } | undefined)?.ref
      payments = [{ method: payment, amount: total, ...(typeof ref === 'string' && ref.trim() ? { ref: plain(ref, 50, 'payment reference') } : {}) }]
    }
    if (!Number.isSafeInteger(tendered) || tendered < total || tendered > 99_999_999_999) throw new Error('The amount received must cover the total.')
    if (payment !== 'cash' && tendered !== total) throw new Error('For non-cash payments, the amount received must equal the total.')
    const quantities = new Map<number, number>()
    for (const row of rows) quantities.set(row.productId, (quantities.get(row.productId) || 0) + row.quantity * (row.weightGrams ?? 1))
    for (const [productId, quantity] of quantities) {
      const product = await db.products.get(productId)
      if (!product) throw new Error('A cart product was deleted. Remove it and review the cart.')
      if (rows.some(row => row.productId === productId && row.unit !== product.unit)) throw new Error('A cart product changed its selling unit. Remove it and add it again.')
      if (product.stock !== undefined) {
        if (product.stock < quantity) throw new Error(`${product.name} has insufficient stock.`)
        await db.products.update(productId, { stock: product.stock - quantity })
        await stockLog(product, product.stock, product.stock - quantity, 'Sale', operator)
      }
    }
    const session = await ensureSession()
    checkedAdd(totals(await db.scans.where('sessionId').equals(session.id!).toArray()).value, total)
    const prefs = await getPreferences()
    const earned = customer ? Math.floor((total - (pricing.taxMode === 'none' ? 0 : pricing.tax)) * config.loyaltyRate / 10_000) : 0
    const shift = await db.shifts.where('status').equals('open').first()
    const sale: Sale = { sessionId: session.id!, total, payment, tendered, change: tendered - total, operator, storeName: prefs.storeName, createdAt: new Date().toISOString(), status: 'completed', subtotal: pricing.subtotal, discount: pricing.discount, tax: pricing.tax, taxRate: pricing.taxRate, taxMode: pricing.taxMode, cost: pricing.cost, payments, notes: plain(options.notes ?? '', 200, 'sale note'), dining: options.dining ?? 'retail', ...(shift ? { shiftId: shift.id } : {}), ...(customer ? { customerId: customer.id, customerName: customer.name, earned, redeemed: pricing.redeemed } : {}) }
    if (!['retail', 'dine-in', 'takeaway', 'delivery'].includes(sale.dining!)) throw new Error('Choose a valid dining option.')
    sale.id = await db.sales.add(sale)
    if (staff) { sale.employeeId = staff.id; await db.sales.update(sale.id, { employeeId: staff.id }) }
    await db.scans.bulkAdd(rows.map((row, i) => ({ sessionId: session.id!, saleId: sale.id!, productId: row.productId, barcode: row.barcode, name: row.name, price: row.price, category: row.category, color: row.color, quantity: row.quantity, lineTotal: pricing.lineTotals[i], ...(row.weightGrams ? { weightGrams: row.weightGrams } : {}), ...(row.cost !== undefined ? { cost: row.cost } : {}), ...(row.note ? { note: row.note } : {}) })))
    if (customer) await db.customers.update(customer.id!, { balance: customer.balance - pricing.redeemed + earned })
    await db.settings.delete('cartContext')
    await db.cart.clear()
    await db.settings.put({ key: 'preferences', value: { ...prefs, operator } })
    await logAction('sale', `Sale #${sale.id}; ${payment}; ${money(total)}`, operator)
    return sale
  })
}
export async function correctSale(saleId: number, action: 'void' | 'refund', reason: string, returnStock: boolean, selection?: { scanId: number; quantity: number }[]) {
  reason = reason.trim()
  if (!reason || reason.length > 200 || /[\u0000-\u001f\u007f-\u009f]/u.test(reason)) throw new Error('Enter a reason with up to 200 characters.')
  if (!['void', 'refund'].includes(action)) throw new Error('Choose a correction type.')
  await db.transaction('rw', db.tables, async () => {
    await requireOwner()
    const sale = await db.sales.get(saleId)
    if (!sale || sale.status !== 'completed') throw new Error('This sale has already been corrected or no longer exists.')
    const originalSession = await db.sessions.get(sale.sessionId)
    if (action === 'void' && (originalSession?.status !== 'open' || originalSession.date !== today())) throw new Error('Only sales in the current open day can be voided. Use a refund for an older sale.')
    const session = await ensureSession()
    const rows = await db.scans.where('saleId').equals(saleId).toArray()
    const previous = await db.corrections.where('saleId').equals(saleId).toArray()
    if (action === 'void' && previous.length) throw new Error('A partly refunded sale cannot be voided. Refund the remaining items instead.')
    const lines = rows.map(row => {
      const returned = previous.reduce((sum, correction) => sum + (correction.lines?.find(line => line.scanId === row.id)?.quantity ?? (correction.lines ? 0 : row.quantity)), 0)
      const quantity = selection ? selection.find(line => line.scanId === row.id)?.quantity ?? 0 : row.quantity - returned
      if (!Number.isInteger(quantity) || quantity < 0 || quantity > row.quantity - returned) throw new Error('Refund quantity exceeds the items remaining on this receipt.')
      const amount = Math.floor(lineAmount(row) * (returned + quantity) / row.quantity) - Math.floor(lineAmount(row) * returned / row.quantity)
      return { scanId: row.id!, quantity, amount }
    }).filter(line => line.quantity)
    if (!lines.length || (selection && (new Set(selection.map(line => line.scanId)).size !== selection.length || selection.some(line => !rows.some(row => row.id === line.scanId))))) throw new Error('Choose valid receipt items to refund.')
    if (action === 'void' && selection && lines.reduce((sum, line) => sum + line.quantity, 0) !== totals(rows).items) throw new Error('A void must include every item.')
    if (returnStock) for (const line of lines) {
      const row = rows.find(row => row.id === line.scanId)!
      const product = row.productId ? await db.products.get(row.productId) : undefined
      if (row.productId && !product) throw new Error(`${row.name} was deleted from the catalog. Uncheck Return items to stock to record the refund, then adjust any replacement product separately.`)
      if (product?.stock !== undefined) {
        if ((product.unit === 'kg') !== !!row.weightGrams) throw new Error('This returned product changed its selling unit. Uncheck Return items to stock and adjust it separately.')
        const stock = checkedAdd(product.stock, line.quantity * (row.weightGrams ?? 1))
        if (stock > 1_000_000_000) throw new Error('Stock would exceed the supported limit.')
        await db.products.update(product.id!, { stock })
        await stockLog(product, product.stock, stock, 'Returned sale items')
      }
    }
    const operator = (await getPreferences()).operator || 'Owner'
    const amount = lines.reduce((sum, line) => sum + line.amount, 0), refunded = previous.reduce((sum, row) => sum + row.amount, 0)
    const cashPaid = sale.payments?.find(part => part.method === 'cash')?.amount ?? (sale.payment === 'cash' ? sale.total : 0)
    const cashAmount = proportion(cashPaid, refunded + amount, sale.total) - proportion(cashPaid, refunded, sale.total)
    const taxAmount = proportion(sale.tax ?? 0, refunded + amount, sale.total) - proportion(sale.tax ?? 0, refunded, sale.total)
    const ratioBefore = sale.total ? refunded : previous.reduce((sum, correction) => sum + correction.items, 0), ratioAfter = ratioBefore + (sale.total ? amount : lines.reduce((sum, line) => sum + line.quantity, 0)), ratioTotal = sale.total || totals(rows).items
    const loyaltyDelta = proportion(sale.redeemed ?? 0, ratioAfter, ratioTotal) - proportion(sale.redeemed ?? 0, ratioBefore, ratioTotal) - (proportion(sale.earned ?? 0, ratioAfter, ratioTotal) - proportion(sale.earned ?? 0, ratioBefore, ratioTotal))
    if (sale.customerId && loyaltyDelta) { const customer = await db.customers.get(sale.customerId); if (customer) await db.customers.update(customer.id!, { balance: customer.balance + loyaltyDelta }) }
    const shift = await db.shifts.where('status').equals('open').first()
    await db.corrections.add({ saleId, sessionId: session.id!, action, reason, returnStock, amount, items: lines.reduce((sum, line) => sum + line.quantity, 0), lines, cashAmount, taxAmount, loyaltyDelta, ...(shift ? { shiftId: shift.id } : {}), operator, createdAt: new Date().toISOString() })
    const fullyReturned = previous.reduce((sum, correction) => sum + correction.items, 0) + lines.reduce((sum, line) => sum + line.quantity, 0) === totals(rows).items
    await db.sales.update(saleId, { status: fullyReturned ? action === 'void' ? 'voided' : 'refunded' : 'completed', refundedAmount: refunded + amount })
    await logAction(action, `Sale #${saleId}; ${reason}; stock return ${returnStock ? 'requested for tracked products' : 'not requested'}`, operator)
  })
}
export async function adjustStock(id: number, stock: number, reason: string) {
  if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000_000) throw new Error('Stock must be a whole number from 0 to 1,000,000,000.')
  reason = reason.trim()
  if (!reason || reason.length > 200) throw new Error('Enter an adjustment reason with up to 200 characters.')
  await db.transaction('rw', db.products, db.settings, db.audit, db.stockMovements, db.employees, async () => {
    await requireOwner()
    const product = await db.products.get(id)
    if (!product) throw new Error('The product no longer exists.')
    await db.products.update(id, { stock })
    await stockLog(product, product.stock ?? 0, stock, reason)
    await logAction('stock', `${product.name}: ${product.stock ?? 'untracked'} → ${stock}. ${reason}`)
  })
}
export function reportTotals(report: Report) {
  const gross = totals(report.scans)
  const refunds = (report.corrections ?? []).reduce((sum, row) => checkedAdd(sum, row.amount), 0)
  const value = report.scans.reduce((sum, row) => checkedAdd(sum, lineAmount(row)), 0)
  return { items: gross.items, gross: value, refunds, value: value - refunds }
}
export async function stockLog(product: Product, before: number, after: number, reason: string, operator?: string) {
  count(before, 'Stock'); count(after, 'Stock')
  await db.stockMovements.add({ productId: product.id!, name: product.name, before, after, reason, operator: operator || (await getPreferences()).operator || 'Owner', createdAt: new Date().toISOString(), ...(product.unit ? { unit: product.unit } : {}) })
}
