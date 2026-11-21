import { describe, expect, it } from "vitest"
import { runExtendedErc } from "./erc"

describe("runExtendedErc", () => {
  it("flags duplicate designators, missing MPN, unconnected power pins, and missing GND", () => {
    const files = {
      "index.circuit.tsx": `export default () => (
        <board>
          <resistor name="R1" resistance="1k" />
          <resistor name="R1" resistance="2k" />
          <chip name="U1" footprint="soic8" />
        </board>
      )`,
    }
    const circuitJson = [
      { type: "source_net", source_net_id: "n1", name: "5V" },
      { type: "source_component", source_component_id: "c1", name: "U1" },
      { type: "source_port", source_port_id: "p1", source_component_id: "c1", name: "VCC" },
    ]
    const issues = runExtendedErc(files, circuitJson)
    const types = issues.map((i) => i.type)
    expect(types).toContain("erc_duplicate_designator")
    expect(types).toContain("erc_missing_mpn")
    expect(types).toContain("erc_unconnected_power_pin")
    expect(types).toContain("erc_missing_gnd")
  })
})
