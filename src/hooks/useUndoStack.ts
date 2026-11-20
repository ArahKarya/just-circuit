import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { EMPTY_HISTORY, recordEdit, redoEdit, undoEdit, type StepResult, type UndoHistory } from "../lib/undo-history"
import type { ProjectFiles } from "../lib/types"

export type UndoStepResult = { status: "empty" } | { status: "conflict"; paths: string[] } | { status: "ok"; files: ProjectFiles }

export interface UndoStack {
  canUndo: boolean
  canRedo: boolean
  /** Records a manual CAD edit as the files it changed (no-op edits are ignored). */
  record: (before: ProjectFiles, after: ProjectFiles) => void
  /** Reverts the last edit on top of `current`, refusing if a touched file changed since. */
  undo: (current: ProjectFiles) => UndoStepResult
  /** Re-applies the last undone edit on top of `current`, with the same check. */
  redo: (current: ProjectFiles) => UndoStepResult
  clear: () => void
}

/**
 * In-memory undo/redo for interactive CAD edits, reset on project switch. The history lives in a
 * ref so rapid key presses always see the latest stack; state only drives re-rendering.
 */
export function useUndoStack(projectId: string | undefined): UndoStack {
  const history = useRef<UndoHistory>(EMPTY_HISTORY)
  const [snapshot, setSnapshot] = useState<UndoHistory>(EMPTY_HISTORY)

  const set = useCallback((next: UndoHistory) => {
    history.current = next
    setSnapshot(next)
  }, [])

  useEffect(() => set(EMPTY_HISTORY), [projectId, set])

  const record = useCallback((before: ProjectFiles, after: ProjectFiles) => set(recordEdit(history.current, before, after)), [set])

  const finish = useCallback(
    (result: StepResult): UndoStepResult => {
      if (result.status !== "ok") return result
      set(result.history)
      return { status: "ok", files: result.files }
    },
    [set],
  )

  const undo = useCallback((current: ProjectFiles) => finish(undoEdit(history.current, current)), [finish])
  const redo = useCallback((current: ProjectFiles) => finish(redoEdit(history.current, current)), [finish])
  const clear = useCallback(() => set(EMPTY_HISTORY), [set])

  const canUndo = snapshot.past.length > 0
  const canRedo = snapshot.future.length > 0
  return useMemo(() => ({ canUndo, canRedo, record, undo, redo, clear }), [canUndo, canRedo, record, undo, redo, clear])
}
