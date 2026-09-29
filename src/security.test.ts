import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { currentSession, db, exportDatabase, getReport, initialize, recordScan, resetDatabase, restoreDatabase, saveProduct, summarizeHistory, totals, type Scan, type Session } from './db'
import { backupLimits, safeColor, validateBackup } from './validation'
import { contentSecurityPolicy, nginxSecurityHeaders, offlineContentSecurityPolicy, staticHostHeaders } from '../security/headers'

beforeEach(async () => { await resetDatabase(); await db.settings.clear(); await initialize(); await recordScan('4800016000013') })
type Backup = Awaited<ReturnType<typeof exportDatabase>>

describe('untrusted backup validation', () => {
  const attacks: [string, (backup: Backup) => void][] = [
    ['display class injection', backup => { backup.products[0].color = 'modal-backdrop' }],
    ['scan display class injection', backup => { backup.scans[0].color = 'toast error' }],
    ['unknown categories', backup => { backup.products[0].category = 'constructor' }],
    ['impossible calendar dates', backup => { backup.sessions[0].date = '2026-02-31' }],
    ['invalid creation timestamps', backup => { backup.sessions[0].createdAt = 'not-a-timestamp' }],
    ['invalid time components', backup => { backup.sessions[0].createdAt = '2026-09-27T25:00:00.000Z' }],
    ['invalid export timestamps', backup => { backup.exportedAt = '2026-02-31T00:00:00.000Z' }],
    ['missing archived close timestamps', backup => { backup.sessions[0].status = 'closed' }],
    ['closing timestamps on open days', backup => { backup.sessions[0].closedAt = new Date().toISOString() }],
    ['null product records', backup => { (backup.products as unknown[])[0] = null }],
    ['missing referenced days', backup => { backup.scans[0].sessionId = 999 }],
    ['fractional quantities', backup => { backup.scans[0].quantity = 1.5 }],
    ['negative prices', backup => { backup.products[0].price = -1 }],
    ['invisible barcode controls', backup => { backup.products[0].barcode = '4800\u0000001' }],
    ['directional spoofing in report names', backup => { backup.scans[0].name = 'Product\u202E123' }],
    ['duplicate normalized barcodes', backup => { backup.products[1].barcode = ` ${backup.products[0].barcode} ` }],
    ['duplicate scan IDs', backup => { backup.scans.push({ ...backup.scans[0] }) }],
    ['duplicate preference records', backup => { backup.settings = [backup.settings.find(s => s.key === 'preferences')!, backup.settings.find(s => s.key === 'preferences')!] }],
  ]
  it.each(attacks)('rejects %s without changing current records', async (_, mutate) => {
    const original = await exportDatabase()
    const bad = structuredClone(original)
    mutate(bad)
    await expect(restoreDatabase(bad)).rejects.toThrow()
    const remaining = await exportDatabase()
    expect(remaining.products).toEqual(original.products)
    expect(remaining.sessions).toEqual(original.sessions)
    expect(remaining.scans).toEqual(original.scans)
    expect(remaining.settings).toEqual(original.settings)
  })
  it.each(['products', 'sessions', 'scans'] as const)('checks %s record limits before replacing records', async table => {
    const bad = await exportDatabase()
    ;(bad[table] as unknown[]) = Array(backupLimits[table] + 1).fill(bad[table][0])
    await expect(restoreDatabase(bad)).rejects.toThrow('too many')
    expect(await db.products.count()).toBe(8)
    expect(await db.scans.count()).toBe(1)
  })
  it('rejects safe individual row values that produce an unsafe aggregate', async () => {
    const bad = await exportDatabase()
    bad.scans = Array.from({ length: 10_000 }, (_, index) => ({ ...bad.scans[0], id: index + 1, quantity: 9999, price: 99_999_999 }))
    await expect(restoreDatabase(bad)).rejects.toThrow('safe numeric limit')
    expect(await db.scans.count()).toBe(1)
    expect(() => totals(bad.scans)).toThrow('safe numeric limit')
  })
  it('copies approved fields and discards extra data and prototype-shaped keys', async () => {
    const backup = await exportDatabase()
    Object.defineProperty(backup.products[0], '__proto__', { value: { polluted: true }, enumerable: true })
    Object.assign(backup.products[0], { arbitrary: { deeply: { nested: 'ignored' } }, html: '<script>alert(1)</script>' })
    Object.assign(backup.scans[0], { externalUrl: 'https://example.invalid' })
    await restoreDatabase(backup)
    const product = (await db.products.get(backup.products[0].id!))!
    expect(Object.keys(product).sort()).toEqual(['barcode', 'category', 'color', 'id', 'name', 'price'])
    expect(Object.hasOwn(product, '__proto__')).toBe(false)
    expect('polluted' in {}).toBe(false)
    expect((await db.scans.toArray())[0]).not.toHaveProperty('externalUrl')
  })
  it('accepts real leap days and valid older app backups with preserved prices', async () => {
    const backup = await exportDatabase()
    backup.sessions[0].date = '2024-02-29'
    const valid = validateBackup(backup)
    await restoreDatabase(valid)
    expect((await db.sessions.toArray())[0].date).toBe('2024-02-29')
    expect((await db.scans.toArray())[0].price).toBe(2500)
  })
  it('prevents malformed product writes and safely renders legacy invalid colors', async () => {
    const product = (await db.products.toArray())[0]
    await expect(saveProduct({ ...product, color: 'modal-backdrop' })).rejects.toThrow()
    expect(safeColor('modal-backdrop')).toBe('sand')
    expect(safeColor('purple')).toBe('purple')
  })
})

describe('history summaries and deployment safeguards', () => {
  it('keeps per-day quantity and value totals without embedding full scan lists', async () => {
    const session = (await currentSession())!
    const report = await getReport(session.id!)
    const sessions: Session[] = Array.from({ length: 500 }, (_, index) => ({ ...session, id: index + 1 }))
    const scans: Scan[] = Array.from({ length: 10_000 }, (_, index) => ({ ...report.scans[0], id: index + 1, sessionId: index % 500 + 1, quantity: 2 }))
    const summaries = summarizeHistory(sessions, scans)
    expect(summaries).toHaveLength(500)
    expect(summaries.every(row => row.items === 40 && row.value === 100_000 && row.lines === 20)).toBe(true)
    expect(summaries[0]).not.toHaveProperty('scans')
  })
  it('generates consistent strict policies for HTML and deployment headers', () => {
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'")
    expect(contentSecurityPolicy).toContain("worker-src 'self'")
    expect(contentSecurityPolicy).not.toMatch(/unsafe-inline|unsafe-eval/)
    expect(offlineContentSecurityPolicy).not.toContain('frame-ancestors')
    expect(staticHostHeaders()).toContain(`Content-Security-Policy: ${contentSecurityPolicy}`)
    expect(nginxSecurityHeaders()).toContain(`add_header Content-Security-Policy "${contentSecurityPolicy}" always;`)
  })
})
