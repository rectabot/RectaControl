import { useEffect } from 'react'
import { useStore } from './store'
import { t } from '@shared/i18n'

/** When the user clicks the window's X while a job is streaming, the main process
 *  vetoes the close and asks us first (main can't render UI). We pop the shared
 *  confirm; on "quit anyway" we tell main to close for real. */
export function useCloseGuard(): void {
  useEffect(() => {
    const off = window.recta.onCloseRequest(async () => {
      const lang = useStore.getState().lang
      const ok = await useStore.getState().askConfirm({
        title: t('ui.quit.title', lang),
        body: t('ui.quit.body', lang),
        confirmLabel: t('ui.quit.confirm', lang),
        cancelLabel: t('ui.quit.cancel', lang)
      })
      if (ok) window.recta.confirmClose()
    })
    return off
  }, [])
}
