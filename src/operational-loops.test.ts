import 'fake-indexeddb/auto'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { addToCart, archiveReport, checkout, db, exportDatabase, getReport, initialize, resetDatabase, restoreDatabase, saveProduct, setOwnerCredential } from './db'
import { closeShift, createPurchase, finishPurchase, openShift, reviewShiftVariance, saveSupplier, suggestPurchase } from './retail'
import { needsCashReview } from './retail-types'
import { createOwnerCredential, lockOwner, unlockOwner } from './owner'
import { backupSizePressure, backupSizeWarnBytes, estimateStorage, storageUnderPressure } from './storage'
import { validateBackup } from './validation'

const barcode = '4800016000013'
beforeEach(async () => { await db.settings.delete('owner'); lockOwner(); await resetDatabase(); await db.settings.clear(); await initialize() })
afterEach(() => { vi.unstubAllGlobals(); lockOwner() })
async function sale() { await addToCart(barcode); return checkout(await db.cart.toArray(), 'cash', 2500, 'Owner') }

it('suggests low tracked stock including threshold equality and weighted products, then receives it once', async () => {
  const product = (await db.products.where('barcode').equals(barcode).first())!
  await saveProduct({ ...product, stock: 5, cost: 1000 })
  await saveProduct({ ...product, id: undefined, barcode: 'RICE', name: 'Rice', unit: 'kg', stock: 500, lowStock: 1000, cost: 5000 })
  const products = await db.products.toArray(), lines = suggestPurchase(products)
  expect(lines).toHaveLength(2)
  expect(lines.find(line => line.productId === product.id)).toMatchObject({ quantity: 5, cost: 1000 })
  expect(lines.find(line => line.unit === 'kg')).toMatchObject({ quantity: 1500, cost: 5000 })
  expect(suggestPurchase([{ ...product, stock: 0, lowStock: 0 }])[0].quantity).toBe(1)
  expect(suggestPurchase([{ ...product, stock: 6 }])).toEqual([])
  await saveSupplier({ name: 'Wholesaler', phone: '', email: '', notes: '' })
  await createPurchase((await db.suppliers.toArray())[0].id!, lines, 'Replenishment')
  const order = (await db.purchases.toArray())[0]
  expect(order.status).toBe('ordered')
  expect((await db.products.get(product.id!))!.stock).toBe(5)
  await finishPurchase(order.id!, true)
  expect(suggestPurchase(await db.products.toArray())).toEqual([])
  expect((await db.purchases.get(order.id!))!.status).toBe('received')
  await expect(finishPurchase(order.id!, true)).rejects.toThrow('already')
  expect((await db.products.get(product.id!))!.stock).toBe(10)
})

it.each([-100, 100])('blocks archiving until cash difference %i is reviewed and preserves the review in backups', async difference => {
  await openShift(1000)
  const receipt = await sale(), report = await getReport(receipt.sessionId), shift = (await db.shifts.toArray())[0]
  await expect(archiveReport(report)).rejects.toThrow('Count and close')
  await closeShift(shift.id!, 3500 + difference)
  await expect(archiveReport(report)).rejects.toThrow('Review cash differences')
  expect((await db.sessions.get(report.session.id!))!.status).toBe('open')
  await expect(reviewShiftVariance(shift.id!, ' ')).rejects.toThrow()
  const credential = await createOwnerCredential('123456')
  await setOwnerCredential(credential)
  await expect(reviewShiftVariance(shift.id!, 'Count verified')).rejects.toThrow('Unlock owner')
  await unlockOwner('123456', credential)
  await reviewShiftVariance(shift.id!, 'Count verified; discrepancy recorded')
  expect(needsCashReview((await db.shifts.get(shift.id!))!)).toBe(false)
  await expect(reviewShiftVariance(shift.id!, 'Again')).rejects.toThrow('no cash difference')
  const backup = validateBackup(await exportDatabase())
  expect(backup.shifts[0].reviewNote).toBe('Count verified; discrepancy recorded')
  await restoreDatabase(backup)
  expect(needsCashReview((await db.shifts.get(shift.id!))!)).toBe(false)
  expect(await db.audit.filter(row => row.action === 'shift review').count()).toBe(1)
  await archiveReport(await getReport(receipt.sessionId))
  expect((await db.sessions.get(report.session.id!))!.status).toBe('closed')
})

it('allows balanced shifts to archive without variance review', async () => {
  await openShift(0)
  const receipt = await sale(), shift = (await db.shifts.toArray())[0]
  await closeShift(shift.id!, 2500)
  await archiveReport(await getReport(receipt.sessionId))
})

it('rejects invalid or incomplete cash review metadata on restore', async () => {
  await openShift(0)
  const shift = (await db.shifts.toArray())[0]
  await closeShift(shift.id!, 100)
  const backup = await exportDatabase()
  backup.shifts[0].reviewedAt = new Date().toISOString()
  expect(() => validateBackup(backup)).toThrow()
  backup.shifts[0].reviewNote = 'Verified'
  backup.shifts[0].reviewedAt = '2000-01-01T00:00:00.000Z'
  expect(() => validateBackup(backup)).toThrow('Invalid cash variance review')
})

it('checks current storage before checkout and leaves all sale data untouched when blocked', async () => {
  const estimate = vi.fn().mockResolvedValue({ usage: 81, quota: 100 })
  vi.stubGlobal('navigator', { storage: { estimate } })
  const product = (await db.products.where('barcode').equals(barcode).first())!
  await saveProduct({ ...product, stock: 10 }); await addToCart(barcode)
  const cart = await db.cart.toArray()
  await expect(checkout(cart, 'cash', 2500, 'Owner')).rejects.toThrow('Export a full backup')
  expect(await db.cart.toArray()).toEqual(cart)
  expect(await db.sales.count()).toBe(0)
  expect(await db.scans.count()).toBe(0)
  expect((await db.products.get(product.id!))!.stock).toBe(10)
  estimate.mockResolvedValue({ usage: 80, quota: 100 })
  await checkout(cart, 'cash', 2500, 'Owner')
  expect(await db.sales.count()).toBe(1)
})

it('handles unavailable, rejected, and invalid storage estimates without blocking checkout', async () => {
  expect(storageUnderPressure({ usage: 80, quota: 100 })).toBe(false)
  for (const estimate of [undefined, {}, { usage: 100, quota: 0 }, { usage: NaN, quota: 100 }]) expect(storageUnderPressure(estimate)).toBe(false)
  vi.stubGlobal('navigator', {})
  expect(await estimateStorage()).toBeUndefined()
  vi.stubGlobal('navigator', { storage: { estimate: vi.fn().mockRejectedValue(new Error('Unavailable')) } })
  await sale()
  expect(await db.sales.count()).toBe(1)
})

it('warns at 80% of the backup restore cap so exports never fail without notice', async () => {
  expect(backupSizeWarnBytes).toBe(20 * 1024 * 1024)
  expect(backupSizePressure(0)).toBe(false)
  expect(backupSizePressure(backupSizeWarnBytes)).toBe(false)
  expect(backupSizePressure(backupSizeWarnBytes + 1)).toBe(true)
  expect(backupSizePressure(25 * 1024 * 1024)).toBe(true)
  expect(backupSizePressure(NaN)).toBe(false)
})
