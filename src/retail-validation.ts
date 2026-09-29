import { count, cents, plain, rate } from './pricing'
import type { RetailSettings, Customer, Supplier, PurchaseOrder, StockMovement, Ticket, Shift, CashMovement, Employee, TimeEntry } from './retail-types'
import type { CartItem } from './db'
import type { OwnerCredential } from './owner'

export function object(raw: unknown): Record<string, unknown> { if (!raw || typeof raw !== 'object' || Array.isArray(raw) || ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) throw new Error('Invalid store record.'); return raw as Record<string, unknown> }
export function key(raw: unknown): number { if (!Number.isSafeInteger(raw) || Number(raw) < 1 || Number(raw) > Number.MAX_SAFE_INTEGER - 1_000_000) throw new Error('Invalid record reference.'); return Number(raw) }
export function stamp(raw: unknown): string { if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw) || !Number.isFinite(Date.parse(raw)) || new Date(raw).toISOString() !== raw) throw new Error('Invalid record timestamp.'); return raw }
export function enumValue<T extends string>(raw: unknown, choices: readonly T[]): T { if (!choices.includes(raw as T)) throw new Error('Invalid record choice.'); return raw as T }
export function validateRetailSettings(raw: unknown): RetailSettings {
  const value = object(raw), discountType = enumValue(value.discountType, ['amount', 'percent'] as const)
  if (typeof value.dark !== 'boolean') throw new Error('Invalid display setting.')
  const weightPrefix = plain(value.weightPrefix ?? '', 2, 'weight barcode prefix')
  if (weightPrefix && !/^2\d$/.test(weightPrefix)) throw new Error('Weight barcode prefix must be 20–29 or empty.')
  const gcashName = plain(value.gcashName ?? '', 100, 'GCash account name')
  const gcashNumber = plain(value.gcashNumber ?? '', 20, 'GCash account number')
  if (gcashNumber && !/^[0-9+][0-9 \-+]{3,19}$/.test(gcashNumber)) throw new Error('Enter a valid GCash number (digits, spaces, + or -).')
  if (!!gcashName !== !!gcashNumber) throw new Error('Enter both the GCash account name and number, or leave both empty.')
  return { discountType, discountValue: discountType === 'percent' ? rate(value.discountValue) : cents(value.discountValue), taxMode: enumValue(value.taxMode, ['none', 'included', 'added'] as const), taxRate: rate(value.taxRate, 'Tax rate'), loyaltyRate: rate(value.loyaltyRate, 'Loyalty rate'), dark: value.dark, weightPrefix, gcashName, gcashNumber }
}
export function validateContext(raw: unknown) {
  const value = object(raw)
  return { notes: plain(value.notes ?? '', 200, 'order note'), dining: enumValue(value.dining ?? 'retail', ['retail', 'dine-in', 'takeaway', 'delivery'] as const), ...(value.customerId !== undefined ? { customerId: key(value.customerId) } : {}) }
}
export interface RetailRecords { customers: Customer[]; suppliers: Supplier[]; purchases: PurchaseOrder[]; stockMovements: StockMovement[]; tickets: Ticket[]; shifts: Shift[]; cashMovements: CashMovement[]; employees: Employee[]; timeEntries: TimeEntry[] }
export function validateRetailRecords(data: Record<string, unknown>, schema: unknown, validateCart: (raw: unknown) => CartItem, validateCredential: (raw: unknown) => OwnerCredential): RetailRecords {
  function rows<T>(name: string, limit: number, map: (raw: Record<string, unknown>) => T): T[] {
    const raw = schema === 3 ? data[name] : []
    if (!Array.isArray(raw) || raw.length > limit) throw new Error(`Invalid or too many ${name} records.`)
    const seen = new Set<number>()
    return raw.map(item => { const record = object(item), id = key(record.id); if (seen.has(id)) throw new Error(`Duplicate ${name} IDs.`); seen.add(id); return map(record) })
  }
  const customers = rows<Customer>('customers', 20_000, v => {
    if (!Number.isSafeInteger(v.balance) || Math.abs(Number(v.balance)) > 99_999_999_999) throw new Error('Invalid loyalty balance.')
    return { id: key(v.id), name: plain(v.name, 100, 'customer name', true), phone: plain(v.phone, 50, 'phone'), email: plain(v.email, 120, 'email'), address: plain(v.address, 200, 'address'), notes: plain(v.notes, 200, 'notes'), card: plain(v.card, 100, 'card'), balance: Number(v.balance) }
  })
  const cards = customers.filter(v => v.card).map(v => v.card)
  if (new Set(cards).size !== cards.length) throw new Error('Duplicate loyalty cards.')
  const suppliers = rows<Supplier>('suppliers', 20_000, v => ({ id: key(v.id), name: plain(v.name, 100, 'supplier name', true), phone: plain(v.phone, 50, 'phone'), email: plain(v.email, 120, 'email'), notes: plain(v.notes, 200, 'notes') }))
  const purchases = rows<PurchaseOrder>('purchases', 20_000, v => {
    if (!Array.isArray(v.lines) || !v.lines.length || v.lines.length > 500) throw new Error('Invalid purchase items.')
    const lines = v.lines.map(raw => { const line = object(raw), unit = line.unit === undefined ? undefined : enumValue(line.unit, ['kg'] as const), quantity = count(line.quantity, 'Purchase quantity', unit ? 9_999_000 : 9999); if (!quantity) throw new Error('Invalid purchase quantity.'); return { productId: key(line.productId), name: plain(line.name, 120, 'purchase item', true), quantity, cost: cents(line.cost, 'Unit cost', 99_999_999), ...(unit ? { unit } : {}) } })
    if (new Set(lines.map(line => line.productId)).size !== lines.length) throw new Error('Duplicate purchase items.')
    const status = enumValue(v.status, ['ordered', 'received', 'cancelled'] as const), createdAt = stamp(v.createdAt)
    if (!suppliers.some(supplier => supplier.id === v.supplierId)) throw new Error('Missing purchase supplier.')
    const receivedAt = v.receivedAt === undefined ? undefined : stamp(v.receivedAt)
    if ((status === 'received') !== !!receivedAt || (receivedAt && receivedAt < createdAt)) throw new Error('Invalid purchase receipt date.')
    return { id: key(v.id), supplierId: key(v.supplierId), supplierName: plain(v.supplierName, 100, 'supplier name', true), status, lines, notes: plain(v.notes, 200, 'purchase note'), createdAt, ...(receivedAt ? { receivedAt } : {}) }
  })
  const stockMovements = rows<StockMovement>('stockMovements', 200_000, v => ({ id: key(v.id), productId: key(v.productId), name: plain(v.name, 120, 'product name', true), before: count(v.before, 'Stock'), after: count(v.after, 'Stock'), reason: plain(v.reason, 200, 'stock reason', true), operator: plain(v.operator, 100, 'operator', true), createdAt: stamp(v.createdAt), ...(v.unit !== undefined ? { unit: enumValue(v.unit, ['kg'] as const) } : {}) }))
  const tickets = rows<Ticket>('tickets', 2000, v => {
    if (!Array.isArray(v.rows) || !v.rows.length || v.rows.length > 2000) throw new Error('Invalid saved order items.')
    const rows = v.rows.map(validateCart)
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate saved order items.')
    return { id: key(v.id), name: plain(v.name, 100, 'order name', true), rows, ...validateContext(v), createdAt: stamp(v.createdAt) }
  })
  const shifts = rows<Shift>('shifts', 20_000, v => {
    const status = enumValue(v.status, ['open', 'closed'] as const), openedAt = stamp(v.openedAt)
    if (status === 'open' && (v.closedAt !== undefined || v.counted !== undefined || v.expected !== undefined)) throw new Error('An open shift cannot have closing totals.')
    if (status === 'closed' && (!Number.isSafeInteger(v.expected) || Math.abs(Number(v.expected)) > 99_999_999_999 || stamp(v.closedAt) < openedAt)) throw new Error('Invalid closed shift.')
    return { id: key(v.id), status, opening: cents(v.opening), operator: plain(v.operator, 100, 'operator', true), openedAt, ...(status === 'closed' ? { closedAt: stamp(v.closedAt), counted: cents(v.counted), expected: Number(v.expected) } : {}) }
  })
  if (shifts.filter(v => v.status === 'open').length > 1) throw new Error('Only one cash shift can be open.')
  const cashMovements = rows<CashMovement>('cashMovements', 200_000, v => {
    const shift = shifts.find(shift => shift.id === v.shiftId), createdAt = stamp(v.createdAt), amount = cents(v.amount)
    if (!amount || !shift || createdAt < shift.openedAt || (shift.closedAt && createdAt > shift.closedAt)) throw new Error('Invalid cash movement reference or time.')
    return { id: key(v.id), shiftId: key(v.shiftId), direction: enumValue(v.direction, ['in', 'out'] as const), amount, reason: plain(v.reason, 200, 'cash reason', true), operator: plain(v.operator, 100, 'operator', true), createdAt }
  })
  const employees = rows<Employee>('employees', 1000, v => { if (typeof v.active !== 'boolean') throw new Error('Invalid employee status.'); return { id: key(v.id), name: plain(v.name, 100, 'employee name', true), role: enumValue(v.role, ['cashier', 'manager'] as const), active: v.active, credential: validateCredential(v.credential) } })
  const timeEntries = rows<TimeEntry>('timeEntries', 200_000, v => { const startedAt = stamp(v.startedAt), endedAt = v.endedAt === undefined ? undefined : stamp(v.endedAt); if (!employees.some(employee => employee.id === v.employeeId) || (endedAt && endedAt < startedAt)) throw new Error('Invalid time clock record.'); return { id: key(v.id), employeeId: key(v.employeeId), name: plain(v.name, 100, 'employee name', true), startedAt, ...(endedAt ? { endedAt } : {}) } })
  if (new Set(timeEntries.filter(v => !v.endedAt).map(v => v.employeeId)).size !== timeEntries.filter(v => !v.endedAt).length) throw new Error('Duplicate open time clock entries.')
  return { customers, suppliers, purchases, stockMovements, tickets, shifts, cashMovements, employees, timeEntries }
}
