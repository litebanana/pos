import { useEffect, useState } from 'react'
interface InstallEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}
export function useInstall() {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null)
  const [installed, setInstalled] = useState(window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true)
  useEffect(() => {
    const before = (event: Event) => { event.preventDefault(); setPrompt(event as InstallEvent) }
    const after = () => { setInstalled(true); setPrompt(null) }
    window.addEventListener('beforeinstallprompt', before)
    window.addEventListener('appinstalled', after)
    return () => { window.removeEventListener('beforeinstallprompt', before); window.removeEventListener('appinstalled', after) }
  }, [])
  async function install() {
    if (!prompt) return false
    await prompt.prompt()
    const choice = await prompt.userChoice
    setPrompt(null)
    return choice.outcome === 'accepted'
  }
  return { canInstall: !!prompt, installed, install }
}
