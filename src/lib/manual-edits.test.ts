import { describe, expect, it } from "vitest"
import { MANUAL_EDITS_FILE, parseManualEdits, wireManualEdits, withManualEdits } from "./manual-edits"
import { createProject } from "./project-ops"

const ENTRY = "index.circuit.tsx"

describe("wireManualEdits", () => {
  it("adds the import and the prop to the first board", () => {
    const { source, wired } = wireManualEdits('export default () => (\n  <board width="10mm">\n  </board>\n)\n', ENTRY)
    expect(wired).toBe(true)
    expect(source.startsWith('import manualEdits from "./manual-edits.json"\n')).toBe(true)
    expect(source).toContain('<board manualEdits={manualEdits} width="10mm">')
  })

  it("is idempotent", () => {
    const once = wireManualEdits("export default () => <board />", ENTRY).source
    expect(wireManualEdits(once, ENTRY).source).toBe(once)
  })

  it("reuses an existing import name and keeps an existing prop", () => {
    const src = 'import edits from "./manual-edits.json"\nexport default () => <board manualEdits={edits} />'
    expect(wireManualEdits(src, ENTRY).source).toBe(src)
    const withoutProp = 'import edits from "./manual-edits.json"\nexport default () => <board />'
    expect(wireManualEdits(withoutProp, ENTRY).source).toContain("<board manualEdits={edits} />")
  })

  it("works with subcircuit and nested entry paths", () => {
    const { source } = wireManualEdits("export default () => <subcircuit name='a' />", "src/main.tsx")
    expect(source).toContain('import manualEdits from "../manual-edits.json"')
    expect(source).toContain("<subcircuit manualEdits={manualEdits} name='a' />")
  })

  it("leaves files without a board untouched", () => {
    const src = 'import { Board } from "./Board"\nexport default () => <Board />'
    expect(wireManualEdits(src, ENTRY)).toEqual({ source: src, wired: false })
  })
})

describe("parseManualEdits", () => {
  it("returns an empty object for missing or broken JSON", () => {
    expect(parseManualEdits(undefined)).toEqual({})
    expect(parseManualEdits("{oops")).toEqual({})
    expect(parseManualEdits("[]")).toEqual({})
    expect(parseManualEdits('{"pcb_placements":[]}')).toEqual({ pcb_placements: [] })
  })
})

describe("withManualEdits", () => {
  it("writes the edits file and wires the entrypoint", () => {
    const { project, wired } = withManualEdits(createProject("x"), { pcb_placements: [{ selector: "R1", center: { x: 4.000000000000002, y: 0 } }] })
    expect(wired).toBe(true)
    expect(JSON.parse(project.files[MANUAL_EDITS_FILE])).toEqual({ pcb_placements: [{ selector: "R1", center: { x: 4, y: 0 } }] })
    expect(project.files[ENTRY]).toContain("manualEdits={manualEdits}")
  })
})
