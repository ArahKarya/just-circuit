import { describe, expect, it } from "vitest"
import { parseFarads, parseHenries, runAcSweepSim, runDcSweepSim, runTransientSim } from "./spice-sim"

// Classic 1k + 1uF RC low-pass filter (tau = 1ms, fc = 159.15 Hz)
const RC_FILTER = [
  { type: "source_net", source_net_id: "n_in", name: "5V" },
  { type: "source_net", source_net_id: "n_out", name: "VOUT" },
  { type: "source_net", source_net_id: "n_gnd", name: "GND" },
  { type: "source_component", source_component_id: "r1", name: "R1", ftype: "simple_resistor", resistance: "1k" },
  { type: "source_port", source_port_id: "r1_1", source_component_id: "r1", name: "pin1" },
  { type: "source_port", source_port_id: "r1_2", source_component_id: "r1", name: "pin2" },
  { type: "source_component", source_component_id: "c1", name: "C1", ftype: "simple_capacitor", capacitance: "1uF" },
  { type: "source_port", source_port_id: "c1_1", source_component_id: "c1", name: "pin1" },
  { type: "source_port", source_port_id: "c1_2", source_component_id: "c1", name: "pin2" },
  { type: "source_trace", connected_source_port_ids: ["r1_1"], connected_source_net_ids: ["n_in"] },
  { type: "source_trace", connected_source_port_ids: ["r1_2", "c1_1"], connected_source_net_ids: ["n_out"] },
  { type: "source_trace", connected_source_port_ids: ["c1_2"], connected_source_net_ids: ["n_gnd"] },
]

describe("spice-sim", () => {
  it("parses capacitance and inductance units", () => {
    expect(parseFarads("100nF")).toBeCloseTo(1e-7)
    expect(parseFarads("10uF")).toBeCloseTo(1e-5)
    expect(parseFarads("22pF")).toBeCloseTo(2.2e-11)
    expect(parseHenries("10uH")).toBeCloseTo(1e-5)
    expect(parseHenries("1mH")).toBeCloseTo(1e-3)
  })

  it("simulates RC step transient response reaching ~63% at t = tau (1ms) and ~99% at 5ms", () => {
    const res = runTransientSim(RC_FILTER, { sourceRail: "5V", waveform: "step", amplitudeV: 5, durationMs: 5, steps: 100 })
    const vout = res.signals.VOUT
    expect(vout).toBeDefined()
    // At index 20 -> t = 1ms -> ~3.16V (63.2% of 5V)
    expect(vout[20]).toBeGreaterThan(2.9)
    expect(vout[20]).toBeLessThan(3.4)
    // At end (5ms) -> ~4.96V
    expect(vout[vout.length - 1]).toBeGreaterThan(4.8)
  })

  it("computes RC low-pass AC Bode response (-3dB near 159 Hz)", () => {
    const res = runAcSweepSim(RC_FILTER, { sourceRail: "5V", startHz: 1, stopHz: 100_000, points: 50 })
    const db = res.magnitudeDb.VOUT
    expect(db[0]).toBeGreaterThan(-0.5) // ~0 dB at 1 Hz
    // Find point closest to 159 Hz
    let bestIdx = 0
    let bestDiff = Infinity
    res.freqsHz.forEach((f, i) => {
      const diff = Math.abs(f - 159.15)
      if (diff < bestDiff) {
        bestDiff = diff
        bestIdx = i
      }
    })
    expect(db[bestIdx]).toBeGreaterThan(-4.2)
    expect(db[bestIdx]).toBeLessThan(-2.0)
    expect(db[db.length - 1]).toBeLessThan(-40) // strong attenuation at 100 kHz
  })

  it("sweeps DC supply voltage cleanly", () => {
    const sweep = runDcSweepSim(RC_FILTER, { railName: "5V", startV: 0, stopV: 10, steps: 10 })
    expect(sweep.voltages).toHaveLength(11)
    expect(sweep.totalCurrentMa).toHaveLength(11)
  })
})
