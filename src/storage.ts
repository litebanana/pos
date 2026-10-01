export const storageExportPrompt = 'Browser storage is over 80% full. Checkout is paused. Export a full backup, then free device space before continuing.'

export async function estimateStorage(): Promise<StorageEstimate | undefined> {
  try {
    if (typeof navigator === 'undefined') return undefined
    return await navigator.storage?.estimate?.()
  } catch { return undefined }
}

export function storageUnderPressure(estimate?: StorageEstimate) {
  return !!estimate && Number.isFinite(estimate.usage) && Number.isFinite(estimate.quota) && estimate.quota! > 0 && estimate.usage! / estimate.quota! > .8
}

export async function assertCheckoutStorage() {
  if (storageUnderPressure(await estimateStorage())) {
    const error = new Error(storageExportPrompt)
    error.name = 'StoragePressureError'
    throw error
  }
}
