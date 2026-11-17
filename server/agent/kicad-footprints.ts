import { lstat, mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { errorMessage, logger } from "../logger.js"
import { readLimited } from "../net/url-guard.js"

/** KiCad footprints converted to circuit JSON by tscircuit (what the browser preview fetches too). */
const KICAD_FOOTPRINT_BASE = process.env.CDS_E2E === "1" && process.env.CDS_PARTS_TEST_BASE ? `${process.env.CDS_PARTS_TEST_BASE}/kicad` : "https://kicad-mod-cache.tscircuit.com"
const MAX_FOOTPRINTS = 100
const MAX_FOOTPRINT_BYTES = 4 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
/** Library and footprint names as KiCad uses them; "." and ".." segments are refused separately. */
const SEGMENT = /^[A-Za-z0-9_.+\-(),]{1,150}$/
const KICAD_REF = /["'`]kicad:([^"'`\s]{3,300})["'`]/g

/** "Package_SO/TSSOP-38_4.4x9.7mm_P0.5mm" -> its two segments, or null when it isn't a plain library/name pair. */
export function footprintSegments(name: string): [string, string] | null {
  const parts = name.split("/")
  if (parts.length !== 2) return null
  const [library, footprint] = parts
  if (!SEGMENT.test(library) || !SEGMENT.test(footprint) || [library, footprint].some((part) => part === "." || part === "..")) return null
  return [library, footprint]
}

/** KiCad footprints a project names (footprint="kicad:Library/Name"), deduplicated. */
export function kicadFootprintsIn(files: Readonly<Record<string, string>>): string[] {
  const names = new Set<string>()
  for (const content of Object.values(files)) {
    for (const match of content.matchAll(KICAD_REF)) {
      if (footprintSegments(match[1])) names.add(match[1])
      if (names.size >= MAX_FOOTPRINTS) return [...names]
    }
  }
  return [...names]
}

async function fetchFootprint(name: string, [library, footprint]: [string, string]): Promise<unknown[]> {
  const url = `${KICAD_FOOTPRINT_BASE}/${encodeURIComponent(library)}/${encodeURIComponent(footprint)}.circuit.json`
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = JSON.parse((await readLimited(response, MAX_FOOTPRINT_BYTES)).toString("utf8")) as unknown
  if (!Array.isArray(body) || body.length === 0) throw new Error(`${name}: bukan circuit JSON`)
  return body
}

export interface PreparedFootprints {
  footprints: Record<string, unknown[]>
  /** Names that couldn't be loaded (unknown footprint, offline); the build reports them. */
  missing: string[]
}

/**
 * Loads the footprints outside the sandbox (which has no network), from a disk cache first.
 * Footprints rarely change, so a cached copy is used as long as it exists.
 */
export async function prepareKicadFootprints(names: readonly string[], cacheDir: string): Promise<PreparedFootprints> {
  const footprints: Record<string, unknown[]> = {}
  const missing: string[] = []
  for (const name of names.slice(0, MAX_FOOTPRINTS)) {
    const segments = footprintSegments(name)
    if (!segments) {
      missing.push(name)
      continue
    }
    const file = path.join(cacheDir, segments[0], `${segments[1]}.circuit.json`)
    const cached = await lstat(file).catch(() => null)
    if (cached?.isFile() && cached.size <= MAX_FOOTPRINT_BYTES) {
      try {
        footprints[name] = JSON.parse(await readFile(file, "utf8")) as unknown[]
        continue
      } catch {
        // A damaged cache file is fetched again.
      }
    }
    try {
      const body = await fetchFootprint(name, segments)
      footprints[name] = body
      await mkdir(path.dirname(file), { recursive: true })
      await writeFile(file, JSON.stringify(body))
    } catch (error) {
      logger.warn("kicad footprint unavailable", { name, error: errorMessage(error) })
      missing.push(name)
    }
  }
  return { footprints, missing }
}
