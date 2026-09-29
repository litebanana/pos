import type { Preferences, Product, Scan, Session, Sale, CartItem, Correction, AuditEntry } from './db'
import { keyIterations, type OwnerCredential } from './owner'
import { lineAmount, rate, proportion } from './pricing'
import { validateContext, validateRetailRecords, validateRetailSettings, type RetailRecords } from './retail-validation'

export const categories = ['Beverages', 'Snacks', 'Pantry', 'Personal care', 'Household', 'Other'] as const
export const productColors = ['peach', 'purple', 'mint', 'pink', 'blue', 'sand'] as const
export const backupLimits = {
  bytes: 25 * 1024 * 1024,
  products: 20_000,
  sessions: 20_000,
  scans: 200_000,
  settings: 6,
  cart: 2_000,
  sales: 200_000,
  corrections: 200_000,
  audit: 200_000,
} as const
export type ProductColor = typeof productColors[number]
export function safeColor(value: string): ProductColor {
  return productColors.includes(value as ProductColor) ? value as ProductColor : 'sand'
}
export function categoryColor(category: string): ProductColor {
  const colors = new Map<string, ProductColor>([['Beverages', 'peach'], ['Snacks', 'purple'], ['Pantry', 'mint'], ['Personal care', 'pink'], ['Household', 'blue']])
  return colors.get(category) || 'sand'
}

export interface ValidatedBackup extends RetailRecords {
  app: 'Tindahan'
  schemaVersion: 3
  exportedAt: string
  products: Product[]
  sessions: Session[]
  scans: Scan[]
  settings: { key: string; value: unknown }[]
  cart: CartItem[]
  sales: Sale[]
  corrections: Correction[]
  audit: AuditEntry[]
}
type RecordData = Record<string, unknown>
function record(value: unknown, label: string): RecordData {
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`The backup contains invalid ${label}.`)
  return value as RecordData
}
function text(value: unknown, max: number, label: string, empty = false): string {
  // Reject invisible controls that can obscure barcodes or misrepresent PDF text.
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) || (!empty && !value.trim())) throw new Error(`The backup contains invalid ${label}.`)
  return value.trim()
}
function id(value: unknown, label: string): number {
  // Leave room for IndexedDB to generate subsequent keys after a restore.
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > Number.MAX_SAFE_INTEGER - 1_000_000) throw new Error(`The backup contains invalid ${label}.`)
  return Number(value)
}
function choice<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw new Error(`The backup contains invalid ${label}.`)
  return value as T
}
function price(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 99_999_999) throw new Error(`The backup contains invalid ${label}.`)
  return Number(value)
}
export function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}
function timestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !validDate(value.slice(0, 10))) throw new Error(`The backup contains invalid ${label}.`)
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) throw new Error(`The backup contains invalid ${label}.`)
  return value
}
function list(value: unknown, limit: number, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`The backup contains invalid ${label}.`)
  if (value.length > limit) throw new Error(`The backup has too many ${label}. The limit is ${limit.toLocaleString()} records.`)
  return value
}
function unique(value: string | number, seen: Set<string | number>, label: string) {
  if (seen.has(value)) throw new Error(`The backup contains duplicate ${label}.`)
  seen.add(value)
}
export function checkedAdd(left: number, right: number): number {
  const result = left + right
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || !Number.isSafeInteger(result) || left < 0 || right < 0) throw new Error('The total exceeds the safe numeric limit. No records were changed.')
  return result
}
export function checkedTotals(rows: Pick<Scan, 'price' | 'quantity'>[]) {
  let items = 0, value = 0
  for (const row of rows) {
    if (!Number.isSafeInteger(row.quantity) || row.quantity < 1 || !Number.isSafeInteger(row.price) || row.price < 0) throw new Error('The report contains invalid quantities or prices.')
    items = checkedAdd(items, row.quantity)
    value = checkedAdd(value, row.quantity * row.price)
  }
  return { items, value }
}
export function validatePreferences(raw: unknown): Preferences {
  const data = record(raw, 'settings')
  if (typeof data.increment !== 'boolean' || typeof data.sound !== 'boolean') throw new Error('The backup contains invalid settings.')
  return {
    storeName: text(data.storeName, 100, 'store name', true),
    increment: data.increment, sound: data.sound,
    paper: choice(data.paper, ['a4', 'letter'], 'paper size'),
    ...(data.operator !== undefined ? { operator: text(data.operator, 100, 'operator name') } : {}),
  }
}
export function validateProduct(raw: unknown, requireId = false): Product {
  const data = record(raw, 'products')
  const product: Product = {
    barcode: text(data.barcode, 100, 'product barcode'), name: text(data.name, 120, 'product name'),
    price: price(data.price, 'product price'), category: choice(data.category, categories, 'product category'),
    color: choice(data.color, productColors, 'product color'),
  }
  if (requireId || data.id !== undefined) product.id = id(data.id, 'product ID')
  if (data.stock !== undefined) product.stock = stock(data.stock)
  if (data.lowStock !== undefined) product.lowStock = stock(data.lowStock)
  if (data.cost !== undefined) product.cost = price(data.cost, 'product cost')
  if (data.unit !== undefined) product.unit = choice(data.unit, ['kg'] as const, 'selling unit')
  if (data.variant !== undefined) product.variant = text(data.variant, 100, 'variant', true)
  if (data.modifiers !== undefined) {
    product.modifiers = list(data.modifiers, 20, 'add-ons').map(raw => { const value = record(raw, 'add-on'); return { name: text(value.name, 40, 'add-on name'), price: price(value.price, 'add-on price') } })
    if (new Set(product.modifiers.map(value => value.name)).size !== product.modifiers.length) throw new Error('Duplicate add-on names.')
  }
  return product
}
export function validateBackup(raw: unknown): ValidatedBackup {
  const data = record(raw, 'backup file')
  if (data.app !== 'Tindahan' || ![1, 2, 3].includes(Number(data.schemaVersion)) || typeof data.schemaVersion !== 'number') throw new Error('This file is not a supported Tindahan backup.')
  const exportedAt = timestamp(data.exportedAt, 'export timestamp')
  // Check every array's bound before allocating normalized records or looking up IDs.
  const productData = list(data.products, backupLimits.products, 'products')
  const sessionData = list(data.sessions, backupLimits.sessions, 'days')
  const scanData = list(data.scans, backupLimits.scans, 'scans')
  const settingData = list(data.settings, backupLimits.settings, 'settings')
  const productIds = new Set<string | number>(), barcodes = new Set<string | number>()
  const products = productData.map(rawProduct => {
    const product = validateProduct(rawProduct, true)
    unique(product.id!, productIds, 'product IDs')
    unique(product.barcode, barcodes, 'product barcodes')
    return product
  })
  const sessionIds = new Set<string | number>(), openDates = new Set<string | number>()
  const sessions = sessionData.map(rawSession => {
    const s = record(rawSession, 'days')
    if (!validDate(s.date)) throw new Error('The backup contains invalid day dates.')
    const session: Session = {
      id: id(s.id, 'day ID'), date: s.date,
      status: choice(s.status, ['open', 'closed'], 'day status'),
      storeName: text(s.storeName, 100, 'day store name', true),
      paper: choice(s.paper, ['a4', 'letter'], 'day paper size'),
      createdAt: timestamp(s.createdAt, 'day creation timestamp'),
    }
    unique(session.id!, sessionIds, 'day IDs')
    if (session.status === 'open') {
      if (s.closedAt !== undefined) throw new Error('An open day cannot have a closing timestamp.')
      unique(session.date, openDates, 'open days for the same date')
    } else {
      session.closedAt = timestamp(s.closedAt, 'day closing timestamp')
      if (session.closedAt < session.createdAt) throw new Error('A day cannot close before it was created.')
    }
    return session
  })
  const scanIds = new Set<string | number>()
  const scans = scanData.map(rawScan => {
    const s = record(rawScan, 'scans')
    const sessionId = id(s.sessionId, 'scan day ID')
    if (!sessionIds.has(sessionId)) throw new Error('The backup contains invalid scans: a referenced day is missing.')
    if (!Number.isInteger(s.quantity) || Number(s.quantity) < 1 || Number(s.quantity) > 9999) throw new Error('The backup contains invalid scan quantities.')
    const scan: Scan = {
      id: id(s.id, 'scan ID'), sessionId,
      barcode: text(s.barcode, 100, 'scan barcode'), name: text(s.name, 120, 'scan product name'),
      price: price(s.price, 'scan price'), quantity: Number(s.quantity),
      category: choice(s.category, categories, 'scan category'), color: choice(s.color, productColors, 'scan color'),
    }
    unique(scan.id!, scanIds, 'scan IDs')
    if (s.saleId !== undefined) scan.saleId = id(s.saleId, 'sale ID')
    if (s.productId !== undefined) scan.productId = id(s.productId, 'scan product ID')
    if (s.lineTotal !== undefined) scan.lineTotal = amount(s.lineTotal)
    if (s.cost !== undefined) scan.cost = price(s.cost, 'item cost')
    if (s.note !== undefined) scan.note = text(s.note, 200, 'item note', true)
    if (s.weightGrams !== undefined) { scan.weightGrams = stock(s.weightGrams); if (scan.weightGrams < 1 || scan.weightGrams > 9_999_000) throw new Error('Invalid item weight.') }
    return scan
  })
  checkedTotals(scans)
  const keys = new Set<string | number>()
  let preferences: Preferences | undefined
  let owner: OwnerCredential | undefined
  let lastExport: string | undefined
  let retail: ReturnType<typeof validateRetailSettings> | undefined
  let cartContext: ReturnType<typeof validateContext> | undefined
  for (const rawSetting of settingData) {
    const setting = record(rawSetting, 'settings')
    const key = choice(setting.key, data.schemaVersion === 1 ? ['initialized', 'preferences'] : data.schemaVersion === 2 ? ['initialized', 'preferences', 'owner', 'lastExport'] : ['initialized', 'preferences', 'owner', 'lastExport', 'retail', 'cartContext'], 'setting key')
    unique(key, keys, 'setting keys')
    if (key === 'preferences') preferences = validatePreferences(setting.value)
    else if (key === 'owner') owner = validateOwnerCredential(setting.value)
    else if (key === 'lastExport') lastExport = timestamp(setting.value, 'last export')
    else if (key === 'retail') retail = validateRetailSettings(setting.value)
    else if (key === 'cartContext') cartContext = validateContext(setting.value)
    else if (typeof setting.value !== 'boolean') throw new Error('The backup contains invalid initialization settings.')
  }
  if (!preferences) throw new Error('The backup contains invalid settings: preferences are missing.')
  const cartIds = new Set<string | number>()
  const validateCart = (raw: unknown): CartItem => {
    const c = record(raw, 'cart item')
    const product = validateProduct(c, true)
    const productId = id(c.productId, 'cart product ID')
    if (!Number.isInteger(c.quantity) || Number(c.quantity) < 1 || Number(c.quantity) > 9999) throw new Error('The backup contains invalid cart quantities.')
    const item: CartItem = { ...product, productId, quantity: Number(c.quantity) }
    if (c.discountRate !== undefined) item.discountRate = rate(c.discountRate)
    if (c.note !== undefined) item.note = text(c.note, 200, 'item note', true)
    if (c.weightGrams !== undefined) { item.weightGrams = stock(c.weightGrams); if (item.unit !== 'kg' || item.weightGrams < 1 || item.weightGrams > 9_999_000) throw new Error('Invalid cart weight.') }
    if (item.unit === 'kg' && !item.weightGrams) throw new Error('A weighed cart item is missing its weight.')
    if (c.selectedModifiers !== undefined) item.selectedModifiers = list(c.selectedModifiers, 20, 'selected add-ons').map(value => text(value, 40, 'add-on'))
    return item
  }
  const cart = (data.schemaVersion !== 1 ? list(data.cart, backupLimits.cart, 'cart items') : []).map(raw => { const item = validateCart(raw); unique(item.id!, cartIds, 'cart IDs'); return item })
  checkedTotals(cart)
  const saleIds = new Set<string | number>()
  const sales = (data.schemaVersion !== 1 ? list(data.sales, backupLimits.sales, 'sales') : []).map(raw => {
    const s = record(raw, 'sale')
    const sale: Sale = {
      id: id(s.id, 'sale ID'), sessionId: id(s.sessionId, 'sale day ID'), total: amount(s.total),
      tendered: amount(s.tendered), change: amount(s.change), payment: choice(s.payment, ['cash', 'gcash', 'card', 'split'], 'payment method'),
      status: choice(s.status, ['completed', 'voided', 'refunded'], 'sale status'),
      createdAt: timestamp(s.createdAt, 'sale timestamp'), operator: text(s.operator, 100, 'operator name'), storeName: text(s.storeName, 100, 'sale store name', true),
    }
    unique(sale.id!, saleIds, 'sale IDs')
    for (const field of ['subtotal', 'discount', 'tax', 'earned', 'redeemed', 'cost', 'refundedAmount'] as const) if (s[field] !== undefined) sale[field] = amount(s[field])
    if (s.taxRate !== undefined) sale.taxRate = rate(s.taxRate, 'Tax rate')
    if (s.taxMode !== undefined) sale.taxMode = choice(s.taxMode, ['none', 'included', 'added'] as const, 'tax mode')
    if (s.customerId !== undefined) sale.customerId = id(s.customerId, 'customer ID')
    if (s.customerName !== undefined) sale.customerName = text(s.customerName, 100, 'customer name')
    if (s.notes !== undefined) sale.notes = text(s.notes, 200, 'sale note', true)
    if (s.dining !== undefined) sale.dining = choice(s.dining, ['retail', 'dine-in', 'takeaway', 'delivery'] as const, 'dining option')
    if (s.shiftId !== undefined) sale.shiftId = id(s.shiftId, 'shift ID')
    if (s.employeeId !== undefined) sale.employeeId = id(s.employeeId, 'employee ID')
    if (s.payments !== undefined) {
      sale.payments = list(s.payments, 3, 'split payments').map(raw => { const p = record(raw, 'payment'); const method = choice(p.method, ['cash', 'gcash', 'card'], 'payment method'); const ref = p.ref === undefined ? undefined : text(p.ref, 50, 'payment reference'); return { method, amount: amount(p.amount), ...(ref ? { ref } : {}) } })
      if (!sale.payments.length || new Set(sale.payments.map(p => p.method)).size !== sale.payments.length || sale.payments.reduce((sum, p) => sum + p.amount, 0) !== sale.total || (sale.payment !== 'split' && (sale.payments.length !== 1 || sale.payments[0].method !== sale.payment)) || (sale.payment === 'split' && sale.payments.length < 2)) throw new Error('The backup contains invalid payment totals.')
    } else if (sale.payment === 'split') throw new Error('Split payments are missing.')
    if (!sessionIds.has(sale.sessionId) || sale.tendered < sale.total || sale.change !== sale.tendered - sale.total || (sale.payment !== 'cash' && sale.tendered !== sale.total)) throw new Error('The backup contains invalid sale totals or references.')
    return sale
  })
  const saleById = new Map(sales.map(sale => [sale.id!, sale]))
  const scanById = new Map(scans.map(scan => [scan.id!, scan]))
  const scansBySale = new Map<number, Scan[]>()
  const saleSums = new Map<number, { items: number; value: number; lines: number }>()
  for (const scan of scans) if (scan.saleId !== undefined) {
    const group = scansBySale.get(scan.saleId) ?? []; group.push(scan); scansBySale.set(scan.saleId, group)
    const sale = saleById.get(scan.saleId)
    if (!sale || sale.sessionId !== scan.sessionId) throw new Error('A scan references an invalid sale.')
    const sum = saleSums.get(scan.saleId) ?? { items: 0, value: 0, lines: 0 }
    saleSums.set(scan.saleId, { items: checkedAdd(sum.items, scan.quantity), value: checkedAdd(sum.value, lineAmount(scan)), lines: sum.lines + 1 })
  }
  for (const sale of sales) if (!saleSums.get(sale.id!)?.lines || saleSums.get(sale.id!)!.value !== sale.total) throw new Error('Sale totals do not match their recorded items.')
  const correctionIds = new Set<string | number>(), correctedSales = new Set<string | number>()
  const corrections = (data.schemaVersion !== 1 ? list(data.corrections, backupLimits.corrections, 'corrections') : []).map(raw => {
    const c = record(raw, 'correction')
    const correction: Correction = {
      id: id(c.id, 'correction ID'), saleId: id(c.saleId, 'corrected sale ID'), sessionId: id(c.sessionId, 'correction day ID'),
      amount: amount(c.amount), items: stock(c.items), action: choice(c.action, ['void', 'refund'], 'correction action'),
      reason: text(c.reason, 200, 'correction reason'), operator: text(c.operator, 100, 'operator name'), createdAt: timestamp(c.createdAt, 'correction timestamp'), returnStock: c.returnStock as boolean,
    }
    unique(correction.id!, correctionIds, 'correction IDs')
    if (c.lines === undefined) unique(correction.saleId, correctedSales, 'sale corrections')
    const sale = saleById.get(correction.saleId)
    if (!sale || !sessionIds.has(correction.sessionId) || typeof c.returnStock !== 'boolean' || correction.createdAt < sale.createdAt) throw new Error('The backup contains inconsistent sale corrections.')
    if (c.lines !== undefined) {
      correction.lines = list(c.lines, 2000, 'refunded items').map(raw => { const line = record(raw, 'refunded item'); return { scanId: id(line.scanId, 'refunded item ID'), quantity: stock(line.quantity), amount: amount(line.amount) } })
      if (!correction.lines.length || new Set(correction.lines.map(line => line.scanId)).size !== correction.lines.length || correction.lines.some(line => !line.quantity) || correction.lines.reduce((sum, line) => sum + line.amount, 0) !== correction.amount || correction.lines.reduce((sum, line) => sum + line.quantity, 0) !== correction.items) throw new Error('Invalid partial refund totals.')
    } else if (sale.total !== correction.amount || saleSums.get(sale.id!)?.items !== correction.items || sale.status !== (correction.action === 'void' ? 'voided' : 'refunded')) throw new Error('The backup contains inconsistent sale corrections.')
    if (c.cashAmount !== undefined) correction.cashAmount = amount(c.cashAmount)
    if (c.taxAmount !== undefined) correction.taxAmount = amount(c.taxAmount)
    if (c.shiftId !== undefined) correction.shiftId = id(c.shiftId, 'refund shift ID')
    if (c.loyaltyDelta !== undefined) { if (!Number.isSafeInteger(c.loyaltyDelta) || Math.abs(Number(c.loyaltyDelta)) > 99_999_999_999) throw new Error('Invalid loyalty correction.'); correction.loyaltyDelta = Number(c.loyaltyDelta) }
    correctedSales.add(correction.saleId)
    return correction
  })
  for (const sale of sales) if (sale.status !== 'completed' && !correctedSales.has(sale.id!)) throw new Error('A corrected sale is missing its correction record.')
  const correctionsBySale = new Map<number, Correction[]>()
  for (const correction of corrections) { const group = correctionsBySale.get(correction.saleId) ?? []; group.push(correction); correctionsBySale.set(correction.saleId, group) }
  for (const sale of sales) {
    const changes = (correctionsBySale.get(sale.id!) ?? []).sort((a, b) => a.id! - b.id!)
    const quantities = new Map<number, number>()
    let refundedBefore = 0, itemsBefore = 0
    for (const correction of changes) {
      const lines = correction.lines ?? (scansBySale.get(sale.id!) ?? []).map(row => ({ scanId: row.id!, quantity: row.quantity, amount: lineAmount(row) }))
      for (const line of lines) { const row = scanById.get(line.scanId), before = quantities.get(line.scanId) ?? 0; if (!row || row.saleId !== sale.id || before + line.quantity > row.quantity || line.amount !== Math.floor(lineAmount(row) * (before + line.quantity) / row.quantity) - Math.floor(lineAmount(row) * before / row.quantity)) throw new Error('Invalid partial refund items or amounts.'); quantities.set(line.scanId, before + line.quantity) }
      const after = refundedBefore + correction.amount, cash = sale.payments?.find(part => part.method === 'cash')?.amount ?? (sale.payment === 'cash' ? sale.total : 0)
      if ((correction.cashAmount !== undefined && correction.cashAmount !== proportion(cash, after, sale.total) - proportion(cash, refundedBefore, sale.total)) || (correction.taxAmount !== undefined && correction.taxAmount !== proportion(sale.tax ?? 0, after, sale.total) - proportion(sale.tax ?? 0, refundedBefore, sale.total))) throw new Error('Invalid refund payment or tax allocation.')
      const ratioBefore = sale.total ? refundedBefore : itemsBefore, ratioAfter = ratioBefore + (sale.total ? correction.amount : correction.items), ratioTotal = sale.total || saleSums.get(sale.id!)!.items
      const loyalty = proportion(sale.redeemed ?? 0, ratioAfter, ratioTotal) - proportion(sale.redeemed ?? 0, ratioBefore, ratioTotal) - (proportion(sale.earned ?? 0, ratioAfter, ratioTotal) - proportion(sale.earned ?? 0, ratioBefore, ratioTotal))
      if (correction.loyaltyDelta !== undefined && correction.loyaltyDelta !== loyalty) throw new Error('Invalid refund loyalty allocation.')
      refundedBefore = after; itemsBefore += correction.items
    }
    const refunded = changes.reduce((sum, row) => sum + row.amount, 0), returned = changes.reduce((sum, row) => sum + row.items, 0)
    if (refunded > sale.total || (sale.refundedAmount !== undefined && sale.refundedAmount !== refunded) || (returned === saleSums.get(sale.id!)!.items && sale.status === 'completed') || (returned < saleSums.get(sale.id!)!.items && sale.status !== 'completed')) throw new Error('Inconsistent refund balance or sale status.')
    if (sale.subtotal !== undefined && sale.subtotal - (sale.discount ?? 0) - (sale.redeemed ?? 0) + (sale.taxMode === 'added' ? sale.tax ?? 0 : 0) !== sale.total) throw new Error('Invalid discounted sale total.')
  }
  const auditIds = new Set<string | number>()
  const audit = (data.schemaVersion !== 1 ? list(data.audit, backupLimits.audit, 'activity entries') : []).map(raw => {
    const a = record(raw, 'activity entry')
    const entry: AuditEntry = { id: id(a.id, 'activity ID'), action: text(a.action, 30, 'activity action'), detail: text(a.detail, 500, 'activity details'), operator: text(a.operator, 100, 'operator name'), createdAt: timestamp(a.createdAt, 'activity timestamp') }
    unique(entry.id!, auditIds, 'activity IDs')
    return entry
  })
  const extra = validateRetailRecords(data, data.schemaVersion, validateCart, validateOwnerCredential)
  const customerKeys = new Set(extra.customers.map(v => v.id)), shiftKeys = new Set(extra.shifts.map(v => v.id))
  const employeeKeys = new Set(extra.employees.map(v => v.id))
  for (const sale of sales) if (sale.employeeId && !employeeKeys.has(sale.employeeId)) throw new Error('A sale references a missing employee.')
  for (const sale of sales) if ((sale.customerId && !customerKeys.has(sale.customerId)) || (sale.shiftId && !shiftKeys.has(sale.shiftId))) throw new Error('A sale references a missing customer or shift.')
  for (const correction of corrections) if (correction.shiftId && !shiftKeys.has(correction.shiftId)) throw new Error('A refund references a missing shift.')
  if (cartContext?.customerId && !customerKeys.has(cartContext.customerId)) throw new Error('A saved checkout customer is missing.')
  return { app: 'Tindahan', schemaVersion: 3, exportedAt, products, sessions, scans, cart, sales, corrections, audit, ...extra, settings: [{ key: 'initialized', value: true }, { key: 'preferences', value: preferences }, ...(owner ? [{ key: 'owner', value: owner }] : []), ...(lastExport ? [{ key: 'lastExport', value: lastExport }] : []), ...(retail ? [{ key: 'retail', value: retail }] : []), ...(cartContext ? [{ key: 'cartContext', value: cartContext }] : [])] }
}

function stock(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 1_000_000_000) throw new Error('Stock and item counts must be whole numbers from 0 to 1,000,000,000.')
  return Number(value)
}
function amount(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 99_999_999_999) throw new Error('The backup contains invalid payment amounts.')
  return Number(value)
}
export function validateOwnerCredential(raw: unknown): OwnerCredential {
  const c = record(raw, 'owner access')
  if (typeof c.salt !== 'string' || !/^[A-Za-z0-9+/]{22}==$/.test(c.salt) || typeof c.hash !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(c.hash) || c.iterations !== keyIterations) throw new Error('The backup contains invalid owner access settings.')
  return { salt: c.salt, hash: c.hash, iterations: keyIterations }
}
