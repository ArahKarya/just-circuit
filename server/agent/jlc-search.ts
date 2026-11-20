import { ExternalServiceError } from "../net/external-error.js"
export interface PartHit {
  lcsc: string
  mfr: string
  package: string
  description: string
  stock: number
  price: number | null
  basic: boolean
}

/** Catalog text goes into the model's context: plain characters only, short. */
function clean(value: unknown, max: number): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").slice(0, max)
}

const SEARCH_URL = "https://jlcsearch.tscircuit.com/api/search"
const TIMEOUT_MS = 15_000

/** Searches the JLCPCB catalog (via tscircuit's jlcsearch) for parts the AI can use. */
export async function searchJlcpcb(query: string, limit: number): Promise<PartHit[]> {
  const url = `${SEARCH_URL}?${new URLSearchParams({ q: query, limit: String(limit) })}`
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "error" })
  if (!response.ok) throw new ExternalServiceError(`jlcsearch HTTP ${response.status}`)
  const body = (await response.json()) as { components?: Record<string, unknown>[] }
  return (body.components ?? []).slice(0, limit).map((c) => ({
    lcsc: `C${clean(c.lcsc, 12).replace(/\D/g, "")}`,
    mfr: clean(c.mfr, 60),
    package: clean(c.package, 40),
    description: clean(c.description, 200),
    stock: Number(c.stock ?? 0),
    price: typeof c.price === "number" ? c.price : null,
    basic: Boolean(c.is_basic),
  }))
}
