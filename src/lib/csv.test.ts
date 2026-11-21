import { describe, expect, it } from "vitest"
import { csvCell, toCsv } from "./csv"

describe("csvCell", () => {
  it("quotes every cell and doubles embedded quotes", () => {
    expect(csvCell("R1")).toBe('"R1"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
  })

  it.each(["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"])("neutralises a formula-looking cell %j", (value) => {
    expect(csvCell(value)).toBe(`"'${value.replace(/"/g, '""')}"`)
  })

  it("leaves ordinary text and numbers alone", () => {
    expect(csvCell("10k")).toBe('"10k"')
    expect(csvCell("1.500")).toBe('"1.500"')
    expect(csvCell("")).toBe('""')
  })

  it("does not flag negative coordinates as formulas", () => {
    expect(csvCell("-12.500")).toBe('"-12.500"')
    expect(csvCell("-3")).toBe('"-3"')
  })
})

describe("toCsv", () => {
  it("joins rows with CRLF-free newlines and commas", () => {
    expect(toCsv([["a", "b"], ["=c", "d"]])).toBe(`"a","b"\n"'=c","d"`)
  })
})
