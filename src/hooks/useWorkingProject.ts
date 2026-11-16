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
  /** Saves run one after another so an older snapshot can never land after a newer one. */
  const queue = useRef<Promise<void>>(Promise.resolve())
  const inFlight = useRef(0)
  const latest = useRef(project)
  latest.current = project

  const enqueue = useCallback(
    (next: Project, commitMessage?: string): Promise<void> => {
      inFlight.current += 1
      const run = queue.current.then(() => save(next, commitMessage))
      queue.current = run.catch(() => undefined)
      return run.finally(() => {
        inFlight.current -= 1
      })
    },
    [save],
  )

  const flushNow = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const next = pending.current
    pending.current = null
    if (next) await enqueue(next)
    else await queue.current
  }, [enqueue])

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

  // Take the server copy when it is reloaded (restored version, terminal) unless local changes are
  // still pending or being saved; the name always comes from the server (it changes only by rename).
  useEffect(() => {
    if (!stored) return
    if (!pending.current && inFlight.current === 0) {
      setProject(stored)
      return
    }
    setProject((current) => (current && current.id === stored.id ? { ...current, name: stored.name } : current))
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
      await enqueue(next, commitMessage)
    },
    [enqueue],
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
