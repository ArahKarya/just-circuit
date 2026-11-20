import {
  Check,
  Circle,
  CircleDot,
  FlipHorizontal2,
  Grid3x3,
  Layers,
  Maximize2,
  MousePointer2,
  Redo2,
  RotateCw,
  Ruler,
  Spline,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react"
import { extractPcbScene, type PcbCompView, type Point2D } from "../../lib/circuit-extract"
import {
  addPcbTrace,
  addVia,
  deleteComponent,
  inspectComponent,
  insertIntoBoard,
  patchBoardProps,
  patchComponentProps,
  roundMm,
  type PcbRoutePoint,
  type PropPatchValue,
} from "../../lib/tsx-ast"
import { classifyCadShortcut } from "../../lib/cad-shortcuts"
import { reportPatchFailure } from "./patch-feedback"
import type { Project, ProjectFiles } from "../../lib/types"
import { Button, IconButton } from "../ui"
import { PropertyInspector } from "./PropertyInspector"

type PcbTool = "select" | "route" | "via" | "hole" | "measure"
type CopperLayer = "top" | "bottom"

const GRID_OPTIONS = [0.1, 0.25, 0.5, 1, 2.54] as const
const WIDTH_OPTIONS = [0.15, 0.2, 0.25, 0.4, 0.6, 1.0] as const

interface PcbCadEditorProps {
  project: Project
  circuitJson: unknown[]
  lockedComponents?: ReadonlySet<string>
  onToggleLock?: (name: string) => void
  onCommitFiles: (nextFiles: ProjectFiles) => void
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onAskAi?: (componentName: string) => void
  onDone: () => void
}

const LAYER_COLOR: Record<string, string> = {
  top: "#ef4444",
  bottom: "#3b82f6",
  all: "#eab308",
}

export function PcbCadEditor({
  project,
  circuitJson,
  lockedComponents,
  onToggleLock,
  onCommitFiles,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAskAi,
  onDone,
}: PcbCadEditorProps) {
  const scene = useMemo(() => extractPcbScene(circuitJson), [circuitJson])

  const [tool, setTool] = useState<PcbTool>("select")
  const [gridMm, setGridMm] = useState<number>(0.5)
  const [activeLayer, setActiveLayer] = useState<CopperLayer>("top")
  const [traceWidth, setTraceWidth] = useState<number>(0.25)
  const [traceNet, setTraceNet] = useState("")
  const [showTop, setShowTop] = useState(true)
  const [showBottom, setShowBottom] = useState(true)
  const [showRatsnest, setShowRatsnest] = useState(true)

  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [boardW, setBoardW] = useState(() => String(roundMm(scene.board.width)))
  const [boardH, setBoardH] = useState(() => String(roundMm(scene.board.height)))

  // Manual copper trace in progress
  const [routePts, setRoutePts] = useState<PcbRoutePoint[]>([])
  // Ruler measurement
  const [measureStart, setMeasureStart] = useState<Point2D | null>(null)

  const [cursorMm, setCursorMm] = useState<Point2D>({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ name: string; startMm: Point2D; origX: number; origY: number; curX: number; curY: number } | null>(null)
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(14) // px per mm
  const [panDrag, setPanDrag] = useState<{ startScreen: Point2D; startPan: Point2D } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

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

  /** Snaps to a nearby pad center if within 0.6mm, else snaps to the active grid. */
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
        setSelectedName(null)
        onCommitFiles(res.files)
      }
    },
    [project.files, onCommitFiles],
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
        else setTool("select")
      } else if (key === "enter" && tool === "route" && routePts.length >= 2) {
        event.preventDefault()
        commitCurrentRoute()
      } else if (key === "v") {
        if (tool === "route" && routePts.length > 0) {
          // Drop a via at the last point and switch copper layer!
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
      } else if ((key === "delete" || key === "backspace") && selectedName) {
        event.preventDefault()
        handleDelete(selectedName)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [tool, routePts, activeLayer, measureStart, selectedName, project.files, handlePatch, handleDelete, commitCurrentRoute, onUndo, onRedo])

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.12 : 0.89
    setZoom((z) => Math.max(3, Math.min(80, z * factor)))
  }

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

    if (tool === "measure") {
      setMeasureStart((prev) => (prev ? null : snapped))
      return
    }

    setSelectedName(null)
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const raw = screenToMm(event.clientX, event.clientY)
    setCursorMm(tool === "route" || tool === "via" || tool === "measure" ? snapToPadOrGrid(raw) : { x: snapMm(raw.x), y: snapMm(raw.y) })

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
    if (tool !== "select" || event.button !== 0 || event.shiftKey) return
    event.stopPropagation()
    setSelectedName(comp.name)
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

  const measureDist = measureStart ? Math.hypot(cursorMm.x - measureStart.x, cursorMm.y - measureStart.y) : 0

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-[#090c10]">
      {/* KiCad Pcbnew-style Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel px-3 py-1.5 text-xs">
        <span className="font-semibold text-ink">PCB CAD</span>
        <span className="h-4 w-px bg-line" />

        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Alat PCB">
          {([
            ["select", "Pilih (V)", MousePointer2],
            ["route", "Copper Trace (X)", Spline],
            ["via", "Via", CircleDot],
            ["hole", "Hole (H)", Circle],
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
              }}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                tool === id ? "bg-accent text-accent-ink" : "text-muted hover:bg-raised hover:text-ink"
              }`}
            >
              <Icon size={13} />
              <span className="hidden lg:inline">{label.split(" (")[0]}</span>
            </button>
          ))}
        </div>

        {/* Route options */}
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
            )}
            <input
              aria-label="Nama net trace"
              value={traceNet}
              onChange={(e) => setTraceNet(e.target.value)}
              placeholder="Net (opsional)"
              className="h-6 w-24 rounded border border-line bg-panel px-1.5 font-mono text-[11px] text-ink"
            />
            {tool === "route" && routePts.length >= 2 && (
              <Button size="sm" variant="primary" className="min-h-6 px-2 py-0 text-[11px]" onClick={commitCurrentRoute}>
                Simpan Trace
              </Button>
            )}
          </div>
        )}

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

        {/* Board W x H quick editor */}
        <form
          className="hidden items-center gap-1 2xl:flex"
          onSubmit={(e) => {
            e.preventDefault()
            applyBoardSize()
          }}
        >
          <span className="text-[11px] text-muted">Board:</span>
          <input aria-label="Lebar board mm" value={boardW} onChange={(e) => setBoardW(e.target.value)} onBlur={applyBoardSize} className="h-6 w-12 rounded border border-line bg-surface px-1 font-mono text-[11px] text-ink" />
          <span className="text-muted">×</span>
          <input aria-label="Tinggi board mm" value={boardH} onChange={(e) => setBoardH(e.target.value)} onBlur={applyBoardSize} className="h-6 w-12 rounded border border-line bg-surface px-1 font-mono text-[11px] text-ink" />
          <span className="text-[11px] text-muted">mm</span>
        </form>

        <span className="h-4 w-px bg-line" />
        <IconButton label="Undo (Ctrl+Z)" className="size-7" disabled={!canUndo} onClick={onUndo}>
          <Undo2 size={14} />
        </IconButton>
        <IconButton label="Redo (Ctrl+Shift+Z)" className="size-7" disabled={!canRedo} onClick={onRedo}>
          <Redo2 size={14} />
        </IconButton>
        {selectedName && (
          <>
            <IconButton
              label="Putar 90° (R)"
              className="size-7"
              onClick={() => handlePatch(selectedName, { pcbRotation: ((selectedSummary?.pcbRotation ?? 0) + 90) % 360 })}
            >
              <RotateCw size={14} />
            </IconButton>
            <IconButton
              label="Balik layer (F)"
              className="size-7"
              onClick={() => handlePatch(selectedName, { layer: selectedSummary?.layer === "bottom" ? "top" : "bottom" })}
            >
              <FlipHorizontal2 size={14} />
            </IconButton>
            <IconButton label="Hapus komponen (Del)" className="size-7 hover:text-danger" onClick={() => handleDelete(selectedName)}>
              <Trash2 size={14} />
            </IconButton>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          <span className="hidden font-mono text-[11px] text-muted tabular-nums lg:inline">
            X: {cursorMm.x.toFixed(2)}mm Y: {cursorMm.y.toFixed(2)}mm
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

      {/* PCB SVG Canvas + Property Inspector */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1 overflow-hidden">
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

              {/* Copper Traces */}
              {scene.traces.map((trace) => {
                if (trace.layer === "top" && !showTop) return null
                if (trace.layer === "bottom" && !showBottom) return null
                return (
                  <polyline
                    key={trace.id}
                    points={trace.points.map((p) => `${p.x * zoom},${-p.y * zoom}`).join(" ")}
                    fill="none"
                    stroke={LAYER_COLOR[trace.layer] ?? "#ef4444"}
                    strokeWidth={Math.max(1.5, trace.width * zoom)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.85}
                  />
                )
              })}

              {/* Ratsnest (Airwires) */}
              {showRatsnest &&
                scene.ratsnest.map((wire, idx) => (
                  <line
                    key={idx}
                    x1={wire.from.x * zoom}
                    y1={-wire.from.y * zoom}
                    x2={wire.to.x * zoom}
                    y2={-wire.to.y * zoom}
                    stroke="#94a3b8"
                    strokeWidth={0.8}
                    strokeDasharray="3 3"
                    opacity={0.55}
                  />
                ))}

              {/* Vias */}
              {scene.vias.map((via) => (
                <g key={via.id} transform={`translate(${via.x * zoom}, ${-via.y * zoom})`}>
                  <circle r={Math.max(3, (via.outerDiameter / 2) * zoom)} fill="#d4a359" />
                  <circle r={Math.max(1.5, (via.holeDiameter / 2) * zoom)} fill="#090c10" />
                </g>
              ))}

              {/* Components & Pads */}
              {scene.components.map((comp) => {
                const isDragging = drag?.name === comp.name
                const dx = isDragging ? drag.curX - comp.x : 0
                const dy = isDragging ? drag.curY - comp.y : 0
                const cx = (comp.x + dx) * zoom
                const cy = -(comp.y + dy) * zoom
                const w = comp.width * zoom
                const h = comp.height * zoom
                const selected = selectedName === comp.name
                const isLocked = lockedComponents?.has(comp.name) ?? false
                const isBottom = comp.layer === "bottom"
                return (
                  <g key={comp.id} onPointerDown={(e) => handleCompPointerDown(e, comp)} className={tool === "select" ? "cursor-move" : ""}>
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

              {/* Active manual copper trace being drawn */}
              {tool === "route" && routePts.length > 0 && (
                <>
                  <polyline
                    points={[...routePts, cursorMm].map((p) => `${p.x * zoom},${-p.y * zoom}`).join(" ")}
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
                </>
              )}

              {/* Active measurement ruler */}
              {tool === "measure" && measureStart && (
                <g>
                  <line
                    x1={measureStart.x * zoom}
                    y1={-measureStart.y * zoom}
                    x2={cursorMm.x * zoom}
                    y2={-cursorMm.y * zoom}
                    stroke="#38bdf8"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                  />
                  <circle cx={measureStart.x * zoom} cy={-measureStart.y * zoom} r={3.5} fill="#38bdf8" />
                  <circle cx={cursorMm.x * zoom} cy={-cursorMm.y * zoom} r={3.5} fill="#38bdf8" />
                  <text
                    x={((measureStart.x + cursorMm.x) / 2) * zoom}
                    y={-((measureStart.y + cursorMm.y) / 2) * zoom - 8}
                    textAnchor="middle"
                    fill="#38bdf8"
                    fontSize={11}
                    fontWeight={600}
                    fontFamily="var(--font-mono)"
                  >
                    {measureDist.toFixed(2)} mm (ΔX {Math.abs(cursorMm.x - measureStart.x).toFixed(2)}, ΔY {Math.abs(cursorMm.y - measureStart.y).toFixed(2)})
                  </text>
                </g>
              )}
            </g>
          </svg>

          {/* Bottom status hint */}
          <div className="pointer-events-none absolute bottom-2 left-3 rounded-lg border border-line bg-panel/90 px-2.5 py-1 text-[11px] text-muted backdrop-blur-xs">
            {tool === "route"
              ? "Klik titik jalur copper trace · Tekan V untuk tambah Via & ganti layer · Enter / klik ganda selesai · Esc batal"
              : tool === "via"
                ? "Klik di board untuk menempatkan Via (Top ↔ Bottom)"
                : tool === "hole"
                  ? "Klik di board untuk menempatkan Mounting Hole (3.2mm)"
                  : tool === "measure"
                    ? "Klik titik awal & geser untuk mengukur jarak (mm)"
                    : "Seret komponen · R putar · F balik layer · X copper trace · H hole · D ukur · Shift+Seret geser kanvas"}
          </div>
        </div>

        <PropertyInspector
          component={selectedSummary}
          mode="pcb"
          locked={selectedName ? lockedComponents?.has(selectedName) : false}
          onToggleLock={onToggleLock}
          onPatch={handlePatch}
          onDelete={handleDelete}
          onAskAi={onAskAi}
          onClose={() => setSelectedName(null)}
        />
      </div>
    </div>
  )
}
