import type { PcbScene, Point2D } from "../../../lib/circuit-extract"
import type { CopperPourEntry } from "../../../lib/tsx-rules"
import { CANVAS_BG } from "./constants"
import { PcbComponentLayer } from "./PcbComponentLayer"
import { PcbCopperLayers } from "./PcbCopperLayers"
import { PcbDrawingOverlay } from "./PcbDrawingOverlay"
import type { PcbDrawing } from "./usePcbDrawing"
import type { PcbPointer } from "./usePcbPointer"
import type { PcbSelection } from "./usePcbSelection"
import type { PcbToolSettings, PcbViewOptions } from "./usePcbSettings"
import type { PcbViewport } from "./usePcbViewport"

interface PcbCanvasProps {
  scene: PcbScene
  settings: PcbToolSettings
  view: PcbViewOptions
  viewport: PcbViewport
  pointer: PcbPointer
  drawing: PcbDrawing
  selection: PcbSelection
  pours: readonly CopperPourEntry[]
  /** Written route of each manual `<pcbtrace>`, in source order. */
  manualTraceRoutes: readonly (readonly Point2D[])[]
  manualVias: readonly { x: number; y: number }[]
  heatmapCurrentA: number
  lockedComponents?: ReadonlySet<string>
}

/** The SVG PCB canvas: dotted grid, copper, parts and the active drawing overlay. */
export function PcbCanvas(props: PcbCanvasProps) {
  const { scene, settings, view, viewport, pointer, drawing, selection } = props
  const { tool, gridMm } = settings
  const { svgRef, pan, zoom } = viewport
  const cursorClass = tool !== "select" ? "cursor-crosshair" : pointer.isPanning ? "cursor-grabbing" : "cursor-default"
  const gridStep = Math.max(6, gridMm * zoom)
  const originX = (svgRef.current?.clientWidth ?? 600) / 2 + pan.x
  const originY = (svgRef.current?.clientHeight ?? 400) / 2 + pan.y
  return (
    <svg
      ref={svgRef}
      aria-label="Kanvas PCB CAD"
      className={`h-full w-full select-none ${cursorClass}`}
      onWheel={viewport.handleWheel}
      onPointerDown={pointer.handleCanvasPointerDown}
      onPointerMove={pointer.handlePointerMove}
      onPointerUp={pointer.handlePointerUp}
    >
      <defs>
        <pattern id="pcb-grid" width={gridStep} height={gridStep} patternUnits="userSpaceOnUse">
          <circle cx={1} cy={1} r={0.8} fill="#252c3b" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={CANVAS_BG} />
      <rect width="100%" height="100%" fill="url(#pcb-grid)" />

      <g transform={`translate(${originX}, ${originY})`}>
        <PcbCopperLayers
          scene={scene}
          zoom={zoom}
          tool={tool}
          view={view}
          selection={selection}
          pours={props.pours}
          manualTraceRoutes={props.manualTraceRoutes}
          manualVias={props.manualVias}
          heatmapCurrentA={props.heatmapCurrentA}
        />
        <PcbComponentLayer
          components={scene.components}
          zoom={zoom}
          tool={tool}
          view={view}
          drag={pointer.drag}
          selectedNames={selection.selectedNames}
          lockedComponents={props.lockedComponents}
          onComponentPointerDown={pointer.handleCompPointerDown}
        />
        <PcbDrawingOverlay settings={settings} drawing={drawing} zoom={zoom} />
      </g>
    </svg>
  )
}
