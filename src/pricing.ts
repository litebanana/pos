import type { CartItem, Product, Scan } from './db'
import type { CheckoutOptions } from './retail-types'
import type { PurchaseLine } from './retail-types'
export const stockFactor = (product: Pick<Product, 'unit'>) => product.unit === 'kg' ? 1000 : 1
export const stockText = (product: Pick<Product, 'unit' | 'stock'>) => product.stock === undefined ? 'Not tracked' : `${product.stock / stockFactor(product)}${product.unit === 'kg' ? ' kg' : ''}`
export const lowStockAt = (product: Product) => product.lowStock ?? 5 * stockFactor(product)
export const purchaseAmount = (line: PurchaseLine) => Math.round(line.cost * line.quantity / stockFactor(line))

export function cents(value: unknown, label = 'Amount', limit = 99_999_999_999): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > limit) throw new Error(`${label} must be a valid non-negative amount.`)
  return Number(value)
}
export function rate(value: unknown, label = 'Percentage'): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > 10_000) throw new Error(`${label} must be between 0 and 100%.`)
  return Number(value)
}
export function proportion(amount: number, numerator: number, denominator: number) {
  cents(amount); cents(numerator); cents(denominator)
  if (!denominator) return 0
  return Number(BigInt(amount) * BigInt(numerator) / BigInt(denominator))
}
export function plain(value: unknown, max: number, label: string, required = false): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u.test(value) || (required && !value.trim())) throw new Error(`Enter a valid ${label} (up to ${max} characters).`)
  return value.trim()
}
export function count(value: unknown, label = 'Quantity', maximum = 1_000_000_000): number {
  if (!Number.isInteger(value) || Number(value) < 0 || Number(value) > maximum) throw new Error(`${label} must be a whole number from 0 to ${maximum.toLocaleString()}.`)
  return Number(value)
}
export function allocate(amount: number, weights: number[]): number[] {
  cents(amount)
  const sum = weights.reduce((a, b) => a + cents(b), 0)
  if (!Number.isSafeInteger(sum)) throw new Error('The total exceeds the safe numeric limit.')
  if (!sum) { if (amount) throw new Error('Cannot allocate an amount to an empty total.'); return weights.map(() => 0) }
  const divisor = BigInt(sum), value = BigInt(amount)
  const parts = weights.map((weight, index) => ({ index, value: Number(value * BigInt(weight) / divisor), remainder: value * BigInt(weight) % divisor }))
  let remaining = amount - parts.reduce((a, b) => a + b.value, 0)
  for (const part of [...parts].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) if (remaining-- > 0) part.value++
  return parts.map(part => part.value)
}
export function cartPricing(rows: CartItem[], options: CheckoutOptions = {}) {
  const gross = rows.map(row => {
    if (!Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 9999) throw new Error('Invalid cart quantity.')
    return cents(row.price * row.quantity)
  })
  const itemDiscounts = rows.map((row, i) => Math.round(gross[i] * rate(row.discountRate ?? 0) / 10_000))
  const base = gross.map((value, i) => value - itemDiscounts[i])
  const subtotal = gross.reduce((a, b) => a + b, 0), baseTotal = base.reduce((a, b) => a + b, 0)
  cents(subtotal)
  const type = options.discountType ?? 'amount', value = options.discountValue ?? 0
  if (!['amount', 'percent'].includes(type)) throw new Error('Choose a discount type.')
  const receiptDiscount = type === 'percent' ? Math.round(baseTotal * rate(value) / 10_000) : cents(value, 'Discount')
  const redeemed = cents(options.redeem ?? 0, 'Loyalty redemption')
  if (receiptDiscount + redeemed > baseTotal) throw new Error('Discounts and redeemed points cannot exceed the subtotal.')
  const discounts = allocate(receiptDiscount + redeemed, base)
  const net = base.map((value, i) => value - discounts[i])
  const taxMode = options.taxMode ?? 'none', taxRate = rate(options.taxRate ?? 0, 'Tax rate')
  if (!['none', 'included', 'added'].includes(taxMode)) throw new Error('Choose a tax mode.')
  const netTotal = net.reduce((a, b) => a + b, 0)
  const tax = taxMode === 'none' ? 0 : Math.round(netTotal * taxRate / (taxMode === 'included' ? 10_000 + taxRate : 10_000))
  const taxes = allocate(tax, net)
  const lineTotals = net.map((value, i) => value + (taxMode === 'added' ? taxes[i] : 0))
  return { subtotal, discount: itemDiscounts.reduce((a, b) => a + b, 0) + receiptDiscount, redeemed, tax, taxMode, taxRate, lineTotals, total: cents(lineTotals.reduce((a, b) => a + b, 0)), cost: rows.reduce((a, row) => a + (row.cost ?? 0) * row.quantity, 0) }
}
export const lineAmount = (row: Pick<Scan, 'price' | 'quantity' | 'lineTotal'>) => row.lineTotal ?? row.price * row.quantity
