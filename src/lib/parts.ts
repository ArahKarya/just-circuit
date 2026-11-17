import { componentNameFor, partFilePath, type CatalogPart, type KicadModPart, type PartHit, type PartSearchResult, type PartSource, type SupplierKey } from "../../shared/parts"
import { api } from "./api"
import type { AttachmentRef } from "./types"

export const partsRepo = {
  search: (q: string, sources?: readonly PartSource[]) =>
    api.get<PartSearchResult>(`/api/parts/search?${new URLSearchParams({ q, ...(sources ? { sources: sources.join(",") } : {}) })}`),
  catalog: (chip: string, supplier?: SupplierKey, supplierPartNumber?: string) =>
    api.get<CatalogPart>(`/api/parts/catalog?${new URLSearchParams({ chip, ...(supplier && supplierPartNumber ? { supplier, spn: supplierPartNumber } : {}) })}`),
  footprints: (q: string) => api.get<string[]>(`/api/parts/footprints?${new URLSearchParams({ q })}`),
  /** Converts an uploaded KiCad footprint into a component (nothing is stored yet). */
  convertKicadMod: (fileName: string, content: string, partName: string) => api.post<KicadModPart>("/api/parts/kicad-mod", { fileName, content, partName }),
  /** The server downloads the PDF and stores it as a chat attachment of the project. */
  fetchDatasheet: (projectId: string, url: string, name: string) => api.post<AttachmentRef>("/api/parts/datasheet", { projectId, url, name }),
}

/** tscircuit supplier key for a hit's order number, when the source is one tscircuit knows. */
export function supplierKeyFor(source: PartSource): SupplierKey | undefined {
  if (source === "jlcpcb") return "jlcpcb"
  if (source === "digikey" || source === "mouser") return source
  return undefined
}

const FAMILY_ALIASES: Record<string, string> = { TFSOP: "TSSOP", PDIP: "DIP", VQFN: "QFN", WQFN: "QFN", UQFN: "QFN", VSON: "SON", WSON: "SON", HVQFN: "QFN" }
const FAMILIES = "TSSOP|TFSOP|HTSSOP|SSOP|SOIC|SOP|MSOP|VSSOP|QFN|VQFN|WQFN|UQFN|HVQFN|DFN|SON|VSON|WSON|LQFP|TQFP|QFP|PDIP|DIP"

/** KiCad search for a supplier's package text: "38-TFSOP (0.173", 4.40mm Width)" -> "TSSOP-38". */
export function kicadQueryFor(pkg: string | undefined): string | null {
  if (!pkg) return null
  const sot = /\b(SOT-?\d+(?:-\d+)?)\b/i.exec(pkg)
  if (sot) return sot[1].toUpperCase().replace(/^SOT(\d)/, "SOT-$1")
  const countFirst = new RegExp(`\\b(\\d{1,3})[- ]?(?:pin\\s+)?(${FAMILIES})\\b`, "i").exec(pkg)
  const familyFirst = new RegExp(`\\b(${FAMILIES})[- ]?(\\d{1,3})\\b`, "i").exec(pkg)
  const [count, family] = countFirst ? [countFirst[1], countFirst[2]] : familyFirst ? [familyFirst[2], familyFirst[1]] : [null, null]
  if (!count || !family) return null
  const upper = family.toUpperCase()
  return `${FAMILY_ALIASES[upper] ?? upper}-${count}`
}

/**
 * The catalog chip for a supplier hit, only when the part numbers are the same: a family prefix
 * (LM358 vs LM358P) can mean another package, and so another footprint or pin map.
 */
export function catalogMatch(hit: PartHit, catalogChips: readonly string[]): string | null {
  const title = hit.title.toLowerCase()
  return catalogChips.find((chip) => title === chip.toLowerCase()) ?? null
}

/** Chat request to replace the pad numbers of an uploaded footprint with the datasheet's pin names. */
export function pinNamesRequest(part: KicadModPart, partName: string): string {
  return [
    `Komponen ${part.componentName} di ${part.tsxPath} memakai footprint KiCad yang saya unggah (${part.padCount} pad); nama pinnya masih P1, P2, ….`,
    `Ganti pinLabels dengan nama pin dari datasheet ${partName || part.componentName} (saya lampirkan datasheet-nya), tambahkan manufacturerPartNumber, dan jangan ubah file .footprint.json.`,
  ].join("\n")
}

/** Chat request that has the AI build a part component from its attached datasheet. */
export function datasheetRequest(hit: PartHit, footprints: readonly string[]): string {
  const name = componentNameFor(hit.title)
  const supplier = supplierKeyFor(hit.source)
  const footprint = footprints.length
    ? `pilih yang cocok dengan package di datasheet, misalnya ${footprints.slice(0, 3).join(" atau ")}`
    : "footprint KiCad yang sesuai package-nya (format kicad:Library/Nama) atau string footprinter tscircuit"
  return [
    `Buat komponen ${hit.title}${hit.manufacturer ? ` (${hit.manufacturer})` : ""}${hit.package ? `, package ${hit.package}` : ""} dari datasheet terlampir, di file baru ${partFilePath(name)}:`,
    `- export const ${name} = (props) => <chip name="U1" ... {...props} />, tanpa <board>, dan jangan dipasang di rangkaian dulu.`,
    `- pinLabels persis sesuai tabel pin di datasheet untuk package ini (pin1, pin2, … ke nama pin). Nama yang berulang (mis. GND) beri akhiran _2, _3.`,
    `- footprint: ${footprint}.`,
    `- manufacturerPartNumber="${hit.title}"${supplier && hit.supplierPartNumber ? `, supplierPartNumbers={{ ${supplier}: ["${hit.supplierPartNumber}"] }}` : ""}.`,
    `Sebutkan halaman datasheet yang kamu pakai untuk pinout dan package.`,
  ].join("\n")
}
