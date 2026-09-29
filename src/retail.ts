import { db, getPreferences, logAction, requireOwner, stockLog, type CartItem } from './db'
import { count, cents, plain, rate } from './pricing'
import { retailDefaults, type RetailSettings, type Customer, type Supplier, type PurchaseLine, type Ticket, type Employee } from './retail-types'
import { createOwnerCredential, lockOwner } from './owner'
import { acceptStaff, signOutStaff, staffSession, verifyStaffPin } from './staff-access'
import { validateProduct } from './validation'
import { validateRetailSettings } from './retail-validation'

export async function getRetailSettings() { return validateRetailSettings({ ...retailDefaults, ...(await db.settings.get('retail'))?.value as Partial<RetailSettings> }) }
export async function saveRetailSettings(value: RetailSettings) {
  value = validateRetailSettings(value)
  await db.transaction('rw', db.settings, db.audit, db.employees, async () => { await requireOwner(); await db.settings.put({ key: 'retail', value }); await logAction('settings', 'Changed checkout, tax, loyalty, and display settings') })
}
export function validateCustomer(value: Customer): Customer {
  return { ...(value.id ? { id: value.id } : {}), name: plain(value.name, 100, 'customer name', true), phone: plain(value.phone, 50, 'phone'), email: plain(value.email, 120, 'email'), address: plain(value.address, 200, 'address'), notes: plain(value.notes, 200, 'notes'), card: plain(value.card, 100, 'loyalty card'), balance: value.balance }
}
export async function saveCustomer(raw: Customer) {
  const value = validateCustomer(raw)
  await db.transaction('rw', db.customers, db.settings, db.audit, db.employees, async () => {
    await requireOwner()
    if (value.card && await db.customers.where('card').equals(value.card).filter(customer => customer.id !== value.id).count()) throw new Error('This loyalty card already belongs to another customer.')
    const old = value.id ? await db.customers.get(value.id) : undefined
    if (value.id && !old) throw new Error('The customer no longer exists.')
    value.balance = old?.balance ?? 0
    if (value.id) await db.customers.put(value); else await db.customers.add(value)
    await logAction('customer', `Saved ${value.name}`)
  })
}
export async function saveSupplier(raw: Supplier) {
  const value = { ...(raw.id ? { id: raw.id } : {}), name: plain(raw.name, 100, 'supplier name', true), phone: plain(raw.phone, 50, 'phone'), email: plain(raw.email, 120, 'email'), notes: plain(raw.notes, 200, 'notes') }
  await db.transaction('rw', db.suppliers, db.settings, db.audit, db.employees, async () => { await requireOwner(); if (value.id) await db.suppliers.put(value); else await db.suppliers.add(value); await logAction('supplier', `Saved ${value.name}`) })
}
export async function createPurchase(supplierId: number, lines: PurchaseLine[], notes: string) {
  if (!lines.length || lines.length > 500 || new Set(lines.map(line => line.productId)).size !== lines.length) throw new Error('Choose 1 to 500 distinct purchase items.')
  notes = plain(notes, 200, 'purchase note')
  await db.transaction('rw', db.tables, async () => {
    await requireOwner()
    const supplier = await db.suppliers.get(supplierId)
    if (!supplier) throw new Error('Choose an existing supplier.')
    const normalized: PurchaseLine[] = []
    for (const line of lines) { const product = await db.products.get(line.productId); if (!product) throw new Error('A purchase product no longer exists.'); if (!count(line.quantity, 'Purchase quantity', product.unit === 'kg' ? 9_999_000 : 9999)) throw new Error('Purchase quantity must be greater than zero.'); normalized.push({ productId: product.id!, name: product.name, quantity: line.quantity, cost: cents(line.cost, 'Unit cost', 99_999_999), ...(product.unit ? { unit: product.unit } : {}) }) }
    const id = await db.purchases.add({ supplierId, supplierName: supplier.name, lines: normalized, notes, status: 'ordered', createdAt: new Date().toISOString() })
    await logAction('purchase', `Ordered purchase #${id} from ${supplier.name}`)
  })
}
export async function finishPurchase(id: number, receive: boolean) {
  await db.transaction('rw', db.tables, async () => {
    await requireOwner()
    const order = await db.purchases.get(id)
    if (!order || order.status !== 'ordered') throw new Error('This purchase has already been received or cancelled.')
    if (receive) for (const line of order.lines) {
      const product = await db.products.get(line.productId)
      if (!product) throw new Error(`${line.name} no longer exists. Cancel this purchase and create another.`)
      if (product.unit !== line.unit) throw new Error('A purchase product changed its selling unit. Cancel this purchase and create another.')
      const before = product.stock ?? 0, after = count(before + line.quantity, 'Stock')
      const value = validateProduct({ ...product, stock: after, cost: line.cost })
      await db.products.put(value)
      await stockLog(product, before, after, `Purchase #${id}`)
    }
    await db.purchases.update(id, { status: receive ? 'received' : 'cancelled', ...(receive ? { receivedAt: new Date().toISOString() } : {}) })
    await logAction('purchase', `${receive ? 'Received' : 'Cancelled'} purchase #${id}`)
  })
}
export async function applyStocktake(expected: { id: number; stock?: number; counted: number }[], reason: string) {
  if (!expected.length || expected.length > 20_000 || new Set(expected.map(item => item.id)).size !== expected.length) throw new Error('Choose distinct products to count.')
  reason = plain(reason, 200, 'stock count reason', true)
  await db.transaction('rw', db.tables, async () => {
    await requireOwner()
    for (const item of expected) {
      count(item.counted, 'Counted stock')
      const product = await db.products.get(item.id)
      if (!product || product.stock !== item.stock) throw new Error('Stock changed while you were counting. Review the latest stock and count again.')
      await db.products.update(item.id, { stock: item.counted })
      await stockLog(product, product.stock ?? 0, item.counted, `Stock count: ${reason}`)
    }
    await logAction('stock count', `Counted ${expected.length} products: ${reason}`)
  })
}
export async function editCartItem(id: number, discountRate: number, note: string) {
  rate(discountRate); note = plain(note, 200, 'item note')
  await db.transaction('rw', db.tables, async () => { if (discountRate) await requireOwner(); if (!await db.cart.get(id)) throw new Error('This cart item no longer exists.'); await db.cart.update(id, { discountRate, note }) })
}
export async function saveTicket(name: string, expected: CartItem[], notes: string, dining: Ticket['dining'], customerId?: number) {
  name = plain(name, 100, 'order name', true); notes = plain(notes, 200, 'order note')
  if (!['retail', 'dine-in', 'takeaway', 'delivery'].includes(dining)) throw new Error('Choose a valid dining option.')
  await db.transaction('rw', db.tables, async () => {
    const rows = await db.cart.toArray()
    if (!rows.length || JSON.stringify(expected) !== JSON.stringify(rows)) throw new Error('The cart changed. Review it before saving the order.')
    if (await db.tickets.count() >= 2000) throw new Error('The limit is 2,000 saved orders.')
    if (customerId && !await db.customers.get(customerId)) throw new Error('This customer no longer exists.')
    await db.tickets.add({ name, rows, notes, dining, ...(customerId ? { customerId } : {}), createdAt: new Date().toISOString() })
    await db.cart.clear(); await db.settings.delete('cartContext'); await logAction('order', `Saved ${name}`)
  })
}
export async function resumeTicket(id: number) {
  await db.transaction('rw', db.tables, async () => {
    if (await db.cart.count()) throw new Error('Save or clear the current cart before opening another order.')
    const ticket = await db.tickets.get(id)
    if (!ticket) throw new Error('This order was already opened in another window.')
    const quantities = new Map<number, number>()
    for (const row of ticket.rows) quantities.set(row.productId, (quantities.get(row.productId) ?? 0) + row.quantity * (row.weightGrams ?? 1))
    for (const [productId, quantity] of quantities) { const product = await db.products.get(productId); if (!product || (product.stock !== undefined && product.stock < quantity)) throw new Error('A saved item is unavailable or has insufficient stock. Update Products before opening this order.') }
    await db.cart.bulkAdd(ticket.rows.map(row => ({ ...row, id: undefined })))
    await db.settings.put({ key: 'cartContext', value: { notes: ticket.notes, dining: ticket.dining, ...(ticket.customerId ? { customerId: ticket.customerId } : {}) } })
    await db.tickets.delete(id); await logAction('order', `Opened ${ticket.name}`)
  })
}
export async function discardTicket(id: number) { await db.transaction('rw', db.tables, async () => { await requireOwner(); const ticket = await db.tickets.get(id); if (!ticket) throw new Error('This order no longer exists.'); await db.tickets.delete(id); await logAction('order', `Deleted ${ticket.name}`) }) }
export async function combineTickets(ids: number[]) {
  if (ids.length < 2 || ids.length > 50 || new Set(ids).size !== ids.length) throw new Error('Select 2 to 50 different orders.')
  await db.transaction('rw', db.tables, async () => {
    const tickets = await db.tickets.bulkGet(ids)
    if (tickets.some(ticket => !ticket)) throw new Error('A selected order changed. Refresh and select again.')
    const first = tickets[0]!, rows = tickets.flatMap(ticket => ticket!.rows)
    if (rows.length > 2000 || tickets.some(ticket => ticket!.customerId !== first.customerId || ticket!.dining !== first.dining)) throw new Error('Combined orders must use the same customer and order type, with at most 2,000 item rows.')
    const combined = { ...first, name: `Combined: ${tickets.map(ticket => ticket!.name).join(', ')}`.slice(0, 100), notes: tickets.map(ticket => ticket!.notes).filter(Boolean).join('; ').slice(0, 200), rows: rows.map((row, i) => ({ ...row, id: i + 1 })) }
    await db.tickets.put(combined); await db.tickets.bulkDelete(ids.slice(1)); await logAction('order', `Combined ${ids.length} saved orders`)
  })
}
export async function splitTicket(id: number, name: string, selection: { rowId: number; quantity: number }[]) {
  name = plain(name, 100, 'split order name', true)
  await db.transaction('rw', db.tables, async () => {
    const ticket = await db.tickets.get(id)
    if (!ticket) throw new Error('This order changed. Refresh and try again.')
    if (await db.tickets.count() >= 2000 || new Set(selection.map(line => line.rowId)).size !== selection.length || selection.some(line => !ticket.rows.some(row => row.id === line.rowId))) throw new Error('Invalid split selection or too many saved orders.')
    const split: CartItem[] = [], remaining: CartItem[] = []
    for (const row of ticket.rows) { const quantity = count(selection.find(line => line.rowId === row.id)?.quantity ?? 0, 'Split quantity', row.quantity); if (quantity) split.push({ ...row, quantity }); if (row.quantity > quantity) remaining.push({ ...row, quantity: row.quantity - quantity }) }
    if (!split.length || !remaining.length) throw new Error('Choose some items for the new order and keep some in the original order.')
    await db.tickets.add({ ...ticket, id: undefined, name, rows: split, createdAt: new Date().toISOString() }); await db.tickets.update(id, { rows: remaining }); await logAction('order', `Split ${ticket.name} into ${name}`)
  })
}
export function decodeWeightBarcode(code: string, prefix: string) {
  if (!prefix || !/^\d{13}$/.test(code) || !code.startsWith(prefix)) return undefined
  const sum = [...code.slice(0, 12)].reduce((sum, digit, i) => sum + Number(digit) * (i % 2 ? 3 : 1), 0)
  if ((10 - sum % 10) % 10 !== Number(code[12])) throw new Error('This weight label has an invalid EAN-13 check digit.')
  const weightGrams = Number(code.slice(7, 12))
  if (!weightGrams) throw new Error('This weight label has zero weight.')
  return { barcode: code.slice(2, 7), weightGrams }
}
export async function expectedCash(shiftId: number) {
  const shift = await db.shifts.get(shiftId)
  if (!shift) throw new Error('This shift no longer exists.')
  const sales = await db.sales.where('shiftId').equals(shiftId).toArray(), corrections = await db.corrections.filter(row => row.shiftId === shiftId).toArray(), movements = await db.cashMovements.where('shiftId').equals(shiftId).toArray()
  return shift.opening + sales.reduce((sum, sale) => sum + (sale.payments?.find(part => part.method === 'cash')?.amount ?? (sale.payment === 'cash' ? sale.total : 0)), 0) - corrections.reduce((sum, correction) => sum + (correction.cashAmount ?? 0), 0) + movements.reduce((sum, movement) => sum + (movement.direction === 'in' ? movement.amount : -movement.amount), 0)
}
export async function openShift(opening: number) {
  cents(opening, 'Opening cash')
  await db.transaction('rw', db.tables, async () => { await requireOwner(); if (await db.shifts.where('status').equals('open').count()) throw new Error('A cash shift is already open.'); const operator = (await getPreferences()).operator || 'Owner'; await db.shifts.add({ opening, operator, openedAt: new Date().toISOString(), status: 'open' }); await logAction('shift', 'Opened cash shift') })
}
export async function moveCash(direction: 'in' | 'out', amount: number, reason: string) {
  if (!['in', 'out'].includes(direction) || !cents(amount, 'Cash movement')) throw new Error('Choose a direction and a positive amount.'); reason = plain(reason, 200, 'cash movement reason', true)
  await db.transaction('rw', db.tables, async () => { await requireOwner(); const shift = await db.shifts.where('status').equals('open').first(); if (!shift) throw new Error('Open a cash shift first.'); if (direction === 'out' && amount > await expectedCash(shift.id!)) throw new Error('Cash out exceeds expected cash in the drawer.'); await db.cashMovements.add({ shiftId: shift.id!, direction, amount, reason, operator: (await getPreferences()).operator || 'Owner', createdAt: new Date().toISOString() }); await logAction('cash', `${direction}: ${amount / 100}; ${reason}`) })
}
export async function closeShift(id: number, counted: number) {
  cents(counted, 'Counted cash')
  await db.transaction('rw', db.tables, async () => { await requireOwner(); const shift = await db.shifts.get(id); if (shift?.status !== 'open') throw new Error('This shift was already closed.'); if (await db.cart.count()) throw new Error('Complete or save the current cart before closing the shift.'); const expected = await expectedCash(id); await db.shifts.update(id, { counted, expected, status: 'closed', closedAt: new Date().toISOString() }); await logAction('shift', `Closed shift #${id}; difference ${(counted - expected) / 100}`) })
}
export async function saveEmployee(name: string, role: Employee['role'], pin: string, id?: number, active = true) {
  name = plain(name, 100, 'employee name', true)
  if (!['cashier', 'manager'].includes(role)) throw new Error('Choose an employee role.')
  const credential = pin ? await createOwnerCredential(pin) : undefined
  await db.transaction('rw', db.tables, async () => { await requireOwner(); if (!await db.settings.get('owner')) throw new Error('Set an owner PIN in Settings before adding employees.'); const old = id ? await db.employees.get(id) : undefined; if (!credential && !old) throw new Error('Enter a 6–12 digit employee PIN.'); const employee: Employee = { ...(id ? { id } : {}), name, role, active, credential: credential ?? old!.credential }; if (id) await db.employees.put(employee); else await db.employees.add(employee); await logAction('employee', `Saved ${name}; ${role}; ${active ? 'active' : 'inactive'}`) })
}
export async function signInEmployee(id: number, pin: string) {
  const employee = await db.employees.get(id)
  if (!employee) throw new Error('Choose an employee.')
  await verifyStaffPin(employee, pin)
  await db.transaction('rw', db.tables, async () => { const fresh = await db.employees.get(id); if (!fresh?.active || fresh.credential.hash !== employee.credential.hash) throw new Error('Employee settings changed. Sign in again.'); await db.settings.put({ key: 'preferences', value: { ...await getPreferences(), operator: employee.name } }); await logAction('sign in', employee.name, employee.name) })
  acceptStaff(employee)
  lockOwner()
}
export function signOutEmployee() { signOutStaff(); lockOwner() }
export async function clockEmployee(id: number, pin: string) {
  const employee = await db.employees.get(id)
  if (!employee) throw new Error('Choose an employee.')
  await verifyStaffPin(employee, pin)
  await db.transaction('rw', db.tables, async () => { const fresh = await db.employees.get(id); if (!fresh?.active || fresh.credential.hash !== employee.credential.hash) throw new Error('Employee settings changed. Try again.'); const open = await db.timeEntries.where('employeeId').equals(id).filter(row => !row.endedAt).first(); if (open) await db.timeEntries.update(open.id!, { endedAt: new Date().toISOString() }); else await db.timeEntries.add({ employeeId: id, name: employee.name, startedAt: new Date().toISOString() }); await logAction('time clock', `${employee.name}: ${open ? 'out' : 'in'}`, employee.name) })
}
export async function activeEmployee() { const session = staffSession(); if (!session) return undefined; const employee = await db.employees.get(session.id); if (!employee?.active || employee.credential.hash !== session.hash) { signOutStaff(); return undefined }; return employee }
