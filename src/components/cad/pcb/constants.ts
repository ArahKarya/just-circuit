import { calcTraceMaxCurrent } from "../../../lib/pcb-calc"

export type PcbTool = "select" | "route" | "via" | "hole" | "cutout" | "fiducial" | "testpoint" | "silktext" | "dimension" | "measure"
export type CopperLayer = "top" | "bottom"

export const GRID_OPTIONS = [0.1, 0.25, 0.5, 1, 2.54] as const
export const WIDTH_OPTIONS = [0.15, 0.2, 0.25, 0.4, 0.6, 1.0, 1.5] as const

export const LAYER_COLOR: Record<string, string> = {
  top: "#ef4444",
  bottom: "#3b82f6",
  all: "#eab308",
}

export const POUR_FALLBACK_COLOR = "#34d399"
export const SELECTED_COLOR = "#38bdf8"
export const HIGHLIGHT_COLOR = "#facc15"
export const CANVAS_BG = "#090c10"

/** IPC-2221 ampacity for an outer-layer trace with 10°C rise and 1oz copper. */
export function traceMaxCurrent(widthMm: number): number {
  return calcTraceMaxCurrent(widthMm, 10, 1, false)
}

export function otherLayer(layer: CopperLayer): CopperLayer {
  return layer === "top" ? "bottom" : "top"
}

export function layerVisible(layer: string, showTop: boolean, showBottom: boolean): boolean {
  if (layer === "top") return showTop
  if (layer === "bottom") return showBottom
  return true
}

interface TraceColorState {
  isSelected: boolean
  isHighlighted: boolean
  /** Simulated circuit current in amps; 0 disables the heatmap colouring. */
  heatmapCurrentA: number
}

export function traceColor(layer: string, width: number, state: TraceColorState): string {
  if (state.isSelected) return SELECTED_COLOR
  if (state.isHighlighted) return HIGHLIGHT_COLOR
  if (state.heatmapCurrentA > 0) {
    const ratio = state.heatmapCurrentA / Math.max(0.05, traceMaxCurrent(width))
    if (ratio >= 1) return "#ef4444"
    if (ratio >= 0.7) return "#f59e0b"
    return "#10b981"
  }
  return LAYER_COLOR[layer] ?? "#ef4444"
}
