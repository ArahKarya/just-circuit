import { componentNameFor, type CatalogPart, type SupplierKey } from "../../shared/parts.js"
import { NotFoundError } from "../storage/errors.js"
import { ENDPOINTS, fetchJson } from "./sources.js"

const FOOTPRINTER = /^[A-Za-z0-9_.\-]{1,120}$/
/** Characters a part number may keep; everything else (newlines, U+2028, quotes, `*` `/`…) is dropped. */
const MPN_NOISE = /[^\w.\-+#(),% ]+/g

/** A part number safe to show and to write into the file's header comment. */
export function cleanMpn(raw: unknown): string {
  return typeof raw === "string" ? raw.replace(MPN_NOISE, " ").replace(/\s+/g, " ").trim().slice(0, 80) : ""
}
const MAX_ATTRIBUTES_CHARS = 60_000

interface CatalogPin {
  name?: unknown
  pin_number?: unknown
}

interface CatalogEntry {
  chip_name?: unknown
  manufacturer_part_number?: unknown
  ai_description?: unknown
  footprinter_string?: unknown
  pin_information?: unknown
  pin_attributes?: unknown
  datasheet_pdf_urls?: unknown
}

/** A pin label tscircuit accepts as a selector: letters, digits and underscores. */
function cleanLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const label = raw.trim().replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40)
  return label || null
}

/** pinN -> [label, aliases…]; repeated names (several GND pins) become GND, GND_2, … so each pin stays addressable. */
export function pinLabelsFrom(pins: readonly CatalogPin[]): { labels: Record<string, string[]>; skipped: string[] } {
  const labels: Record<string, string[]> = {}
  const skipped: string[] = []
  const used = new Map<string, number>()
  for (const pin of pins) {
    const number = typeof pin.pin_number === "string" || typeof pin.pin_number === "number" ? String(pin.pin_number).trim() : ""
    if (!/^\d{1,4}$/.test(number)) {
      if (number) skipped.push(number)
      continue
    }
    const names = (Array.isArray(pin.name) ? pin.name : [pin.name]).map(cleanLabel).filter((name): name is string => name !== null)
    if (names.length === 0) continue
    const [first, ...aliases] = names
    const count = (used.get(first) ?? 0) + 1
    used.set(first, count)
    const primary = count === 1 ? first : `${first}_${count}`
    labels[`pin${Number(number)}`] = [...new Set([primary, ...aliases.filter((alias) => alias !== first)])]
  }
  return { labels, skipped }
}

/** Pin attributes as plain JSON data (only for pins that exist). */
function attributesFrom(raw: unknown, labels: Record<string, string[]>): Record<string, unknown> | null {
  if (!raw || typeof raw !== "object") return null
  const picked = Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter(([key, value]) => key in labels && value && typeof value === "object"))
  const json = JSON.stringify(picked)
  return Object.keys(picked).length > 0 && json.length <= MAX_ATTRIBUTES_CHARS ? (JSON.parse(json) as Record<string, unknown>) : null
}

export interface CatalogOptions {
  supplier?: SupplierKey
  supplierPartNumber?: string
}

/**
 * Builds the component TSX from the catalog's data. The catalog also ships ready-made TSX, but code
 * from an outside service is never written into a project: every value here goes through JSON.stringify.
 */
export function buildCatalogTsx(entry: CatalogEntry, options: CatalogOptions = {}): Omit<CatalogPart, "chipName" | "description" | "datasheetUrls"> {
  const pins = Array.isArray(entry.pin_information) ? (entry.pin_information as CatalogPin[]) : []
  const { labels, skipped } = pinLabelsFrom(pins)
  const mpn = cleanMpn(entry.manufacturer_part_number) || cleanMpn(entry.chip_name) || "PART"
  const componentName = componentNameFor(mpn)
  const footprint = typeof entry.footprinter_string === "string" && FOOTPRINTER.test(entry.footprinter_string) ? entry.footprinter_string : null
  const attributes = attributesFrom(entry.pin_attributes, labels)
  const suppliers = options.supplier && options.supplierPartNumber ? { [options.supplier]: [options.supplierPartNumber] } : null
  const props = [
    `name="U1"`,
    `manufacturerPartNumber={${JSON.stringify(mpn)}}`,
    `pinLabels={pinLabels}`,
    footprint ? `footprint={${JSON.stringify(footprint)}}` : null,
    attributes ? `pinAttributes={${JSON.stringify(attributes)}}` : null,
    suppliers ? `supplierPartNumbers={${JSON.stringify(suppliers)}}` : null,
    `{...props}`,
  ].filter(Boolean)
  const tsx = [
    `// ${mpn}: dibuat CDS dari katalog datasheet tscircuit. Cek peta pin dengan datasheet sebelum produksi.`,
    `import type { ChipProps } from "tscircuit"`,
    ``,
    `const pinLabels = {`,
    ...Object.entries(labels).map(([pin, names]) => `  ${pin}: ${JSON.stringify(names)},`),
    `} as const`,
    ``,
    `export const ${componentName} = (props: ChipProps<typeof pinLabels>) => (`,
    `  <chip`,
    ...props.map((prop) => `    ${prop}`),
    `  />`,
    `)`,
    ``,
    `export default ${componentName}`,
    ``,
  ].join("\n")
  return { mpn, componentName, footprint, pinCount: Object.keys(labels).length, tsx, skippedPins: skipped }
}

/** A part from the tscircuit datasheet catalog, ready to add to a project. */
export async function getCatalogPart(chipName: string, options: CatalogOptions = {}): Promise<CatalogPart> {
  let body: unknown
  try {
    body = await fetchJson(`${ENDPOINTS.datasheetGet}?${new URLSearchParams({ chip_name: chipName.toLowerCase() })}`)
  } catch (error) {
    if (error instanceof Error && /HTTP 404/.test(error.message)) throw new NotFoundError(`${chipName} tidak ada di katalog datasheet`)
    throw error
  }
  const entry = (body as { datasheet?: CatalogEntry } | null)?.datasheet
  if (!entry || !Array.isArray(entry.pin_information) || entry.pin_information.length === 0) {
    throw new NotFoundError(`${chipName} belum punya data pin di katalog datasheet`)
  }
  const built = buildCatalogTsx(entry, options)
  if (built.pinCount === 0) throw new NotFoundError(`${chipName} belum punya data pin yang bisa dipakai di katalog datasheet`)
  const urls = Array.isArray(entry.datasheet_pdf_urls) ? entry.datasheet_pdf_urls.filter((url): url is string => typeof url === "string" && /^https?:\/\//.test(url)).slice(0, 3) : []
  return {
    ...built,
    chipName: cleanMpn(entry.chip_name) || chipName,
    description: typeof entry.ai_description === "string" ? entry.ai_description.slice(0, 400) : "",
    datasheetUrls: urls,
  }
}
