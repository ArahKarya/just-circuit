import type { PcbBoardView, PcbCompView, Point2D } from "./circuit-extract"
import { roundMm } from "./tsx-ast"

/** Zoom is expressed in screen pixels per millimetre. */
export const PCB_ZOOM_MIN = 3
export const PCB_ZOOM_MAX = 80

export type AlignAxis = "left" | "top" | "distX" | "distY"

export interface PositionPatch {
  name: string
  patch: { pcbX: number } | { pcbY: number }
}

export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

/** Computes a KiCad-style 45° mitered elbow point between `from` and `to`. */
export function miter45Point(from: Point2D, to: Point2D, diagFirst: boolean): Point2D | null {
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

export function polylineLength(points: readonly Point2D[]): number {
  let len = 0
  for (let i = 1; i < points.length; i += 1) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  }
  return len
}

export function distanceMm(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

export function snapToGrid(value: number, gridMm: number): number {
  return roundMm(Math.round(value / gridMm) * gridMm)
}

export function snapPointToGrid(pt: Point2D, gridMm: number): Point2D {
  return { x: snapToGrid(pt.x, gridMm), y: snapToGrid(pt.y, gridMm) }
}

/** Snaps to the first pad within reach (at least 0.5mm), otherwise to the grid. */
export function snapToPadOrGrid(pt: Point2D, components: readonly PcbCompView[], gridMm: number): Point2D {
  const reach = Math.max(0.5, gridMm * 0.8)
  for (const comp of components) {
    for (const pad of comp.pads) {
      if (Math.hypot(pad.x - pt.x, pad.y - pt.y) <= reach) {
        return { x: roundMm(pad.x), y: roundMm(pad.y) }
      }
    }
  }
  return snapPointToGrid(pt, gridMm)
}

/** Converts a client (screen) point to board millimetres; the canvas centre plus `pan` is the origin, +Y up. */
export function screenToBoardMm(clientX: number, clientY: number, rect: ScreenRect, pan: Point2D, zoom: number): Point2D {
  const sx = clientX - rect.left - rect.width / 2 - pan.x
  const sy = clientY - rect.top - rect.height / 2 - pan.y
  return { x: sx / zoom, y: -sy / zoom }
}

/** Zoom and pan that fit the board into ~78% of the viewport. */
export function fitViewport(viewport: { width: number; height: number }, board: PcbBoardView): { zoom: number; pan: Point2D } {
  const fitW = (viewport.width * 0.78) / Math.max(10, board.width)
  const fitH = (viewport.height * 0.78) / Math.max(10, board.height)
  const zoom = Math.max(4, Math.min(48, Math.min(fitW, fitH)))
  return { zoom, pan: { x: -board.center.x * zoom, y: board.center.y * zoom } }
}

export function clampZoom(zoom: number): number {
  return Math.max(PCB_ZOOM_MIN, Math.min(PCB_ZOOM_MAX, zoom))
}

/** Formats points as an SVG `points` attribute (board Y is flipped to screen Y). */
export function toSvgPoints(points: readonly Point2D[], zoom: number): string {
  return points.map((p) => `${p.x * zoom},${-p.y * zoom}`).join(" ")
}

/** Position patches that align (left/top) or evenly distribute (distX/distY) at least two components. */
export function computeAlignment(comps: readonly PcbCompView[], axis: AlignAxis): PositionPatch[] {
  if (comps.length < 2) return []
  if (axis === "left") {
    const minX = Math.min(...comps.map((c) => c.x))
    return comps.map((c) => ({ name: c.name, patch: { pcbX: roundMm(minX) } }))
  }
  if (axis === "top") {
    const maxY = Math.max(...comps.map((c) => c.y))
    return comps.map((c) => ({ name: c.name, patch: { pcbY: roundMm(maxY) } }))
  }
  if (axis === "distX") {
    const sorted = [...comps].sort((a, b) => a.x - b.x)
    const minX = sorted[0].x
    const step = (sorted[sorted.length - 1].x - minX) / (sorted.length - 1)
    return sorted.map((c, i) => ({ name: c.name, patch: { pcbX: roundMm(minX + step * i) } }))
  }
  const sorted = [...comps].sort((a, b) => b.y - a.y)
  const maxY = sorted[0].y
  const step = (maxY - sorted[sorted.length - 1].y) / (sorted.length - 1)
  return sorted.map((c, i) => ({ name: c.name, patch: { pcbY: roundMm(maxY - step * i) } }))
}
