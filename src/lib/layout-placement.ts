import type { ProjectFiles } from "./types"

/**
 * Moving a component in the PCB view: when its JSX already sets pcbX/pcbY,
 * those numbers win over manual-edits.json ("Manual Edit Conflict"), so the
 * drag is written back into the code instead.
 */

interface Point {
  x: number
  y: number
}

export interface PcbMoveEvent {
  pcb_component_id: string
  original_center: Point
  new_center: Point
}

type CircuitElement = Record<string, unknown>

function isPoint(value: unknown): value is Point {
  return !!value && typeof value === "object" && typeof (value as Point).x === "number" && typeof (value as Point).y === "number"
}

export function asPcbMoveEvent(event: Record<string, unknown>): PcbMoveEvent | null {
  const { pcb_component_id, original_center, new_center } = event
  if (typeof pcb_component_id !== "string" || !isPoint(original_center) || !isPoint(new_center)) return null
  return { pcb_component_id, original_center, new_center }
}

/** Name of the source component (e.g. "R1") behind a pcb_component. */
export function componentNameFor(circuitJson: readonly unknown[], pcbComponentId: string): string | null {
  const elements = circuitJson as CircuitElement[]
  const pcb = elements.find((el) => el.type === "pcb_component" && el.pcb_component_id === pcbComponentId)
  const sourceId = pcb?.source_component_id
  const source = elements.find((el) => el.type === "source_component" && el.source_component_id === sourceId)
  return typeof source?.name === "string" ? source.name : null
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

interface TagMatch {
  start: number
  end: number
  text: string
}

/** Finds the opening JSX tag that has name="<name>". */
export function findComponentTag(source: string, name: string): TagMatch | null {
  const quoted = escapeRegExp(name)
  const pattern = new RegExp(`<[A-Za-z][\\w.]*\\b[^<>]*?\\bname=(?:"${quoted}"|'${quoted}'|\\{\\s*["'\`]${quoted}["'\`]\\s*\\})[^<>]*>`)
  const match = pattern.exec(source)
  return match ? { start: match.index, end: match.index + match[0].length, text: match[0] } : null
}

type AttrValue = { kind: "absent" } | { kind: "number"; value: number } | { kind: "unsupported" }

/** Reads attr={1.5}, attr="2mm" or attr="2". Anything else (variables, other units) is unsupported. */
export function readNumericAttr(tag: string, attr: string): AttrValue {
  const match = tag.match(new RegExp(`\\b${attr}=(\\{[^}]*\\}|"[^"]*"|'[^']*')`))
  if (!match) return { kind: "absent" }
  const raw = match[1].slice(1, -1).trim()
  const numeric = raw.match(/^(-?\d+(?:\.\d+)?)(mm)?$/)
  return numeric ? { kind: "number", value: Number(numeric[1]) } : { kind: "unsupported" }
}

function formatMm(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Object.is(rounded, -0) ? "0" : String(rounded)
}

const attrPattern = (attr: string) => new RegExp(`\\b${attr}=(\\{[^}]*\\}|"[^"]*"|'[^']*')`)

/** Sets attr={value}; a new attribute goes right after `after` when present, else after the tag name. */
export function setNumericAttr(tag: string, attr: string, value: number, after?: string): string {
  const replacement = `${attr}={${formatMm(value)}}`
  const existing = attrPattern(attr)
  if (existing.test(tag)) return tag.replace(existing, replacement)
  const anchor = after ? attrPattern(after).exec(tag) : null
  const insertAt = anchor ? anchor.index + anchor[0].length : (tag.match(/^<[A-Za-z][\w.]*/)?.[0].length ?? 1)
  return `${tag.slice(0, insertAt)} ${replacement}${tag.slice(insertAt)}`
}

export type PlacementResult =
  | { status: "updated"; files: ProjectFiles; path: string }
  /** No pcbX/pcbY in the code: store the move in manual-edits.json. */
  | { status: "use-manual-edits" }
  /** pcbX/pcbY is an expression we can't rewrite safely. */
  | { status: "unsupported"; path: string }

/** Shifts the component's pcbX/pcbY in code by the drag distance. */
export function applyMoveToCode(files: ProjectFiles, name: string, move: PcbMoveEvent): PlacementResult {
  const dx = move.new_center.x - move.original_center.x
  const dy = move.new_center.y - move.original_center.y
  for (const [path, source] of Object.entries(files)) {
    if (!/\.(tsx|jsx)$/.test(path)) continue
    const tag = findComponentTag(source, name)
    if (!tag) continue
    const x = readNumericAttr(tag.text, "pcbX")
    const y = readNumericAttr(tag.text, "pcbY")
    if (x.kind === "absent" && y.kind === "absent") return { status: "use-manual-edits" }
    if (x.kind === "unsupported" || y.kind === "unsupported") return { status: "unsupported", path }
    const baseX = x.kind === "number" ? x.value : 0
    const baseY = y.kind === "number" ? y.value : 0
    const nextTag = setNumericAttr(setNumericAttr(tag.text, "pcbX", baseX + dx, "pcbY"), "pcbY", baseY + dy, "pcbX")
    const nextSource = `${source.slice(0, tag.start)}${nextTag}${source.slice(tag.end)}`
    return { status: "updated", files: { ...files, [path]: nextSource }, path }
  }
  return { status: "use-manual-edits" }
}
