import { useCallback, useMemo, useState } from "react"
import type { Point2D } from "../../../lib/circuit-extract"
import { miter45Point, polylineLength } from "../../../lib/pcb-cad-geometry"
import { addPcbTrace, type PcbRoutePoint } from "../../../lib/tsx-ast"
import type { Project, ProjectFiles } from "../../../lib/types"
import { otherLayer } from "./constants"
import type { PcbToolSettings } from "./usePcbSettings"

interface UsePcbDrawingOptions {
  project: Project
  settings: PcbToolSettings
  onCommitFiles: (nextFiles: ProjectFiles) => void
}

/** In-progress route, measurement and dimension drawings plus the snapped cursor. */
export function usePcbDrawing({ project, settings, onCommitFiles }: UsePcbDrawingOptions) {
  const { tool, activeLayer, setActiveLayer, traceWidth, traceNet, miter45, diagFirst } = settings
  const [routePts, setRoutePts] = useState<PcbRoutePoint[]>([])
  const [measureStart, setMeasureStart] = useState<Point2D | null>(null)
  const [dimStart, setDimStart] = useState<Point2D | null>(null)
  const [cursorMm, setCursorMm] = useState<Point2D>({ x: 0, y: 0 })

  const resetDrawing = useCallback(() => {
    setRoutePts([])
    setMeasureStart(null)
    setDimStart(null)
  }, [])

  const commitCurrentRoute = useCallback(() => {
    if (routePts.length < 2) {
      setRoutePts([])
      return
    }
    const res = addPcbTrace(project.files, project.entrypoint, routePts, {
      layer: activeLayer,
      width: traceWidth,
      net: traceNet.trim() || undefined,
    })
    if (res.status === "updated") onCommitFiles(res.files)
    setRoutePts([])
  }, [routePts, project.files, project.entrypoint, activeLayer, traceWidth, traceNet, onCommitFiles])

  /** Adds a clicked point, inserting a 45° elbow first when mitering applies. */
  const addRoutePoint = useCallback(
    (snapped: Point2D) => {
      const point = { x: snapped.x, y: snapped.y, layer: activeLayer, width: traceWidth }
      const last = routePts[routePts.length - 1]
      const elbow = last && miter45 ? miter45Point(last, snapped, diagFirst) : null
      setRoutePts((pts) => (elbow ? [...pts, { x: elbow.x, y: elbow.y, layer: activeLayer, width: traceWidth }, point] : [...pts, point]))
    },
    [routePts, miter45, diagFirst, activeLayer, traceWidth],
  )

  /** KiCad "V" while routing: drop a via at the last point and continue on the other layer. */
  const addLayerSwitchVia = useCallback(() => {
    const last = routePts[routePts.length - 1]
    if (!last) return
    const nextLayer = otherLayer(activeLayer)
    setRoutePts((pts) => [...pts, { x: last.x, y: last.y, layer: nextLayer, via: true }])
    setActiveLayer(nextLayer)
  }, [routePts, activeLayer, setActiveLayer])

  const previewRoutePts = useMemo(() => {
    if (tool !== "route" || routePts.length === 0) return []
    const last = routePts[routePts.length - 1]
    const elbow = miter45 ? miter45Point(last, cursorMm, diagFirst) : null
    return elbow ? [...routePts, elbow, cursorMm] : [...routePts, cursorMm]
  }, [tool, routePts, cursorMm, miter45, diagFirst])

  const activeRouteLenMm = useMemo(() => polylineLength(previewRoutePts), [previewRoutePts])

  return {
    routePts,
    setRoutePts,
    measureStart,
    setMeasureStart,
    dimStart,
    setDimStart,
    cursorMm,
    setCursorMm,
    resetDrawing,
    commitCurrentRoute,
    addRoutePoint,
    addLayerSwitchVia,
    previewRoutePts,
    activeRouteLenMm,
  }
}

export type PcbDrawing = ReturnType<typeof usePcbDrawing>
