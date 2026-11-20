import Fuse from "fuse.js"
import { PART_SOURCES, type PartHit, type PartSearchResult, type PartSource } from "../../shared/parts.js"
import { readLimited } from "../net/url-guard.js"
import { ExternalServiceError } from "../net/external-error.js"

/** E2E runs point every source at the local mock (only honoured in E2E mode). */
const TEST_BASE = process.env.JUST_CIRCUIT_E2E === "1" ? process.env.JUST_CIRCUIT_PARTS_TEST_BASE : undefined

/** Public tscircuit services (the same ones `tsci search` uses). */
export const ENDPOINTS = {
  jlcpcb: TEST_BASE ? `${TEST_BASE}/jlcpcb/api/search` : "https://jlcsearch.tscircuit.com/api/search",
  ti: TEST_BASE ? `${TEST_BASE}/ti/api/search` : "https://tisearch.tscircuit.com/api/search",
  digikey: TEST_BASE ? `${TEST_BASE}/digikey/api/search` : "https://digikeysearch.tscircuit.com/api/search",
  mouser: TEST_BASE ? `${TEST_BASE}/mouser/api/search` : "https://mousersearch.tscircuit.com/api/search",
  registry: TEST_BASE ? `${TEST_BASE}/registry/packages/search` : "https://registry-api.tscircuit.com/packages/search",
  datasheetList: TEST_BASE ? `${TEST_BASE}/registry/datasheets/list` : "https://registry-api.tscircuit.com/datasheets/list",
  datasheetGet: TEST_BASE ? `${TEST_BASE}/registry/datasheets/get` : "https://registry-api.tscircuit.com/datasheets/get",
  kicadFiles: TEST_BASE ? `${TEST_BASE}/kicad/kicad_files.json` : "https://kicad-mod-cache.tscircuit.com/kicad_files.json",
} as const

const TIMEOUT_MS = 8_000
const MAX_JSON_BYTES = 8 * 1024 * 1024
const LIMIT = 10
const KICAD_TTL_MS = 24 * 60 * 60 * 1000
const DATASHEET_LIST_TTL_MS = 60 * 60 * 1000
const MAX_KICAD_FILES = 200_000
const KICAD_FILE = /^[\w.\-+()]{1,80}\.pretty\/[\w.\-+(),]{1,150}\.kicad_mod$/
const SEARCH_CACHE_MS = 5 * 60 * 1000
const SEARCH_CACHE_ENTRIES = 200

/** JSON from one of the fixed endpoints above (never a URL from the request). */
export async function fetchJson(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: "application/json", ...init.headers } })
  if (!response.ok) throw new ExternalServiceError(`HTTP ${response.status}`)
  const body = await readLimited(response, MAX_JSON_BYTES)
  return JSON.parse(body.toString("utf8"))
}

/**
 * Text from a supplier, made safe to show and to hand to the AI: one line, no control characters
 * or backticks (upstream data could otherwise smuggle instructions or break out of a prompt).
 */
const text = (value: unknown, max = 300): string | undefined => {
  if (typeof value !== "string") return undefined
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029`]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max)
  return clean || undefined
}
/** Part numbers, packages and order codes: a strict character set. */
const code = (value: unknown, max = 80): string | undefined => text(value, max)?.replace(/[^\w .,+\-/#()%]+/g, "").trim() || undefined
const num = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) ? value : undefined)
/** Only http(s) links reach the page (a javascript: URL from a source must never become a link). */
const link = (value: unknown): string | undefined => {
  const raw = text(value, 1000)
  if (!raw) return undefined
  try {
    const url = new URL(raw)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : undefined
  } catch {
    return undefined
  }
}

type Row = Record<string, unknown>

function rows(body: unknown, key: string): Row[] {
  const list = (body as Record<string, unknown> | null)?.[key]
  return Array.isArray(list) ? (list.filter((item) => item && typeof item === "object") as Row[]) : []
}

function distributorHit(source: PartSource, row: Row, numberField: string): PartHit | null {
  const title = code(row.mfr)
  if (!title) return null
  const supplierPartNumber = code(row[numberField]) ?? code(row.supplier_part_number)
  return {
    source,
    key: `${source}:${supplierPartNumber ?? title}`,
    title,
    manufacturer: text(row.manufacturer, 80),
    description: text(row.detailed_description) ?? text(row.description),
    package: code(row.package),
    stock: num(row.stock),
    price: num(row.price),
    supplierPartNumber,
    datasheetUrl: link(row.datasheet_url),
    productUrl: link(row.product_url),
  }
}

/** A list fetched upstream and kept for a while; a failed refresh keeps serving the old copy. */
function cached<T>(ttlMs: number, load: () => Promise<T>): () => Promise<T> {
  let value: { loadedAt: number; data: T } | null = null
  let loading: Promise<T> | null = null
  return async () => {
    if (value && Date.now() - value.loadedAt < ttlMs) return value.data
    loading ??= load()
      .then((data) => {
        value = { loadedAt: Date.now(), data }
        return data
      })
      .catch((error: unknown) => {
        if (value) return value.data
        throw error
      })
      .finally(() => {
        loading = null
      })
    return loading
  }
}

const kicadFuse = cached(KICAD_TTL_MS, async () => {
  const body = await fetchJson(ENDPOINTS.kicadFiles)
  if (!Array.isArray(body)) throw new Error("Daftar footprint KiCad tidak valid")
  const files = body.slice(0, MAX_KICAD_FILES).filter((item): item is string => typeof item === "string" && KICAD_FILE.test(item))
  return new Fuse(files, { threshold: 0.35, ignoreLocation: true })
})

/** "Package_SO.pretty/TSSOP-38_4.4x9.7mm_P0.5mm.kicad_mod" -> "kicad:Package_SO/TSSOP-38_4.4x9.7mm_P0.5mm". */
export function kicadFootprintName(path: string): string {
  return `kicad:${path.replace(".pretty/", "/").replace(/\.kicad_mod$/, "")}`
}

/** How well a footprint path matches: name starting with the query, then containing it, then fuzzy. */
function kicadRank(path: string, needle: string): number {
  const name = path.slice(path.lastIndexOf("/") + 1).toLowerCase()
  if (name.startsWith(`${needle}_`) || name === `${needle}.kicad_mod`) return 0
  if (name.startsWith(needle)) return 1
  if (name.includes(needle)) return 2
  return 3
}

/** KiCad footprints matching a package name, e.g. "TSSOP-38" puts TSSOP-38_… before HTSSOP-38_…. */
export async function searchKicadFootprints(query: string, limit = LIMIT): Promise<string[]> {
  const fuse = await kicadFuse()
  const needle = query.trim().toLowerCase()
  const results = fuse.search(query, { limit: limit * 10 }).map((result, order) => ({ path: result.item, order }))
  return results
    .sort((a, b) => kicadRank(a.path, needle) - kicadRank(b.path, needle) || a.order - b.order)
    .slice(0, limit)
    .map((result) => kicadFootprintName(result.path))
}

const datasheetChips = cached(DATASHEET_LIST_TTL_MS, async () =>
  rows(await fetchJson(ENDPOINTS.datasheetList), "datasheets").flatMap((row) => {
    const chip = code(row.chip_name)
    const id = code(row.datasheet_id)
    return chip && id ? [{ id, chip }] : []
  }),
)

type Searcher = (query: string) => Promise<PartHit[]>

const SEARCHERS: Record<PartSource, Searcher> = {
  async datasheets(query) {
    const needle = query.toLowerCase()
    return (await datasheetChips())
      .filter(({ chip }) => chip.toLowerCase().includes(needle))
      .sort((a, b) => Number(b.chip.toLowerCase() === needle) - Number(a.chip.toLowerCase() === needle) || a.chip.localeCompare(b.chip))
      .slice(0, LIMIT)
      .map(({ id, chip }) => ({ source: "datasheets", key: `datasheets:${id}`, title: chip, description: "Peta pin dan footprint sudah tersedia" }))
  },
  async jlcpcb(query) {
    const body = await fetchJson(`${ENDPOINTS.jlcpcb}?${new URLSearchParams({ q: query, limit: String(LIMIT) })}`)
    return rows(body, "components").flatMap((row) => {
      const lcsc = num(row.lcsc)
      const hit = distributorHit("jlcpcb", { ...row, lcsc_number: lcsc ? `C${lcsc}` : undefined }, "lcsc_number")
      return hit ? [{ ...hit, description: text(row.description) }] : []
    })
  },
  async ti(query) {
    const body = await fetchJson(`${ENDPOINTS.ti}?${new URLSearchParams({ q: query, limit: String(LIMIT) })}`)
    return rows(body, "components").flatMap((row) => distributorHit("ti", { manufacturer: "Texas Instruments", ...row }, "ti_product_number") ?? [])
  },
  async digikey(query) {
    const body = await fetchJson(`${ENDPOINTS.digikey}?${new URLSearchParams({ q: query, limit: String(LIMIT) })}`)
    return rows(body, "components").flatMap((row) => distributorHit("digikey", row, "digikey_product_number") ?? [])
  },
  async mouser(query) {
    const body = await fetchJson(`${ENDPOINTS.mouser}?${new URLSearchParams({ q: query, limit: String(LIMIT) })}`)
    return rows(body, "components").flatMap((row) => distributorHit("mouser", row, "mouser_product_number") ?? [])
  },
  async kicad(query) {
    return (await searchKicadFootprints(query)).map((footprint) => ({ source: "kicad", key: `kicad:${footprint}`, title: footprint.replace(/^kicad:/, ""), footprint }))
  },
  async tscircuit(query) {
    const body = await fetchJson(ENDPOINTS.registry, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query }) })
    return rows(body, "packages").flatMap((row) => {
      const name = code(row.name, 120)
      return name ? [{ source: "tscircuit", key: `tscircuit:${name}`, title: name, description: text(row.description) }] : []
    })
  },
}

const searchCache = new Map<string, { at: number; result: PartSearchResult }>()

/** Searches the chosen sources in parallel; a failing source is reported, not fatal. Results are kept a few minutes. */
export async function searchParts(query: string, sources: readonly PartSource[] = PART_SOURCES): Promise<PartSearchResult> {
  const cacheKey = `${query.toLowerCase()}|${[...sources].sort().join(",")}`
  const hit = searchCache.get(cacheKey)
  if (hit && Date.now() - hit.at < SEARCH_CACHE_MS) return hit.result
  const settled = await Promise.allSettled(sources.map((source) => SEARCHERS[source](query)))
  const hits: PartHit[] = []
  const errors: PartSearchResult["errors"] = []
  const keys = new Set<string>()
  settled.forEach((outcome, index) => {
    if (outcome.status === "rejected") {
      errors.push({ source: sources[index], message: outcome.reason instanceof Error ? outcome.reason.message.slice(0, 200) : "Gagal" })
      return
    }
    for (const found of outcome.value) {
      // Suppliers list the same order code twice now and then; keys stay unique for the page.
      let key = found.key
      for (let n = 2; keys.has(key); n += 1) key = `${found.key}#${n}`
      keys.add(key)
      hits.push({ ...found, key })
    }
  })
  const result = { query, hits, errors }
  if (errors.length === 0) {
    if (searchCache.size >= SEARCH_CACHE_ENTRIES) searchCache.delete(searchCache.keys().next().value as string)
    searchCache.set(cacheKey, { at: Date.now(), result })
  }
  return result
}
