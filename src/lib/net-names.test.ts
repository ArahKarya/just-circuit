import { describe, expect, it } from "vitest"
import { buildNetNameMap, sanitizeNetName } from "./net-names"

describe("sanitizeNetName", () => {
  it.each([
    ["GND", "GND"],
    ["+3V3", "P3V3"],
    ["+5V", "P5V"],
    ["-12V", "N12V"],
    ["/SDA", "SDA"],
    ["/sub/CLK", "sub_CLK"],
    ["Net-(R1-Pad1)", "Net_R1_Pad1"],
    ["VCC.IO", "VCC_IO"],
    ["3V3", "N_3V3"],
    ["", "NET"],
    ["~{RST}", "RST"],
  ])("%j -> %j", (raw, expected) => {
    expect(sanitizeNetName(raw)).toBe(expected)
  })

  it("always yields a name core accepts after net.", () => {
    for (const raw of ["+3V3", "Net-(U1-Pad3)", "/a.b+c", "1", "a>b c"]) {
      const name = sanitizeNetName(raw)
      expect(name).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/)
    }
  })
})

describe("buildNetNameMap", () => {
  it("is deterministic, unique and counts renames", () => {
    const { names, renamed } = buildNetNameMap(["GND", "+3V3", "P3V3", "/SDA", "SDA"])
    expect([...names.entries()]).toEqual([
      ["GND", "GND"],
      ["+3V3", "P3V3_2"],
      ["P3V3", "P3V3"],
      ["/SDA", "SDA_2"],
      ["SDA", "SDA"],
    ])
    expect(renamed).toBe(2)
  })

  it("prefers keeping names that are already valid", () => {
    const { names } = buildNetNameMap(["+3V3", "P3V3"])
    expect(names.get("P3V3")).toBe("P3V3")
    expect(names.get("+3V3")).toBe("P3V3_2")
  })
})
