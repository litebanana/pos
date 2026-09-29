import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { addToCart, db, money, type CartItem, type Product } from './db'
import { Field, Modal } from './components'
import { editCartItem, saveTicket } from './retail'
import { type Ticket } from './retail-types'
import { lineAmount } from './pricing'
import { runWork, setFormDirty } from './work'

interface Feedback { onError: (error: unknown) => void; notify: (text: string, error?: boolean) => void }
export function CartItemDetails({ row, onClose, ...feedback }: Feedback & { row: CartItem; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return <Modal title={`Item details: ${row.name}`} busy={busy} onClose={onClose}><form data-edit-form onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget), value = String(data.get('discount')); if (!/^\d+(\.\d{1,2})?$/.test(value)) { feedback.onError(new Error('Enter a percentage with up to two decimal places.')); return }; setBusy(true); try { await runWork(() => editCartItem(row.id!, Math.round(Number(value) * 100), String(data.get('note')))); setFormDirty(false); onClose(); feedback.notify('Item details saved.') } catch (error) { feedback.onError(error) } finally { setBusy(false) } }}><Field label="Item discount (%)" required><input required type="number" name="discount" min="0" max="100" step="0.01" defaultValue={((row.discountRate ?? 0) / 100).toFixed(2)} /></Field><Field label="Item note"><input name="note" maxLength={200} defaultValue={row.note ?? ''} /></Field><p className="form-note">Discounts require manager / owner access. Notes appear on the receipt.</p><div className="actions"><button className="button primary" disabled={busy}>Save item details</button></div></form></Modal>
}
export function SaveOrderDialog({ rows, context, onClose, ...feedback }: Feedback & { rows: CartItem[]; context: { notes?: string; dining?: Ticket['dining']; customerId?: number }; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return <Modal title="Save current order" busy={busy} onClose={onClose}><form data-edit-form onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); try { await runWork(() => saveTicket(String(data.get('name')), rows, String(data.get('notes')), data.get('dining') as Ticket['dining'], context.customerId)); setFormDirty(false); onClose(); feedback.notify('Order saved. The cart is ready for another customer.') } catch (error) { feedback.onError(error) } finally { setBusy(false) } }}><Field label="Order name" required><input name="name" required maxLength={100} placeholder="e.g. Customer name or Table 1" /></Field><Field label="Saved order type" required><select name="dining" defaultValue={context.dining ?? 'retail'}><option value="retail">Retail</option><option value="dine-in">Dine in</option><option value="takeaway">Takeaway</option><option value="delivery">Delivery</option></select></Field><Field label="Saved order notes"><input name="notes" maxLength={200} defaultValue={context.notes ?? ''} /></Field><p className="form-note">Stock and sales stay unchanged until checkout. Saved prices are retained when reopening.</p><div className="actions"><button className="button primary" disabled={busy}>Save order</button></div></form></Modal>
}
export function CustomizeProductDialog({ product, weightGrams, onClose, ...feedback }: Feedback & { product: Product; weightGrams?: number; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  return <Modal title={`Add: ${product.name}`} busy={busy} onClose={onClose}><form data-edit-form onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); try { await runWork(() => addToCart(product.barcode, undefined, { modifiers: data.getAll('modifier').map(String), note: String(data.get('note')), ...(product.unit === 'kg' ? { weightGrams: Math.round(Number(data.get('weight')) * 1000) } : {}) })); setFormDirty(false); onClose(); feedback.notify('Product added with its selected options.') } catch (error) { feedback.onError(error) } finally { setBusy(false) } }}><p>{money(product.price)} {product.unit === 'kg' ? 'per kilogram' : 'base price'}</p>{product.unit === 'kg' && <Field label="Bag weight (kg)" required><input name="weight" required type="number" inputMode="decimal" min="0.001" max="9999" step="0.001" defaultValue={(weightGrams ?? 1000) / 1000} /></Field>}{product.modifiers?.map(modifier => <label className="check-field" key={modifier.name}><input type="checkbox" name="modifier" value={modifier.name} />{modifier.name} (+{money(modifier.price)})</label>)}<Field label="Preparation / item note"><input name="note" maxLength={200} /></Field><div className="actions"><button className="button primary" disabled={busy}>Add with options</button></div></form></Modal>
}
interface Detector { detect: (video: HTMLVideoElement) => Promise<{ rawValue: string }[]> }
interface DetectorConstructor { new(options: { formats: string[] }): Detector; getSupportedFormats: () => Promise<string[]> }
export function CameraScanner({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLVideoElement>(null), [error, setError] = useState(''), [ready, setReady] = useState(false)
  const scanCallback = useRef(onScan); scanCallback.current = onScan
  useEffect(() => {
    let alive = true, stream: MediaStream | undefined, timer: ReturnType<typeof setTimeout> | undefined
    async function start() {
      try {
        const Constructor = (window as unknown as { BarcodeDetector?: DetectorConstructor }).BarcodeDetector
        if (!Constructor || !navigator.mediaDevices?.getUserMedia) throw new Error('Camera barcode scanning is unavailable in this browser. Use a keyboard scanner or enter the barcode.')
        const supported = await Constructor.getSupportedFormats(), formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'].filter(format => supported.includes(format))
        if (!formats.length) throw new Error('This browser does not support retail barcode formats.')
        const detector = new Constructor({ formats })
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
        if (!alive) { stream.getTracks().forEach(track => track.stop()); return }
        ref.current!.srcObject = stream; await ref.current!.play(); if (!alive) return; setReady(true)
        async function detect() { if (!alive || !ref.current) return; try { const codes = await detector.detect(ref.current); if (alive && codes[0]?.rawValue) { alive = false; stream?.getTracks().forEach(track => track.stop()); scanCallback.current(codes[0].rawValue); return } } catch { /* Wait for the next complete camera frame. */ }; if (alive) timer = setTimeout(() => void detect(), 250) }
        void detect()
      } catch (error) { stream?.getTracks().forEach(track => track.stop()); if (alive) setError(error instanceof Error && error.name === 'NotAllowedError' ? 'Camera access was denied. Allow camera access for this website, or enter the barcode.' : error instanceof Error ? error.message : 'Unable to start the camera.') }
    }
    void start()
    return () => { alive = false; clearTimeout(timer); stream?.getTracks().forEach(track => track.stop()) }
  }, [])
  return <Modal title="Scan with camera" onClose={onClose}><video className="camera-preview" ref={ref} playsInline muted /><p className="form-note">{ready ? 'Point the rear camera at one product barcode.' : 'Starting camera…'}</p>{error && <p className="error-text" role="alert">{error}</p>}</Modal>
}
export function CustomerDisplay() {
  const rows = useLiveQuery(() => db.cart.toArray(), [], []), lastSale = useLiveQuery(() => db.sales.orderBy('id').last()), prefs = useLiveQuery(async () => (await db.settings.get('preferences'))?.value as { storeName?: string } | undefined)
  return <main className="customer-screen"><h1>{prefs?.storeName || 'My store'}</h1><p className="form-note">Customer display · This browser and device only</p>{rows.length ? <><div className="tool-cards">{rows.map(row => <article className="tool-card" key={row.id}><strong>{row.name} × {row.quantity}</strong><p>{money(row.price * row.quantity)}{row.discountRate ? ` · ${(row.discountRate / 100).toFixed(2)}% item discount` : ''}</p></article>)}</div><div className="checkout-total"><span>Subtotal before checkout discounts and tax</span><strong>{money(rows.reduce((sum, row) => sum + lineAmount(row), 0))}</strong></div></> : <><h2>Thank you!</h2>{lastSale && <p>Latest receipt #{lastSale.id} · {money(lastSale.total)} · Change {money(lastSale.change)}</p>}</>}</main>
}
