import { describe, expect, it } from "vitest"
import {
  BOARD_LAYER_VALUES,
  FABRICATOR_PRESET_VALUES,
  VIA_TENTING_VALUES,
  boardDraftErrors,
  boardFieldText,
  buildBoardPatch,
  readBoardConfig,
  saveBoardConfig,
} from "./tsx-board"

const ENTRY = "index.circuit.tsx"

function boardFile(attrs: string): Record<string, string> {
  return { [ENTRY]: `export default () => (\n  <board ${attrs}>\n    <resistor name="R1" resistance="1k" />\n  </board>\n)\n` }
}

describe("readBoardConfig", () => {
  it("reads quoted, numeric, boolean and expression attributes without inventing defaults", () => {
    const files = boardFile('width={50} height="35mm" layers={10} defaultViaTenting fabricatorPreset="jlcpcb_standard_20260912" thickness={boardT}')
    const cfg = readBoardConfig(files, ENTRY)
    expect(cfg).not.toBeNull()
    if (!cfg) return
    expect(cfg.width).toEqual({ kind: "literal", text: "50" })
    expect(cfg.height).toEqual({ kind: "literal", text: "35mm" })
    expect(cfg.layers).toEqual({ kind: "literal", text: "10" })
    expect(cfg.defaultViaTenting).toEqual({ kind: "literal", text: "true" })
    expect(cfg.fabricatorPreset).toEqual({ kind: "literal", text: "jlcpcb_standard_20260912" })
    expect(cfg.thickness).toEqual({ kind: "expression", raw: "boardT" })
    expect(cfg.material).toEqual({ kind: "absent" })
    expect(boardFieldText(cfg.material)).toBe("")
  })

  it("returns null when there is no board", () => {
    expect(readBoardConfig({ [ENTRY]: "export default () => <group />" }, ENTRY)).toBeNull()
  })
})

describe("buildBoardPatch / saveBoardConfig", () => {
  it("patches only the fields the user changed", () => {
    const files = boardFile('width={50} height={40} layers={10} defaultViaTenting fabricatorPreset="jlcpcb_economy_20260912"')
    const initial = readBoardConfig(files, ENTRY)
    if (!initial) throw new Error("no board")
    expect(buildBoardPatch(initial, { width: "50", height: "40", layers: "10", defaultViaTenting: "true" })).toEqual({})
    expect(buildBoardPatch(initial, { title: "Rev 1", width: "60" })).toEqual({ title: "Rev 1", width: 60 })
  })

  it("never touches expression attributes and keeps unrelated ones on save", () => {
    const files = boardFile("width={w} height={40} layers={10} defaultViaTenting")
    const initial = readBoardConfig(files, ENTRY)
    if (!initial) throw new Error("no board")
    expect(buildBoardPatch(initial, { width: "70mm", title: "X" })).toEqual({ title: "X" })
    const res = saveBoardConfig(files, ENTRY, initial, { width: "70mm", title: "X" })
    expect(res.status).toBe("updated")
    if (res.status !== "updated") return
    const out = res.files[ENTRY]
    expect(out).toContain("width={w}")
    expect(out).toContain("layers={10}")
    expect(out).toContain("defaultViaTenting")
    expect(out).toContain('title="X"')
  })

  it("coerces values per field and deletes cleared fields", () => {
    const files = boardFile('width="30mm" height="20mm" material="flex" allowBlindAndBuriedVias')
    const initial = readBoardConfig(files, ENTRY)
    if (!initial) throw new Error("no board")
    expect(
      buildBoardPatch(initial, { layers: "4", material: "", allowBlindAndBuriedVias: "false", defaultViaTenting: "false", height: "25" }),
    ).toEqual({ layers: 4, material: undefined, allowBlindAndBuriedVias: undefined, defaultViaTenting: false, height: 25 })
  })

  it("treats an absent boolean and false as the same value", () => {
    const initial = readBoardConfig(boardFile('width="30mm"'), ENTRY)
    if (!initial) throw new Error("no board")
    expect(buildBoardPatch(initial, { allowBlindAndBuriedVias: "false" })).toEqual({})
  })
})

describe("board enum values", () => {
  it("covers every value allowed by @tscircuit/props", () => {
    expect(BOARD_LAYER_VALUES).toEqual(["1", "2", "4", "6", "8", "10"])
    expect(FABRICATOR_PRESET_VALUES).toEqual(["jlcpcb_economy", "jlcpcb_standard", "jlcpcb_economy_20260912", "jlcpcb_standard_20260912"])
    expect(VIA_TENTING_VALUES).toEqual(["true", "false", "both_sides", "top_and_bottom_tented", "top_tented", "bottom_tented", "exposed"])
  })
})

describe("distance validation", () => {
  const initial = readBoardConfig(boardFile('width="30mm" height="20mm"'), ENTRY)
  if (!initial) throw new Error("no board")

  it("accepts numbers with optional units, comma decimals, leading dots and exponents", () => {
    expect(boardDraftErrors(initial, { width: "5,5", height: ".5in", thickness: "1e3mil", borderRadius: "2 cm" })).toEqual({})
    expect(buildBoardPatch(initial, { width: "5,5", height: ".5in", thickness: "1.6mm" })).toEqual({ width: 5.5, height: "0.5in", thickness: "1.6mm" })
  })

  it("rejects junk and blocks save", () => {
    expect(Object.keys(boardDraftErrors(initial, { width: "abc", height: "5,5,5", thickness: "3px" }))).toEqual(["width", "height", "thickness"])
    const res = saveBoardConfig(boardFile('width="30mm" height="20mm"'), ENTRY, initial, { width: "abc" })
    expect(res.status).toBe("invalid")
  })

  it("does not validate untouched or cleared fields", () => {
    expect(boardDraftErrors(initial, { width: "30mm", height: "" })).toEqual({})
  })
})
