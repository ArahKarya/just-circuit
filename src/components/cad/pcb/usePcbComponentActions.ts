import { useCallback } from "react"
import toast from "react-hot-toast"
import { nextDesignator, type PcbCompView, type PcbScene } from "../../../lib/circuit-extract"
import { computeAlignment, type AlignAxis } from "../../../lib/pcb-cad-geometry"
import {
  deleteComponent,
  deleteElementSpan,
  duplicateComponent,
  patchBoardProps,
  patchComponentProps,
  roundMm,
  type PropPatchValue,
} from "../../../lib/tsx-ast"
import type { Project, ProjectFiles } from "../../../lib/types"
import { reportPatchFailure } from "../patch-feedback"
import type { PcbSelection } from "./usePcbSelection"

const MIN_BOARD_MM = 5
const DUPLICATE_OFFSET = { pcbDx: 3, pcbDy: 0 }

interface ManualSpan {
  path: string
  start: number
  end: number
}

interface UsePcbComponentActionsOptions {
  project: Project
  scene: PcbScene
  codeNames: readonly string[]
  manualTraces: readonly ManualSpan[]
  manualVias: readonly ManualSpan[]
  selection: PcbSelection
  onCommitFiles: (nextFiles: ProjectFiles) => void
}

/** Code edits on parts, the board outline and selected manual traces/vias. */
export function usePcbComponentActions({ project, scene, codeNames, manualTraces, manualVias, selection, onCommitFiles }: UsePcbComponentActionsOptions) {
  const { selectedNames, selectedTraceIdx, selectedViaIdx, setPrimarySelection, setSelectedTraceIdx, setSelectedViaIdx } = selection

  const handlePatch = useCallback(
    (name: string, patch: Record<string, PropPatchValue>) => {
      const res = patchComponentProps(project.files, name, patch)
      if (res.status === "updated") onCommitFiles(res.files)
      else reportPatchFailure(name, res)
    },
    [project.files, onCommitFiles],
  )

  const handleDelete = useCallback(
    (name: string) => {
      const res = deleteComponent(project.files, name, { removeConnectedTraces: true })
      if (res.status === "updated") {
        setPrimarySelection(null)
        onCommitFiles(res.files)
      }
    },
    [project.files, onCommitFiles, setPrimarySelection],
  )

  const handleDuplicate = useCallback(
    (name: string) => {
      const prefix = name.match(/^[A-Za-z]+/)?.[0] ?? "U"
      const nextName = nextDesignator(prefix, codeNames)
      const rendered = scene.components.find((c) => c.name === name)
      const base = rendered ? { pcbX: rendered.x, pcbY: rendered.y } : {}
      const res = duplicateComponent(project.files, name, nextName, DUPLICATE_OFFSET, base)
      if (res.status === "updated") {
        setPrimarySelection(nextName)
        onCommitFiles(res.files)
        toast.success(`${name} diduplikat menjadi ${nextName}`)
      }
    },
    [project.files, codeNames, scene.components, onCommitFiles, setPrimarySelection],
  )

  const alignSelected = useCallback(
    (axis: AlignAxis) => {
      if (selectedNames.length < 2) return
      const comps = selectedNames
        .map((n) => scene.components.find((c) => c.name === n))
        .filter((c): c is PcbCompView => Boolean(c))
      if (comps.length < 2) return
      const files = computeAlignment(comps, axis).reduce<ProjectFiles>((acc, { name, patch }) => {
        const r = patchComponentProps(acc, name, patch)
        return r.status === "updated" ? r.files : acc
      }, project.files)
      onCommitFiles(files)
    },
    [selectedNames, scene.components, project.files, onCommitFiles],
  )

  const deleteSelectedTraceOrVia = useCallback(() => {
    if (selectedTraceIdx !== null && manualTraces[selectedTraceIdx]) {
      const tr = manualTraces[selectedTraceIdx]
      const res = deleteElementSpan(project.files, tr.path, tr.start, tr.end)
      if (res.status === "updated") {
        setSelectedTraceIdx(null)
        onCommitFiles(res.files)
        toast.success("Manual copper trace dihapus")
      }
    } else if (selectedViaIdx !== null && manualVias[selectedViaIdx]) {
      const via = manualVias[selectedViaIdx]
      const res = deleteElementSpan(project.files, via.path, via.start, via.end)
      if (res.status === "updated") {
        setSelectedViaIdx(null)
        onCommitFiles(res.files)
        toast.success("Via dihapus")
      }
    }
  }, [selectedTraceIdx, selectedViaIdx, manualTraces, manualVias, project.files, onCommitFiles, setSelectedTraceIdx, setSelectedViaIdx])

  const applyBoardSize = useCallback(
    (widthText: string, heightText: string) => {
      const w = Number.parseFloat(widthText)
      const h = Number.parseFloat(heightText)
      if (!Number.isFinite(w) || !Number.isFinite(h) || w < MIN_BOARD_MM || h < MIN_BOARD_MM) return
      const res = patchBoardProps(project.files, project.entrypoint, { width: `${roundMm(w)}mm`, height: `${roundMm(h)}mm` })
      if (res.status === "updated") onCommitFiles(res.files)
    },
    [project.files, project.entrypoint, onCommitFiles],
  )

  return { handlePatch, handleDelete, handleDuplicate, alignSelected, deleteSelectedTraceOrVia, applyBoardSize }
}

export type PcbComponentActions = ReturnType<typeof usePcbComponentActions>
