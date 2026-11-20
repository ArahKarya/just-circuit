import { useCallback, useEffect, useRef, useState } from "react"
import type { ProjectFiles } from "../lib/types"

const MAX_UNDO_STEPS = 50

export interface UndoStack {
  canUndo: boolean
  canRedo: boolean
  /** Record the `before` files snapshot before applying a manual edit. */
  record: (before: ProjectFiles) => void
  /** Pops the last snapshot (passing the current files for redo) and returns it. */
  undo: (current: ProjectFiles) => ProjectFiles | null
  /** Re-applies the last undone snapshot (passing current files for undo) and returns it. */
  redo: (current: ProjectFiles) => ProjectFiles | null
  clear: () => void
}

/** In-memory undo/redo stack for interactive visual CAD edits, reset on project switch. */
export function useUndoStack(projectId: string | undefined): UndoStack {
  const [past, setPast] = useState<ProjectFiles[]>([])
  const [future, setFuture] = useState<ProjectFiles[]>([])
  const pastRef = useRef(past)
  const futureRef = useRef(future)
  pastRef.current = past
  futureRef.current = future

  useEffect(() => {
    setPast([])
    setFuture([])
  }, [projectId])

  const record = useCallback((before: ProjectFiles) => {
    setPast((prev) => [...prev.slice(-(MAX_UNDO_STEPS - 1)), before])
    setFuture([])
  }, [])

  const undo = useCallback((current: ProjectFiles): ProjectFiles | null => {
    const stack = pastRef.current
    if (stack.length === 0) return null
    const previous = stack[stack.length - 1]
    setPast(stack.slice(0, -1))
    setFuture((prev) => [...prev.slice(-(MAX_UNDO_STEPS - 1)), current])
    return previous
  }, [])

  const redo = useCallback((current: ProjectFiles): ProjectFiles | null => {
    const stack = futureRef.current
    if (stack.length === 0) return null
    const next = stack[stack.length - 1]
    setFuture(stack.slice(0, -1))
    setPast((prev) => [...prev.slice(-(MAX_UNDO_STEPS - 1)), current])
    return next
  }, [])

  const clear = useCallback(() => {
    setPast([])
    setFuture([])
  }, [])

  return {
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    record,
    undo,
    redo,
    clear,
  }
}
