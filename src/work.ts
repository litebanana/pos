import { useSyncExternalStore } from 'react'

let pending = 0, dirty = false, updating = false
let updateTimer: ReturnType<typeof setTimeout> | undefined
let formLockPending = false
let releaseFormLock: (() => void) | undefined
const id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`
const peers = new Map<string, { busy: boolean; at: number }>()
const listeners = new Set<() => void>()
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('tindahan-work') : undefined
// Let input change handlers finish before notifying React's external-store subscribers.
const emit = () => queueMicrotask(() => listeners.forEach(listener => listener()))
const announce = () => channel?.postMessage({ type: 'state', id, busy: pending > 0 || dirty || updating })
channel?.addEventListener('message', event => {
  const value = event.data
  if (value?.type === 'state' && typeof value.id === 'string') { peers.set(value.id, { busy: !!value.busy, at: Date.now() }); emit() }
  if (value?.type === 'updating') { updating = true; emit() }
  if (value?.type === 'update-failed') { updating = false; clearTimeout(updateTimer); emit() }
  if (value?.type === 'query') announce()
})
setInterval(() => { for (const [key, peer] of peers) if (Date.now() - peer.at > 10_000) peers.delete(key); announce(); emit() }, 3000)
const getSnapshot = () => `${pending > 0 || dirty || [...peers.values()].some(peer => peer.busy)}:${updating}:${pending > 0}`
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useWorkState() { return useSyncExternalStore(subscribe, getSnapshot).split(':').map(value => value === 'true') as [boolean, boolean, boolean] }
function holdFormLock() {
  if (!navigator.locks || formLockPending) return
  formLockPending = true
  void navigator.locks.request('tindahan-unsaved-form', { mode: 'shared' }, () => new Promise<void>(resolve => { releaseFormLock = resolve; if (!dirty) resolve() })).finally(() => {
    formLockPending = false; releaseFormLock = undefined
    if (dirty) holdFormLock()
  })
}
export function setFormDirty(value: boolean) { dirty = value; if (dirty) holdFormLock(); else releaseFormLock?.(); announce(); emit() }
export async function runWork<T>(operation: () => Promise<T>): Promise<T> {
  if (updating) throw new Error('The app is updating. Wait for it to reopen before continuing.')
  pending++; announce(); emit()
  try {
    const perform = () => { if (updating) throw new Error('The app is updating. Try again after it reopens.'); return operation() }
    return navigator.locks ? await navigator.locks.request('tindahan-work', { mode: 'shared' }, perform) : await perform()
  } finally { pending--; announce(); emit() }
}
export async function safeUpdate(update: () => Promise<void>) {
  channel?.postMessage({ type: 'query' })
  await new Promise(resolve => setTimeout(resolve, 300))
  const perform = async () => {
    if (pending || dirty || [...peers.values()].some(peer => peer.busy)) throw new Error('Finish current actions and save or close forms in all app windows before updating.')
    updating = true; channel?.postMessage({ type: 'updating' }); announce(); emit()
    updateTimer = setTimeout(() => { updating = false; channel?.postMessage({ type: 'update-failed' }); announce(); emit() }, 20_000)
    try { await update() }
    catch (error) { updating = false; clearTimeout(updateTimer); channel?.postMessage({ type: 'update-failed' }); announce(); emit(); throw error }
  }
  if (navigator.locks) await navigator.locks.request('tindahan-unsaved-form', { mode: 'exclusive', ifAvailable: true }, formLock => {
    if (!formLock) throw new Error('Save or close unsaved forms in all windows before updating.')
    return navigator.locks.request('tindahan-work', { mode: 'exclusive', ifAvailable: true }, lock => {
      if (!lock) throw new Error('Another window is saving data. Try updating after it finishes.')
      return perform()
    })
  })
  else await perform()
}
window.addEventListener('beforeunload', event => { if (!updating && (pending || dirty)) { event.preventDefault(); event.returnValue = '' } })
window.addEventListener('pagehide', () => channel?.postMessage({ type: 'state', id, busy: false }))
// Explicitly handle worker changes, including updates registered by another window.
// Workbox can classify those as external rather than setting its isUpdate flag.
navigator.serviceWorker?.addEventListener('controllerchange', () => { if (updating) { clearTimeout(updateTimer); window.location.reload() } })
