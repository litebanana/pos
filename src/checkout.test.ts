import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addToCart, adjustStock, archiveReport, changeCartQuantity, checkout, correctSale, currentSession, db, exportDatabase, getReport, initialize, removeCartItem, reportTotals, resetDatabase, restoreDatabase, saveProduct, setOwnerCredential, setPreferences, undoCartRemoval } from './db'
import { createOwnerCredential, lockOwner, unlockOwner, type OwnerCredential } from './owner'
import { decodeBackup, encodeBackup, serializeBackup } from './backup-format'
import { catalogCSV, importCatalog, parseCatalog } from './catalog'
import { validateBackup } from './validation'

const code = '4800016000013'
beforeEach(async () => { await resetDatabase(); await db.settings.clear(); await initialize() })
afterEach(async () => {
  vi.useRealTimers()
  const credential = (await db.settings.get('owner'))?.value as OwnerCredential | undefined
  if (credential) { await unlockOwner('123456', credential); await setOwnerCredential() }
  lockOwner()
})
const pay = async () => checkout(await db.cart.toArray(), 'cash', 10000, 'Maria')

describe('checkout, stock, and recovery', () => {
  it('keeps a saved cart outside sales totals and commits payment, items, stock, and receipt atomically', async () => {
    const product = (await db.products.where('barcode').equals(code).first())!
    await saveProduct({ ...product, stock: 3, lowStock: 1 })
    await Promise.all([addToCart(code), addToCart(code)])
    expect(await db.scans.count()).toBe(0)
    expect((await db.products.get(product.id!))!.stock).toBe(3)
    const sale = await pay()
    expect(sale).toMatchObject({ total: 5000, tendered: 10000, change: 5000, operator: 'Maria', status: 'completed' })
    expect(await db.cart.count()).toBe(0)
    expect((await db.products.get(product.id!))!.stock).toBe(1)
    expect((await db.scans.toArray())[0]).toMatchObject({ saleId: sale.id, quantity: 2, price: 2500 })
  })
  it('rejects stale and duplicate checkout without double charging or reducing stock twice', async () => {
    await addToCart(code)
    const snapshot = await db.cart.toArray()
    const outcomes = await Promise.allSettled([checkout(snapshot, 'cash', 2500, 'A'), checkout(snapshot, 'cash', 2500, 'B')])
    expect(outcomes.filter(outcome => outcome.status === 'fulfilled')).toHaveLength(1)
    expect(await db.sales.count()).toBe(1)
    await addToCart(code)
    const stale = await db.cart.toArray()
    await addToCart(code)
    await expect(checkout(stale, 'cash', 10000, 'A')).rejects.toThrow('cart changed')
    expect(await db.cart.count()).toBe(1)
  })
  it('rolls back checkout when stock changes in another window or payment is invalid', async () => {
    const product = (await db.products.where('barcode').equals(code).first())!
    const other = (await db.products.where('barcode').equals('4800016000020').first())!
    await saveProduct({ ...product, stock: 1 })
    await saveProduct({ ...other, stock: 1 })
    await addToCart(code)
    await addToCart(other.barcode)
    await adjustStock(other.id!, 0, 'Stock count correction')
    await expect(pay()).rejects.toThrow('insufficient stock')
    expect(await db.sales.count()).toBe(0)
    expect(await db.cart.count()).toBe(2)
    // The first product was already reduced inside the transaction before the second failed.
    expect((await db.products.get(product.id!))!.stock).toBe(1)
    await adjustStock(other.id!, 1, 'Found one item')
    await expect(checkout(await db.cart.toArray(), 'cash', 4299, 'A')).rejects.toThrow('cover the total')
    await expect(checkout(await db.cart.toArray(), 'gcash', 4500, 'A')).rejects.toThrow('equal the total')
  })
  it('adds quantity deltas atomically and restores a removed item without overwriting a newer row', async () => {
    await addToCart(code)
    const row = (await db.cart.toArray())[0]
    await Promise.all([changeCartQuantity(row.id!, 1, true), changeCartQuantity(row.id!, 1, true)])
    expect((await db.cart.get(row.id!))!.quantity).toBe(3)
    const removed = await removeCartItem(row.id!)
    await addToCart(code)
    await undoCartRemoval(removed)
    expect((await db.cart.toArray())[0].quantity).toBe(4)
  })
  it('records a void once, returns stock, and retains the original sale and item prices', async () => {
    const product = (await db.products.where('barcode').equals(code).first())!
    await saveProduct({ ...product, stock: 1 })
    await addToCart(code)
    const sale = await pay()
    await correctSale(sale.id!, 'void', 'Accidental sale', true)
    await expect(correctSale(sale.id!, 'refund', 'Again', true)).rejects.toThrow('already been corrected')
    expect((await db.products.get(product.id!))!.stock).toBe(1)
    expect((await db.scans.toArray())[0].price).toBe(2500)
    expect(reportTotals(await getReport(sale.sessionId)).value).toBe(0)
    expect(await db.corrections.count()).toBe(1)
  })
  it('records an older refund on the current day without changing a closed report', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-27T08:00:00Z'))
    await setPreferences({ storeName: 'Maria’s store' })
    await addToCart(code)
    const sale = await pay(), original = await getReport(sale.sessionId)
    await archiveReport(original)
    vi.setSystemTime(new Date('2026-09-28T08:00:00Z'))
    await expect(correctSale(sale.id!, 'void', 'Old sale', true)).rejects.toThrow('older sale')
    await correctSale(sale.id!, 'refund', 'Returned damaged item', false)
    expect(reportTotals(await getReport(sale.sessionId)).value).toBe(2500)
    const current = await currentSession()
    expect(reportTotals(await getReport(current!.id!)).value).toBe(-2500)
    await archiveReport(await getReport(current!.id!))
  })
  it('protects administration at the database layer while allowing cashier checkout', async () => {
    const credential = await createOwnerCredential('123456')
    await setOwnerCredential(credential)
    const product = (await db.products.toArray())[0]
    await expect(saveProduct({ ...product, price: 1 })).rejects.toThrow('Unlock owner')
    await expect(resetDatabase()).rejects.toThrow('Unlock owner')
    await expect(restoreDatabase(await exportDatabase())).rejects.toThrow('Unlock owner')
    await expect(unlockOwner('654321', credential)).rejects.toThrow('Incorrect')
    await addToCart(code); const sale = await pay()
    await expect(correctSale(sale.id!, 'void', 'Mistake', true)).rejects.toThrow('Unlock owner')
    await unlockOwner('123456', credential)
    await correctSale(sale.id!, 'void', 'Mistake', true)
    expect((await db.sales.get(sale.id!))!.status).toBe('voided')
  })
  it('round trips carts, receipts, corrections, stock, and activity; rejects inconsistent imports', async () => {
    await addToCart(code); const sale = await pay()
    await correctSale(sale.id!, 'refund', 'Returned', true)
    await addToCart(code)
    const backup = await exportDatabase()
    const bad = structuredClone(backup); bad.sales[0].total = 1
    await expect(restoreDatabase(bad)).rejects.toThrow('totals')
    expect(await db.sales.count()).toBe(1)
    await resetDatabase(); await restoreDatabase(backup)
    const restored = await exportDatabase()
    for (const table of ['cart', 'sales', 'corrections', 'audit'] as const) expect(restored[table]).toEqual(backup[table])
  })
  it('encrypts backups with authenticated encryption and rejects wrong passwords and modified ciphertext', async () => {
    await addToCart(code); await pay()
    const contents = await encodeBackup(await exportDatabase(), 'long backup password')
    expect(contents).not.toContain('Coca-Cola')
    expect((await decodeBackup(contents, 'long backup password')).sales).toHaveLength(1)
    await expect(decodeBackup(contents, 'wrong password')).rejects.toThrow('incorrect')
    const broken = JSON.parse(contents); broken.data = (broken.data[0] === 'A' ? 'B' : 'A') + broken.data.slice(1)
    await expect(decodeBackup(JSON.stringify(broken), 'long backup password')).rejects.toThrow('damaged')
    expect(await db.sales.count()).toBe(1)
  })
  it('refuses an export that fails the restore contract, and accepts schema-1 backups', async () => {
    const backup = await exportDatabase()
    const bad = { ...backup, products: [...backup.products, backup.products[0]] }
    expect(() => serializeBackup(bad)).toThrow('duplicate')
    const legacy = { ...backup, schemaVersion: 1, cart: undefined, sales: undefined, corrections: undefined, audit: undefined }
    expect(validateBackup(legacy).sales).toEqual([])
    await restoreDatabase(legacy)
    expect(await db.products.count()).toBe(8)
  })
  it('upgrades an actual version-1 database without deleting catalog or report rows', async () => {
    const backup = await exportDatabase()
    db.close(); await Dexie.delete(db.name)
    const legacy = new Dexie(db.name)
    legacy.version(1).stores({ products: '++id, &barcode, name, category', sessions: '++id, date, status, [date+status]', scans: '++id, sessionId, [sessionId+barcode]', settings: '&key' })
    await legacy.table('products').bulkAdd(backup.products)
    await legacy.table('settings').bulkPut(backup.settings)
    legacy.close(); await db.open()
    expect(await db.products.count()).toBe(8)
    expect(await db.cart.count()).toBe(0)
    await addToCart(code); await pay()
    expect(await db.sales.count()).toBe(1)
  })
  it('validates CSV, preserves quoted names and formula-like strings, and applies imports atomically', async () => {
    const products = [{ barcode: '+123', name: '=Tea, "large"', price: 1250, category: 'Other', color: 'sand', stock: 5, lowStock: 2 }]
    expect(parseCatalog(catalogCSV(products))).toEqual(products)
    await importCatalog(products)
    expect(await db.products.where('barcode').equals('+123').count()).toBe(1)
    expect(() => parseCatalog('barcode,name,price,category,stock,low_stock\nA,Tea,12,Other,1,1\nA,Tea,12,Other,1,1')).toThrow('Duplicate')
    const invalid = [{ ...products[0], price: -1 }]
    await expect(importCatalog(invalid)).rejects.toThrow()
    expect((await db.products.where('barcode').equals('+123').first())!.price).toBe(1250)
  })
})
