import { describe, expect, it } from "vitest"
import { isGroundName, isPowerName, runExtendedErc } from "./erc"

type El = Record<string, unknown>

const EMPTY_FILES = { "index.circuit.tsx": "export default () => <board />" }

const net = (id: string, name: string, extra: El = {}): El => ({ type: "source_net", source_net_id: id, name, ...extra })
const chip = (id: string, name: string): El => ({ type: "source_component", source_component_id: id, name, ftype: "simple_chip" })
const port = (id: string, compId: string, name: string, extra: El = {}): El => ({
  type: "source_port",
  source_port_id: id,
  source_component_id: compId,
  name,
  ...extra,
})
const trace = (ports: string[], nets: string[] = []): El => ({
  type: "source_trace",
  connected_source_port_ids: ports,
  connected_source_net_ids: nets,
})

const typesOf = (circuitJson: El[]): string[] => runExtendedErc(EMPTY_FILES, circuitJson).map((i) => i.type)

describe("power / ground name matching", () => {
  it("recognises common ground spellings", () => {
    for (const n of ["GND", "AGND", "DGND", "PGND", "GND_ISO", "GNDA", "VSS", "VSSA", "0V", "ground", "COM"]) {
      expect(isGroundName(n), n).toBe(true)
    }
    expect(isGroundName("SIGNAL")).toBe(false)
    expect(isGroundName("GPIO1")).toBe(false)
  })

  it("recognises common power rail spellings", () => {
    for (const n of ["VCC", "VDD", "VDDIO", "AVDD", "DVDD", "VCC_3V3", "VBUS", "VIN", "VBAT", "V+", "+3V3", "+5V", "3V3", "5V", "12V", "V3_3"]) {
      expect(isPowerName(n), n).toBe(true)
    }
    expect(isPowerName("VOUT_SENSE")).toBe(false)
    expect(isPowerName("GPIO5")).toBe(false)
    expect(isPowerName("GND")).toBe(false)
  })
})

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
    const types = runExtendedErc(files, circuitJson).map((i) => i.type)
    expect(types).toContain("erc_duplicate_designator")
    expect(types).toContain("erc_missing_mpn")
    expect(types).toContain("erc_unconnected_power_pin")
    expect(types).toContain("erc_missing_gnd")
  })

  it("flags unconnected VDDIO / AVDD / GNDA pins and pins identified only by port_hints", () => {
    const issues = runExtendedErc(EMPTY_FILES, [
      net("n_gnd", "GND"),
      chip("u1", "U1"),
      port("p1", "u1", "VDDIO"),
      port("p2", "u1", "AVDD"),
      port("p3", "u1", "GNDA"),
      port("p4", "u1", "pin4", { port_hints: ["pin4", "GND"] }),
      port("p5", "u1", "PA0"),
    ])
    const unconnected = issues.filter((i) => i.type === "erc_unconnected_power_pin").map((i) => i.key)
    expect(unconnected).toEqual(["erc:unconn:p1", "erc:unconn:p2", "erc:unconn:p3", "erc:unconn:p4"])
  })

  it("does not report missing GND when ground uses another name (GND_ISO, AGND, COM)", () => {
    for (const gndName of ["GND_ISO", "AGND", "COM", "VSS"]) {
      const types = typesOf([
        net("n_pwr", "+3V3"),
        net("n_gnd", gndName),
        chip("u1", "U1"),
        port("p1", "u1", "VDD"),
        port("p2", "u1", "VSS"),
        trace(["p1"], ["n_pwr"]),
        trace(["p2"], ["n_gnd"]),
      ])
      expect(types, gndName).not.toContain("erc_missing_gnd")
    }
  })

  it("does not report missing GND when a net is flagged is_ground", () => {
    const types = typesOf([net("n_pwr", "VCC"), net("n_ret", "RETURN", { is_ground: true })])
    expect(types).not.toContain("erc_missing_gnd")
  })

  it("does not report missing GND when a connected pin is a ground pin by port_hints", () => {
    const types = typesOf([
      net("n_pwr", "VCC"),
      chip("u1", "U1"),
      port("p1", "u1", "pin1", { port_hints: ["VCC"] }),
      port("p2", "u1", "pin2", { port_hints: ["GND"] }),
      port("p3", "u1", "pin3"),
      trace(["p1"], ["n_pwr"]),
      trace(["p2", "p3"]),
    ])
    expect(types).not.toContain("erc_missing_gnd")
  })

  it("reports missing GND for a powered design using VDD-style rails only", () => {
    expect(typesOf([net("n_pwr", "VDDIO"), net("n_sig", "SDA")])).toContain("erc_missing_gnd")
  })
})
