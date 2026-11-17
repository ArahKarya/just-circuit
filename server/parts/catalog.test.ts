import { describe, expect, it } from "vitest"
import { buildCatalogTsx, cleanMpn, pinLabelsFrom } from "./catalog"

describe("catalog parts", () => {
  it("labels pins by number and keeps repeated names addressable", () => {
    const { labels, skipped } = pinLabelsFrom([
      { pin_number: "1", name: ["VDD"] },
      { pin_number: "2", name: ["GND"] },
      { pin_number: "3", name: ["GND"] },
      { pin_number: "4", name: ["SCSn", "SCS_N"] },
      { pin_number: "5", name: ["RST#"] },
      { pin_number: "EP", name: ["PAD"] },
      { pin_number: "6", name: [] },
    ])
    expect(labels).toEqual({ pin1: ["VDD"], pin2: ["GND"], pin3: ["GND_2"], pin4: ["SCSn", "SCS_N"], pin5: ["RST"] })
    expect(skipped).toEqual(["EP"])
  })

  it("builds TSX from data only, so text from the catalog can't become code", () => {
    const { tsx, componentName, footprint } = buildCatalogTsx(
      {
        chip_name: 'EVIL"/><script>',
        manufacturer_part_number: 'X1"} {...alert(1)} a={"',
        footprinter_string: 'soic8"} onClick={alert(1)',
        pin_information: [{ pin_number: "1", name: ['A"]} alert(1) {["'] }],
        pin_attributes: { pin1: { note: '"} alert(2) {"' }, pin9: { requiresPower: true }, evil: "x" },
      },
      { supplier: "digikey", supplierPartNumber: "296-1-ND" },
    )
    expect(componentName).toMatch(/^[A-Za-z][A-Za-z0-9]*$/)
    expect(footprint).toBeNull()
    expect(tsx).not.toContain("footprint=")
    expect(tsx).toContain('manufacturerPartNumber={"X1 ...alert(1) a"}')
    expect(tsx).toContain('pin1: ["A_alert_1"]')
    expect(tsx).toContain('pinAttributes={{"pin1":{"note":"\\"} alert(2) {\\""}}}')
    expect(tsx).not.toContain("pin9")
    expect(tsx).toContain('supplierPartNumbers={{"digikey":["296-1-ND"]}}')
  })

  it("never lets a part number end the header comment", () => {
    for (const mpn of ["A\nfetch('/api/settings')\n//", "A\u2028fetch(1)", "A*/ fetch(1) /*"]) {
      const { tsx } = buildCatalogTsx({ manufacturer_part_number: mpn, pin_information: [{ pin_number: "1", name: ["GND"] }] })
      const header = tsx.split("\n")[0]
      expect(header.startsWith("// A")).toBe(true)
      expect(tsx.split("\n")[1]).toBe('import type { ChipProps } from "tscircuit"')
      expect(tsx).not.toMatch(/[\u2028\u2029]/)
      expect(header).not.toMatch(/\*\/|['"]/)
    }
    expect(cleanMpn("ADS8688 IDBT(R)#")).toBe("ADS8688 IDBT(R)#")
  })

  it("keeps valid footprinter strings", () => {
    const part = buildCatalogTsx({ chip_name: "NE555DR", footprinter_string: "soic8_w6.95mm_p1.27mm", pin_information: [{ pin_number: "1", name: ["GND"] }] })
    expect(part.footprint).toBe("soic8_w6.95mm_p1.27mm")
    expect(part.pinCount).toBe(1)
    expect(part.tsx).toContain("export const NE555DR = (props: ChipProps<typeof pinLabels>) => (")
  })
})
