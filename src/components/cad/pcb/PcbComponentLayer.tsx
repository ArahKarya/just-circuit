import type { PointerEvent as ReactPointerEvent } from "react"
import type { PcbCompView, PcbPadView } from "../../../lib/circuit-extract"
import { CANVAS_BG, LAYER_COLOR, layerVisible, type PcbTool } from "./constants"
import type { ComponentDrag } from "./usePcbPointer"
import type { PcbViewOptions } from "./usePcbSettings"

const PLATED_HOLE_COLOR = "#eab308"

interface PcbComponentLayerProps {
  components: readonly PcbCompView[]
  zoom: number
  tool: PcbTool
  view: PcbViewOptions
  drag: ComponentDrag | null
  selectedNames: readonly string[]
  lockedComponents?: ReadonlySet<string>
  onComponentPointerDown: (event: ReactPointerEvent, comp: PcbCompView) => void
}

/** Component bodies, pads and designator labels; a dragged part is drawn at its drag offset. */
export function PcbComponentLayer({ components, zoom, tool, view, drag, selectedNames, lockedComponents, onComponentPointerDown }: PcbComponentLayerProps) {
  return components.map((comp) => {
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
      <g key={comp.id} onPointerDown={(e) => onComponentPointerDown(e, comp)} className={tool === "select" && view.filterComp ? "cursor-move" : ""}>
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
        {comp.pads.map((pad) =>
          layerVisible(pad.layer, view.showTop, view.showBottom) ? <Pad key={pad.id} pad={pad} zoom={zoom} dx={dx} dy={dy} /> : null,
        )}
        <text x={cx} y={cy - h / 2 - 4} textAnchor="middle" fill="#e2e8f0" fontSize={10} fontWeight={600} fontFamily="var(--font-mono)">
          {comp.name}
          {isLocked ? " 🔒" : ""}
        </text>
      </g>
    )
  })
}

function Pad({ pad, zoom, dx, dy }: { pad: PcbPadView; zoom: number; dx: number; dy: number }) {
  const px = (pad.x + dx) * zoom
  const py = -(pad.y + dy) * zoom
  const fill = pad.isPlatedHole ? PLATED_HOLE_COLOR : LAYER_COLOR[pad.layer] ?? "#ef4444"
  const label = `${pad.componentName}.${pad.pinLabel}`
  if (pad.shape === "circle") {
    return (
      <g>
        <circle cx={px} cy={py} r={Math.max(2.5, (pad.width / 2) * zoom)} fill={fill} opacity={0.9} />
        {pad.isPlatedHole && <circle cx={px} cy={py} r={Math.max(1.2, (pad.width / 4) * zoom)} fill={CANVAS_BG} />}
        <title>{label}</title>
      </g>
    )
  }
  return (
    <rect
      x={px - (pad.width * zoom) / 2}
      y={py - (pad.height * zoom) / 2}
      width={Math.max(3, pad.width * zoom)}
      height={Math.max(3, pad.height * zoom)}
      rx={1}
      fill={fill}
      opacity={0.9}
    >
      <title>{label}</title>
    </rect>
  )
}
