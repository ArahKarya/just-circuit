import { lookup as dnsLookup, type LookupAddress } from "node:dns"
import http from "node:http"
import https from "node:https"
import { isIP, type LookupFunction } from "node:net"
import { isPrivateAddress, parseHttpUrl, UrlGuardError } from "../net/url-guard.js"

const MAX_REDIRECTS = 5
const MAX_LOCATION_CHARS = 2000
/** Datasheets live on ordinary web servers; other ports would turn this into a port scanner. */
const ALLOWED_PORTS = new Set(["", "80", "443"])
const TIMEOUT_MS = 45_000

export interface Download {
  bytes: Buffer
  /** URL after redirects. */
  url: string
  contentType: string
}

/**
 * DNS lookup that refuses private addresses at connect time, so a host can't pass a check and then
 * resolve to 127.0.0.1 or the LAN for the real request (DNS rebinding).
 */
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4)
    const list = addresses as LookupAddress[]
    const blocked = list.find((entry) => isPrivateAddress(entry.address))
    if (list.length === 0 || blocked) return callback(new UrlGuardError("Host ini mengarah ke jaringan privat dan tidak diizinkan"), "", 4)
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

function assertAllowedPort(url: URL): void {
  if (!ALLOWED_PORTS.has(url.port)) throw new UrlGuardError("Hanya port 80 dan 443 yang diizinkan")
}

/** An IP written in the URL skips DNS (and so the lookup above): check it directly. */
function assertPublicLiteral(url: URL): void {
  const host = url.hostname.replace(/^\[|\]$/g, "")
  if (isIP(host) && isPrivateAddress(host)) throw new UrlGuardError("Host ini mengarah ke jaringan privat dan tidak diizinkan")
}

function requestOnce(url: URL, maxBytes: number, signal: AbortSignal, allowPrivate: boolean): Promise<{ status: number; location?: string; contentType: string; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http
    const req = client.get(
      url,
      { ...(allowPrivate ? {} : { lookup: publicLookup }), signal, headers: { "User-Agent": "Just-Circuit-datasheet-fetch", Accept: "application/pdf,*/*;q=0.5" } },
      (res) => {
        const status = res.statusCode ?? 0
        const contentType = String(res.headers["content-type"] ?? "")
        if (status >= 300 && status < 400) {
          res.resume()
          return resolve({ status, location: res.headers.location, contentType, bytes: Buffer.alloc(0) })
        }
        const declared = Number(res.headers["content-length"] ?? 0)
        if (declared > maxBytes) {
          res.destroy()
          return reject(new UrlGuardError("File terlalu besar"))
        }
        const chunks: Buffer[] = []
        let total = 0
        res.on("data", (chunk: Buffer) => {
          total += chunk.length
          if (total > maxBytes) {
            res.destroy()
            reject(new UrlGuardError("File terlalu besar"))
            return
          }
          chunks.push(chunk)
        })
        res.on("end", () => resolve({ status, contentType, bytes: Buffer.concat(chunks) }))
        res.on("error", reject)
      },
    )
    req.on("error", reject)
  })
}

/** Downloads a public http(s) file, following redirects only to other public hosts. */
export async function downloadPublicFile(rawUrl: string, maxBytes: number, options: { allowPrivate?: boolean } = {}): Promise<Download> {
  const signal = AbortSignal.timeout(TIMEOUT_MS)
  let url = parseHttpUrl(rawUrl)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (!options.allowPrivate) {
      assertPublicLiteral(url)
      assertAllowedPort(url)
    }
    const result = await requestOnce(url, maxBytes, signal, options.allowPrivate ?? false)
    if (result.location) {
      if (result.location.length > MAX_LOCATION_CHARS) throw new Error("Alamat pengalihan terlalu panjang")
      const next = parseHttpUrl(new URL(result.location, url).toString())
      if (url.protocol === "https:" && next.protocol === "http:") throw new UrlGuardError("Pengalihan dari https ke http ditolak")
      url = next
      continue
    }
    if (result.status < 200 || result.status >= 300) throw new Error(`Server sumber menjawab HTTP ${result.status}`)
    return { bytes: result.bytes, url: url.toString(), contentType: result.contentType }
  }
  throw new Error("Terlalu banyak pengalihan (redirect)")
}
