import {
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyStart,
  Check,
  Circle,
  CircleDot,
  Copy,
  Crosshair,
  Flame,
  FlipHorizontal2,
  GitBranch,
  Grid3x3,
  Layers,
  Maximize2,
  MousePointer2,
  Plus,
  Redo2,
  RotateCw,
  Ruler,
  Scissors,
  Spline,
  SquareDashed,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react"
import toast from "react-hot-toast"
import { classifyCadShortcut } from "../../lib/cad-shortcuts"
import { extractPcbScene, nextDesignator, type PcbCompView, type Point2D } from "../../lib/circuit-extract"
import { simulateCircuit } from "../../lib/circuit-sim"
import { calcTraceMaxCurrent } from "../../lib/pcb-calc"
import {
  addCopperPour,
  addDifferentialPair,
  addPcbTrace,
  addVia,
  deleteComponent,
  deleteElementSpan,
  duplicateComponent,
  inspectComponent,
  insertIntoBoard,
  jsxStringValue,
  listComponents,
  listCopperPours,
  listManualPcbTraces,
  listManualVias,
  patchBoardProps,
  patchComponentProps,
  roundMm,
  type PcbRoutePoint,
  type PropPatchValue,
} from "../../lib/tsx-ast"
import type { Project, ProjectFiles } from "../../lib/types"
import { Button, IconButton } from "../ui"
import { PropertyInspector } from "./PropertyInspector"
import { reportPatchFailure } from "./patch-feedback"

type PcbTool = "select" | "route" | "via" | "hole" | "cutout" | "fiducial" | "testpoint" | "silktext" | "dimension" | "measure"
type CopperLayer = "top" | "bottom"

const GRID_OPTIONS = [0.1, 0.25, 0.5, 1, 2.54] as const
const WIDTH_OPTIONS = [0.15, 0.2, 0.25, 0.4, 0.6, 1.0, 1.5] as const

interface PcbCadEditorProps {
  project: Project
  circuitJson: unknown[]
  selectedComponent?: string | null
  onSelectComponent?: (name: string | null) => void
  lockedComponents?: ReadonlySet<string>
  onToggleLock?: (name: string) => void
  onCommitFiles: (nextFiles: ProjectFiles) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onRevealCode?: (name: string) => void
  onAskAi?: (componentName: string) => void
  onDone: () => void
}

const LAYER_COLOR: Record<string, string> = {
  top: "#ef4444",
  bottom: "#3b82f6",
  all: "#eab308",
}

/** Computes a KiCad-style 45° mitered elbow point between `from` and `to`. */
function miter45Point(from: Point2D, to: Point2D, diagFirst: boolean): Point2D | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const adx = Math.abs(dx)
  const ady = Math.abs(dy)
  if (adx < 0.05 || ady < 0.05 || Math.abs(adx - ady) < 0.05) return null
  const diag = Math.min(adx, ady)
  const sx = Math.sign(dx)
  const sy = Math.sign(dy)
  if (diagFirst) {
    return { x: roundMm(from.x + sx * diag), y: roundMm(from.y + sy * diag) }
  }
  return adx > ady
    ? { x: roundMm(from.x + sx * (adx - diag)), y: roundMm(from.y) }
    : { x: roundMm(from.x), y: roundMm(from.y + sy * (ady - diag)) }
}

function polylineLength(points: readonly Point2D[]): number {
  let len = 0
  for (let i = 1; i < points.length; i += 1) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return len
}

export function PcbCadEditor({
  project,
  circuitJson,
  selectedComponent,
  onSelectComponent,
  lockedComponents,
  onToggleLock,
  onCommitFiles,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onRevealCode,
  onAskAi,
  onDone,
}: PcbCadEditorProps) {
  const scene = useMemo(() => extractPcbScene(circuitJson), [circuitJson])
  const codeComponents = useMemo(() => listComponents(project.files), [project.files])
  const copperPours = useMemo(() => listCopperPours(project.files), [project.files])
  const manualTraces = useMemo(() => listManualPcbTraces(project.files), [project.files])
  const manualVias = useMemo(() => listManualVias(project.files), [project.files])

  const [tool, setTool] = useState<PcbTool>("select")
  const [gridMm, setGridMm] = useState<number>(0.5)
  const [activeLayer, setActiveLayer] = useState<CopperLayer>("top")
  const [traceWidth, setTraceWidth] = useState<number>(0.25)
  const [traceNet, setTraceNet] = useState("")
  const [miter45, setMiter45] = useState(true)
  const [diagFirst, setDiagFirst] = useState(false)
  const [silkText, setSilkText] = useState("REV 1.0")

  // Layer visibility & overlays
  const [showTop, setShowTop] = useState(true)
  const [showBottom, setShowBottom] = useState(true)
  const [showRatsnest, setShowRatsnest] = useState(true)
  const [showHeatmap, setShowHeatmap] = useState(false)

  // Selection Filter (KiCad 9)
  const [filterComp, setFilterComp] = useState(true)
  const [filterTrace, setFilterTrace] = useState(true)
  const [filterVia, setFilterVia] = useState(true)

  // Popover drawers inside PCB CAD
  const [showZones, setShowZones] = useState(false)
  const [zoneNet, setZoneNet] = useState("GND")
  const [zoneLayer, setZoneLayer] = useState<CopperLayer>("bottom")
  const [showDiffPair, setShowDiffPair] = useState(false)
  const [dpName, setDpName] = useState("USB")
  const [dpPos, setDpPos] = useState("USB_DP")
  const [dpNeg, setDpNeg] = useState("USB_DM")
  const [dpSkew, setDpSkew] = useState(0.05)

  // Selection (single + multi + manual trace/via + highlighted net)
  const [selectedNames, setSelectedNames] = useState<string[]>(() => (selectedComponent ? [selectedComponent] : []))
  const [selectedTraceIdx, setSelectedTraceIdx] = useState<number | null>(null)
  const [selectedViaIdx, setSelectedViaIdx] = useState<number | null>(null)
  const [highlightedNet, setHighlightedNet] = useState<string | null>(null)

  const selectedName = selectedNames.length === 1 ? selectedNames[0] : null

  useEffect(() => {
    if (selectedComponent && !selectedNames.includes(selectedComponent)) {
      setSelectedNames([selectedComponent])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedComponent])

  const setPrimarySelection = useCallback(
    (name: string | null) => {
      setSelectedNames(name ? [name] : [])
      setSelectedTraceIdx(null)
      setSelectedViaIdx(null)
      onSelectComponent?.(name)
    },
    [onSelectComponent],
  )

  const [boardW, setBoardW] = useState(() => String(roundMm(scene.board.width)))
  const [boardH, setBoardH] = useState(() => String(roundMm(scene.board.height)))

  // Active drawings
  const [routePts, setRoutePts] = useState<PcbRoutePoint[]>([])
  const [measureStart, setMeasureStart] = useState<Point2D | null>(null)
  const [dimStart, setDimStart] = useState<Point2D | null>(null)

  const [cursorMm, setCursorMm] = useState<Point2D>({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ name: string; startMm: Point2D; origX: number; origY: number; curX: number; curY: number } | null>(null)
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(14)
  const [panDrag, setPanDrag] = useState<{ startScreen: Point2D; startPan: Point2D } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  // Compute simulation current for Heatmap mode only when toggled on
  const simCurrentA = useMemo(() => {
    if (!showHeatmap) return 0
    const report = simulateCircuit(circuitJson)
    return report.totalCurrentMa / 1000
  }, [showHeatmap, circuitJson])

  useEffect(() => {
    setBoardW(String(roundMm(scene.board.width)))
    setBoardH(String(roundMm(scene.board.height)))
  }, [scene.board.width, scene.board.height])

  const selectedSummary = useMemo(
    () => (selectedName ? inspectComponent(project.files, selectedName) : null),
    [project.files, selectedName],
  )

  const snapMm = useCallback((v: number) => roundMm(Math.round(v / gridMm) * gridMm), [gridMm])

  const fitView = useCallback(() => {
    const el = svgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const scale = Math.max(4, Math.min(48, Math.min((rect.width * 0.78) / Math.max(10, scene.board.width), (rect.height * 0.78) / Math.max(10, scene.board.height))))
    setZoom(scale)
    setPan({ x: -scene.board.center.x * scale, y: scene.board.center.y * scale })
  }, [scene.board])

  useEffect(() => {
    fitView()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const screenToMm = useCallback(
    (clientX: number, clientY: number): Point2D => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      const sx = clientX - rect.left - rect.width / 2 - pan.x
      const sy = clientY - rect.top - rect.height / 2 - pan.y
      return { x: sx / zoom, y: -sy / zoom }
    },
    [pan, zoom],
  )

  const snapToPadOrGrid = useCallback(
    (pt: Point2D): Point2D => {
      for (const comp of scene.components) {
        for (const pad of comp.pads) {
          if (Math.hypot(pad.x - pt.x, pad.y - pt.y) <= Math.max(0.5, gridMm * 0.8)) {
            return { x: roundMm(pad.x), y: roundMm(pad.y) }
          }
        }
      }
      return { x: snapMm(pt.x), y: snapMm(pt.y) }
    },
    [scene.components, gridMm, snapMm],
  )

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
      const nextName = nextDesignator(prefix, codeComponents.map((c) => c.name))
      const res = duplicateComponent(project.files, name, nextName, { pcbDx: 3, pcbDy: 0 })
      if (res.status === "updated") {
        setPrimarySelection(nextName)
        onCommitFiles(res.files)
        toast.success(`${name} diduplikat menjadi ${nextName}`)
      }
    },
    [project.files, codeComponents, onCommitFiles, setPrimarySelection],
  )

  const alignSelected = useCallback(
    (axis: "left" | "top" | "distX" | "distY") => {
      if (selectedNames.length < 2) return
      const comps = selectedNames
        .map((n) => scene.components.find((c) => c.name === n))
        .filter((c): c is PcbCompView => Boolean(c))
      if (comps.length < 2) return
      let files: ProjectFiles = project.files
      if (axis === "left") {
        const minX = Math.min(...comps.map((c) => c.x))
        for (const c of comps) {
          const r = patchComponentProps(files, c.name, { pcbX: roundMm(minX) })
          if (r.status === "updated") files = r.files
        }
      } else if (axis === "top") {
        const maxY = Math.max(...comps.map((c) => c.y))
        for (const c of comps) {
          const r = patchComponentProps(files, c.name, { pcbY: roundMm(maxY) })
          if (r.status === "updated") files = r.files
        }
      } else if (axis === "distX") {
        const sorted = [...comps].sort((a, b) => a.x - b.x)
        const minX = sorted[0].x
        const step = (sorted[sorted.length - 1].x - minX) / (sorted.length - 1)
        sorted.forEach((c, i) => {
          const r = patchComponentProps(files, c.name, { pcbX: roundMm(minX + step * i) })
          if (r.status === "updated") files = r.files
        })
      } else if (axis === "distY") {
        const sorted = [...comps].sort((a, b) => b.y - a.y)
        const maxY = sorted[0].y
        const step = (maxY - sorted[sorted.length - 1].y) / (sorted.length - 1)
        sorted.forEach((c, i) => {
          const r = patchComponentProps(files, c.name, { pcbY: roundMm(maxY - step * i) })
          if (r.status === "updated") files = r.files
        })
      }
      onCommitFiles(files)
    },
    [selectedNames, scene.components, project.files, onCommitFiles],
  )

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
  }, [selectedTraceIdx, selectedViaIdx, manualTraces, manualVias, project.files, onCommitFiles])

  // KiCad-style PCB shortcuts
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
        if (tool === "route" && routePts.length > 0) {
          const nextLayer: CopperLayer = activeLayer === "top" ? "bottom" : "top"
          const last = routePts[routePts.length - 1]
          setRoutePts((pts) => [...pts, { x: last.x, y: last.y, layer: nextLayer, via: true }])
          setActiveLayer(nextLayer)
        } else {
          setTool("select")
        }
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
        const cur = comp?.pcbRotation ?? 0
        handlePatch(selectedName, { pcbRotation: (cur + 90) % 360 })
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
    activeLayer,
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
    onUndo,
    onRedo,
  ])

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.12 : 0.89
    setZoom((z) => Math.max(3, Math.min(80, z * factor)))
  }

  const previewRoutePts = useMemo(() => {
    if (tool !== "route" || routePts.length === 0) return []
    const last = routePts[routePts.length - 1]
    const elbow = miter45 ? miter45Point(last, cursorMm, diagFirst) : null
    return elbow ? [...routePts, elbow, cursorMm] : [...routePts, cursorMm]
  }, [tool, routePts, cursorMm, miter45, diagFirst])

  const activeRouteLenMm = useMemo(() => polylineLength(previewRoutePts), [previewRoutePts])
  const maxAmpForWidth = useMemo(() => calcTraceMaxCurrent(traceWidth, 10, 1, false), [traceWidth])

  const handleCanvasPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || event.shiftKey) {
      setPanDrag({ startScreen: { x: event.clientX, y: event.clientY }, startPan: pan })
      return
    }
    if (event.button !== 0) return
    const raw = screenToMm(event.clientX, event.clientY)
    const snapped = snapToPadOrGrid(raw)

    if (tool === "route") {
      if (event.detail === 2 && routePts.length >= 2) {
        commitCurrentRoute()
        return
      }
      if (routePts.length > 0 && miter45) {
        const last = routePts[routePts.length - 1]
        const elbow = miter45Point(last, snapped, diagFirst)
        if (elbow) {
          setRoutePts((pts) => [
            ...pts,
            { x: elbow.x, y: elbow.y, layer: activeLayer, width: traceWidth },
            { x: snapped.x, y: snapped.y, layer: activeLayer, width: traceWidth },
          ])
          return
        }
      }
      setRoutePts((pts) => [...pts, { x: snapped.x, y: snapped.y, layer: activeLayer, width: traceWidth }])
      return
    }

    if (tool === "via") {
      const res = addVia(project.files, project.entrypoint, snapped.x, snapped.y, {
        fromLayer: "top",
        toLayer: "bottom",
        net: traceNet.trim() || undefined,
      })
      if (res.status === "updated") onCommitFiles(res.files)
      return
    }

    if (tool === "hole") {
      const res = insertIntoBoard(project.files, project.entrypoint, `<hole diameter="3.2mm" pcbX={${snapped.x}} pcbY={${snapped.y}} />`)
      if (res.status === "updated") onCommitFiles(res.files)
      return
    }

    if (tool === "cutout") {
      const res = insertIntoBoard(project.files, project.entrypoint, `<cutout shape="rect" width="4mm" height="2mm" pcbX={${snapped.x}} pcbY={${snapped.y}} />`)
      if (res.status === "updated") onCommitFiles(res.files)
      return
    }

    if (tool === "fiducial") {
      const name = nextDesignator("FID", codeComponents.map((c) => c.name))
      const res = insertIntoBoard(project.files, project.entrypoint, `<fiducial name=${jsxStringValue(name)} padDiameter="1mm" pcbX={${snapped.x}} pcbY={${snapped.y}} />`)
      if (res.status === "updated") onCommitFiles(res.files)
      return
    }

    if (tool === "testpoint") {
      const name = nextDesignator("TP", codeComponents.map((c) => c.name))
      const res = insertIntoBoard(project.files, project.entrypoint, `<testpoint name=${jsxStringValue(name)} padVariant="pad" footprintVariant="pad" padDiameter="1.2mm" pcbX={${snapped.x}} pcbY={${snapped.y}} />`)
      if (res.status === "updated") onCommitFiles(res.files)
      return
    }

    if (tool === "silktext") {
      const txt = silkText.trim() || "TEXT"
      const res = insertIntoBoard(project.files, project.entrypoint, `<silkscreentext text=${jsxStringValue(txt)} pcbX={${snapped.x}} pcbY={${snapped.y}} layer=${jsxStringValue(activeLayer)} fontSize="1mm" />`)
      if (res.status === "updated") onCommitFiles(res.files)
      return
    }

    if (tool === "dimension") {
      if (!dimStart) {
        setDimStart(snapped)
      } else {
        const res = insertIntoBoard(
          project.files,
          project.entrypoint,
          `<pcbnotedimension from={{ x: ${dimStart.x}, y: ${dimStart.y} }} to={{ x: ${snapped.x}, y: ${snapped.y} }} />`,
        )
        if (res.status === "updated") onCommitFiles(res.files)
        setDimStart(null)
      }
      return
    }

    if (tool === "measure") {
      setMeasureStart((prev) => (prev ? null : snapped))
      return
    }

    setPrimarySelection(null)
    setHighlightedNet(null)
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const raw = screenToMm(event.clientX, event.clientY)
    setCursorMm(tool === "route" || tool === "via" || tool === "measure" || tool === "dimension" ? snapToPadOrGrid(raw) : { x: snapMm(raw.x), y: snapMm(raw.y) })

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
      setDrag({ ...drag, curX: snapMm(drag.origX + dx), curY: snapMm(drag.origY + dy) })
    }
  }

  const handlePointerUp = () => {
    if (panDrag) {
      setPanDrag(null)
      return
    }
    if (drag) {
      if (drag.curX !== drag.origX || drag.curY !== drag.origY) {
        handlePatch(drag.name, { pcbX: drag.curX, pcbY: drag.curY })
      }
      setDrag(null)
    }
  }

  const handleCompPointerDown = (event: ReactPointerEvent, comp: PcbCompView) => {
    if (tool !== "select" || !filterComp || event.button !== 0 || event.shiftKey) return
    event.stopPropagation()
    if (event.altKey || event.metaKey || event.ctrlKey) {
      setSelectedNames((prev) => (prev.includes(comp.name) ? prev.filter((n) => n !== comp.name) : [...prev, comp.name]))
      setSelectedTraceIdx(null)
      setSelectedViaIdx(null)
      return
    }
    setPrimarySelection(comp.name)
    const raw = screenToMm(event.clientX, event.clientY)
    setDrag({ name: comp.name, startMm: raw, origX: comp.x, origY: comp.y, curX: comp.x, curY: comp.y })
  }

  const applyBoardSize = () => {
    const w = Number.parseFloat(boardW)
    const h = Number.parseFloat(boardH)
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 5 || h < 5) return
    const res = patchBoardProps(project.files, project.entrypoint, { width: `${roundMm(w)}mm`, height: `${roundMm(h)}mm` })
    if (res.status === "updated") onCommitFiles(res.files)
  }

  const addZone = () => {
    if (!zoneNet.trim()) return
    const res = addCopperPour(project.files, project.entrypoint, { net: zoneNet.trim(), layer: zoneLayer, useThermalReliefs: true })
    if (res.status === "updated") {
      onCommitFiles(res.files)
      toast.success(`Copper pour ${zoneNet.trim()} (${zoneLayer}) ditambahkan`)
    }
  }

  const addDiffPair = () => {
    if (!dpName.trim() || !dpPos.trim() || !dpNeg.trim()) return
    const res = addDifferentialPair(project.files, project.entrypoint, {
      name: dpName.trim(),
      positiveConnection: dpPos.trim(),
      negativeConnection: dpNeg.trim(),
      maxLengthSkew: dpSkew,
    })
    if (res.status === "updated") {
      onCommitFiles(res.files)
      setShowDiffPair(false)
      toast.success(`Differential pair ${dpName.trim()} ditambahkan`)
    }
  }

  const measureDist = measureStart ? Math.hypot(cursorMm.x - measureStart.x, cursorMm.y - measureStart.y) : 0
  const traceColor = (layer: string, width: number, isSelected: boolean, isHighlighted: boolean): string => {
    if (isSelected) return "#38bdf8"
    if (isHighlighted) return "#facc15"
    if (showHeatmap && simCurrentA > 0) {
      const cap = calcTraceMaxCurrent(width, 10, 1, false)
      const ratio = simCurrentA / Math.max(0.05, cap)
      if (ratio >= 1) return "#ef4444"
      if (ratio >= 0.7) return "#f59e0b"
      return "#10b981"
    }
    return LAYER_COLOR[layer] ?? "#ef4444"
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#090c10]">
      {/* KiCad Pcbnew-style Primary Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel px-3 py-1.5 text-xs">
        <span className="font-semibold text-ink">PCB CAD</span>
        <span className="h-4 w-px bg-line" />

        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Alat PCB">
          {([
            ["select", "Pilih (V)", MousePointer2],
            ["route", "Copper Trace 45° (X)", Spline],
            ["via", "Via", CircleDot],
            ["hole", "Hole (H)", Circle],
            ["cutout", "Cutout", Scissors],
            ["fiducial", "Fiducial", Crosshair],
            ["testpoint", "Testpoint", Plus],
            ["silktext", "Silkscreen", Type],
            ["dimension", "Dimensi", SquareDashed],
            ["measure", "Ukur (D)", Ruler],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              title={label}
              onClick={() => {
                setTool(id)
                setRoutePts([])
                setMeasureStart(null)
                setDimStart(null)
              }}
              className={`flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium transition ${
                tool === id ? "bg-accent text-accent-ink" : "text-muted hover:bg-raised hover:text-ink"
              }`}
            >
              <Icon size={13} />
              <span className="hidden 2xl:inline">{label.split(" (")[0]}</span>
            </button>
          ))}
        </div>

        {/* Route / Silkscreen contextual inputs */}
        {(tool === "route" || tool === "via") && (
          <div className="flex items-center gap-1.5 rounded-lg border border-line bg-surface/70 px-2 py-0.5">
            <button
              type="button"
              onClick={() => setActiveLayer((l) => (l === "top" ? "bottom" : "top"))}
              className="flex items-center gap-1 font-mono text-[11px] font-semibold"
              style={{ color: LAYER_COLOR[activeLayer] }}
              title="Ganti layer tembaga (Top / Bottom)"
            >
              <Layers size={12} /> {activeLayer === "top" ? "F.Cu" : "B.Cu"}
            </button>
            {tool === "route" && (
              <>
                <select
                  aria-label="Lebar trace"
                  value={traceWidth}
                  onChange={(e) => setTraceWidth(Number(e.target.value))}
                  className="h-6 rounded border border-line bg-panel px-1 font-mono text-[11px] text-ink"
                >
                  {WIDTH_OPTIONS.map((w) => (
                    <option key={w} value={w}>
                      {w}mm
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => setMiter45((v) => !v)}
                  className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${miter45 ? "border-accent/40 bg-accent/15 text-accent" : "border-line text-muted"}`}
                  title="Sudut 45° otomatis (tekan / saat routing untuk balik postur)"
                >
                  45°
                </button>
              </>
            )}
            <input
              aria-label="Nama net trace"
              value={traceNet}
              onChange={(e) => setTraceNet(e.target.value)}
              placeholder="Net"
              className="h-6 w-20 rounded border border-line bg-panel px-1.5 font-mono text-[11px] text-ink"
            />
            {tool === "route" && routePts.length >= 2 && (
              <Button size="sm" variant="primary" className="min-h-6 px-2 py-0 text-[11px]" onClick={commitCurrentRoute}>
                Simpan ({activeRouteLenMm.toFixed(1)}mm)
              </Button>
            )}
          </div>
        )}

        {tool === "silktext" && (
          <input
            aria-label="Teks silkscreen"
            value={silkText}
            onChange={(e) => setSilkText(e.target.value)}
            placeholder="Teks silkscreen"
            className="h-7 w-28 rounded-md border border-line bg-surface px-2 font-mono text-xs text-ink"
          />
        )}

        {/* Copper Zones, Diff Pair & Ampacity Heatmap */}
        <Button size="sm" variant={showZones ? "primary" : "ghost"} onClick={() => setShowZones((v) => !v)} title="Kelola Copper Pour / Ground Plane">
          <Layers size={12} /> Zone ({copperPours.length})
        </Button>
        <Button size="sm" variant={showDiffPair ? "primary" : "ghost"} onClick={() => setShowDiffPair((v) => !v)} title="Tambah Differential Pair (USB/CAN/Ethernet)">
          <GitBranch size={12} /> Diff-Pair
        </Button>
        <Button
          size="sm"
          variant={showHeatmap ? "primary" : "ghost"}
          onClick={() => setShowHeatmap((v) => !v)}
          title="Heatmap kapasitas arus IPC-2221 pada trace PCB"
        >
          <Flame size={12} className={showHeatmap ? "" : "text-warn"} /> Heatmap
        </Button>

        {/* Grid selector */}
        <label className="flex items-center gap-1 text-muted" title="Grid snap (mm)">
          <Grid3x3 size={13} />
          <select
            aria-label="Grid PCB"
            value={gridMm}
            onChange={(e) => setGridMm(Number(e.target.value))}
            className="h-7 rounded-md border border-line bg-surface px-1.5 font-mono text-[11px] text-ink"
          >
            {GRID_OPTIONS.map((g) => (
              <option key={g} value={g}>
                {g}mm
              </option>
            ))}
          </select>
        </label>

        {/* Layer visibility toggles */}
        <div className="hidden items-center gap-1 xl:flex">
          <button
            type="button"
            aria-pressed={showTop}
            onClick={() => setShowTop((v) => !v)}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${showTop ? "border-red-500/50 bg-red-500/15 text-red-400" : "border-line text-muted line-through"}`}
          >
            F.Cu
          </button>
          <button
            type="button"
            aria-pressed={showBottom}
            onClick={() => setShowBottom((v) => !v)}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${showBottom ? "border-blue-500/50 bg-blue-500/15 text-blue-400" : "border-line text-muted line-through"}`}
          >
            B.Cu
          </button>
          <button
            type="button"
            aria-pressed={showRatsnest}
            onClick={() => setShowRatsnest((v) => !v)}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${showRatsnest ? "border-line bg-raised text-ink" : "border-line text-muted line-through"}`}
          >
            Ratsnest
          </button>
        </div>

        {/* Multi-select alignment bar */}
        {selectedNames.length >= 2 && (
          <div className="flex items-center gap-1 rounded-lg border border-accent/40 bg-accent/10 px-2 py-0.5">
            <span className="font-mono text-[11px] text-accent">{selectedNames.length} dipilih</span>
            <IconButton label="Ratakan kiri" className="size-6" onClick={() => alignSelected("left")}>
              <AlignHorizontalJustifyStart size={12} />
            </IconButton>
            <IconButton label="Ratakan atas" className="size-6" onClick={() => alignSelected("top")}>
              <AlignVerticalJustifyStart size={12} />
            </IconButton>
            <button type="button" className="rounded px-1 text-[10px] text-ink hover:bg-raised" onClick={() => alignSelected("distX")}>
              Dist X
            </button>
            <button type="button" className="rounded px-1 text-[10px] text-ink hover:bg-raised" onClick={() => alignSelected("distY")}>
              Dist Y
            </button>
          </div>
        )}

        {(selectedTraceIdx !== null || selectedViaIdx !== null) && (
          <Button size="sm" variant="danger" onClick={deleteSelectedTraceOrVia}>
            <Trash2 size={12} /> Hapus {selectedTraceIdx !== null ? "Trace" : "Via"}
          </Button>
        )}

        <span className="h-4 w-px bg-line" />
        <IconButton label="Undo (Ctrl+Z)" className="size-7" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={14} />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" className="size-7" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={14} />
        </IconButton>
        {selectedName && (
          <>
            <IconButton label="Putar 90° (R)" className="size-7" onClick={() => handlePatch(selectedName, { pcbRotation: ((selectedSummary?.pcbRotation ?? 0) + 90) % 360 })}>
              <RotateCw size={14} />
            </IconButton>
            <IconButton label="Balik layer (F)" className="size-7" onClick={() => handlePatch(selectedName, { layer: selectedSummary?.layer === "bottom" ? "top" : "bottom" })}>
              <FlipHorizontal2 size={14} />
            </IconButton>
            <IconButton label="Duplikat komponen" className="size-7" onClick={() => handleDuplicate(selectedName)}>
              <Copy size={13} />
            </IconButton>
            <IconButton label="Hapus komponen (Del)" className="size-7 hover:text-danger" onClick={() => handleDelete(selectedName)}>
              <Trash2 size={14} />
            </IconButton>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          <form
            className="hidden items-center gap-1 2xl:flex"
            onSubmit={(e) => {
              e.preventDefault()
              applyBoardSize()
            }}
          >
            <input aria-label="Lebar board mm" value={boardW} onChange={(e) => setBoardW(e.target.value)} onBlur={applyBoardSize} className="h-6 w-11 rounded border border-line bg-surface px-1 font-mono text-[11px] text-ink" />
            <span className="text-muted">×</span>
            <input aria-label="Tinggi board mm" value={boardH} onChange={(e) => setBoardH(e.target.value)} onBlur={applyBoardSize} className="h-6 w-11 rounded border border-line bg-surface px-1 font-mono text-[11px] text-ink" />
            <span className="text-[11px] text-muted">mm</span>
          </form>
          <span className="hidden font-mono text-[11px] text-muted tabular-nums lg:inline">
            {cursorMm.x.toFixed(1)}, {cursorMm.y.toFixed(1)}
          </span>
          <IconButton label="Perbesar" className="size-7" onClick={() => setZoom((z) => Math.min(80, z * 1.2))}>
            <ZoomIn size={14} />
          </IconButton>
          <IconButton label="Perkecil" className="size-7" onClick={() => setZoom((z) => Math.max(3, z * 0.8))}>
            <ZoomOut size={14} />
          </IconButton>
          <IconButton label="Sesuaikan tampilan" className="size-7" onClick={fitView}>
            <Maximize2 size={13} />
          </IconButton>
          <Button size="sm" variant="primary" onClick={onDone}>
            <Check size={14} /> Selesai
          </Button>
        </div>
      </div>

      {/* Collapsible Copper Zone Manager Bar */}
      {showZones && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface/90 px-3 py-2 text-xs">
          <span className="font-semibold text-ink">Copper Pour / Zone Manager:</span>
          <input value={zoneNet} onChange={(e) => setZoneNet(e.target.value)} placeholder="GND" className="h-7 w-24 rounded border border-line bg-panel px-2 font-mono text-xs text-ink" />
          <select value={zoneLayer} onChange={(e) => setZoneLayer(e.target.value as CopperLayer)} className="h-7 rounded border border-line bg-panel px-2 text-xs text-ink">
            <option value="bottom">Bottom (B.Cu)</option>
            <option value="top">Top (F.Cu)</option>
          </select>
          <Button size="sm" variant="primary" onClick={addZone}>
            <Plus size={12} /> Tambah Pour
          </Button>
          {copperPours.map((p, idx) => (
            <span key={idx} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-0.5 font-mono text-[11px]">
              <span className="size-2 rounded-full" style={{ background: LAYER_COLOR[p.layer] ?? "#34d399" }} />
              {p.net} ({p.layer})
              <button
                type="button"
                className="text-muted hover:text-danger"
                onClick={() => {
                  const res = deleteElementSpan(project.files, p.path, p.start, p.end)
                  if (res.status === "updated") onCommitFiles(res.files)
                }}
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Collapsible Differential Pair Bar */}
      {showDiffPair && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-surface/90 px-3 py-2 text-xs">
          <span className="font-semibold text-ink">Differential Pair:</span>
          <input value={dpName} onChange={(e) => setDpName(e.target.value)} placeholder="Nama (USB)" className="h-7 w-24 rounded border border-line bg-panel px-2 font-mono text-xs text-ink" />
          <input value={dpPos} onChange={(e) => setDpPos(e.target.value)} placeholder="Trace + (USB_DP)" className="h-7 w-28 rounded border border-line bg-panel px-2 font-mono text-xs text-ink" />
          <input value={dpNeg} onChange={(e) => setDpNeg(e.target.value)} placeholder="Trace - (USB_DM)" className="h-7 w-28 rounded border border-line bg-panel px-2 font-mono text-xs text-ink" />
          <label className="flex items-center gap-1 text-muted">
            Skew maks
            <input type="number" step="0.01" value={dpSkew} onChange={(e) => setDpSkew(Number(e.target.value) || 0.05)} className="h-7 w-16 rounded border border-line bg-panel px-1.5 font-mono text-xs text-ink" />
            mm
          </label>
          <Button size="sm" variant="primary" onClick={addDiffPair}>
            Tambah &lt;differentialpair&gt;
          </Button>
        </div>
      )}

      {/* PCB SVG Canvas + Property Inspector */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          {/* KiCad 9 Selection Filter overlay (top-left) */}
          <div className="absolute left-3 top-2 z-10 flex items-center gap-1.5 rounded-lg border border-line bg-panel/90 px-2 py-1 text-[11px] backdrop-blur-xs">
            <span className="text-muted">Seleksi:</span>
            <label className="flex cursor-pointer items-center gap-1 text-ink">
              <input type="checkbox" checked={filterComp} onChange={(e) => setFilterComp(e.target.checked)} className="accent-emerald-500" />
              Part
            </label>
            <label className="flex cursor-pointer items-center gap-1 text-ink">
              <input type="checkbox" checked={filterTrace} onChange={(e) => setFilterTrace(e.target.checked)} className="accent-emerald-500" />
              Trace
            </label>
            <label className="flex cursor-pointer items-center gap-1 text-ink">
              <input type="checkbox" checked={filterVia} onChange={(e) => setFilterVia(e.target.checked)} className="accent-emerald-500" />
              Via
            </label>
            {highlightedNet && (
              <button
                type="button"
                onClick={() => setHighlightedNet(null)}
                className="ml-1 rounded bg-warn/15 px-1.5 py-0.5 font-mono text-[10px] text-warn"
              >
                Net: {highlightedNet} ×
              </button>
            )}
          </div>

          <svg
            ref={svgRef}
            aria-label="Kanvas PCB CAD"
            className={`h-full w-full select-none ${tool !== "select" ? "cursor-crosshair" : panDrag ? "cursor-grabbing" : "cursor-default"}`}
            onWheel={handleWheel}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <defs>
              <pattern id="pcb-grid" width={Math.max(6, gridMm * zoom)} height={Math.max(6, gridMm * zoom)} patternUnits="userSpaceOnUse">
                <circle cx={1} cy={1} r={0.8} fill="#252c3b" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="#090c10" />
            <rect width="100%" height="100%" fill="url(#pcb-grid)" />

            <g transform={`translate(${(svgRef.current?.clientWidth ?? 600) / 2 + pan.x}, ${(svgRef.current?.clientHeight ?? 400) / 2 + pan.y})`}>
              {/* Board Edge.Cuts */}
              {scene.board.outline ? (
                <polygon
                  points={scene.board.outline.map((p) => `${p.x * zoom},${-p.y * zoom}`).join(" ")}
                  fill="#0f1f17"
                  stroke="#eab308"
                  strokeWidth={2}
                />
              ) : (
                <rect
                  x={(scene.board.center.x - scene.board.width / 2) * zoom}
                  y={-(scene.board.center.y + scene.board.height / 2) * zoom}
                  width={scene.board.width * zoom}
                  height={scene.board.height * zoom}
                  fill="#0f1f17"
                  stroke="#eab308"
                  strokeWidth={2}
                />
              )}

              {/* Visual Copper Pour shading */}
              {copperPours.map((pour, idx) => {
                if (pour.layer === "top" && !showTop) return null
                if (pour.layer === "bottom" && !showBottom) return null
                return (
                  <rect
                    key={idx}
                    x={(scene.board.center.x - scene.board.width / 2 + 0.5) * zoom}
                    y={-(scene.board.center.y + scene.board.height / 2 - 0.5) * zoom}
                    width={Math.max(0, (scene.board.width - 1) * zoom)}
                    height={Math.max(0, (scene.board.height - 1) * zoom)}
                    fill={LAYER_COLOR[pour.layer] ?? "#34d399"}
                    fillOpacity={0.07}
                    stroke={LAYER_COLOR[pour.layer] ?? "#34d399"}
                    strokeOpacity={0.35}
                    strokeDasharray="6 4"
                    strokeWidth={1}
                    pointerEvents="none"
                  />
                )
              })}

              {/* Copper Traces (clickable to highlight net or delete manual trace) */}
              {scene.traces.map((trace, idx) => {
                if (trace.layer === "top" && !showTop) return null
                if (trace.layer === "bottom" && !showBottom) return null
                const isSelected = selectedTraceIdx === idx
                const isHighlighted = Boolean(highlightedNet && trace.netName === highlightedNet)
                const lenMm = polylineLength(trace.points)
                const maxA = calcTraceMaxCurrent(trace.width, 10, 1, false)
                return (
                  <polyline
                    key={trace.id}
                    points={trace.points.map((p) => `${p.x * zoom},${-p.y * zoom}`).join(" ")}
                    fill="none"
                    stroke={traceColor(trace.layer, trace.width, isSelected, isHighlighted)}
                    strokeWidth={Math.max(2, trace.width * zoom)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={isSelected || isHighlighted ? 1 : 0.85}
                    className={tool === "select" && filterTrace ? "cursor-pointer" : ""}
                    onPointerDown={(e) => {
                      if (tool !== "select" || !filterTrace) return
                      e.stopPropagation()
                      if (trace.netName) setHighlightedNet(trace.netName)
                      if (idx < manualTraces.length) {
                        setSelectedTraceIdx(idx)
                        setSelectedViaIdx(null)
                        setSelectedNames([])
                      }
                    }}
                  >
                    <title>{`${trace.layer} · ${trace.width}mm · ${lenMm.toFixed(1)}mm · maks ${maxA}A${trace.netName ? ` · ${trace.netName}` : ""}`}</title>
                  </polyline>
                )
              })}

              {/* Ratsnest (Airwires) */}
              {showRatsnest &&
                scene.ratsnest.map((wire, idx) => {
                  const isHi = Boolean(highlightedNet && wire.netName === highlightedNet)
                  return (
                    <line
                      key={idx}
                      x1={wire.from.x * zoom}
                      y1={-wire.from.y * zoom}
                      x2={wire.to.x * zoom}
                      y2={-wire.to.y * zoom}
                      stroke={isHi ? "#facc15" : "#94a3b8"}
                      strokeWidth={isHi ? 1.5 : 0.8}
                      strokeDasharray="3 3"
                      opacity={isHi ? 0.95 : 0.55}
                    />
                  )
                })}

              {/* Vias */}
              {scene.vias.map((via) => {
                const manualIdx = manualVias.findIndex((mv) => Math.hypot(mv.x - via.x, mv.y - via.y) < 0.2)
                const isSelected = manualIdx !== -1 && selectedViaIdx === manualIdx
                return (
                  <g
                    key={via.id}
                    transform={`translate(${via.x * zoom}, ${-via.y * zoom})`}
                    className={tool === "select" && filterVia && manualIdx !== -1 ? "cursor-pointer" : ""}
                    onPointerDown={(e) => {
                      if (tool !== "select" || !filterVia || manualIdx === -1) return
                      e.stopPropagation()
                      setSelectedViaIdx(manualIdx)
                      setSelectedTraceIdx(null)
                      setSelectedNames([])
                    }}
                  >
                    <circle r={Math.max(3, (via.outerDiameter / 2) * zoom)} fill={isSelected ? "#38bdf8" : "#d4a359"} />
                    <circle r={Math.max(1.5, (via.holeDiameter / 2) * zoom)} fill="#090c10" />
                  </g>
                )
              })}

              {/* Components & Pads */}
              {scene.components.map((comp) => {
                const isDragging = drag?.name === comp.name
                const dx = isDragging ? drag.curX - comp.x : 0
                const dy = isDragging ? drag.curY - comp.y : 0
                const cx = (comp.x + dx) * zoom
                const cy = -(comp.y + dy) * zoom
                const w = comp.width * zoom
                const h = comp.height * zoom
                const selected = selectedNames.includes(comp.name)
                const isLocked = lockedComponents?.has(comp.name) ?? false
                const isBottom = comp.layer === "bottom"
                return (
                  <g key={comp.id} onPointerDown={(e) => handleCompPointerDown(e, comp)} className={tool === "select" && filterComp ? "cursor-move" : ""}>
                    <rect
                      x={cx - w / 2}
                      y={cy - h / 2}
                      width={w}
                      height={h}
                      rx={2}
                      fill={isBottom ? "rgba(59,130,246,0.12)" : "rgba(239,68,68,0.10)"}
                      stroke={selected ? "#34d399" : isLocked ? "#fbbf24" : isBottom ? "#60a5fa" : "#cbd5e1"}
                      strokeWidth={selected ? 2 : 1}
                      strokeDasharray={isBottom ? "3 2" : undefined}
                    />
                    {comp.pads.map((pad) => {
                      if (pad.layer === "top" && !showTop) return null
                      if (pad.layer === "bottom" && !showBottom) return null
                      const px = (pad.x + dx) * zoom
                      const py = -(pad.y + dy) * zoom
                      const fill = pad.isPlatedHole ? "#eab308" : LAYER_COLOR[pad.layer] ?? "#ef4444"
                      return pad.shape === "circle" ? (
                        <g key={pad.id}>
                          <circle cx={px} cy={py} r={Math.max(2.5, (pad.width / 2) * zoom)} fill={fill} opacity={0.9} />
                          {pad.isPlatedHole && <circle cx={px} cy={py} r={Math.max(1.2, (pad.width / 4) * zoom)} fill="#090c10" />}
                          <title>{`${pad.componentName}.${pad.pinLabel}`}</title>
                        </g>
                      ) : (
                        <rect
                          key={pad.id}
                          x={px - (pad.width * zoom) / 2}
                          y={py - (pad.height * zoom) / 2}
                          width={Math.max(3, pad.width * zoom)}
                          height={Math.max(3, pad.height * zoom)}
                          rx={1}
                          fill={fill}
                          opacity={0.9}
                        >
                          <title>{`${pad.componentName}.${pad.pinLabel}`}</title>
                        </rect>
                      )
                    })}
                    <text x={cx} y={cy - h / 2 - 4} textAnchor="middle" fill="#e2e8f0" fontSize={10} fontWeight={600} fontFamily="var(--font-mono)">
                      {comp.name}
                      {isLocked ? " 🔒" : ""}
                    </text>
                  </g>
                )
              })}

              {/* Active 45° manual copper trace preview */}
              {tool === "route" && previewRoutePts.length >= 2 && (
                <>
                  <polyline
                    points={previewRoutePts.map((p) => `${p.x * zoom},${-p.y * zoom}`).join(" ")}
                    fill="none"
                    stroke={LAYER_COLOR[activeLayer]}
                    strokeWidth={Math.max(2, traceWidth * zoom)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="6 3"
                  />
                  {routePts.map((pt, i) => (
                    <circle key={i} cx={pt.x * zoom} cy={-pt.y * zoom} r={pt.via ? 4.5 : 2.5} fill={pt.via ? "#eab308" : "#fff"} />
                  ))}
                  <text
                    x={cursorMm.x * zoom + 10}
                    y={-cursorMm.y * zoom - 10}
                    fill="#34d399"
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="var(--font-mono)"
                  >
                    {activeRouteLenMm.toFixed(2)} mm · maks {maxAmpForWidth}A
                  </text>
                </>
              )}

              {/* Active measurement ruler / dimension */}
              {(tool === "measure" && measureStart) || (tool === "dimension" && dimStart) ? (
                <g>
                  {(() => {
                    const st = tool === "dimension" ? dimStart! : measureStart!
                    const d = Math.hypot(cursorMm.x - st.x, cursorMm.y - st.y)
                    return (
                      <>
                        <line x1={st.x * zoom} y1={-st.y * zoom} x2={cursorMm.x * zoom} y2={-cursorMm.y * zoom} stroke="#38bdf8" strokeWidth={1.5} strokeDasharray="4 3" />
                        <circle cx={st.x * zoom} cy={-st.y * zoom} r={3.5} fill="#38bdf8" />
                        <circle cx={cursorMm.x * zoom} cy={-cursorMm.y * zoom} r={3.5} fill="#38bdf8" />
                        <text
                          x={((st.x + cursorMm.x) / 2) * zoom}
                          y={-((st.y + cursorMm.y) / 2) * zoom - 8}
                          textAnchor="middle"
                          fill="#38bdf8"
                          fontSize={11}
                          fontWeight={600}
                          fontFamily="var(--font-mono)"
                        >
                          {(tool === "measure" ? measureDist : d).toFixed(2)} mm
                        </text>
                      </>
                    )
                  })()}
                </g>
              ) : null}
            </g>
          </svg>

          {/* Bottom status hint */}
          <div className="pointer-events-none absolute bottom-2 left-3 rounded-lg border border-line bg-panel/90 px-2.5 py-1 text-[11px] text-muted backdrop-blur-xs">
            {tool === "route"
              ? `Trace 45° (${activeLayer}, ${traceWidth}mm, maks ${maxAmpForWidth}A) · Tekan / balik postur · V tambah Via · Enter selesai`
              : tool === "dimension"
                ? dimStart
                  ? "Klik titik akhir dimensi PCB (<pcbnotedimension>)"
                  : "Klik titik awal dimensi PCB"
                : tool === "cutout"
                  ? "Klik untuk menempatkan slot/cutout board"
                  : tool === "fiducial"
                    ? "Klik untuk menempatkan Fiducial marker SMT"
                    : tool === "testpoint"
                      ? "Klik untuk menempatkan Testpoint"
                      : tool === "silktext"
                        ? `Klik untuk menempatkan teks silkscreen "${silkText}"`
                        : "Seret part · Alt+Klik multi-pilih · R putar · F balik layer · X trace 45° · H hole · D ukur · Shift+Seret geser kanvas"}
          </div>
        </div>

        <PropertyInspector
          component={selectedSummary}
          mode="pcb"
          locked={selectedName ? lockedComponents?.has(selectedName) : false}
          onToggleLock={onToggleLock}
          onDuplicate={handleDuplicate}
          onRevealCode={onRevealCode}
          onPatch={handlePatch}
          onDelete={handleDelete}
          onAskAi={onAskAi}
          onClose={() => setPrimarySelection(null)}
        />
      </div>
    </div>
  )
}
