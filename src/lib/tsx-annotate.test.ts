import { describe, expect, it } from "vitest"
import { MANUAL_EDITS_FILE } from "./manual-edits"
import { autoAnnotateProject, describeAnnotateSkips, renameSelector } from "./tsx-annotate"

const ENTRY = "index.circuit.tsx"

function board(body: string): string {
  return `export default () => (\n  <board width="30mm" height="20mm">\n${body}\n  </board>\n)\n`
}

describe("renameSelector", () => {
  const map = new Map([
    ["R9", "R1"],
    ["D1", "D2"],
  ])
  it("rewrites only the component segment of a selector", () => {
    expect(renameSelector(".R9 > .pin1", map)).toBe(".R1 > .pin1")
    expect(renameSelector("R9.pin1", map)).toBe("R1.pin1")
    expect(renameSelector("R9", map)).toBe("R1")
    expect(renameSelector(".U1 > .D1", map)).toBe(".U1 > .D1")
    expect(renameSelector("net.R9", map)).toBe("net.R9")
    expect(renameSelector(".R90 > .pin1", map)).toBe(".R90 > .pin1")
  })
})

describe("autoAnnotateProject", () => {
  it("returns the rename map and updates trace selectors", () => {
    const files = {
      [ENTRY]: board(
        '    <resistor name="R9" resistance="1k" schX={0} schY={2} />\n    <resistor name="R4" resistance="2k" schX={4} schY={2} />\n    <trace from=".R9 > .pin1" to=".R4 > .pin2" />',
      ),
    }
    const res = autoAnnotateProject(files)
    expect(res.renames).toEqual({ R9: "R1", R4: "R2" })
    expect(res.renamed).toEqual([
      { from: "R9", to: "R1" },
      { from: "R4", to: "R2" },
    ])
    expect(res.files[ENTRY]).toContain('from=".R1 > .pin1" to=".R2 > .pin2"')
  })

  it("swaps permuted designators without collisions", () => {
    const files = {
      [ENTRY]: board(
        '    <resistor name="R9" schX={0} schY={0} />\n    <resistor name="R1" schX={5} schY={0} />\n    <trace from=".R9 > .pin1" to=".R1 > .pin1" />',
      ),
    }
    const res = autoAnnotateProject(files)
    expect(res.renames).toEqual({ R9: "R1", R1: "R2" })
    const text = res.files[ENTRY]
    expect(text).toContain('<resistor name="R1" schX={0} schY={0} />')
    expect(text).toContain('<resistor name="R2" schX={5} schY={0} />')
    expect(text).toContain('from=".R1 > .pin1" to=".R2 > .pin1"')
  })

  it("rewrites selectors inside object/array expressions and other selector props", () => {
    const files = {
      [ENTRY]: board(
        [
          '    <resistor name="R9" schX={0} schY={0} />',
          '    <resistor name="R4" schX={5} schY={0} />',
          '    <chip name="U1" connections={{ pin1: ".R9 > .pin1", pin2: "R4.pin2" }} />',
          '    <differentialpair name="P" positiveConnection=".R9 > .pin2" negativeConnection="R4.pin1" />',
          '    <copperpour connectsTo=".R9 > .pin1" layer="top" />',
          '    <net name="R9" connectsTo={[".R9 > .pin2", "net.GND"]} />',
          '    <silkscreentext text="R9" />',
        ].join("\n"),
      ),
    }
    const text = autoAnnotateProject(files).files[ENTRY]
    expect(text).toContain('connections={{ pin1: ".R1 > .pin1", pin2: "R2.pin2" }}')
    expect(text).toContain('positiveConnection=".R1 > .pin2" negativeConnection="R2.pin1"')
    expect(text).toContain('<copperpour connectsTo=".R1 > .pin1"')
    expect(text).toContain('<net name="R9" connectsTo={[".R1 > .pin2", "net.GND"]} />')
    expect(text).toContain('<silkscreentext text="R9" />')
  })

  it("does not rename nets, boards or groups that look like designators", () => {
    const files = {
      [ENTRY]: `export default () => (\n  <board name="B2">\n    <group name="G5">\n      <resistor name="R3" />\n    </group>\n    <net name="V5" />\n  </board>\n)\n`,
    }
    const res = autoAnnotateProject(files)
    expect(res.renames).toEqual({ R3: "R1" })
    expect(res.files[ENTRY]).toContain('<net name="V5" />')
    expect(res.files[ENTRY]).toContain('<group name="G5">')
    expect(res.files[ENTRY]).toContain('<board name="B2">')
  })

  it("orders by pcb coordinates when schematic coordinates are incomplete", () => {
    const files = {
      [ENTRY]: board('    <resistor name="R7" pcbX={9} pcbY={0} schX={0} schY={0} />\n    <resistor name="R8" pcbX={1} pcbY={0} />'),
    }
    expect(autoAnnotateProject(files).renames).toEqual({ R8: "R1", R7: "R2" })
  })

  it("rewrites manual-edits.json placements and trace hints", () => {
    const manual = {
      pcb_placements: [{ selector: "R9", center: { x: 1, y: 2 }, relative_to: "group_center" }],
      schematic_placements: [{ selector: ".R4", center: { x: 0, y: 0 } }],
      manual_trace_hints: [{ pcb_port_selector: ".R9 > .pin1", offsets: [] }],
    }
    const files = {
      [ENTRY]: board('    <resistor name="R9" schX={0} schY={0} />\n    <resistor name="R4" schX={5} schY={0} />'),
      [MANUAL_EDITS_FILE]: `${JSON.stringify(manual, null, 2)}\n`,
    }
    const res = autoAnnotateProject(files)
    const next = JSON.parse(res.files[MANUAL_EDITS_FILE]) as typeof manual
    expect(next.pcb_placements[0].selector).toBe("R1")
    expect(next.pcb_placements[0].relative_to).toBe("group_center")
    expect(next.schematic_placements[0].selector).toBe(".R2")
    expect(next.manual_trace_hints[0].pcb_port_selector).toBe(".R1 > .pin1")
  })

  it("leaves files untouched when designators are already ordered", () => {
    const files = { [ENTRY]: board('    <resistor name="R1" schX={0} schY={0} />') }
    const res = autoAnnotateProject(files)
    expect(res.renames).toEqual({})
    expect(res.files).toBe(files)
  })

  it("skips designator groups that contain duplicate names and reports them", () => {
    const files = {
      "a.tsx": `export const A = () => <group><resistor name="R1" schX={0} schY={0} /><resistor name="R5" schX={1} schY={0} /></group>`,
      "b.tsx": `export const B = () => <group><resistor name="R1" schX={2} schY={0} /><capacitor name="C7" schX={0} schY={0} /></group>`,
    }
    const res = autoAnnotateProject(files)
    expect(res.renames).toEqual({ C7: "C1" })
    expect(res.files["a.tsx"]).toContain('name="R5"')
    expect(res.skipped).toContainEqual({ name: "R1", reason: "duplicate" })
  })

  it("leaves non-selector strings alone, even in expressions", () => {
    const files = {
      [ENTRY]: board(
        [
          '    <led name="D9" schX={0} schY={0} />',
          '    <resistor name="R9" schX={0} schY={0} description="R9, 1%" />',
          '    <chip name="U1" pinLabels={{ pin1: "D9", pin2: "R9" }} connections={{ pin1: "R9", pin2: ".D9 > .anode" }} />',
          '    <netlabel net="X" connection="R9.pin1" />',
        ].join("\n"),
      ),
    }
    const text = autoAnnotateProject(files).files[ENTRY]
    expect(text).toContain('description="R9, 1%"')
    expect(text).toContain('pinLabels={{ pin1: "D9", pin2: "R9" }}')
    expect(text).toContain('connections={{ pin1: "R9", pin2: ".D1 > .anode" }}')
    expect(text).toContain('connection="R1.pin1"')
  })

  it("warns about template-literal selectors that mention a renamed designator", () => {
    const files = {
      [ENTRY]: board('    <resistor name="R9" schX={0} schY={0} />\n    <trace from={`.R9 > .pin${n}`} to="net.GND" />'),
    }
    const res = autoAnnotateProject(files)
    expect(res.renames).toEqual({ R9: "R1" })
    expect(res.skipped).toContainEqual({ name: "R9", reason: "template", path: ENTRY })
  })
})

describe("describeAnnotateSkips", () => {
  it("summarizes duplicates and template mentions, or returns null", () => {
    expect(describeAnnotateSkips([])).toBeNull()
    const text = describeAnnotateSkips([
      { name: "R1", reason: "duplicate" },
      { name: "R9", reason: "template", path: "a.tsx" },
    ])
    expect(text).toContain("R1")
    expect(text).toContain("R9")
  })
})
