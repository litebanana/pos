import { decodeBackup, maxBackupFileBytes } from './backup-format'

self.onmessage = async (event: MessageEvent<{ file: File; password: string }>) => {
  try {
    const { file, password } = event.data
    if (!(file instanceof Blob) || file.size > maxBackupFileBytes) throw new Error('Choose a smaller backup file.')
    self.postMessage({ ok: true, backup: await decodeBackup(await file.text(), password) })
  } catch (error) {
    self.postMessage({ ok: false, error: error instanceof SyntaxError ? 'This file is not valid JSON.' : error instanceof Error ? error.message : 'The backup could not be read.' })
  }
}
