import { useCallback, useEffect, useRef, useState } from "react"
import toast from "react-hot-toast"
import type { Project } from "../lib/types"

const SAVE_DELAY_MS = 400

function reportSaveError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Gagal menyimpan proyek"
  toast.error(`Perubahan belum tersimpan: ${message}`)
}

export interface WorkingProject {
  project: Project | undefined
  /** Local edit (typing); saved after a short pause. */
  edit: (next: Project) => void
  /** Replace the project and save immediately (AI changes, imports, undo); a message records a version. */
  apply: (next: Project, commitMessage?: string) => Promise<void>
  /** Saves pending typing right away (before history operations). */
  flush: () => Promise<void>
  /** Like apply, but derives the next project from the latest in-memory copy. */
  update: (change: (current: Project) => Project) => Promise<void>
}

/**
 * Keeps an in-memory copy of the active project so typing stays responsive,
 * and writes it back to IndexedDB in the background.
 */
export function useWorkingProject(stored: Project | undefined, save: (project: Project, commitMessage?: string) => Promise<void>): WorkingProject {
  const [project, setProject] = useState<Project | undefined>(stored)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pending = useRef<Project | null>(null)
  const latest = useRef(project)
  latest.current = project

  const flushNow = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    if (next) await save(next)
  }, [save])

  const flush = useCallback(() => {
    flushNow().catch((error: unknown) => reportSaveError(error))
  }, [flushNow])

  // Switch to another project: save the old one first.
  useEffect(() => {
    flush()
    setProject(stored)
    // Only react to a different project id; content updates come from this hook itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stored?.id])

  // Take the server copy when it is reloaded (rename, restored version, terminal) unless typing is pending.
  useEffect(() => {
    if (stored && !pending.current) setProject(stored)
  }, [stored])

  useEffect(() => flush, [flush])

  const edit = useCallback(
    (next: Project) => {
      setProject(next)
      pending.current = next
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(flush, SAVE_DELAY_MS)
    },
    [flush],
  )

  const apply = useCallback(
    async (next: Project, commitMessage?: string) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = null
      pending.current = null
      setProject(next)
      await save(next, commitMessage)
    },
    [save],
  )

  const update = useCallback(
    async (change: (current: Project) => Project) => {
      if (!latest.current) return
      const next = change(latest.current)
      latest.current = next
      await apply(next)
    },
    [apply],
  )

  return { project, edit, apply, update, flush: flushNow }
}
