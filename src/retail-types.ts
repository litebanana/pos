import type { CartItem, Payment } from './db'
import type { OwnerCredential } from './owner'

export interface Modifier { name: string; price: number }
export interface Customer { id?: number; name: string; phone: string; email: string; address: string; notes: string; card: string; balance: number }
export interface Supplier { id?: number; name: string; phone: string; email: string; notes: string }
export interface PurchaseLine { productId: number; name: string; quantity: number; cost: number; unit?: 'kg' }
export interface PurchaseOrder { id?: number; supplierId: number; supplierName: string; status: 'ordered' | 'received' | 'cancelled'; lines: PurchaseLine[]; notes: string; createdAt: string; receivedAt?: string }
export interface StockMovement { id?: number; productId: number; name: string; before: number; after: number; reason: string; createdAt: string; operator: string; unit?: 'kg' }
export interface Ticket { id?: number; name: string; rows: CartItem[]; notes: string; dining: 'retail' | 'dine-in' | 'takeaway' | 'delivery'; customerId?: number; createdAt: string }
export interface Shift { id?: number; operator: string; opening: number; openedAt: string; status: 'open' | 'closed'; closedAt?: string; counted?: number; expected?: number }
export interface CashMovement { id?: number; shiftId: number; direction: 'in' | 'out'; amount: number; reason: string; operator: string; createdAt: string }
export interface Employee { id?: number; name: string; role: 'cashier' | 'manager'; active: boolean; credential: OwnerCredential }
export interface TimeEntry { id?: number; employeeId: number; name: string; startedAt: string; endedAt?: string }
export interface PaymentPart { method: Payment; amount: number; ref?: string }
export interface RetailSettings { discountType: 'amount' | 'percent'; discountValue: number; taxRate: number; taxMode: 'none' | 'included' | 'added'; loyaltyRate: number; dark: boolean; weightPrefix?: string; gcashName: string; gcashNumber: string }
export const retailDefaults: RetailSettings = { discountType: 'amount', discountValue: 0, taxRate: 0, taxMode: 'none', loyaltyRate: 0, dark: false, weightPrefix: '', gcashName: '', gcashNumber: '' }
export interface CheckoutOptions { discountType?: 'amount' | 'percent'; discountValue?: number; taxRate?: number; taxMode?: 'none' | 'included' | 'added'; customerId?: number; redeem?: number; notes?: string; dining?: Ticket['dining']; payments?: PaymentPart[] }
export const retailTables = ['customers', 'suppliers', 'purchases', 'stockMovements', 'tickets', 'shifts', 'cashMovements', 'employees', 'timeEntries'] as const
