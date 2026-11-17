/** Part search across the sources the tscircuit ecosystem exposes (shared by server and browser). */

export const PART_SOURCES = ["datasheets", "jlcpcb", "ti", "digikey", "mouser", "kicad", "tscircuit"] as const
export type PartSource = (typeof PART_SOURCES)[number]

export const PART_SOURCE_LABELS: Record<PartSource, string> = {
  datasheets: "Katalog datasheet",
  jlcpcb: "JLCPCB / LCSC",
  ti: "Texas Instruments",
  digikey: "DigiKey",
  mouser: "Mouser",
  kicad: "Footprint KiCad",
  tscircuit: "Registry tscircuit",
}

/** Supplier keys tscircuit accepts in supplierPartNumbers. */
export type SupplierKey = "jlcpcb" | "lcsc" | "digikey" | "mouser"

export interface PartHit {
  source: PartSource
  /** Unique within one search result. */
  key: string
  /** Manufacturer part number (or footprint / package name for KiCad and registry hits). */
  title: string
  manufacturer?: string
  description?: string
  package?: string
  stock?: number
  price?: number
  /** Order number at the supplier (C123 for LCSC, 296-… for DigiKey). */
  supplierPartNumber?: string
  datasheetUrl?: string
  productUrl?: string
  /** KiCad hits: the footprint string to use, e.g. kicad:Package_SO/TSSOP-38_4.4x9.7mm_P0.5mm. */
  footprint?: string
}

export interface PartSearchResult {
  query: string
  hits: PartHit[]
  /** Sources that failed (offline, rate limited); the rest still answer. */
  errors: { source: PartSource; message: string }[]
}

/** A part from the datasheet catalog, turned into a ready component. */
export interface CatalogPart {
  chipName: string
  mpn: string
  description: string
  pinCount: number
  footprint: string | null
  datasheetUrls: string[]
  componentName: string
  /** TSX of lib/parts/<componentName>.tsx, built by CDS from the catalog data. */
  tsx: string
  /** Pins the catalog lists that couldn't be mapped to pinN labels (e.g. "EP"). */
  skippedPins: string[]
}

/** Names the generated file imports or that would shadow a JavaScript global. */
const RESERVED_NAMES = new Set(["ChipProps", "React", "Object", "Array", "Date", "Map", "Set", "Math", "JSON", "Number", "String", "Boolean", "Symbol", "Promise", "Error", "Function", "Infinity", "NaN", "Proxy", "Reflect"])

/** A component made from an uploaded KiCad footprint (.kicad_mod). */
export interface KicadModPart {
  componentName: string
  footprintName: string
  padCount: number
  /** lib/parts/<Name>.tsx and lib/parts/<Name>.footprint.json. */
  files: Record<string, string>
  tsxPath: string
  warnings: string[]
}

/** PascalCase component name from a part number: "ADS8688IDBT" -> "ADS8688IDBT", "74hc595-q1" -> "Part74hc595Q1". */
export function componentNameFor(mpn: string): string {
  const words = mpn.split(/[^A-Za-z0-9]+/).filter(Boolean)
  const name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("").slice(0, 40)
  if (!name) return "Part"
  if (/^[0-9]/.test(name)) return `Part${name}`
  return RESERVED_NAMES.has(name) ? `${name}Part` : name
}

/** File a part component lives in. */
export function partFilePath(componentName: string): string {
  return `lib/parts/${componentName}.tsx`
}

/** Valid search query: what the sources accept, nothing that could smuggle markup. */
export const PART_QUERY = /^[\w .,+\-/#%()]{1,100}$/
