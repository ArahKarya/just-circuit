import type { PcbScene, Point2D } from "../../../lib/circuit-extract"
import { manualTraceIndexes, polylineLength, toSvgPoints } from "../../../lib/pcb-cad-geometry"
import type { CopperPourEntry } from "../../../lib/tsx-rules"
import { CANVAS_BG, HIGHLIGHT_COLOR, LAYER_COLOR, POUR_FALLBACK_COLOR, SELECTED_COLOR, layerVisible, traceColor, traceMaxCurrent, type PcbTool } from "./constants"
import type { PcbSelection } from "./usePcbSelection"
import type { PcbViewOptions } from "./usePcbSettings"

const BOARD_FILL = "#0f1f17"
const EDGE_CUTS = "#eab308"
const VIA_COPPER = "#d4a359"
/** Manual vias are matched to rendered vias by position within this distance (mm). */
const VIA_MATCH_MM = 0.2

interface PcbCopperLayersProps {
  scene: PcbScene
  zoom: number
  tool: PcbTool
  view: PcbViewOptions
  selection: PcbSelection
  pours: readonly CopperPourEntry[]
  manualTraceRoutes: readonly (readonly Point2D[])[]
  manualVias: readonly { x: number; y: number }[]
  heatmapCurrentA: number
}

/** Board outline, copper pour shading, traces, ratsnest and vias. */
export function PcbCopperLayers(props: PcbCopperLayersProps) {
  return (
    <>
      <BoardOutline scene={props.scene} zoom={props.zoom} />
      <PourShading {...props} />
      <Traces {...props} />
      <Ratsnest {...props} />
      <Vias {...props} />
    </>
  )
}

function BoardOutline({ scene, zoom }: { scene: PcbScene; zoom: number }) {
  const { board } = scene
  if (board.outline) {
    return <polygon points={toSvgPoints(board.outline, zoom)} fill={BOARD_FILL} stroke={EDGE_CUTS} strokeWidth={2} />
  }
  return (
    <rect
      x={(board.center.x - board.width / 2) * zoom}
      y={-(board.center.y + board.height / 2) * zoom}
      width={board.width * zoom}
      height={board.height * zoom}
      fill={BOARD_FILL}
      stroke={EDGE_CUTS}
      strokeWidth={2}
    />
  )
}

function PourShading({ scene, zoom, view, pours }: PcbCopperLayersProps) {
  const { board } = scene
  return pours.map((pour, idx) => {
    if (!layerVisible(pour.layer, view.showTop, view.showBottom)) return null
    const color = LAYER_COLOR[pour.layer] ?? POUR_FALLBACK_COLOR
    return (
      <rect
        key={idx}
        x={(board.center.x - board.width / 2 + 0.5) * zoom}
        y={-(board.center.y + board.height / 2 - 0.5) * zoom}
        width={Math.max(0, (board.width - 1) * zoom)}
        height={Math.max(0, (board.height - 1) * zoom)}
        fill={color}
        fillOpacity={0.07}
        stroke={color}
        strokeOpacity={0.35}
        strokeDasharray="6 4"
        strokeWidth={1}
        pointerEvents="none"
      />
    )
  })
}

/** Traces are clickable to highlight their net; manual traces also become selectable for deletion. */
function Traces({ scene, zoom, tool, view, selection, manualTraceRoutes, heatmapCurrentA }: PcbCopperLayersProps) {
  const pickable = tool === "select" && view.filterTrace
  const manualIndexes = manualTraceIndexes(scene.traces, manualTraceRoutes)
  return scene.traces.map((trace, idx) => {
    if (!layerVisible(trace.layer, view.showTop, view.showBottom)) return null
    const manualIdx = manualIndexes[idx]
    const isSelected = manualIdx !== -1 && selection.selectedTraceIdx === manualIdx
    const isHighlighted = Boolean(selection.highlightedNet && trace.netName === selection.highlightedNet)
    const lenMm = polylineLength(trace.points)
    const maxA = traceMaxCurrent(trace.width)
    return (
      <polyline
        key={trace.id}
        points={toSvgPoints(trace.points, zoom)}
        fill="none"
        stroke={traceColor(trace.layer, trace.width, { isSelected, isHighlighted, heatmapCurrentA })}
        strokeWidth={Math.max(2, trace.width * zoom)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={isSelected || isHighlighted ? 1 : 0.85}
        className={pickable ? "cursor-pointer" : ""}
        onPointerDown={(e) => {
          if (!pickable) return
          e.stopPropagation()
          if (trace.netName) selection.setHighlightedNet(trace.netName)
          if (manualIdx !== -1) selection.selectTrace(manualIdx)
        }}
      >
        <title>{`${trace.layer} · ${trace.width}mm · ${lenMm.toFixed(1)}mm · maks ${maxA}A${trace.netName ? ` · ${trace.netName}` : ""}`}</title>
      </polyline>
    )
  })
}

function Ratsnest({ scene, zoom, view, selection }: PcbCopperLayersProps) {
  if (!view.showRatsnest) return null
  return scene.ratsnest.map((wire, idx) => {
    const isHi = Boolean(selection.highlightedNet && wire.netName === selection.highlightedNet)
    return (
      <line
        key={idx}
        x1={wire.from.x * zoom}
        y1={-wire.from.y * zoom}
        x2={wire.to.x * zoom}
        y2={-wire.to.y * zoom}
        stroke={isHi ? HIGHLIGHT_COLOR : "#94a3b8"}
        strokeWidth={isHi ? 1.5 : 0.8}
        strokeDasharray="3 3"
        opacity={isHi ? 0.95 : 0.55}
      />
    )
  })
}

function Vias({ scene, zoom, tool, view, selection, manualVias }: PcbCopperLayersProps) {
  return scene.vias.map((via) => {
    const manualIdx = manualVias.findIndex((mv) => Math.hypot(mv.x - via.x, mv.y - via.y) < VIA_MATCH_MM)
    const pickable = tool === "select" && view.filterVia && manualIdx !== -1
    const isSelected = manualIdx !== -1 && selection.selectedViaIdx === manualIdx
    return (
      <g
        key={via.id}
        transform={`translate(${via.x * zoom}, ${-via.y * zoom})`}
        className={pickable ? "cursor-pointer" : ""}
        onPointerDown={(e) => {
          if (!pickable) return
          e.stopPropagation()
          selection.selectVia(manualIdx)
        }}
      >
        <circle r={Math.max(3, (via.outerDiameter / 2) * zoom)} fill={isSelected ? SELECTED_COLOR : VIA_COPPER} />
        <circle r={Math.max(1.5, (via.holeDiameter / 2) * zoom)} fill={CANVAS_BG} />
      </g>
    )
  })
}
