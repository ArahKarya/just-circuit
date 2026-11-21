import { describe, expect, it } from "vitest"
import {
  chooseTimeStep,
  MAX_SPICE_NODES,
  parseFarads,
  parseHenries,
  runAcSweepSim,
  runDcSweepSim,
  runTransientSim,
} from "./spice-sim"

type El = Record<string, unknown>

const net = (id: string, name: string, extra: El = {}): El => ({ type: "source_net", source_net_id: id, name, ...extra })
const part = (id: string, name: string, ftype: string, extra: El = {}): El => ({
  type: "source_component",
  source_component_id: id,
  name,
  ftype,
  ...extra,
})
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

// Classic 1k + 1uF RC low-pass filter (tau = 1ms, fc = 159.15 Hz)
const rcFilter = (rail = "5V", capacitance: unknown = "1uF"): El[] => [
  net("n_in", rail),
  net("n_out", "VOUT"),
  net("n_gnd", "GND"),
  part("r1", "R1", "simple_resistor", { resistance: "1k" }),
  port("r1_1", "r1", "pin1"),
  port("r1_2", "r1", "pin2"),
  part("c1", "C1", "simple_capacitor", { capacitance }),
  port("c1_1", "c1", "pin1"),
  port("c1_2", "c1", "pin2"),
  trace(["r1_1"], ["n_in"]),
  trace(["r1_2", "c1_1"], ["n_out"]),
  trace(["c1_2"], ["n_gnd"]),
]
const RC_FILTER = rcFilter()

/** 5V -> 330R -> LED -> GND, with the LED ports listed cathode-first. */
const LED_CATHODE_FIRST: El[] = [
  net("n_vcc", "5V"),
  net("n_a", "LED_A"),
  net("n_gnd", "GND"),
  part("r1", "R1", "simple_resistor", { resistance: 330 }),
  port("r1_1", "r1", "pin1"),
  port("r1_2", "r1", "pin2"),
  part("d1", "D1", "simple_led", { color: "red" }),
  port("d1_c", "d1", "cathode"),
  port("d1_a", "d1", "anode"),
  trace(["r1_1"], ["n_vcc"]),
  trace(["r1_2", "d1_a"], ["n_a"]),
  trace(["d1_c"], ["n_gnd"]),
]

/** 5V -> 1k -> OUT, diode reverse-biased from OUT (cathode) to GND (anode). */
const REVERSE_DIODE: El[] = [
  net("n_vcc", "5V"),
  net("n_out", "OUT"),
  net("n_gnd", "GND"),
  part("r1", "R1", "simple_resistor", { resistance: "1k" }),
  port("r1_1", "r1", "pin1"),
  port("r1_2", "r1", "pin2"),
  part("d1", "D1", "simple_diode"),
  port("d1_a", "d1", "anode"),
  port("d1_c", "d1", "cathode"),
  trace(["r1_1"], ["n_vcc"]),
  trace(["r1_2", "d1_c"], ["n_out"]),
  trace(["d1_a"], ["n_gnd"]),
]

const valueAt = (times: number[], ys: number[], tMs: number): number => {
  let best = 0
  times.forEach((t, i) => {
    if (Math.abs(t - tMs) < Math.abs(times[best] - tMs)) best = i
  })
  return ys[best]
}

const nearestIndex = (xs: number[], target: number): number =>
  xs.reduce((best, x, i) => (Math.abs(x - target) < Math.abs(xs[best] - target) ? i : best), 0)

function resistorChain(count: number): El[] {
  const els: El[] = [net("n_vcc", "5V"), net("n_gnd", "GND")]
  for (let i = 0; i < count; i += 1) {
    els.push(part(`r${i}`, `R${i}`, "simple_resistor", { resistance: 1000 }))
    els.push(port(`r${i}_1`, `r${i}`, "pin1"), port(`r${i}_2`, `r${i}`, "pin2"))
    els.push(i === 0 ? trace([`r0_1`], ["n_vcc"]) : trace([`r${i - 1}_2`, `r${i}_1`]))
  }
  els.push(trace([`r${count - 1}_2`], ["n_gnd"]))
  return els
}

describe("parseFarads / parseHenries", () => {
  it("parses common unit suffixes", () => {
    expect(parseFarads("100nF")).toBeCloseTo(1e-7)
    expect(parseFarads("10uF")).toBeCloseTo(1e-5)
    expect(parseFarads("22pF")).toBeCloseTo(2.2e-11)
    expect(parseHenries("10uH")).toBeCloseTo(1e-5)
    expect(parseHenries("1mH")).toBeCloseTo(1e-3)
  })

  it("treats Greek mu and micro sign as micro", () => {
    expect(parseFarads("4.7μF")).toBeCloseTo(4.7e-6, 12)
    expect(parseFarads("4.7µF")).toBeCloseTo(4.7e-6, 12)
    expect(parseHenries("10μH")).toBeCloseTo(1e-5, 12)
  })

  it("supports compact, leading-dot and exponent notation", () => {
    expect(parseFarads("4u7")).toBeCloseTo(4.7e-6, 12)
    expect(parseFarads(".1u")).toBeCloseTo(1e-7, 12)
    expect(parseFarads("1e-6")).toBeCloseTo(1e-6, 12)
    expect(parseFarads("2.2 nF")).toBeCloseTo(2.2e-9, 15)
    expect(parseHenries("2m2")).toBeCloseTo(2.2e-3, 9)
  })

  it("returns null for unparseable or non-positive values", () => {
    expect(parseFarads("abc")).toBeNull()
    expect(parseFarads("0")).toBeNull()
    expect(parseFarads("")).toBeNull()
    expect(parseHenries("-1mH")).toBeNull()
  })
})

describe("chooseTimeStep", () => {
  it("uses at least 20 points per signal period", () => {
    const { dtS, warnings } = chooseTimeStep({ durationS: 0.005, periodS: 0.001 })
    expect(dtS).toBeLessThanOrEqual(0.001 / 20)
    expect(warnings).toHaveLength(0)
  })

  it("resolves the smallest time constant", () => {
    const { dtS } = chooseTimeStep({ durationS: 0.002, minTauS: 1e-5 })
    expect(dtS).toBeLessThanOrEqual(1e-6)
  })

  it("warns when the step cap prevents 10 points per period", () => {
    const { warnings } = chooseTimeStep({ durationS: 1, periodS: 1e-4 })
    expect(warnings.join(" ")).toMatch(/kurang dari 10 titik per periode/i)
  })
})

describe("runTransientSim", () => {
  it("simulates RC step response reaching ~63% at t = tau and ~99% at 5 tau", () => {
    const res = runTransientSim(RC_FILTER, { sourceRail: "5V", waveform: "step", amplitudeV: 5, durationMs: 5 })
    expect(res.error).toBeUndefined()
    const vout = res.signals.VOUT
    expect(valueAt(res.timesMs, vout, 1)).toBeGreaterThan(3.0)
    expect(valueAt(res.timesMs, vout, 1)).toBeLessThan(3.35)
    expect(vout[vout.length - 1]).toBeGreaterThan(4.9)
  })

  it("defaults the source amplitude to the DC rail voltage", () => {
    const res = runTransientSim(rcFilter("3V3"), { waveform: "step", durationMs: 10 })
    const vout = res.signals.VOUT
    expect(vout[vout.length - 1]).toBeCloseTo(3.3, 1)
  })

  it("returns an error instead of a flat waveform when there is no GND net", () => {
    const noGnd = RC_FILTER.map((el) => (el.source_net_id === "n_gnd" ? { ...el, name: "NET3" } : el))
    const res = runTransientSim(noGnd, { durationMs: 5 })
    expect(res.error).toMatch(/GND/)
    expect(res.timesMs).toHaveLength(0)
  })

  it("returns an error when no voltage source net exists", () => {
    const noSrc = RC_FILTER.map((el) => (el.source_net_id === "n_in" ? { ...el, name: "IN" } : el))
    const res = runTransientSim(noSrc, { durationMs: 5 })
    expect(res.error).toMatch(/sumber/i)
    expect(res.timesMs).toHaveLength(0)
  })

  it("resolves LED polarity from port names, not port order", () => {
    const res = runTransientSim(LED_CATHODE_FIRST, { sourceRail: "5V", waveform: "step", amplitudeV: 5, durationMs: 1 })
    const va = res.signals.LED_A
    const last = va[va.length - 1]
    expect(last).toBeGreaterThan(1.7)
    expect(last).toBeLessThan(2.4)
  })

  it("settles a diode circuit without chattering between on and off", () => {
    const res = runTransientSim(LED_CATHODE_FIRST, { sourceRail: "5V", waveform: "step", amplitudeV: 5, durationMs: 1 })
    const tail = res.signals.LED_A.slice(-20)
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.01)
  })

  it("keeps sine waveforms free of aliasing (>= 20 samples per period)", () => {
    const res = runTransientSim(RC_FILTER, { sourceRail: "5V", waveform: "sine", amplitudeV: 5, frequencyHz: 5000, durationMs: 2 })
    const samplesPerPeriod = (res.timesMs.length - 1) / (2 / 0.2)
    expect(samplesPerPeriod).toBeGreaterThanOrEqual(20)
    expect(res.warnings).toHaveLength(0)
  })

  it("warns about unparseable capacitor values instead of silently defaulting", () => {
    const res = runTransientSim(rcFilter("5V", "banyak"), { durationMs: 5 })
    expect(res.warnings.join(" ")).toMatch(/C1/)
  })

  it("lists parts the simulator ignores", () => {
    const withChip = [...RC_FILTER, part("u1", "U1", "simple_chip"), port("u1_1", "u1", "VCC"), port("u1_2", "u1", "GND")]
    const res = runTransientSim(withChip, { durationMs: 5 })
    expect(res.ignoredParts.join(" ")).toMatch(/U1/)
  })

  it("adds a backward-Euler damping note when L and C are both present", () => {
    const lc: El[] = [
      ...RC_FILTER,
      part("l1", "L1", "simple_inductor", { inductance: "10mH" }),
      port("l1_1", "l1", "pin1"),
      port("l1_2", "l1", "pin2"),
      trace(["l1_1"], ["n_out"]),
      trace(["l1_2"], ["n_gnd"]),
    ]
    const res = runTransientSim(lc, { durationMs: 5 })
    expect(res.notes.join(" ")).toMatch(/backward-Euler/i)
  })
})

describe("runAcSweepSim", () => {
  it("computes RC low-pass Bode response (-3dB near 159 Hz)", () => {
    const res = runAcSweepSim(RC_FILTER, { sourceRail: "5V", startHz: 1, stopHz: 100_000, points: 50 })
    const db = res.magnitudeDb.VOUT
    expect(db[0]).toBeGreaterThan(-0.5)
    const idx = nearestIndex(res.freqsHz, 159.15)
    expect(db[idx]).toBeGreaterThan(-4.2)
    expect(db[idx]).toBeLessThan(-2.0)
    expect(db[db.length - 1]).toBeLessThan(-40)
  })

  it("treats a reverse-biased diode as open at its DC operating point", () => {
    const res = runAcSweepSim(REVERSE_DIODE, { sourceRail: "5V", startHz: 10, stopHz: 1000 })
    expect(res.magnitudeDb.OUT[0]).toBeGreaterThan(-0.5)
  })

  it("treats a forward-biased LED as its small-signal conductance", () => {
    const res = runAcSweepSim(LED_CATHODE_FIRST, { sourceRail: "5V", startHz: 10, stopHz: 1000 })
    expect(res.magnitudeDb.LED_A[0]).toBeLessThan(-20)
  })

  it("returns an error when there is no GND net", () => {
    const noGnd = RC_FILTER.map((el) => (el.source_net_id === "n_gnd" ? { ...el, name: "NET3" } : el))
    const res = runAcSweepSim(noGnd)
    expect(res.error).toMatch(/GND/)
    expect(res.freqsHz).toHaveLength(0)
  })

  it("refuses boards above the AC node cap with a message", () => {
    const res = runAcSweepSim(resistorChain(MAX_SPICE_NODES + 20))
    expect(res.tooLarge).toBe(true)
    expect(res.error).toMatch(/terlalu besar/i)
  })

  it("warns when the stop frequency has to be raised", () => {
    const res = runAcSweepSim(RC_FILTER, { startHz: 100, stopHz: 200 })
    expect(res.warnings.join(" ")).toMatch(/frekuensi akhir/i)
    expect(res.freqsHz[res.freqsHz.length - 1]).toBeCloseTo(1000, -1)
  })
})

describe("runDcSweepSim", () => {
  it("sweeps DC supply voltage cleanly", () => {
    const sweep = runDcSweepSim(RC_FILTER, { railName: "5V", startV: 0, stopV: 10, steps: 10 })
    expect(sweep.voltages).toHaveLength(11)
    expect(sweep.totalCurrentMa).toHaveLength(11)
  })
})
