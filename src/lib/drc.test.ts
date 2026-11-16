import { describe, expect, it } from "vitest"
import circuit from "./__fixtures__/drc-circuit.json"
import { buildIssues, extractIssues, locateComponent } from "./drc"

describe("extractIssues", () => {
  const issues = extractIssues(circuit)

  it("lists errors before warnings with their category", () => {
    expect(issues[0].severity).toBe("error")
    expect(issues.filter((i) => i.severity === "error").every((i) => i.category === "pcb")).toBe(true)
    expect(issues.some((i) => i.category === "schematic" && i.severity === "warning")).toBe(true)
  })

  it("maps ids and messages to component names", () => {
    const byType = (type: string) => issues.find((i) => i.type === type)
    expect(byType("pcb_footprint_overlap_error")?.components).toEqual(["R1", "R2"])
    expect(byType("pcb_component_outside_board_error")?.components).toEqual(["C1"])
    expect(byType("pcb_placement_error")?.components).toEqual(["C1"])
    expect(byType("pcb_port_not_connected_error")?.components.sort()).toEqual(["C1", "R1"])
    expect(byType("source_no_power_pin_defined_warning")?.components).toEqual(["U1"])
    expect(byType("schematic_missing_sheet_warning")?.components).toEqual([])
  })

  it("treats supplier polarity mismatches as warnings", () => {
    const soft = extractIssues([{ type: "source_component_misconfigured_error", message: "<led /> maps pin 1 to the anode, but supplier part jlcpcb:C1 maps pin 1 to the cathode. Update pinLabels or use a supplier part with matching diode polarity." }])
    expect(soft[0].severity).toBe("warning")
  })

  it("wraps plain build errors", () => {
    expect(buildIssues(["SyntaxError: x"])[0]).toMatchObject({ severity: "error", category: "build" })
  })
})

describe("locateComponent", () => {
  it("finds the element that declares a component", () => {
    const files = { "index.circuit.tsx": 'export default () => (\n  <board>\n    <resistor name="R1" />\n  </board>\n)', "lib/p.tsx": "    <chip name={'U1'} />" }
    expect(locateComponent(files, "index.circuit.tsx", "R1")).toEqual({ path: "index.circuit.tsx", line: 3, column: 5 })
    expect(locateComponent(files, "index.circuit.tsx", "U1")).toEqual({ path: "lib/p.tsx", line: 1, column: 5 })
    expect(locateComponent(files, "index.circuit.tsx", "R10")).toBeNull()
  })
})
