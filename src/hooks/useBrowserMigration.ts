import { useEffect, useState } from "react"
import toast from "react-hot-toast"
import { migrateBrowserData } from "../lib/browser-legacy"

/** Moves pre-server IndexedDB data to the server once; resolves to true when the app can load projects. */
export function useBrowserMigration(enabled: boolean): { ready: boolean; error: string | null } {
  const [state, setState] = useState<{ ready: boolean; error: string | null }>({ ready: false, error: null })

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    migrateBrowserData()
      .then((result) => {
        if (cancelled) return
        if (result && result.imported > 0) toast.success(`${result.imported} proyek dari browser dipindahkan ke server`)
        if (result && result.skipped.length > 0) toast.error(`${result.skipped.length} proyek gagal dipindahkan: ${result.skipped.map((s) => s.name).join(", ")}`)
        setState({ ready: true, error: null })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ ready: false, error: error instanceof Error ? error.message : "Gagal memindahkan data browser" })
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  return state
}
