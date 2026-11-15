import { APICallError } from "ai"
import { errorMessage } from "../logger.js"

const STATUS_HINTS: Record<number, string> = {
  400: "Permintaan ditolak provider. Cek nama model dan jenis API.",
  401: "API key ditolak. Cek kembali key-nya.",
  403: "Akses ditolak. Key tidak punya izin untuk model ini.",
  404: "Endpoint tidak ditemukan. Cek Base URL (biasanya diakhiri /v1) dan jenis API, atau nama model.",
  429: "Kuota atau batas request provider habis. Tunggu sebentar atau ganti model.",
}

function stripQuery(url: string): string {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return url
  }
}

/** Turns provider failures into a short, actionable message (without leaking keys in query strings). */
export function describeProviderError(error: unknown): string {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode
    const hint = status ? STATUS_HINTS[status] ?? (status >= 500 ? "Server provider sedang bermasalah, coba lagi nanti." : error.message) : error.message
    const where = error.url ? ` (${stripQuery(error.url)})` : ""
    return `HTTP ${status ?? "?"}${where}: ${hint}`
  }
  return errorMessage(error)
}
