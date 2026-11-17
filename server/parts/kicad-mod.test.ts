import { describe, expect, it } from "vitest"
import { ValidationError } from "../storage/errors"
import { convertKicadMod, pinLabelsForPads } from "./kicad-mod"

const FOOTPRINT = `(footprint "Test_SOT-3"
  (layer "F.Cu")
  (property "Reference" "REF**" (at 0 -2 0) (layer "F.SilkS"))
  (property "Value" "Test" (at 0 2 0) (layer "F.Fab"))
  (pad "1" smd rect (at -1 0) (size 0.6 0.8) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "2" smd rect (at 0 0) (size 0.6 0.8) (layers "F.Cu" "F.Paste" "F.Mask"))
  (pad "EP" smd rect (at 1 0) (size 0.6 0.8) (layers "F.Cu" "F.Paste" "F.Mask"))
)
`

describe("uploaded KiCad footprints", () => {
  it("numbers pads as pinN and gives lettered pads their own label", () => {
    expect(pinLabelsForPads(["3", "1", "1", "EP", "A1"])).toEqual({ pin1: ["P1"], pin3: ["P3"], pin4: ["EP"], pin5: ["A1"] })
  })

  it("makes a component file and a footprint JSON file", () => {
    const part = convertKicadMod(FOOTPRINT, "Test_SOT-3.kicad_mod", "TPS3823-33DBVR")
    expect(part.componentName).toBe("TPS382333DBVR")
    expect(part.tsxPath).toBe("lib/parts/TPS382333DBVR.tsx")
    expect(part.padCount).toBe(3)
    const tsx = part.files[part.tsxPath]
    expect(tsx).toContain('import footprint from "./TPS382333DBVR.footprint.json"')
    expect(tsx).toContain('  pin1: ["P1"],\n  pin2: ["P2"],\n  pin3: ["EP"],')
    const footprint = JSON.parse(part.files["lib/parts/TPS382333DBVR.footprint.json"]) as { type: string; text?: string }[]
    expect(footprint.filter((element) => element.type === "pcb_smtpad")).toHaveLength(3)
    expect(footprint.filter((element) => element.type === "pcb_silkscreen_text").every((element) => element.text === "REF**")).toBe(true)
  })

  it("names the part after the footprint when no part number is given, without letting the name reach code", () => {
    const evil = FOOTPRINT.replace('"Test_SOT-3"', '"Evil\\"\\nfetch(1)//"')
    const part = convertKicadMod(evil, "x.kicad_mod")
    expect(part.componentName).toMatch(/^[A-Za-z][A-Za-z0-9]*$/)
    expect(part.files[part.tsxPath].split("\n")[2]).toBe('import type { ChipProps } from "tscircuit"')
  })

  it("refuses files that aren't footprints or have no pads", () => {
    expect(() => convertKicadMod("hello", "a.kicad_mod")).toThrow(ValidationError)
    expect(() => convertKicadMod('(footprint "Empty" (layer "F.Cu"))', "a.kicad_mod")).toThrow(/tidak punya pad/)
  })
})
