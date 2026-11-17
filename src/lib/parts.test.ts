import { describe, expect, it } from "vitest"
import { componentNameFor, partFilePath, type PartHit } from "../../shared/parts"
import { catalogMatch, datasheetRequest, kicadQueryFor, supplierKeyFor } from "./parts"

const hit = (extra: Partial<PartHit>): PartHit => ({ source: "ti", key: "k", title: "ADS8688IDBT", ...extra })

describe("part helpers", () => {
  it("names components after part numbers", () => {
    expect(componentNameFor("ADS8688IDBT")).toBe("ADS8688IDBT")
    expect(componentNameFor("74hc595-q1")).toBe("Part74hc595Q1")
    expect(componentNameFor("LM358 DR")).toBe("LM358DR")
    expect(componentNameFor("***")).toBe("Part")
    expect(componentNameFor("chip-props")).toBe("ChipPropsPart")
    expect(componentNameFor("object")).toBe("ObjectPart")
    expect(partFilePath("W5500")).toBe("lib/parts/W5500.tsx")
  })

  it("turns supplier package text into a KiCad search", () => {
    expect(kicadQueryFor('38-TFSOP (0.173", 4.40mm Width)')).toBe("TSSOP-38")
    expect(kicadQueryFor("16-SOIC (0.295\", 7.50mm Width)")).toBe("SOIC-16")
    expect(kicadQueryFor("SOT-23-5")).toBe("SOT-23-5")
    expect(kicadQueryFor("QFN-32")).toBe("QFN-32")
    expect(kicadQueryFor("48-VQFN")).toBe("QFN-48")
    expect(kicadQueryFor("TSSOP")).toBeNull()
    expect(kicadQueryFor(undefined)).toBeNull()
  })

  it("matches supplier codes to catalog chips", () => {
    expect(catalogMatch(hit({ title: "W5500" }), ["W5500"])).toBe("W5500")
    expect(catalogMatch(hit({ title: "w5500" }), ["W5500"])).toBe("W5500")
    // Another package of the same family must not get the catalog's footprint and pins.
    expect(catalogMatch(hit({ title: "NE555P" }), ["NE555"])).toBeNull()
    expect(catalogMatch(hit({ title: "ADS8688IDBT" }), ["W5500"])).toBeNull()
  })

  it("asks the AI for a component file from the attached datasheet", () => {
    const text = datasheetRequest(hit({ source: "digikey", manufacturer: "Texas Instruments", package: "38-TFSOP", supplierPartNumber: "296-ADS8688IDBTR-ND" }), ["kicad:Package_SO/TSSOP-38_4.4x9.7mm_P0.5mm"])
    expect(text).toContain("Buat komponen ADS8688IDBT (Texas Instruments), package 38-TFSOP dari datasheet terlampir, di file baru lib/parts/ADS8688IDBT.tsx")
    expect(text).toContain("kicad:Package_SO/TSSOP-38_4.4x9.7mm_P0.5mm")
    expect(text).toContain('supplierPartNumbers={{ digikey: ["296-ADS8688IDBTR-ND"] }}')
    expect(supplierKeyFor("ti")).toBeUndefined()
  })
})
