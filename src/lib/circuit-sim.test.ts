import { describe, expect, it } from "vitest"
import { inferRailVoltage, MAX_SIM_NODES, parseOhms, simulateCircuit } from "./circuit-sim"

describe("parseOhms & inferRailVoltage", () => {
  it("parses resistor values in standard and compact notation", () => {
    expect(parseOhms("330")).toBe(330)
    expect(parseOhms("10k")).toBe(10_000)
    expect(parseOhms("4k7")).toBe(4_700)
    expect(parseOhms("1.5M")).toBe(1_500_000)
    expect(parseOhms("2R2")).toBe(2.2)
  })

  it("infers rail voltages from net names", () => {
    expect(inferRailVoltage("GND")).toBe(0)
    expect(inferRailVoltage("3V3")).toBe(3.3)
    expect(inferRailVoltage("V3_3")).toBe(3.3)
    expect(inferRailVoltage("5V")).toBe(5)
    expect(inferRailVoltage("12V")).toBe(12)
    expect(inferRailVoltage("VCC", 3.3)).toBe(3.3)
  })
})

describe("simulateCircuit", () => {
  it("solves a healthy 5V -> 330 ohm -> Red LED -> GND circuit accurately", () => {
    const circuit = [
      { type: "source_net", source_net_id: "n_vcc", name: "5V" },
      { type: "source_net", source_net_id: "n_gnd", name: "GND" },
      { type: "source_component", source_component_id: "r1", name: "R1", ftype: "simple_resistor", resistance: 330 },
      { type: "source_port", source_port_id: "r1_1", source_component_id: "r1", name: "pin1" },
      { type: "source_port", source_port_id: "r1_2", source_component_id: "r1", name: "pin2" },
      { type: "source_component", source_component_id: "d1", name: "D1", ftype: "simple_led", color: "red" },
      { type: "source_port", source_port_id: "d1_a", source_component_id: "d1", name: "anode" },
      { type: "source_port", source_port_id: "d1_c", source_component_id: "d1", name: "cathode" },
      { type: "source_trace", connected_source_port_ids: ["r1_1"], connected_source_net_ids: ["n_vcc"] },
      { type: "source_trace", connected_source_port_ids: ["r1_2", "d1_a"], connected_source_net_ids: [] },
      { type: "source_trace", connected_source_port_ids: ["d1_c"], connected_source_net_ids: ["n_gnd"] },
    ]

    const report = simulateCircuit(circuit)
    expect(report.ok).toBe(true)
    expect(report.findings).toHaveLength(0)
    const r1 = report.components.find((c) => c.name === "R1")!
    const d1 = report.components.find((c) => c.name === "D1")!
    // I ≈ (5 - 1.9) / (330 + 10) ≈ 9.12 mA
    expect(r1.currentMa).toBeGreaterThan(8.5)
    expect(r1.currentMa).toBeLessThan(10)
    expect(d1.currentMa).toBeGreaterThan(8.5)
    expect(d1.status).toBe("ok")
  })

  it("detects LED overcurrent when connected directly to 5V without a resistor", () => {
    const circuit = [
      { type: "source_net", source_net_id: "n_vcc", name: "5V" },
      { type: "source_net", source_net_id: "n_gnd", name: "GND" },
      { type: "source_component", source_component_id: "d1", name: "D1", ftype: "simple_led", color: "red" },
      { type: "source_port", source_port_id: "d1_a", source_component_id: "d1", name: "anode" },
      { type: "source_port", source_port_id: "d1_c", source_component_id: "d1", name: "cathode" },
      { type: "source_trace", connected_source_port_ids: ["d1_a"], connected_source_net_ids: ["n_vcc"] },
      { type: "source_trace", connected_source_port_ids: ["d1_c"], connected_source_net_ids: ["n_gnd"] },
    ]
    const report = simulateCircuit(circuit)
    expect(report.ok).toBe(false)
    expect(report.findings.some((f) => f.code === "led_overcurrent")).toBe(true)
  })

  it("detects direct VCC-to-GND short circuit", () => {
    const circuit = [
      { type: "source_net", source_net_id: "n_vcc", name: "5V" },
      { type: "source_net", source_net_id: "n_gnd", name: "GND" },
      { type: "source_trace", connected_source_port_ids: [], connected_source_net_ids: ["n_vcc", "n_gnd"] },
    ]
    const report = simulateCircuit(circuit)
    expect(report.ok).toBe(false)
    expect(report.findings.some((f) => f.code === "short_circuit")).toBe(true)
  })

  it("detects resistor power overload on a 0603 resistor across 12V", () => {
    const circuit = [
      { type: "source_net", source_net_id: "n_12v", name: "12V" },
      { type: "source_net", source_net_id: "n_gnd", name: "GND" },
      { type: "source_component", source_component_id: "r1", name: "R1", ftype: "simple_resistor", resistance: 100 },
      { type: "pcb_component", source_component_id: "r1", footprint: "0603" },
      { type: "source_port", source_port_id: "r1_1", source_component_id: "r1", name: "pin1" },
      { type: "source_port", source_port_id: "r1_2", source_component_id: "r1", name: "pin2" },
      { type: "source_trace", connected_source_port_ids: ["r1_1"], connected_source_net_ids: ["n_12v"] },
      { type: "source_trace", connected_source_port_ids: ["r1_2"], connected_source_net_ids: ["n_gnd"] },
    ]
    // P = 12^2 / 100 = 1.44W = 1440 mW >> 100 mW (0603 limit)
    const report = simulateCircuit(circuit)
    expect(report.ok).toBe(false)
    expect(report.findings.some((f) => f.code === "resistor_overpower")).toBe(true)
  })

  it("skips boards too large for the dense solver instead of freezing the tab", () => {
    const count = MAX_SIM_NODES
    const circuit = Array.from({ length: count }, (_, i) => [
      { type: "source_component", source_component_id: `r${i}`, name: `R${i}`, ftype: "simple_resistor", resistance: 1000 },
      { type: "source_port", source_port_id: `r${i}_1`, source_component_id: `r${i}`, name: "pin1" },
      { type: "source_port", source_port_id: `r${i}_2`, source_component_id: `r${i}`, name: "pin2" },
    ]).flat()
    const started = Date.now()
    const report = simulateCircuit(circuit)
    expect(Date.now() - started).toBeLessThan(1000)
    expect(report.findings.map((f) => f.code)).toContain("too_large")
    expect(report.components).toEqual([])
  })

  it("does not warn about convergence on a circuit that settles", () => {
    const circuit = [
      { type: "source_net", source_net_id: "n_vcc", name: "5V" },
      { type: "source_net", source_net_id: "n_gnd", name: "GND" },
      { type: "source_component", source_component_id: "d1", name: "D1", ftype: "simple_led", color: "red" },
      { type: "source_port", source_port_id: "d1_a", source_component_id: "d1", name: "anode" },
      { type: "source_port", source_port_id: "d1_c", source_component_id: "d1", name: "cathode" },
      { type: "source_component", source_component_id: "r1", name: "R1", ftype: "simple_resistor", resistance: 330 },
      { type: "source_port", source_port_id: "r1_1", source_component_id: "r1", name: "pin1" },
      { type: "source_port", source_port_id: "r1_2", source_component_id: "r1", name: "pin2" },
      { type: "source_trace", connected_source_port_ids: ["r1_1"], connected_source_net_ids: ["n_vcc"] },
      { type: "source_trace", connected_source_port_ids: ["r1_2", "d1_a"], connected_source_net_ids: [] },
      { type: "source_trace", connected_source_port_ids: ["d1_c"], connected_source_net_ids: ["n_gnd"] },
    ]
    expect(simulateCircuit(circuit).findings.map((f) => f.code)).not.toContain("no_convergence")
  })
})
