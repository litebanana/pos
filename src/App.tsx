import { useCallback, useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Banknote, Barcode, CalendarClock, ClipboardList, Download, FileText, Package, Plus, Settings, ShoppingCart, Trash2, TriangleAlert, X } from 'lucide-react'
import { addToCart, archiveReport, currentSession, dateLabel, db, defaults, getPreferences, getReport, initialize, money, removeCartItem, reportTotals, saveProduct, today, totals, undoCartRemoval, type CartItem, type Product, type Report, type Sale } from './db'
import { Field, Modal, ProductForm, QuantityControl, Required } from './components'
import { HistoryView, ProductsView, SalesView, SettingsView } from './views'
import { createPDF, createReceiptPDF, pdfFilename } from './pdf'
import { useInstall } from './useInstall'
import { runWork, safeUpdate, setFormDirty, useWorkState } from './work'
import { StoreTools, type ToolSection } from './retail-views'
import { decodeWeightBarcode, getRetailSettings } from './retail'
import { needsCashReview, type CheckoutOptions, type RetailSettings } from './retail-types'
import { CheckoutDialog } from './checkout-dialog'
import { PrivacyPolicy, TermsOfUse } from './legal'
import { CameraScanner, CartItemDetails, CustomerDisplay, CustomizeProductDialog, SaveOrderDialog } from './sell-extras'
import { cartPricing, lineAmount, lowStockAt, stockText } from './pricing'

import { estimateStorage, storageUnderPressure, storageExportPrompt } from './storage'

type View = 'sell' | 'products' | 'sales' | 'reports' | 'settings' | 'tools'
type Dialog = { type: 'product'; product?: Product; barcode?: string; scanAfter?: boolean } | { type: 'checkout'; cart: CartItem[]; config: RetailSettings; context: CheckoutOptions } | { type: 'receipt'; sale: Sale } | { type: 'report' | 'close'; report: Report } | { type: 'install' | 'help' | 'camera' | 'privacy' | 'terms' } | { type: 'item'; row: CartItem } | { type: 'saveOrder'; rows: CartItem[]; context: CheckoutOptions } | { type: 'customize'; product: Product; weightGrams?: number }
const nav = [{ id: 'sell', title: 'Sell', shortTitle: 'Sell', icon: ShoppingCart }, { id: 'products', title: 'Products', shortTitle: 'Products', icon: Package }, { id: 'sales', title: 'Sales history', shortTitle: 'Sales', icon: FileText }, { id: 'reports', title: 'Daily reports', shortTitle: 'Reports', icon: FileText }, { id: 'settings', title: 'Settings', shortTitle: 'Settings', icon: Settings }] as const

export default function App() {
  const [view, setView] = useState<View>('sell'), [dialog, setDialog] = useState<Dialog | null>(null)
  const [storagePressure, setStoragePressure] = useState(false)
  const [replenish, setReplenish] = useState(false)
  const [toolSection, setToolSection] = useState<ToolSection>('Customers')
  const retail = useLiveQuery(getRetailSettings, [])
  useEffect(() => { document.documentElement.dataset.theme = retail?.dark ? 'dark' : 'light' }, [retail?.dark])
  const [barcode, setBarcode] = useState(''), [day, setDay] = useState(today()), [filter, setFilter] = useState('')
  const [ready, setReady] = useState(false), [storageError, setStorageError] = useState(''), [setupError, setSetupError] = useState('')
  const [online, setOnline] = useState(navigator.onLine), [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(null), [lastProduct, setLastProduct] = useState('')
  const [removed, setRemoved] = useState<CartItem | null>(null), [actionFailed, setActionFailed] = useState(false)
  const scanner = useRef<HTMLInputElement>(null), queue = useRef<Promise<void>>(Promise.resolve()), unknown = useRef(false)
  const audio = useRef<AudioContext | null>(null), lastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const prefs = useLiveQuery(getPreferences, [], defaults)
  const products = useLiveQuery(() => db.products.toArray(), [], [])
  const cart = useLiveQuery(() => db.cart.toArray(), [], [])
  const openShift = useLiveQuery(() => db.shifts.where('status').equals('open').first(), [], undefined)
  const cashReviews = useLiveQuery(() => db.shifts.filter(needsCashReview).toArray(), [], [])
  const savedOrders = useLiveQuery(() => db.tickets.count(), [], 0)
  const staleDays = useLiveQuery(async () => (await db.sessions.where('status').equals('open').toArray()).filter(session => session.date < today()).length, [day], 0)
  const report = useLiveQuery(async () => { const session = await currentSession(day); return session ? getReport(session.id!) : null }, [day], null)
  const lastExport = useLiveQuery(async () => (await db.settings.get('lastExport'))?.value as string | undefined)
  const cartSum = { ...totals(cart), value: cartPricing(cart).total }, daySum = report ? reportTotals(report) : { value: 0, items: 0, refunds: 0 }
  const [workBusy, updating, saving] = useWorkState()
  const { canInstall, installed, install } = useInstall()
  const { offlineReady: [workerReady], needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({ onRegisterError: () => setSetupError('Offline setup failed. Check your connection, then reload before working offline.') })
  const offlineReady = workerReady || ('serviceWorker' in navigator && !!navigator.serviceWorker.controller)
  const notify = useCallback((text: string, error = false) => { setToast({ text, error }); if (!error) setActionFailed(false) }, [])
  const onError = useCallback((error: unknown) => {
    setActionFailed(true)
    const name = error instanceof Error ? error.name : ''
    if (name === 'StoragePressureError' || name === 'QuotaExceededError') setStoragePressure(true)
    notify(name === 'QuotaExceededError' ? 'Device storage is full. This action was not saved. Export a backup and free device space before continuing.' : error instanceof Error ? error.message : 'This action could not be completed. Review your data before trying again.', true)
  }, [notify])
  const focusScanner = useCallback(() => requestAnimationFrame(() => scanner.current?.focus({ preventScroll: true })), [])
  function closeDialog() { if (busy) return; setDialog(null); unknown.current = false; setFormDirty(false); if (view === 'sell') focusScanner() }
  useEffect(() => { void runWork(initialize).then(() => setReady(true)).catch(error => { setStorageError('Device storage is unavailable. Allow site storage and reload to continue.'); onError(error) }) }, [onError])
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), toast.error ? 9000 : 4500); return () => clearTimeout(timer) }, [toast])
  useEffect(() => {
    let active = true
    const update = () => { setOnline(navigator.onLine); setDay(today()); void estimateStorage().then(estimate => { if (active && estimate) setStoragePressure(storageUnderPressure(estimate)) }) }
    update()
    const timer = setInterval(update, 15000)
    window.addEventListener('online', update); window.addEventListener('offline', update); document.addEventListener('visibilitychange', update)
    return () => { active = false; clearInterval(timer); window.removeEventListener('online', update); window.removeEventListener('offline', update); document.removeEventListener('visibilitychange', update) }
  }, [])
  useEffect(() => { if (view === 'sell' && !dialog && ready) focusScanner() }, [view, dialog, ready, focusScanner])
  useEffect(() => () => { clearTimeout(lastTimer.current); void audio.current?.close() }, [])
  function beep() {
    if (!prefs.sound) return
    try { audio.current ??= new AudioContext(); void audio.current.resume() } catch { /* Visual feedback remains available. */ }
  }
  function confirmScan(product: Product) {
    setActionFailed(false); setLastProduct(`${product.name} added to cart.`)
    clearTimeout(lastTimer.current); lastTimer.current = setTimeout(() => setLastProduct(''), 2500)
    if (prefs.sound && audio.current) try {
      const context = audio.current, oscillator = context.createOscillator(), gain = context.createGain()
      oscillator.connect(gain); gain.connect(context.destination); oscillator.frequency.value = 1000; gain.gain.setValueAtTime(.05, context.currentTime); gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + .12); oscillator.start(); oscillator.stop(context.currentTime + .13)
    } catch { /* Audio must not interrupt sales. */ }
  }
  function scan(code: string) {
    const value = code.trim()
    if (!value || !ready || storageError || updating || busy) return
    beep(); setBarcode(''); setRemoved(null); focusScanner()
    // Reserve work immediately, before the scan queue starts, to prevent update races.
    const previous = queue.current
    queue.current = runWork(async () => {
      await previous
      if (unknown.current) { notify('Finish adding the new product before scanning another item.', true); return }
      let found = await db.products.where('barcode').equals(value).first()
      const weight = !found ? decodeWeightBarcode(value, (await getRetailSettings()).weightPrefix ?? '') : undefined
      if (weight) { found = await db.products.where('barcode').equals(weight.barcode).first(); if (found?.unit !== 'kg') throw new Error('This weight label does not match a product sold by kilogram. Add its five-digit item code in Products.'); unknown.current = true; setDialog({ type: 'customize', product: found, weightGrams: weight.weightGrams }); return }
      if (found && (found.modifiers?.length || found.unit === 'kg')) { unknown.current = true; setDialog({ type: 'customize', product: found }); return }
      const product = await addToCart(value)
      if (product) confirmScan(product)
      else { unknown.current = true; setDialog({ type: 'product', barcode: value, scanAfter: true }) }
    }).catch(onError)
  }
  async function beginCheckout() {
    await queue.current
    const estimate = await estimateStorage()
    const blocked = estimate ? storageUnderPressure(estimate) : storagePressure
    setStoragePressure(blocked)
    if (blocked) { notify(storageExportPrompt, true); navigate('settings'); return }
    try { const rows = await db.cart.toArray(); if (!rows.length) throw new Error('Add an item to the cart first.'); const config = await getRetailSettings(), context = (await db.settings.get('cartContext'))?.value as CheckoutOptions | undefined; setDialog({ type: 'checkout', cart: rows, config, context: context ?? {} }) } catch (error) { onError(error) }
  }
  async function beginClose(id?: number) {
    try { await queue.current; if (await db.cart.count()) throw new Error('Complete checkout or remove the cart items before closing the day.'); const session = id ? await db.sessions.get(id) : await currentSession(); if (!session) throw new Error('Record a sale before closing the day.'); setDialog({ type: 'close', report: await getReport(session.id!) }) } catch (error) { onError(error) }
  }
  async function downloadReport(report: Report) { const pdf = await createPDF(report); pdf.save(pdfFilename(report)); notify('Report download started.') }
  async function finishDay(report: Report) {
    if (busy) return; setBusy(true)
    try { await runWork(async () => { const pdf = await createPDF(report); await archiveReport(report); setDialog(null); setFormDirty(false); try { pdf.save(pdfFilename(report)); notify('Day closed. Export a full backup to keep your records safe.') } catch { notify('Day closed. Download the report again from Daily reports.', true) } }) } catch (error) { onError(error) } finally { setBusy(false) }
  }
  function navigate(next: View) { if (saving || updating) { notify('Wait for the current action to finish.', true); return }; setView(next); setFormDirty(false); window.scrollTo({ top: 0 }) }
  const backupDue = !lastExport || Date.now() - new Date(lastExport).getTime() > 24 * 60 * 60_000
  const quickProducts = products.filter(product => `${product.name} ${product.barcode}`.toLowerCase().includes(filter.toLowerCase())).slice(0, 24)
  const lowCount = products.filter(product => product.stock !== undefined && product.stock <= lowStockAt(product)).length
  if (new URLSearchParams(window.location.search).has('customer-display')) return <CustomerDisplay />
  return <>
    <div className="app-shell" onChange={event => { if ((event.target as Element).closest('[data-edit-form]')) setFormDirty(true) }}>
      <aside className="sidebar"><div className="sidebar-brand"><a className="brand" href="#" onClick={event => { event.preventDefault(); navigate('sell') }}>Tindahan</a><button className="button small secondary mobile-install" onClick={() => setDialog({ type: 'install' })}>{installed ? 'Installation details' : 'Install app'}</button></div><nav className="main-nav" aria-label="Main navigation">{nav.map(({ id, title, shortTitle, icon: Icon }) => <button key={id} aria-label={title} disabled={saving || updating} className={view === id ? 'active' : ''} aria-current={view === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon size={20} /><span className="nav-label-full" aria-hidden="true">{title}</span><span className="nav-label-short" aria-hidden="true">{shortTitle}</span></button>)}</nav><div className="sidebar-foot"><p>{offlineReady ? 'Offline ready' : 'Offline setup pending'}</p><button className="button small secondary" onClick={() => setDialog({ type: 'install' })}>{installed ? 'Installation details' : 'Install app'}</button><div className="legal-links"><button type="button" onClick={() => setDialog({ type: 'privacy' })}>Privacy</button><span aria-hidden="true">·</span><button type="button" onClick={() => setDialog({ type: 'terms' })}>Terms</button></div></div></aside>
      <div className="main-shell"><header className="topbar"><strong>{prefs.storeName || 'My store'}</strong><div className="topbar-actions"><span className={actionFailed ? 'save-status error-text' : 'save-status'} role="status">{updating ? 'Updating…' : actionFailed ? 'Check the last action' : workBusy ? 'Work in progress' : online ? 'Stored on this device' : 'Working offline'}</span><button className="button small secondary" disabled={saving || updating} onClick={() => navigate('tools')}>Store tools</button><button className="button small secondary" onClick={() => setDialog({ type: 'help' })}>Help</button></div></header>
        <main className="main-content">
          {storageError && <p className="notice error" role="alert">{storageError}</p>}
          {setupError && <p className="notice error" role="alert">{setupError}</p>}
          {needRefresh && <div className="notice update-notice"><span>New version available. Save changes and finish actions in all app windows before updating.</span><button className="button small secondary" disabled={workBusy || updating || !!dialog || !!barcode.trim()} onClick={() => void safeUpdate(() => updateServiceWorker(true)).catch(onError)}>Update app</button></div>}
          {storagePressure && <div className="notice warning backup-notice" role="alert"><span>{storageExportPrompt}</span><button className="button small secondary" onClick={() => navigate('settings')}>Export full backup</button></div>}
          {backupDue && <div className="notice backup-notice"><span>{lastExport ? 'Daily backup is due.' : 'No backup exported yet.'}</span><button className="button small secondary" aria-label="Back up data" onClick={() => navigate('settings')}>Back up</button></div>}
          {view === 'sell' && <>
            <div className="page-heading"><div><h1>Sell</h1><p>{dateLabel(day)} · Philippine time</p></div><button className="button secondary" onClick={() => void beginClose()}>Close day</button></div>
            <div className="day-stats" aria-label="Daily totals"><div><span>Net sales today</span><strong>{money(daySum.value)}</strong></div><div><span>Items sold today</span><strong>{daySum.items}</strong></div><div><span>Voids / refunds</span><strong>{money(daySum.refunds)}</strong></div></div>
            {(!!lowCount || !!savedOrders || openShift || !!cashReviews.length || !!staleDays) && <div className="day-alerts" role="region" aria-label="Needs attention">
              {!!lowCount && <button type="button" className="button small secondary" onClick={() => { setReplenish(true); setToolSection('Purchasing'); navigate('tools') }}><TriangleAlert size={18} aria-hidden="true" />{lowCount} {lowCount === 1 ? 'product is' : 'products are'} low on stock</button>}
              {!!savedOrders && <button type="button" className="button small secondary" onClick={() => { setToolSection('Saved orders'); navigate('tools') }}><ClipboardList size={18} aria-hidden="true" />{savedOrders} saved {savedOrders === 1 ? 'order is' : 'orders are'} waiting</button>}
              {openShift && <button type="button" className="button small secondary" onClick={() => { setToolSection('Cash drawer'); navigate('tools') }}><Banknote size={18} aria-hidden="true" />Cash shift #{openShift.id} is open</button>}
              {cashReviews.map(shift => <button key={shift.id} type="button" className="button small secondary" onClick={() => { setToolSection('Cash drawer'); navigate('tools') }}><Banknote size={18} aria-hidden="true" />Shift #{shift.id}: {money(shift.counted! - shift.expected!)} cash difference needs review</button>)}
              {!!staleDays && <button type="button" className="button small secondary" onClick={() => navigate('reports')}><CalendarClock size={18} aria-hidden="true" />{staleDays} past {staleDays === 1 ? 'day is' : 'days are'} still open</button>}
            </div>}
            <div className="sell-layout"><section className="panel cart-panel"><div className="panel-heading"><h2>Current cart</h2><span>{cartSum.items} {cartSum.items === 1 ? 'item' : 'items'}</span></div><form className="scanner-form" onSubmit={event => { event.preventDefault(); scan(barcode) }}><Field label="Barcode" required><div className="scanner-input"><Barcode size={22} /><input ref={scanner} required aria-label="Scan or enter barcode" maxLength={100} autoComplete="off" autoCorrect="off" spellCheck={false} value={barcode} onChange={event => setBarcode(event.target.value)} placeholder="Scan or enter" disabled={!ready || !!storageError || updating || busy} /></div></Field><button className="button primary" disabled={!ready || !!storageError || updating || busy}><Plus size={18} />Add item</button></form><p className="scan-feedback" role="status">{lastProduct || 'Use a keyboard scanner or enter a barcode.'}</p>
            <div className="sell-tools"><button className="button secondary" onClick={() => setDialog({ type: 'camera' })}>Scan with camera</button><button className="button secondary" disabled={!cart.length || saving || busy} onClick={() => void queue.current.then(async () => { const rows = await db.cart.toArray(), context = (await db.settings.get('cartContext'))?.value as CheckoutOptions | undefined; setDialog({ type: 'saveOrder', rows, context: context ?? {} }) }).catch(onError)}>Save order</button><button className="button secondary" onClick={() => { setToolSection('Saved orders'); navigate('tools') }}>Saved orders</button><a className="button secondary" href="?customer-display" target="_blank" rel="noopener">Customer display</a></div>
              <div className="table-scroll"><table className="cart-table"><thead><tr><th>Product</th><th>Quantity<Required /></th><th>Subtotal</th><th><span className="sr-only">Remove</span></th></tr></thead><tbody>{cart.map(row => <tr key={row.id}><td><strong>{row.name}</strong><small>{money(row.price)} each · {row.barcode}</small>{row.note && <small>{row.note}</small>}{!!row.discountRate && <small>{(row.discountRate / 100).toFixed(2)}% discount</small>}<button className="item-details-button" aria-label={`Item details for ${row.name}`} onClick={() => setDialog({ type: 'item', row })}>Item details</button></td><td><span className="mobile-quantity-label">Quantity<Required /></span><QuantityControl row={row} onError={onError} onDone={focusScanner} /></td><td className="numeric">{money(row.price * row.quantity - Math.round(row.price * row.quantity * (row.discountRate ?? 0) / 10000))}</td><td><button className="icon-button danger-text" aria-label={`Remove ${row.name}`} onClick={() => void runWork(async () => { setRemoved(await removeCartItem(row.id!)); notify('Item removed. You can undo this removal.'); focusScanner() }).catch(onError)}><Trash2 size={18} /></button></td></tr>)}</tbody></table></div>
              {!cart.length && <div className="empty-state">Cart is empty. Scan a product or choose one below.</div>}
              {removed && <div className="undo-notice"><span>{removed.name} removed.</span><button className="button small secondary" onClick={() => void runWork(async () => { await undoCartRemoval(removed); setRemoved(null); notify('Item restored.'); focusScanner() }).catch(onError)}>Undo removal</button></div>}
              <p className="panel-foot">Cart items are saved locally. Sales totals and stock change only after checkout.</p>
            </section><aside className="panel checkout-summary"><h2>Checkout</h2><div className="checkout-total"><span>Total</span><strong>{money(cartSum.value)}</strong></div><p>{cartSum.items} {cartSum.items === 1 ? 'item' : 'items'}</p><button className="button primary full-width" disabled={!cart.length || !ready || updating || busy} onClick={() => void beginCheckout()}>Checkout</button><p className="form-note">Choose a payment method on the next screen.</p></aside></div>
            <section className="panel quick-panel"><div className="panel-heading"><h2>Quick add</h2><Field label="Find a product"><input aria-label="Find quick-add product" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Name or barcode" /></Field></div><div className="quick-products">{quickProducts.map(product => <button key={product.id} disabled={!ready || updating || product.stock === 0} onClick={() => scan(product.barcode)}><strong>{product.name}</strong><span>{money(product.price)}{product.stock === undefined ? '' : ` · ${stockText(product)} in stock`}</span></button>)}</div>{!quickProducts.length && <p className="empty-state">No matching products. Add products in the catalog.</p>}{products.length > 24 && <p className="panel-foot">Showing up to 24 products. Search to find another product.</p>}</section>
          </>}
          {view === 'products' && <ProductsView products={products} onAdd={() => setDialog({ type: 'product' })} onEdit={product => setDialog({ type: 'product', product })} onError={onError} notify={notify} />}
          {view === 'sales' && <SalesView onReceipt={sale => setDialog({ type: 'receipt', sale })} onError={onError} notify={notify} />}
          {view === 'reports' && <HistoryView onView={report => setDialog({ type: 'report', report })} onDownload={downloadReport} onCloseDay={beginClose} onError={onError} />}
          {view === 'settings' && <SettingsView prefs={prefs} onError={onError} notify={notify} offlineReady={offlineReady} onInstall={() => setDialog({ type: 'install' })} />}
          {view === 'tools' && <StoreTools replenish={replenish} onReplenish={() => setReplenish(false)} section={toolSection} onSection={setToolSection} onSell={() => navigate('sell')} onError={onError} notify={notify} />}
        </main>
      </div>
    </div>
    {toast && <div className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.text}</span><button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><X size={20} /></button></div>}
    {dialog?.type === 'product' && <Modal title={dialog.product ? 'Edit product' : 'Add product'} busy={saving} onClose={closeDialog}><ProductForm product={dialog.product} barcode={dialog.barcode} scanAfter={dialog.scanAfter} onCancel={closeDialog} onSave={async product => { if (dialog.scanAfter) { const saved = await addToCart(product.barcode, product); if (saved) confirmScan(saved) } else await saveProduct(product); setDialog(null); unknown.current = false; setFormDirty(false); focusScanner(); notify(dialog.scanAfter ? 'Product saved and added to cart.' : 'Product saved.') }} /></Modal>}
    {dialog?.type === 'checkout' && <CheckoutDialog storageBlocked={storagePressure} onExport={() => { closeDialog(); navigate('settings') }} cart={dialog.cart} config={dialog.config} context={dialog.context} operator={prefs.operator || 'Owner'} onClose={closeDialog} onError={onError} onComplete={sale => { setRemoved(null); setFormDirty(false); setDialog({ type: 'receipt', sale }); notify(`Sale completed. Change: ${money(sale.change)}.`) }} />}
    {dialog?.type === 'camera' && <CameraScanner onClose={closeDialog} onScan={value => { closeDialog(); scan(value) }} />}
    {dialog?.type === 'item' && <CartItemDetails row={dialog.row} onClose={closeDialog} onError={onError} notify={notify} />}
    {dialog?.type === 'saveOrder' && <SaveOrderDialog rows={dialog.rows} context={dialog.context} onClose={closeDialog} onError={onError} notify={notify} />}
    {dialog?.type === 'customize' && <CustomizeProductDialog product={dialog.product} weightGrams={dialog.weightGrams} onClose={closeDialog} onError={onError} notify={notify} />}
    {dialog?.type === 'receipt' && <ReceiptDialog sale={dialog.sale} onClose={closeDialog} onError={onError} />}
    {(dialog?.type === 'close' || dialog?.type === 'report') && <Modal title={dialog.type === 'close' ? 'Close day?' : 'Daily sales report'} wide busy={busy} onClose={closeDialog}><p>{dialog.report.session.storeName || 'My store'} · {dateLabel(dialog.report.session.date, true)}</p><ReportTable report={dialog.report} />{dialog.type === 'close' && <p className="notice">This archives the day. Your store name and products stay saved. Export a full backup after closing.</p>}<div className="actions"><button className="button secondary" disabled={busy} onClick={closeDialog}>Cancel</button>{dialog.type === 'close' ? <button className="button primary" disabled={busy} onClick={() => void finishDay(dialog.report)}>{busy ? 'Closing…' : 'Close day & download'}</button> : <button className="button primary" onClick={() => void runWork(() => downloadReport(dialog.report)).catch(onError)}><Download size={18} />Download PDF</button>}</div></Modal>}
    {dialog?.type === 'install' && <Modal title="Install Tindahan" onClose={closeDialog}><p>{installed ? 'This app is installed.' : 'Install the app to open it from your home screen.'}</p><p className="notice">{offlineReady ? 'App files are ready for offline use.' : 'Keep the app open with a connection until offline setup finishes.'}</p><p><strong>Android Chrome:</strong> open this website directly in a regular Chrome tab, then use ⋮ → Add to Home screen → Install. Some versions show Install app directly.</p><p><strong>iPhone / iPad:</strong> open in Safari → Share → Add to Home Screen.</p>{!installed && !canInstall && <p className="form-note">Your browser has not offered an installation prompt. Try its menu instead. If you opened the link inside another app, copy the website address into Chrome or Safari.</p>}{canInstall && !installed && <div className="actions"><button className="button primary" onClick={() => void install().then(ok => { if (ok) { closeDialog(); notify('App installed.') } }).catch(onError)}>Install app</button></div>}</Modal>}
    {dialog?.type === 'help' && <Modal title="How to use Tindahan" onClose={closeDialog}><ol className="help-list"><li>Check the example barcodes and prices in Products. Add stock counts if you want to track inventory.</li><li>Connect a USB or Bluetooth scanner in keyboard mode with an Enter suffix.</li><li>Scan into the cart. Check quantities, then complete checkout and record the payment.</li><li>Download a receipt, and use Sales history to record voids or refunds.</li><li>Close the day when the cart is empty. Export backups regularly and keep copies off the device.</li></ol><p className="form-note">Updates wait for saved forms and completed actions. Local owner PINs restrict app controls; they do not encrypt the database.</p><div className="legal-links"><button type="button" onClick={() => setDialog({ type: 'privacy' })}>Privacy policy</button><span aria-hidden="true">·</span><button type="button" onClick={() => setDialog({ type: 'terms' })}>Terms of use</button></div><p className="form-note">No tracking cookies. Records stay in this browser until you export or reset them.</p></Modal>}
    {dialog?.type === 'privacy' && <Modal title="Privacy policy" wide onClose={closeDialog}><PrivacyPolicy /><div className="actions"><button className="button secondary" onClick={closeDialog}>Close</button><button className="button primary" onClick={() => setDialog({ type: 'terms' })}>View terms</button></div></Modal>}
    {dialog?.type === 'terms' && <Modal title="Terms of use" wide onClose={closeDialog}><TermsOfUse /><div className="actions"><button className="button secondary" onClick={closeDialog}>Close</button><button className="button primary" onClick={() => setDialog({ type: 'privacy' })}>View privacy</button></div></Modal>}
  </>
}
function ReceiptDialog({ sale, onClose, onError }: { sale: Sale; onClose: () => void; onError: (error: unknown) => void }) {
  const rows = useLiveQuery(() => db.scans.where('saleId').equals(sale.id!).toArray(), [sale.id], [])
  const corrections = useLiveQuery(() => db.corrections.where('saleId').equals(sale.id!).toArray(), [sale.id], [])
  const [busy, setBusy] = useState(false)
  return <Modal title={`Receipt #${String(sale.id).padStart(6, '0')}`} printable wide busy={busy} onClose={onClose}><p>{sale.storeName || 'My store'} · {new Date(sale.createdAt).toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}</p><p>Operator: {sale.operator} · Payment: {sale.payment === 'gcash' ? 'GCash' : sale.payment}</p>{sale.customerName && <p>Customer: {sale.customerName}</p>}{sale.notes && <p>Note: {sale.notes}</p>}<div className="table-scroll"><table className="mobile-records"><thead><tr><th>Product</th><th>Qty</th><th>Subtotal</th></tr></thead><tbody>{rows.map(row => <tr key={row.id}><td className="record-title">{row.name}<small>{money(row.price)} each{row.note && ` · ${row.note}`}</small></td><td data-label="Quantity">{row.quantity}</td><td data-label="Subtotal">{money(lineAmount(row))}</td></tr>)}</tbody></table></div><div className="receipt-totals">{!!sale.discount && <p><span>Discounts</span><strong>−{money(sale.discount)}</strong></p>}{!!sale.tax && <p><span>Tax ({sale.taxMode})</span><strong>{money(sale.tax)}</strong></p>}<p><span>Total</span><strong>{money(sale.total)}</strong></p><p><span>Received</span><strong>{money(sale.tendered)}</strong></p><p><span>Change</span><strong>{money(sale.change)}</strong></p>{sale.payments?.map(part => <p key={part.method}><span>{part.method}{part.ref ? ` · ref ${part.ref}` : ''}</span><strong>{money(part.amount)}</strong></p>)}</div>{sale.customerName && <p className="form-note">Points earned: {((sale.earned ?? 0) / 100).toFixed(2)} · Redeemed: {((sale.redeemed ?? 0) / 100).toFixed(2)}</p>}{corrections.map(correction => <p className="notice warning" key={correction.id}>{correction.action === 'void' ? 'Voided' : 'Refunded'}: {money(correction.amount)} · {correction.reason} · {new Date(correction.createdAt).toLocaleString()}</p>)}<div className="actions"><button className="button secondary" disabled={busy} onClick={onClose}>Done</button><button className="button secondary" onClick={() => window.print()}>Print receipt</button><button className="button primary" disabled={busy || !rows.length} onClick={async () => { setBusy(true); try { await runWork(async () => { const pdf = await createReceiptPDF(sale, rows, corrections); pdf.save(`Tindahan-receipt-${sale.id}.pdf`) }) } catch (error) { onError(error) } finally { setBusy(false) } }}>Download receipt PDF</button></div></Modal>
}
function ReportTable({ report }: { report: Report }) {
  const sum = reportTotals(report)
  return <><div className="table-scroll"><table className="mobile-records"><thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Subtotal</th></tr></thead><tbody>{report.scans.map(row => <tr key={row.id}><td className="record-title">{row.name}<small>{row.barcode}</small></td><td data-label="Quantity">{row.quantity}</td><td data-label="Unit price">{money(row.price)}</td><td data-label="Subtotal">{money(lineAmount(row))}</td></tr>)}</tbody></table></div>{!!report.corrections?.length && <div className="corrections"><h3>Voids and refunds</h3>{report.corrections.map(correction => <p key={correction.id}>Sale #{correction.saleId} · {correction.reason} · −{money(correction.amount)}</p>)}</div>}<div className="receipt-totals"><p><span>Gross sales</span><strong>{money(sum.gross)}</strong></p><p><span>Voids and refunds</span><strong>−{money(sum.refunds)}</strong></p><p><span>Net sales</span><strong>{money(sum.value)}</strong></p></div></>
}
