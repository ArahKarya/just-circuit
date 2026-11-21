import { findBoardElement, getAttr, patchBoardProps, type JsxElementNode, type PatchResult, type PropPatchValue } from "./tsx-ast"
import type { ProjectFiles } from "./types"

/** Allowed values from BoardProps in @tscircuit/props. Booleans are written as "true"/"false". */
export const BOARD_LAYER_VALUES = ["1", "2", "4", "6", "8", "10"] as const
export const BOARD_MATERIAL_VALUES = ["fr4", "fr1", "flex"] as const
export const FABRICATOR_PRESET_VALUES = ["jlcpcb_economy", "jlcpcb_standard", "jlcpcb_economy_20260912", "jlcpcb_standard_20260912"] as const
export const VIA_TENTING_VALUES = ["true", "false", "both_sides", "top_and_bottom_tented", "top_tented", "bottom_tented", "exposed"] as const

export const BOARD_FIELDS = [
  "width",
  "height",
  "layers",
  "material",
  "thickness",
  "borderRadius",
  "fabricatorPreset",
  "defaultViaTenting",
  "allowBlindAndBuriedVias",
  "title",
] as const

export type BoardField = (typeof BOARD_FIELDS)[number]

/** One `<board>` attribute: missing, a literal the dialog can edit, or an expression it must leave alone. */
export type BoardFieldState = { kind: "absent" } | { kind: "literal"; text: string } | { kind: "expression"; raw: string }

export type BoardConfig = Readonly<Record<BoardField, BoardFieldState>>

export type BoardDraft = Readonly<Partial<Record<BoardField, string>>>

const DISTANCE_FIELDS: ReadonlySet<BoardField> = new Set(["width", "height", "thickness", "borderRadius"])
/** Number (comma or dot decimal, `.5`, `1e3`) with an optional unit. */
const DISTANCE_TEXT = /^(-?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:e[+-]?\d+)?)\s*(mm|cm|in|mil)?$/i

function readField(board: JsxElementNode, name: BoardField): BoardFieldState {
  const attr = getAttr(board, name)
  if (!attr) return { kind: "absent" }
  const parsed = attr.parsed
  if (parsed.kind === "expression") return { kind: "expression", raw: parsed.raw }
  if (parsed.kind === "string" || parsed.kind === "boolean") return { kind: "literal", text: String(parsed.value) }
  // Quoted numbers keep their original spelling ("50mm"); `{50}` reads back as "50".
  const quoted = attr.rawValue?.startsWith('"') || attr.rawValue?.startsWith("'")
  return { kind: "literal", text: quoted && attr.rawValue ? attr.rawValue.slice(1, -1) : String(parsed.value) }
}

/** Reads the editable board properties; null when the entrypoint has no `<board>`. */
export function readBoardConfig(files: ProjectFiles, entrypoint: string): BoardConfig | null {
  const board = findBoardElement(files, entrypoint)
  if (!board) return null
  return Object.fromEntries(BOARD_FIELDS.map((field) => [field, readField(board, field)])) as Record<BoardField, BoardFieldState>
}

/** Text shown in the dialog for a field ("" when absent). */
export function boardFieldText(state: BoardFieldState): string {
  if (state.kind === "absent") return ""
  return state.kind === "literal" ? state.text : state.raw
}

function normalize(field: BoardField, text: string): string {
  const trimmed = text.trim()
  return field === "allowBlindAndBuriedVias" && trimmed === "false" ? "" : trimmed
}

/** Parses a distance into a number (mm) or a normalized unit string; null when invalid. */
export function parseDistance(text: string): number | string | null {
  const match = text.trim().match(DISTANCE_TEXT)
  if (!match) return null
  const value = Number(match[1].replace(",", "."))
  if (!Number.isFinite(value)) return null
  return match[2] ? `${value}${match[2].toLowerCase()}` : value
}

function changedFields(initial: BoardConfig, draft: BoardDraft): { field: BoardField; text: string }[] {
  return BOARD_FIELDS.flatMap((field) => {
    const next = draft[field]
    const state = initial[field]
    if (next === undefined || state.kind === "expression") return []
    const text = normalize(field, next)
    return text === normalize(field, boardFieldText(state)) ? [] : [{ field, text }]
  })
}

/** Errors for changed distance fields that are not a number with an optional mm/cm/in/mil unit. */
export function boardDraftErrors(initial: BoardConfig, draft: BoardDraft): Partial<Record<BoardField, string>> {
  const errors: Partial<Record<BoardField, string>> = {}
  for (const { field, text } of changedFields(initial, draft)) {
    if (DISTANCE_FIELDS.has(field) && text !== "" && parseDistance(text) === null) {
      errors[field] = "Harus angka dengan satuan opsional mm, cm, in, atau mil (mis. 50mm, 5,5, .5in)"
    }
  }
  return errors
}

function coerce(field: BoardField, text: string): PropPatchValue {
  if (text === "") return undefined
  if (field === "layers") return Number(text)
  if (field === "allowBlindAndBuriedVias") return text === "true" ? true : undefined
  if (field === "defaultViaTenting" && (text === "true" || text === "false")) return text === "true"
  if (DISTANCE_FIELDS.has(field)) return parseDistance(text) ?? text
  return text
}

/** Builds a patch with only the literal/absent fields whose text differs from the initial read. */
export function buildBoardPatch(initial: BoardConfig, draft: BoardDraft): Record<string, PropPatchValue> {
  return Object.fromEntries(changedFields(initial, draft).map(({ field, text }) => [field, coerce(field, text)]))
}

export type BoardSaveResult = PatchResult | { status: "invalid"; errors: Partial<Record<BoardField, string>> }

/** Writes the changed fields to `<board>`; expression attributes are never overwritten. */
export function saveBoardConfig(files: ProjectFiles, entrypoint: string, initial: BoardConfig, draft: BoardDraft): BoardSaveResult {
  const errors = boardDraftErrors(initial, draft)
  if (Object.keys(errors).length > 0) return { status: "invalid", errors }
  return patchBoardProps(files, entrypoint, buildBoardPatch(initial, draft))
}
