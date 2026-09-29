import { type ValidatedBackup } from './validation'
import { maxBackupFileBytes } from './backup-format'

export function readBackupFile(file: File, signal?: AbortSignal, password = ''): Promise<ValidatedBackup> {
  if (file.size > maxBackupFileBytes) return Promise.reject(new Error('Choose a backup smaller than 36 MB (25 MB before encryption).'))
  if (signal?.aborted) return Promise.reject(new DOMException('Backup reading cancelled.', 'AbortError'))
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./backup.worker.ts', import.meta.url), { type: 'module' })
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); worker.terminate() }
    const cancel = () => { finish(); reject(new DOMException('Backup reading cancelled.', 'AbortError')) }
    const timer = setTimeout(() => { finish(); reject(new Error('This backup took too long to check. Choose a smaller file.')) }, 20_000)
    signal?.addEventListener('abort', cancel, { once: true })
    worker.onmessage = (event: MessageEvent<{ ok: boolean; backup?: ValidatedBackup; error?: string }>) => {
      finish()
      if (event.data.ok && event.data.backup) resolve(event.data.backup)
      else reject(new Error(event.data.error || 'The backup could not be read.'))
    }
    worker.onerror = event => { event.preventDefault(); finish(); reject(new Error('Could not check the backup. Reload the app and try again.')) }
    worker.postMessage({ file, password })
  })
}
