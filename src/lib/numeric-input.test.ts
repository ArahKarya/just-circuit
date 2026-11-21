import { describe, expect, it } from "vitest"
import { parseNumberInput } from "./numeric-input"

describe("parseNumberInput", () => {
  it("parses decimals, including a comma decimal separator", () => {
    expect(parseNumberInput("0.5")).toEqual({ ok: true, value: 0.5 })
    expect(parseNumberInput("0,5")).toEqual({ ok: true, value: 0.5 })
    expect(parseNumberInput(" 12 ")).toEqual({ ok: true, value: 12 })
    expect(parseNumberInput("0")).toEqual({ ok: true, value: 0 })
  })

  it("rejects thousands separators and ambiguous separators", () => {
    for (const raw of ["1,000", "12,500", "1,000.5", "1.000,5", "1,2,3"]) {
      const res = parseNumberInput(raw)
      expect(res.ok, raw).toBe(false)
      if (!res.ok) expect(res.error).toMatch(/tanpa pemisah ribuan/)
    }
    expect(parseNumberInput("1,25")).toEqual({ ok: true, value: 1.25 })
    expect(parseNumberInput("0,125")).toEqual({ ok: true, value: 0.125 })
  })

  it("rejects empty input unless optional", () => {
    expect(parseNumberInput("").ok).toBe(false)
    expect(parseNumberInput("", { optional: true })).toEqual({ ok: true, value: null })
  })

  it("rejects non-numbers", () => {
    const res = parseNumberInput("abc")
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/angka/i)
    expect(parseNumberInput("1.2.3").ok).toBe(false)
    expect(parseNumberInput("Infinity").ok).toBe(false)
  })

  it("enforces bounds with readable messages", () => {
    const tooSmall = parseNumberInput("0", { gt: 0 })
    expect(tooSmall.ok).toBe(false)
    if (!tooSmall.ok) expect(tooSmall.error).toMatch(/lebih dari 0/)
    expect(parseNumberInput("0.5", { min: 1 }).ok).toBe(false)
    expect(parseNumberInput("100", { max: 60 }).ok).toBe(false)
    expect(parseNumberInput("60", { max: 60 })).toEqual({ ok: true, value: 60 })
  })
})
