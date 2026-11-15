import { describe, expect, it } from "vitest"
import {
  applyMoveToCode,
  asPcbMoveEvent,
  componentNameFor,
  findComponentTag,
  readNumericAttr,
  setNumericAttr,
} from "./layout-placement"

const move = (dx: number, dy: number) => ({
  pcb_component_id: "pcb_component_1",
  original_center: { x: 1, y: 1 },
  new_center: { x: 1 + dx, y: 1 + dy },
})

const SOURCE = `export default () => (
  <board width="20mm" height="15mm">
    <resistor name="R1" resistance="330" footprint="0603" pcbX={0} />
    <led name="D1" color="red" footprint="0603" />
    <trace from=".R1 > .pin2" to=".D1 > .anode" />
  </board>
)
`

describe("findComponentTag", () => {
  it("matches the tag by its name attribute only", () => {
    expect(findComponentTag(SOURCE, "R1")?.text).toBe('<resistor name="R1" resistance="330" footprint="0603" pcbX={0} />')
    expect(findComponentTag(SOURCE, "R")).toBeNull()
    expect(findComponentTag('<chip name={"U1"} pcbX={2} />', "U1")).not.toBeNull()
  })
})

describe("numeric attributes", () => {
  it("reads numbers, mm strings, and flags expressions", () => {
    expect(readNumericAttr("<a pcbX={-6.5} />", "pcbX")).toEqual({ kind: "number", value: -6.5 })
    expect(readNumericAttr('<a pcbX="3mm" />', "pcbX")).toEqual({ kind: "number", value: 3 })
    expect(readNumericAttr("<a pcbX={x + 1} />", "pcbX")).toEqual({ kind: "unsupported" })
    expect(readNumericAttr("<a />", "pcbY")).toEqual({ kind: "absent" })
  })

  it("replaces or inserts an attribute, rounding to 0.01mm", () => {
    expect(setNumericAttr('<a pcbX="3mm" />', "pcbX", 4.256)).toBe("<a pcbX={4.26} />")
    expect(setNumericAttr('<resistor name="R1" />', "pcbY", -0.001)).toBe('<resistor pcbY={0} name="R1" />')
  })
})

describe("applyMoveToCode", () => {
  it("shifts existing pcbX and adds pcbY", () => {
    const result = applyMoveToCode({ "index.circuit.tsx": SOURCE }, "R1", move(2.5, -4))
    expect(result.status).toBe("updated")
    if (result.status !== "updated") return
    expect(result.files["index.circuit.tsx"]).toContain('<resistor name="R1" resistance="330" footprint="0603" pcbX={2.5} pcbY={-4} />')
    expect(result.files["index.circuit.tsx"]).toContain('<led name="D1" color="red" footprint="0603" />')
  })

  it("defers to manual edits when the code has no position", () => {
    expect(applyMoveToCode({ "index.circuit.tsx": SOURCE }, "D1", move(1, 1)).status).toBe("use-manual-edits")
    expect(applyMoveToCode({ "index.circuit.tsx": SOURCE }, "Q9", move(1, 1)).status).toBe("use-manual-edits")
  })

  it("refuses to rewrite expressions", () => {
    expect(applyMoveToCode({ "a.tsx": "<chip name=\"U1\" pcbX={W / 2} />" }, "U1", move(1, 1))).toEqual({ status: "unsupported", path: "a.tsx" })
  })

  it("ignores non-TSX files", () => {
    expect(applyMoveToCode({ "manual-edits.json": '{"name":"R1"}' }, "R1", move(1, 1)).status).toBe("use-manual-edits")
  })
})

describe("circuit json helpers", () => {
  const circuit = [
    { type: "source_component", source_component_id: "s1", name: "R1" },
    { type: "pcb_component", pcb_component_id: "pcb_component_1", source_component_id: "s1" },
  ]

  it("maps a pcb component to its source name", () => {
    expect(componentNameFor(circuit, "pcb_component_1")).toBe("R1")
    expect(componentNameFor(circuit, "missing")).toBeNull()
  })

  it("validates move events", () => {
    expect(asPcbMoveEvent(move(1, 2))).not.toBeNull()
    expect(asPcbMoveEvent({ pcb_component_id: "x" })).toBeNull()
  })
})
