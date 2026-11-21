import { describe, expect, it } from "vitest"
import {
  calcDiffPairImpedance,
  calcLedResistor,
  calcMicrostripImpedance,
  calcRcFilter,
  calcTraceMaxCurrent,
  calcTraceWidthIpc2221,
  calcViaCurrent,
  calcVoltageClearanceIpc2221,
  calcVoltageDivider,
  E96_SERIES,
  nearestE24,
  nearestInSeries,
} from "./pcb-calc"

describe("pcb-calc", () => {
  it("computes IPC-2221 trace width and inverse ampacity consistently", () => {
    const res = calcTraceWidthIpc2221(1.0, 10, 1, false)
    expect(res.widthMm).toBeGreaterThan(0.25)
    expect(res.widthMm).toBeLessThan(0.4)
    const back = calcTraceMaxCurrent(res.widthMm, 10, 1, false)
    expect(back).toBeCloseTo(1.0, 1)
  })

  it("computes via current capacity and resistance", () => {
    const via = calcViaCurrent(0.3, 25, 1.6, 10)
    expect(via.maxCurrentA).toBeGreaterThan(0.8)
    expect(via.resistanceMOhm).toBeGreaterThan(0.5)
  })

  it("computes 50-ohm microstrip and 90-ohm USB diff pair in realistic range", () => {
    // 4-layer JLCPCB 7628 stackup: h ~ 0.2mm, Er ~ 4.4, w ~ 0.35mm -> ~50 ohm
    const ms = calcMicrostripImpedance(0.35, 0.2, 0.035, 4.4)
    expect(ms.z0Ohms).toBeGreaterThan(45)
    expect(ms.z0Ohms).toBeLessThan(58)

    const diff = calcDiffPairImpedance(0.22, 0.15, 0.2, 0.035, 4.4)
    expect(diff.zDiffOhms).toBeGreaterThan(75)
    expect(diff.zDiffOhms).toBeLessThan(115)
  })

  it("picks nearest E24 resistors for voltage divider and LED limiter", () => {
    expect(nearestE24(325)).toBe(330)
    expect(nearestE24(4800)).toBe(4700)

    const div = calcVoltageDivider(5, 3.3, 10_000)
    if (!div.ok) throw new Error(div.error)
    expect(Math.abs(div.actualVout - 3.3)).toBeLessThan(0.15)

    const led = calcLedResistor(5, 2.0, 10)
    if (!led.ok) throw new Error(led.error)
    expect(led.standardOhms).toBe(300)
    expect(led.actualCurrentMa).toBeCloseTo(10, 0)
    expect(led.recommendedPackage).toBe("0402")
  })

  it("returns null for non-positive resistances instead of a bogus value", () => {
    expect(nearestE24(0)).toBeNull()
    expect(nearestE24(-5)).toBeNull()
    expect(nearestE24(Number.NaN)).toBeNull()
  })

  it("rejects LED inputs where the supply cannot forward-bias the LED", () => {
    const res = calcLedResistor(2, 2.0, 10)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/Vf/)
    expect(calcLedResistor(5, 2, 0).ok).toBe(false)
  })

  it("rejects divider targets outside 0 < Vout < Vin", () => {
    expect(calcVoltageDivider(5, 0, 10_000).ok).toBe(false)
    expect(calcVoltageDivider(5, 5, 10_000).ok).toBe(false)
    expect(calcVoltageDivider(5, 6, 10_000).ok).toBe(false)
    expect(calcVoltageDivider(0, 1, 10_000).ok).toBe(false)
  })

  it("searches R1/R2 pairs and beats fixing R2 at the nearest value", () => {
    // 12V -> 3.3V with R2 fixed at 10k gives R1=27k (3.24V, -1.9%).
    const div = calcVoltageDivider(12, 3.3, 10_000)
    if (!div.ok) throw new Error(div.error)
    expect(Math.abs(div.errorPercent)).toBeLessThan(1)
    expect(div.r2Ohms).toBeGreaterThan(3000)
    expect(div.r2Ohms).toBeLessThan(33_000)
  })

  it("supports the E96 series for tighter dividers", () => {
    expect(E96_SERIES).toHaveLength(96)
    expect(E96_SERIES).toContain(1.02)
    expect(E96_SERIES).toContain(4.99)
    expect(E96_SERIES).toContain(9.76)
    expect(nearestInSeries(4990, "E96")).toBe(4990)
    const div = calcVoltageDivider(12, 3.3, 10_000, "E96")
    if (!div.ok) throw new Error(div.error)
    expect(div.series).toBe("E96")
    // E96 is geometric, so pair ratios fall on a ~2.4% grid: worst case is about half a step.
    expect(Math.abs(div.errorPercent)).toBeLessThan(1.25)
    expect(E96_SERIES).toContain(div.r1Ohms / 10 ** Math.floor(Math.log10(div.r1Ohms)))
  })

  it("returns IPC-2221 voltage clearance and RC filter cutoff", () => {
    expect(calcVoltageClearanceIpc2221(240).externalUncoatedMm).toBe(1.25)
    expect(calcVoltageClearanceIpc2221(5).externalCoatedMm).toBe(0.05)

    // 1k + 100nF -> fc ≈ 1591.5 Hz
    const rc = calcRcFilter(1000, 100)
    expect(rc.cutoffHz).toBeCloseTo(1591.55, 0)
  })
})
