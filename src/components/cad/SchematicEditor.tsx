import {
  Check,
  Maximize2,
  MousePointer2,
  Plus,
  Redo2,
  RotateCw,
  Spline,
  Tag,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type WheelEvent } from "react"
import { extractSchematicScene, nextDesignator, type Point2D, type SchematicCompView, type SchematicPinView } from "../../lib/circuit-extract"
import {
  addTrace,
  deleteComponent,
  inspectComponent,
  insertIntoBoard,
  listComponents,
  patchComponentProps,
  roundMm,
  type PropPatchValue,
} from "../../lib/tsx-ast"
import type { Project, ProjectFiles } from "../../lib/types"
import { Button, IconButton } from "../ui"
import { PropertyInspector } from "./PropertyInspector"

type SchTool = "select" | "wire" | "place" | "netlabel"

interface PartPreset {
  id: string
  label: string
  prefix: string
  buildJsx: (name: string, x: number, y: number) => string
}

const PART_PRESETS: PartPreset[] = [
  { id: "resistor", label: "Resistor (10k)", prefix: "R", buildJsx: (n, x, y) => `<resistor name="${n}" resistance="10k" footprint="0603" schX={${x}} schY={${y}} />` },
  { id: "capacitor", label: "Kapasitor (100nF)", prefix: "C", buildJsx: (n, x, y) => `<capacitor name="${n}" capacitance="100nF" footprint="0603" schX={${x}} schY={${y}} />` },
  { id: "inductor", label: "Induktor (10uH)", prefix: "L", buildJsx: (n, x, y) => `<inductor name="${n}" inductance="10uH" footprint="0805" schX={${x}} schY={${y}} />` },
  { id: "led", label: "LED (Merah)", prefix: "D", buildJsx: (n, x, y) => `<led name="${n}" color="red" footprint="0603" schX={${x}} schY={${y}} />` },
  { id: "diode", label: "Dioda (SOD-123)", prefix: "D", buildJsx: (n, x, y) => `<diode name="${n}" footprint="sod123" schX={${x}} schY={${y}} />` },
  { id: "pushbutton", label: "Tombol (Pushbutton)", prefix: "SW", buildJsx: (n, x, y) => `<pushbutton name="${n}" footprint="pushbutton" schX={${x}} schY={${y}} />` },
  { id: "header4", label: "Header 1×4", prefix: "J", buildJsx: (n, x, y) => `<pinheader name="${n}" pinCount={4} pitch="2.54mm" footprint="pinrow4" schX={${x}} schY={${y}} />` },
  { id: "chip", label: "IC / Chip 8-pin", prefix: "U", buildJsx: (n, x, y) => `<chip name="${n}" footprint="soic8" pinLabels={{ pin1: "VCC", pin2: "IN1", pin3: "IN2", pin4: "GND", pin5: "OUT1", pin6: "OUT2", pin7: "NC", pin8: "EN" }} schX={${x}} schY={${y}} />` },
]

interface SchematicEditorProps {
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

const GRID_STEP = 0.5
const snap = (v: number) => Math.round(v / GRID_STEP) * GRID_STEP

export function SchematicEditor({
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
}: SchematicEditorProps) {
  const scene = useMemo(() => extractSchematicScene(circuitJson), [circuitJson])
  const codeComponents = useMemo(() => listComponents(project.files), [project.files])

  const [tool, setTool] = useState<SchTool>("select")
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [placePresetId, setPlacePresetId] = useState(PART_PRESETS[0].id)
  const [netLabelName, setNetLabelName] = useState("VCC")
  const [wireStart, setWireStart] = useState<SchematicPinView | null>(null)
  const [cursorWorld, setCursorWorld] = useState<Point2D>({ x: 0, y: 0 })
  const [drag, setDrag] = useState<{ name: string; startWorld: Point2D; origX: number; origY: number; curX: number; curY: number } | null>(null)
  const [pan, setPan] = useState<Point2D>({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(64) // px per schematic unit
  const [panDrag, setPanDrag] = useState<{ startScreen: Point2D; startPan: Point2D } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  const selectedSummary = useMemo(
    () => (selectedName ? inspectComponent(project.files, selectedName) : null),
    [project.files, selectedName],
  )

  const fitView = useCallback(() => {
    const el = svgRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const bw = Math.max(4, scene.bounds.maxX - scene.bounds.minX)
    const bh = Math.max(4, scene.bounds.maxY - scene.bounds.minY)
    const scale = Math.max(24, Math.min(120, Math.min((rect.width * 0.82) / bw, (rect.height * 0.82) / bh)))
    const cx = (scene.bounds.minX + scene.bounds.maxX) / 2
    const cy = (scene.bounds.minY + scene.bounds.maxY) / 2
    setZoom(scale)
    setPan({ x: -cx * scale, y: cy * scale })
  }, [scene.bounds])

  useEffect(() => {
    fitView()
    // Fit once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const screenToWorld = useCallback(
    (clientX: number, clientY: number): Point2D => {
      const rect = svgRef.current?.getBoundingClientRect()
      if (!rect) return { x: 0, y: 0 }
      const sx = clientX - rect.left - rect.width / 2 - pan.x
      const sy = clientY - rect.top - rect.height / 2 - pan.y
      return { x: sx / zoom, y: -sy / zoom }
    },
    [pan, zoom],
  )

  const handlePatch = useCallback(
    (name: string, patch: Record<string, PropPatchValue>) => {
      const res = patchComponentProps(project.files, name, patch)
      if (res.status === "updated") onCommitFiles(res.files)
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

  // KiCad-style keyboard shortcuts
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement | null)?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault()
        if (event.shiftKey) onRedo()
        else onUndo()
        return
      }
      const key = event.key.toLowerCase()
      if (key === "escape") {
        setTool("select")
        setWireStart(null)
      } else if (key === "v") {
        setTool("select")
        setWireStart(null)
      } else if (key === "w") {
        setTool("wire")
      } else if (key === "a") {
        setTool("place")
        setWireStart(null)
      } else if (key === "l") {
        setTool("netlabel")
        setWireStart(null)
      } else if (key === "r" && selectedName) {
        event.preventDefault()
        const comp = inspectComponent(project.files, selectedName)
        const cur = comp?.schRotation ?? 0
        handlePatch(selectedName, { schRotation: (cur + 90) % 360 })
      } else if ((key === "delete" || key === "backspace") && selectedName) {
        event.preventDefault()
        handleDelete(selectedName)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [selectedName, project.files, handlePatch, handleDelete, onUndo, onRedo])

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault()
    const factor = event.deltaY < 0 ? 1.12 : 0.89
    setZoom((z) => Math.max(16, Math.min(220, z * factor)))
  }

  const handleCanvasPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || event.shiftKey) {
      setPanDrag({ startScreen: { x: event.clientX, y: event.clientY }, startPan: pan })
      return
    }
    if (event.button !== 0) return
    const world = screenToWorld(event.clientX, event.clientY)
    const sx = roundMm(snap(world.x))
    const sy = roundMm(snap(world.y))

    if (tool === "place") {
      const preset = PART_PRESETS.find((p) => p.id === placePresetId) ?? PART_PRESETS[0]
      const name = nextDesignator(preset.prefix, codeComponents.map((c) => c.name))
      const res = insertIntoBoard(project.files, project.entrypoint, preset.buildJsx(name, sx, sy))
      if (res.status === "updated") {
        setSelectedName(name)
        onCommitFiles(res.files)
      }
      return
    }

    if (tool === "select") {
      setSelectedName(null)
    }
  }

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const world = screenToWorld(event.clientX, event.clientY)
    setCursorWorld({ x: roundMm(snap(world.x)), y: roundMm(snap(world.y)) })

    if (panDrag) {
      setPan({
        x: panDrag.startPan.x + (event.clientX - panDrag.startScreen.x),
        y: panDrag.startPan.y + (event.clientY - panDrag.startScreen.y),
      })
      return
    }

    if (drag) {
      const dx = world.x - drag.startWorld.x
      const dy = world.y - drag.startWorld.y
      setDrag({ ...drag, curX: roundMm(snap(drag.origX + dx)), curY: roundMm(snap(drag.origY + dy)) })
    }
  }

  const handlePointerUp = () => {
    if (panDrag) {
      setPanDrag(null)
      return
    }
    if (drag) {
      if (drag.curX !== drag.origX || drag.curY !== drag.origY) {
        handlePatch(drag.name, { schX: drag.curX, schY: drag.curY })
      }
      setDrag(null)
    }
  }

  const handleCompPointerDown = (event: ReactPointerEvent, comp: SchematicCompView) => {
    if (tool !== "select" || event.button !== 0 || event.shiftKey) return
    event.stopPropagation()
    setSelectedName(comp.name)
    const world = screenToWorld(event.clientX, event.clientY)
    setDrag({ name: comp.name, startWorld: world, origX: comp.x, origY: comp.y, curX: comp.x, curY: comp.y })
  }

  const handlePinClick = (event: ReactPointerEvent, pin: SchematicPinView) => {
    event.stopPropagation()
    if (tool === "wire") {
      if (!wireStart) {
        setWireStart(pin)
      } else if (wireStart.selector !== pin.selector) {
        const res = addTrace(project.files, project.entrypoint, wireStart.selector, pin.selector)
        if (res.status === "updated") onCommitFiles(res.files)
        setWireStart(null)
      }
      return
    }
    if (tool === "netlabel") {
      const label = netLabelName.trim() || "NET1"
      const snippet = `<netlabel net=${JSON.stringify(label)} connection=${JSON.stringify(`${pin.componentName}.${pin.pinLabel}`)} schX={${roundMm(pin.x + 0.5)}} schY={${roundMm(pin.y + 0.5)}} />`
      const res = insertIntoBoard(project.files, project.entrypoint, snippet)
      if (res.status === "updated") onCommitFiles(res.files)
    }
  }

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-surface">
      {/* KiCad-style Schematic Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line bg-panel px-3 py-1.5 text-xs">
        <span className="font-semibold text-ink">Editor Skematik</span>
        <span className="h-4 w-px bg-line" />

        <div className="flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5" role="group" aria-label="Alat skematik">
          {([
            ["select", "Pilih / Geser (V)", MousePointer2],
            ["wire", "Kabel (W)", Spline],
            ["place", "Tambah Part (A)", Plus],
            ["netlabel", "Net Label (L)", Tag],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              aria-pressed={tool === id}
              title={label}
              onClick={() => {
                setTool(id)
                setWireStart(null)
              }}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition ${
                tool === id ? "bg-accent text-accent-ink" : "text-muted hover:bg-raised hover:text-ink"
              }`}
            >
              <Icon size={13} />
              <span className="hidden md:inline">{label.split(" (")[0]}</span>
            </button>
          ))}
        </div>

        {tool === "place" && (
          <select
            aria-label="Pilih komponen"
            value={placePresetId}
            onChange={(e) => setPlacePresetId(e.target.value)}
            className="h-7 rounded-md border border-line bg-surface px-2 text-xs text-ink"
          >
            {PART_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        )}

        {tool === "netlabel" && (
          <input
            aria-label="Nama net label"
            value={netLabelName}
            onChange={(e) => setNetLabelName(e.target.value)}
            placeholder="VCC / GND"
            className="h-7 w-28 rounded-md border border-line bg-surface px-2 font-mono text-xs text-ink"
          />
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
            <IconButton
              label="Putar 90° (R)"
              className="size-7"
              onClick={() => {
                const cur = selectedSummary?.schRotation ?? 0
                handlePatch(selectedName, { schRotation: (cur + 90) % 360 })
              }}
            >
              <RotateCw size={14} />
            </IconButton>
            <IconButton label="Hapus komponen (Del)" className="size-7 hover:text-danger" onClick={() => handleDelete(selectedName)}>
              <Trash2 size={14} />
            </IconButton>
          </>
        )}

        <div className="ml-auto flex items-center gap-1">
          <span className="hidden font-mono text-[11px] text-muted tabular-nums lg:inline">
            X: {cursorWorld.x.toFixed(1)} Y: {cursorWorld.y.toFixed(1)}
          </span>
          <IconButton label="Perbesar" className="size-7" onClick={() => setZoom((z) => Math.min(220, z * 1.2))}>
            <ZoomIn size={14} />
          </IconButton>
          <IconButton label="Perkecil" className="size-7" onClick={() => setZoom((z) => Math.max(16, z * 0.8))}>
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

      {/* Main canvas + Inspector */}
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 flex-1 overflow-hidden bg-surface">
          <svg
            ref={svgRef}
            aria-label="Kanvas skematik"
            className={`h-full w-full select-none ${tool === "place" || tool === "wire" ? "cursor-crosshair" : panDrag ? "cursor-grabbing" : "cursor-default"}`}
            onWheel={handleWheel}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
          >
            <defs>
              <pattern id="sch-grid" width={zoom * GRID_STEP} height={zoom * GRID_STEP} patternUnits="userSpaceOnUse">
                <circle cx={1} cy={1} r={0.9} fill="var(--color-line)" />
              </pattern>
            </defs>
            <rect width="100%" height="100%" fill="url(#sch-grid)" />

            <g transform={`translate(${(svgRef.current?.clientWidth ?? 600) / 2 + pan.x}, ${(svgRef.current?.clientHeight ?? 400) / 2 + pan.y})`}>
              {/* Origin axes */}
              <line x1={-4000} y1={0} x2={4000} y2={0} stroke="var(--color-line)" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />
              <line x1={0} y1={-4000} x2={0} y2={4000} stroke="var(--color-line)" strokeWidth={1} strokeDasharray="4 4" opacity={0.5} />

              {/* Existing wires */}
              {scene.wires.map((wire) =>
                wire.segments.map((seg, idx) => (
                  <line
                    key={`${wire.id}_${idx}`}
                    x1={seg.from.x * zoom}
                    y1={-seg.from.y * zoom}
                    x2={seg.to.x * zoom}
                    y2={-seg.to.y * zoom}
                    stroke="#34d399"
                    strokeWidth={2}
                    strokeLinecap="round"
                  />
                )),
              )}

              {/* Live rubber-band wire preview */}
              {tool === "wire" && wireStart && (
                <polyline
                  points={`${wireStart.x * zoom},${-wireStart.y * zoom} ${cursorWorld.x * zoom},${-wireStart.y * zoom} ${cursorWorld.x * zoom},${-cursorWorld.y * zoom}`}
                  fill="none"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  strokeDasharray="5 3"
                />
              )}

              {/* Net labels */}
              {scene.labels.map((lbl) => (
                <g key={lbl.id} transform={`translate(${lbl.x * zoom}, ${-lbl.y * zoom})`}>
                  <rect x={-22} y={-10} width={44} height={18} rx={4} fill="var(--color-raised)" stroke="var(--color-accent)" strokeWidth={1} />
                  <text textAnchor="middle" y={3} fill="var(--color-accent)" fontSize={10} fontFamily="var(--font-mono)" fontWeight={600}>
                    {lbl.text}
                  </text>
                </g>
              ))}

              {/* Components */}
              {scene.components.map((comp) => {
                const isDragging = drag?.name === comp.name
                const cx = (isDragging ? drag.curX : comp.x) * zoom
                const cy = -(isDragging ? drag.curY : comp.y) * zoom
                const w = comp.width * zoom
                const h = comp.height * zoom
                const selected = selectedName === comp.name
                const isLocked = lockedComponents?.has(comp.name) ?? false
                return (
                  <g
                    key={comp.id}
                    onPointerDown={(e) => handleCompPointerDown(e, comp)}
                    className="cursor-move"
                  >
                    <rect
                      x={cx - w / 2}
                      y={cy - h / 2}
                      width={w}
                      height={h}
                      rx={6}
                      fill="var(--color-panel)"
                      stroke={selected ? "var(--color-accent)" : isLocked ? "var(--color-warn)" : "var(--color-info)"}
                      strokeWidth={selected ? 2.5 : 1.5}
                    />
                    <text x={cx} y={cy - h / 2 - 6} textAnchor="middle" fill="var(--color-ink)" fontSize={11} fontWeight={600} fontFamily="var(--font-mono)">
                      {comp.name}
                      {isLocked ? " 🔒" : ""}
                    </text>
                    {comp.value && (
                      <text x={cx} y={cy + 4} textAnchor="middle" fill="var(--color-muted)" fontSize={10} fontFamily="var(--font-mono)">
                        {comp.value}
                      </text>
                    )}

                    {/* Pins */}
                    {comp.pins.map((pin) => {
                      const px = (pin.x + (isDragging ? drag.curX - comp.x : 0)) * zoom
                      const py = -(pin.y + (isDragging ? drag.curY - comp.y : 0)) * zoom
                      const isWireOrigin = wireStart?.id === pin.id
                      return (
                        <g
                          key={pin.id}
                          onPointerDown={(e) => handlePinClick(e, pin)}
                          className="cursor-pointer"
                        >
                          <circle
                            cx={px}
                            cy={py}
                            r={tool === "wire" || tool === "netlabel" ? 6 : 4}
                            fill={isWireOrigin ? "#fbbf24" : "var(--color-surface)"}
                            stroke={isWireOrigin ? "#fbbf24" : "#38bdf8"}
                            strokeWidth={2}
                          />
                          <title>{`${pin.componentName}.${pin.pinLabel} (${pin.selector})`}</title>
                        </g>
                      )
                    })}
                  </g>
                )
              })}
            </g>
          </svg>

          {/* Bottom hint bar */}
          <div className="pointer-events-none absolute bottom-2 left-3 rounded-lg border border-line bg-panel/90 px-2.5 py-1 text-[11px] text-muted backdrop-blur-xs">
            {tool === "wire"
              ? wireStart
                ? `Kabel dari ${wireStart.componentName}.${wireStart.pinLabel} → klik pin tujuan (Esc batal)`
                : "Klik pin awal untuk menarik kabel (<trace>)"
              : tool === "place"
                ? "Klik di kanvas untuk menempatkan komponen"
                : tool === "netlabel"
                  ? `Klik pin untuk memasang netlabel "${netLabelName}"`
                  : "Seret komponen untuk pindah · Shift+Seret untuk geser kanvas · R putar · W kabel · A tambah part"}
          </div>
        </div>

        <PropertyInspector
          component={selectedSummary}
          mode="schematic"
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
