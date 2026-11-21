import { describe, expect, it } from "vitest"
import { sanitizePinLabel, uniquePinLabels } from "./pin-labels"

describe("sanitizePinLabel", () => {
  it("keeps valid labels", () => {
    expect(sanitizePinLabel("VCC")).toBe("VCC")
    expect(sanitizePinLabel("PA0_ADC")).toBe("PA0_ADC")
  })

  it("turns KiCad overbars into an _N suffix", () => {
    expect(sanitizePinLabel("~{RESET}")).toBe("RESET_N")
  })

  it("replaces invalid characters", () => {
    expect(sanitizePinLabel("PA0/ADC0")).toBe("PA0_ADC0")
    expect(sanitizePinLabel("+3V3")).toBe("3V3")
    expect(sanitizePinLabel("D+")).toBe("D")
  })

  it("returns nothing for KiCad's unnamed marker", () => {
    expect(sanitizePinLabel("~")).toBeUndefined()
    expect(sanitizePinLabel("  ")).toBeUndefined()
    expect(sanitizePinLabel(undefined)).toBeUndefined()
  })
})

describe("uniquePinLabels", () => {
  it("falls back to pinN, dedupes repeats and counts every change", () => {
    const result = uniquePinLabels([
      { num: 1, raw: "VCC" },
      { num: 2, raw: "~" },
      { num: 3, raw: "GND" },
      { num: 4, raw: "GND" },
      { num: 5, raw: "pin2" },
    ])
    expect(result.pins).toEqual([
      { num: 1, label: "VCC" },
      { num: 2, label: "pin2" },
      { num: 3, label: "GND" },
      { num: 4, label: "GND_2" },
      { num: 5, label: "pin2_2" },
    ])
    expect(result.renamed).toBe(3)
  })

  it("every label matches the tscircuit pin label pattern", () => {
    const { pins } = uniquePinLabels([{ num: 1, raw: "~{CS}" }, { num: 2, raw: "SDA/SDI" }, { num: 3, raw: "" }])
    for (const pin of pins) expect(pin.label).toMatch(/^[A-Za-z0-9_]+$/)
  })
})
