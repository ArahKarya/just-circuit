import { useState, type PointerEvent as ReactPointerEvent } from "react"
import type { PcbCompView, PcbScene, Point2D } from "../../../lib/circuit-extract"
import { snapPointToGrid, snapToGrid, snapToPadOrGrid } from "../../../lib/pcb-cad-geometry"
import { dimensionElement, isPlacementTool, placementElement } from "../../../lib/pcb-cad-placement"
import { addVia, insertIntoBoard, type PatchResult } from "../../../lib/tsx-ast"
import type { Project, ProjectFiles } from "../../../lib/types"
import type { PcbTool } from "./constants"
import type { PcbComponentActions } from "./usePcbComponentActions"
import type { PcbDrawing } from "./usePcbDrawing"
import type { PcbSelection } from "./usePcbSelection"
import type { PcbToolSettings, PcbViewOptions } from "./usePcbSettings"
import type { PcbViewport } from "./usePcbViewport"

export interface ComponentDrag {
  name: string
  startMm: Point2D
  origX: number
  origY: number
  curX: number
  curY: number
}

interface PanDrag {
  startScreen: Point2D
  startPan: Point2D
}

/** Tools whose cursor snaps to pads as well as the grid. */
const PAD_SNAP_TOOLS: ReadonlySet<PcbTool> = new Set<PcbTool>(["route", "via", "measure", "dimension"])

interface UsePcbPointerOptions {
  project: Project
  scene: PcbScene
  codeNames: readonly string[]
  settings: PcbToolSettings
  view: PcbViewOptions
  viewport: PcbViewport
  drawing: PcbDrawing
  selection: PcbSelection
  actions: PcbComponentActions
  onCommitFiles: (nextFiles: ProjectFiles) => void
}

/** Canvas pointer handling: tool clicks, component drag, panning and cursor tracking. */
export function usePcbPointer(options: UsePcbPointerOptions) {
  const { project, scene, codeNames, settings, view, viewport, drawing, selection, actions, onCommitFiles } = options
  const { tool, gridMm, activeLayer, traceNet, silkText } = settings
  const { pan, setPan, screenToMm } = viewport
  const [drag, setDrag] = useState<ComponentDrag | null>(null)
  const [panDrag, setPanDrag] = useState<PanDrag | null>(null)

  const commitIfUpdated = (res: PatchResult) => {
    if (res.status === "updated") onCommitFiles(res.files)
  }

  const handleRouteClick = (event: ReactPointerEvent, snapped: Point2D) => {
    if (event.detail === 2 && drawing.routePts.length >= 2) drawing.commitCurrentRoute()
    else drawing.addRoutePoint(snapped)
  }

  const handleDimensionClick = (snapped: Point2D) => {
    if (!drawing.dimStart) {
      drawing.setDimStart(snapped)
      return
    }
    commitIfUpdated(insertIntoBoard(project.files, project.entrypoint, dimensionElement(drawing.dimStart, snapped)))
    drawing.setDimStart(null)
  }

  const handleCanvasPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || event.shiftKey) {
      setPanDrag({ startScreen: { x: event.clientX, y: event.clientY }, startPan: pan })
      return
    }
    if (event.button !== 0) return
    const snapped = snapToPadOrGrid(screenToMm(event.clientX, event.clientY), scene.components, gridMm)

    if (tool === "route") return handleRouteClick(event, snapped)
    if (tool === "via") {
      const net = traceNet.trim() || undefined
      return commitIfUpdated(addVia(project.files, project.entrypoint, snapped.x, snapped.y, { fromLayer: "top", toLayer: "bottom", net }))
    }
    if (isPlacementTool(tool)) {
      const element = placementElement(tool, snapped, { existingNames: codeNames, silkText, layer: activeLayer })
      return commitIfUpdated(insertIntoBoard(project.files, project.entrypoint, element))
    }
    if (tool === "dimension") return handleDimensionClick(snapped)
    if (tool === "measure") {
      drawing.setMeasureStart((prev) => (prev ? null : snapped))
      return
    }
    selection.setPrimarySelection(null)
    selection.setHighlightedNet(null)
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const raw = screenToMm(event.clientX, event.clientY)
    drawing.setCursorMm(PAD_SNAP_TOOLS.has(tool) ? snapToPadOrGrid(raw, scene.components, gridMm) : snapPointToGrid(raw, gridMm))

    if (panDrag) {
      setPan({
        x: panDrag.startPan.x + (event.clientX - panDrag.startScreen.x),
        y: panDrag.startPan.y + (event.clientY - panDrag.startScreen.y),
      })
      return
    }
    if (drag) {
      const dx = raw.x - drag.startMm.x
      const dy = raw.y - drag.startMm.y
      setDrag({ ...drag, curX: snapToGrid(drag.origX + dx, gridMm), curY: snapToGrid(drag.origY + dy, gridMm) })
    }
  }

  const handlePointerUp = () => {
    if (panDrag) {
      setPanDrag(null)
      return
    }
    if (drag) {
      if (drag.curX !== drag.origX || drag.curY !== drag.origY) {
        actions.handlePatch(drag.name, { pcbX: drag.curX, pcbY: drag.curY })
      }
      setDrag(null)
    }
  }

  const handleCompPointerDown = (event: ReactPointerEvent, comp: PcbCompView) => {
    if (tool !== "select" || !view.filterComp || event.button !== 0 || event.shiftKey) return
    event.stopPropagation()
    if (event.altKey || event.metaKey || event.ctrlKey) {
      selection.toggleComponent(comp.name)
      return
    }
    selection.setPrimarySelection(comp.name)
    const raw = screenToMm(event.clientX, event.clientY)
    setDrag({ name: comp.name, startMm: raw, origX: comp.x, origY: comp.y, curX: comp.x, curY: comp.y })
  }

  return { drag, isPanning: panDrag !== null, handleCanvasPointerDown, handlePointerMove, handlePointerUp, handleCompPointerDown }
}

export type PcbPointer = ReturnType<typeof usePcbPointer>
