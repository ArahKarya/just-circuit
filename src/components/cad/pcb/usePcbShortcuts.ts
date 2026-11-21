import { useEffect } from "react"
import { classifyCadShortcut } from "../../../lib/cad-shortcuts"
import { inspectComponent } from "../../../lib/tsx-ast"
import type { Project } from "../../../lib/types"
import type { PcbComponentActions } from "./usePcbComponentActions"
import type { PcbDrawing } from "./usePcbDrawing"
import type { PcbSelection } from "./usePcbSelection"
import type { PcbToolSettings } from "./usePcbSettings"

interface UsePcbShortcutsOptions {
  project: Project
  settings: PcbToolSettings
  drawing: PcbDrawing
  selection: PcbSelection
  actions: PcbComponentActions
  onUndo: () => void
  onRedo: () => void
}

/** KiCad Pcbnew-style keyboard shortcuts (X route, V via/select, H hole, D measure, R rotate, F flip, Del). */
export function usePcbShortcuts({ project, settings, drawing, selection, actions, onUndo, onRedo }: UsePcbShortcutsOptions) {
  const { tool, setTool, setDiagFirst } = settings
  const { routePts, setRoutePts, measureStart, setMeasureStart, dimStart, setDimStart, commitCurrentRoute, addLayerSwitchVia } = drawing
  const { selectedName, selectedTraceIdx, selectedViaIdx } = selection
  const { handlePatch, handleDelete, deleteSelectedTraceOrVia } = actions

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const shortcut = classifyCadShortcut(event)
      if (shortcut.kind === "ignore") return
      if (shortcut.kind === "undo" || shortcut.kind === "redo") {
        event.preventDefault()
        if (shortcut.kind === "redo") onRedo()
        else onUndo()
        return
      }
      const key = shortcut.key
      if (key === "escape") {
        if (routePts.length > 0) setRoutePts([])
        else if (measureStart) setMeasureStart(null)
        else if (dimStart) setDimStart(null)
        else setTool("select")
      } else if (key === "enter" && tool === "route" && routePts.length >= 2) {
        event.preventDefault()
        commitCurrentRoute()
      } else if (key === "/" && tool === "route") {
        event.preventDefault()
        setDiagFirst((v) => !v)
      } else if (key === "v") {
        if (tool === "route" && routePts.length > 0) addLayerSwitchVia()
        else setTool("select")
      } else if (key === "x") {
        setTool("route")
      } else if (key === "h") {
        setTool("hole")
      } else if (key === "d") {
        setTool("measure")
        setMeasureStart(null)
      } else if (key === "r" && selectedName) {
        event.preventDefault()
        const comp = inspectComponent(project.files, selectedName)
        handlePatch(selectedName, { pcbRotation: ((comp?.pcbRotation ?? 0) + 90) % 360 })
      } else if (key === "f" && selectedName) {
        event.preventDefault()
        const comp = inspectComponent(project.files, selectedName)
        handlePatch(selectedName, { layer: comp?.layer === "bottom" ? "top" : "bottom" })
      } else if (key === "delete" || key === "backspace") {
        if (selectedName) {
          event.preventDefault()
          handleDelete(selectedName)
        } else if (selectedTraceIdx !== null || selectedViaIdx !== null) {
          event.preventDefault()
          deleteSelectedTraceOrVia()
        }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [
    tool,
    routePts,
    measureStart,
    dimStart,
    selectedName,
    selectedTraceIdx,
    selectedViaIdx,
    project.files,
    handlePatch,
    handleDelete,
    commitCurrentRoute,
    deleteSelectedTraceOrVia,
    addLayerSwitchVia,
    onUndo,
    onRedo,
    setTool,
    setDiagFirst,
    setRoutePts,
    setMeasureStart,
    setDimStart,
  ])
}
