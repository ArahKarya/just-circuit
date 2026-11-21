import { uniquePinLabels } from "./pin-labels"
import { jsxStringValue } from "./tsx-ast"

export type PackageFamily = "soic" | "qfn" | "bga" | "pinrow"

/**
 * Wizard input, all in mm. `leadSpan` is the toe-to-toe span E (SOIC) or the body size (QFN);
 * `padLength` runs away from the body, `padWidth` along the row.
 */
export interface FootprintParams {
  family: PackageFamily
  pinCount: number
  pitch: number
  leadSpan: number
  bodyWidth: number
  padLength: number
  padWidth: number
  /** Square exposed thermal pad edge for QFN; 0 = none. */
  exposedPad: number
}

export interface PadSpec {
  num: number
  x: number
  y: number
  w: number
  h: number
  shape: "rect" | "circle"
  plated?: boolean
}

export interface Point {
  x: number
  y: number
}

/**
 * How far the land extends past the lead tip, roughly IPC-7351 nominal density
 * (KiCad's SOIC-8 3.9x4.9 P1.27 lands at x=±2.475, 1.95 mm long, from E = 6.0).
 */
export const TOE_EXTENSION_MM: Record<PackageFamily, number> = { soic: 0.45, qfn: 0.3, bga: 0, pinrow: 0 }

const MIN_PINS = 2
const MAX_PINS = 128
const SILK_CLEARANCE_MM = 0.25
const PIN1_MARKER_GAP_MM = 0.5
const PIN1_MARKER_RADIUS_MM = 0.2
const MIN_PAD_GAP_MM = 0.1
const DRILL_RATIO = 0.55
const MIN_EP_GAP_MM = 0.15

export const FAMILY_DEFAULTS: Record<PackageFamily, Omit<FootprintParams, "family">> = {
  soic: { pinCount: 8, pitch: 1.27, leadSpan: 6.0, bodyWidth: 3.9, padLength: 1.95, padWidth: 0.6, exposedPad: 0 },
  qfn: { pinCount: 16, pitch: 0.5, leadSpan: 3.0, bodyWidth: 3.0, padLength: 0.8, padWidth: 0.3, exposedPad: 1.65 },
  pinrow: { pinCount: 4, pitch: 2.54, leadSpan: 0, bodyWidth: 2.54, padLength: 1.7, padWidth: 1.7, exposedPad: 0 },
  bga: { pinCount: 16, pitch: 0.8, leadSpan: 0, bodyWidth: 4.0, padLength: 0.4, padWidth: 0.4, exposedPad: 0 },
}

/** 0.001 mm resolution, so 0.65 mm pitches and 2.475 mm offsets survive. */
export function roundUm(value: number): number {
  const rounded = Math.round(value * 1000) / 1000
  return Object.is(rounded, -0) ? 0 : rounded
}

function clampPins(pinCount: number): number {
  return Math.max(MIN_PINS, Math.min(MAX_PINS, Math.round(pinCount) || MIN_PINS))
}

/** Pin count the family can actually lay out (even for SOIC, a multiple of 4 for QFN). */
export function effectivePinCount(family: PackageFamily, pinCount: number): number {
  const n = clampPins(pinCount)
  if (family === "soic") return Math.ceil(n / 2) * 2
  if (family === "qfn") return Math.max(4, Math.floor(n / 4) * 4)
  return n
}

/** Pad centre distance from the body centre for gull-wing / no-lead rows. */
export function padRowOffset(params: FootprintParams): number {
  return roundUm(params.leadSpan / 2 - params.padLength / 2 + TOE_EXTENSION_MM[params.family])
}

/** Centred positions along a row, first pin at +span. */
function rowPositions(count: number, pitch: number): number[] {
  const start = ((count - 1) * pitch) / 2
  return Array.from({ length: count }, (_, i) => roundUm(start - i * pitch))
}

function soicPads(params: FootprintParams, n: number): PadSpec[] {
  const perSide = n / 2
  const x = padRowOffset(params)
  const ys = rowPositions(perSide, params.pitch)
  const pad = { w: params.padLength, h: params.padWidth, shape: "rect" as const }
  const left = ys.map((y, i) => ({ ...pad, num: i + 1, x: -x, y }))
  const right = [...ys].reverse().map((y, i) => ({ ...pad, num: perSide + i + 1, x, y }))
  return [...left, ...right]
}

function qfnPads(params: FootprintParams, n: number): PadSpec[] {
  const perSide = n / 4
  const off = padRowOffset(params)
  const along = rowPositions(perSide, params.pitch)
  const vertical = { w: params.padLength, h: params.padWidth, shape: "rect" as const }
  const horizontal = { w: params.padWidth, h: params.padLength, shape: "rect" as const }
  // Counter-clockwise from the top of the left row, as on a QFN datasheet top view.
  const sides: PadSpec[][] = [
    along.map((y, i) => ({ ...vertical, num: i + 1, x: -off, y })),
    along.map((p, i) => ({ ...horizontal, num: perSide + i + 1, x: -p, y: -off })),
    along.map((p, i) => ({ ...vertical, num: 2 * perSide + i + 1, x: off, y: -p })),
    along.map((x, i) => ({ ...horizontal, num: 3 * perSide + i + 1, x, y: off })),
  ]
  const ep: PadSpec[] = params.exposedPad > 0 ? [{ num: n + 1, x: 0, y: 0, w: params.exposedPad, h: params.exposedPad, shape: "rect" }] : []
  return [...sides.flat(), ...ep]
}

function pinrowPads(params: FootprintParams, n: number): PadSpec[] {
  const xs = rowPositions(n, params.pitch).reverse()
  return xs.map((x, i) => ({ num: i + 1, x, y: 0, w: params.padLength, h: params.padLength, shape: "circle", plated: true }))
}

function bgaPads(params: FootprintParams, n: number): PadSpec[] {
  const side = Math.ceil(Math.sqrt(n))
  const coords = rowPositions(side, params.pitch)
  const grid = coords.flatMap((y) => [...coords].reverse().map((x) => ({ x, y })))
  return grid.slice(0, n).map((p, i) => ({ num: i + 1, ...p, w: params.padLength, h: params.padLength, shape: "circle" }))
}

/** Pads for the chosen family; numbering follows the usual datasheet top view. */
export function generatePads(params: FootprintParams): PadSpec[] {
  const n = effectivePinCount(params.family, params.pinCount)
  if (params.family === "soic") return soicPads(params, n)
  if (params.family === "qfn") return qfnPads(params, n)
  if (params.family === "pinrow") return pinrowPads(params, n)
  return bgaPads(params, n)
}

/** Silkscreen dot just outside pin 1, on the side away from the body. */
export function pin1Marker(pads: readonly PadSpec[]): Point {
  const first = pads.find((p) => p.num === 1) ?? pads[0]
  return { x: roundUm(first.x - first.w / 2 - PIN1_MARKER_GAP_MM), y: first.y }
}

function closedRect(halfW: number, halfH: number): Point[] {
  const w = roundUm(halfW)
  const h = roundUm(halfH)
  return [
    { x: -w, y: h },
    { x: w, y: h },
    { x: w, y: -h },
    { x: -w, y: -h },
    { x: -w, y: h },
  ]
}

/** Silkscreen routes that stay clear of copper: SOIC gets top/bottom body edges, others a box around the pads. */
export function silkscreenRoutes(params: FootprintParams, pads: readonly PadSpec[]): Point[][] {
  const maxX = Math.max(...pads.map((p) => Math.abs(p.x) + p.w / 2))
  const maxY = Math.max(...pads.map((p) => Math.abs(p.y) + p.h / 2))
  if (params.family === "soic") {
    const halfW = roundUm(params.bodyWidth / 2)
    const y = roundUm(maxY + SILK_CLEARANCE_MM)
    return [
      [{ x: -halfW, y }, { x: halfW, y }],
      [{ x: -halfW, y: -y }, { x: halfW, y: -y }],
    ]
  }
  const halfBody = params.bodyWidth / 2
  return [closedRect(Math.max(halfBody, maxX + SILK_CLEARANCE_MM), Math.max(halfBody, maxY + SILK_CLEARANCE_MM))]
}

/** Geometry problems worth showing before the part is written. */
export function footprintWarnings(params: FootprintParams, pads: readonly PadSpec[]): string[] {
  const warnings: string[] = []
  const requested = clampPins(params.pinCount)
  const actual = effectivePinCount(params.family, params.pinCount)
  if (actual !== requested) warnings.push(`Jumlah pin disesuaikan menjadi ${actual} agar simetris untuk paket ini.`)
  const across = params.family === "pinrow" || params.family === "bga" ? params.padLength : params.padWidth
  if (params.pitch - across < MIN_PAD_GAP_MM) warnings.push("Pad bersentuhan: lebar pad hampir sama atau lebih besar dari pitch.")
  if (params.family === "soic" || params.family === "qfn") {
    const inner = padRowOffset(params) - params.padLength / 2
    if (inner <= MIN_PAD_GAP_MM) warnings.push("Baris pad kiri & kanan bertumpuk: periksa lead span (E) dan panjang pad.")
    if (params.family === "qfn" && params.exposedPad > 0 && params.exposedPad / 2 > inner - MIN_EP_GAP_MM) {
      warnings.push("Exposed pad terlalu besar: jarak ke pad sinyal kurang dari 0,15 mm.")
    }
  }
  if (pads.length === 0) warnings.push("Tidak ada pad yang dihasilkan.")
  return warnings
}

function routeLiteral(route: readonly Point[]): string {
  return `[${route.map((p) => `{ x: ${p.x}, y: ${p.y} }`).join(", ")}]`
}

function padJsx(pad: PadSpec): string {
  const hint = `portHints={[${JSON.stringify(`pin${pad.num}`)}]}`
  const at = `pcbX={${roundUm(pad.x)}} pcbY={${roundUm(pad.y)}}`
  if (pad.plated) {
    return `<platedhole ${hint} shape="circle" outerDiameter="${roundUm(pad.w)}mm" holeDiameter="${roundUm(pad.w * DRILL_RATIO)}mm" ${at} />`
  }
  if (pad.shape === "circle") return `<smtpad ${hint} shape="circle" radius="${roundUm(pad.w / 2)}mm" ${at} />`
  return `<smtpad ${hint} shape="rect" width="${roundUm(pad.w)}mm" height="${roundUm(pad.h)}mm" ${at} />`
}

/** Valid tscircuit component identifier from free text. */
export function safeComponentName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, "")
  if (!cleaned) return "CustomPart"
  return /^[0-9]/.test(cleaned) ? `Part${cleaned}` : cleaned
}

export interface FootprintComponentInput {
  name: string
  params: FootprintParams
  pinNames: readonly string[]
  cadModelUrl?: string
}

/** Pin labels for every pad; the QFN thermal pad defaults to "EP". */
function padLabels(pads: readonly PadSpec[], pinNames: readonly string[], params: FootprintParams): string {
  const epNum = params.family === "qfn" && params.exposedPad > 0 ? pads[pads.length - 1]?.num : undefined
  const raw = pads.map((p, i) => ({ num: p.num, raw: pinNames[i] ?? (p.num === epNum ? "EP" : undefined) }))
  return uniquePinLabels(raw)
    .pins.map((p) => `  pin${p.num}: ${JSON.stringify(p.label)},`)
    .join("\n")
}

/** The complete lib/parts/<Name>.tsx source for a wizard-made chip. */
export function buildFootprintTsx({ name, params, pinNames, cadModelUrl }: FootprintComponentInput): string {
  const safeName = safeComponentName(name)
  const pads = generatePads(params)
  const marker = pin1Marker(pads)
  const silk = silkscreenRoutes(params, pads).map((route) => `        <silkscreenpath route={${routeLiteral(route)}} />`)
  const cadProp = cadModelUrl?.trim() ? `\n    cadModel={{ stepUrl: ${JSON.stringify(cadModelUrl.trim())} }}` : ""
  return `import type { ChipProps } from "@tscircuit/props"

// Dibuat oleh Footprint Wizard sebagai titik awal (land pattern kira-kira IPC-7351).
// Cocokkan ukuran pad, pitch dan lead span dengan land pattern yang disarankan di datasheet sebelum produksi.
const pinLabels = {
${padLabels(pads, pinNames, params)}
} as const

export const ${safeName} = (props: ChipProps<typeof pinLabels>) => (
  <chip
    manufacturerPartNumber=${jsxStringValue(safeName)}
    pinLabels={pinLabels}${cadProp}
    footprint={
      <footprint>
${pads.map((p) => `        ${padJsx(p)}`).join("\n")}
${silk.join("\n")}
        <silkscreencircle pcbX={${marker.x}} pcbY={${marker.y}} radius="${PIN1_MARKER_RADIUS_MM}mm" isFilled />
      </footprint>
    }
    {...props}
  />
)
`
}
