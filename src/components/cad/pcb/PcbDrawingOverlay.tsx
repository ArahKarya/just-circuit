import type { Point2D } from "../../../lib/circuit-extract"
import { distanceMm, toSvgPoints } from "../../../lib/pcb-cad-geometry"
import { LAYER_COLOR, SELECTED_COLOR, traceMaxCurrent } from "./constants"
import type { PcbDrawing } from "./usePcbDrawing"
import type { PcbToolSettings } from "./usePcbSettings"

const ROUTE_LABEL_COLOR = "#34d399"

interface PcbDrawingOverlayProps {
  settings: PcbToolSettings
  drawing: PcbDrawing
  zoom: number
}

/** Live preview of the route being drawn and the active measure/dimension ruler. */
export function PcbDrawingOverlay({ settings, drawing, zoom }: PcbDrawingOverlayProps) {
  const { tool } = settings
  const rulerStart = tool === "measure" ? drawing.measureStart : tool === "dimension" ? drawing.dimStart : null
  return (
    <>
      {tool === "route" && drawing.previewRoutePts.length >= 2 && <RoutePreview settings={settings} drawing={drawing} zoom={zoom} />}
      {rulerStart && (
        <g>
          <Ruler from={rulerStart} to={drawing.cursorMm} zoom={zoom} />
        </g>
      )}
    </>
  )
}

function RoutePreview({ settings, drawing, zoom }: PcbDrawingOverlayProps) {
  const { activeLayer, traceWidth } = settings
  const { cursorMm, routePts } = drawing
  return (
    <>
      <polyline
        points={toSvgPoints(drawing.previewRoutePts, zoom)}
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
      <text x={cursorMm.x * zoom + 10} y={-cursorMm.y * zoom - 10} fill={ROUTE_LABEL_COLOR} fontSize={11} fontWeight={600} fontFamily="var(--font-mono)">
        {drawing.activeRouteLenMm.toFixed(2)} mm · maks {traceMaxCurrent(traceWidth)}A
      </text>
    </>
  )
}

function Ruler({ from, to, zoom }: { from: Point2D; to: Point2D; zoom: number }) {
  return (
    <>
      <line x1={from.x * zoom} y1={-from.y * zoom} x2={to.x * zoom} y2={-to.y * zoom} stroke={SELECTED_COLOR} strokeWidth={1.5} strokeDasharray="4 3" />
      <circle cx={from.x * zoom} cy={-from.y * zoom} r={3.5} fill={SELECTED_COLOR} />
      <circle cx={to.x * zoom} cy={-to.y * zoom} r={3.5} fill={SELECTED_COLOR} />
      <text
        x={((from.x + to.x) / 2) * zoom}
        y={-((from.y + to.y) / 2) * zoom - 8}
        textAnchor="middle"
        fill={SELECTED_COLOR}
        fontSize={11}
        fontWeight={600}
        fontFamily="var(--font-mono)"
      >
        {distanceMm(from, to).toFixed(2)} mm
      </text>
    </>
  )
}
