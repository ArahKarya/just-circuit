import { lookup } from "node:dns/promises"
import { BlockList, isIP } from "node:net"

export class UrlGuardError extends Error {}

const PRIVATE_RANGES: ReadonlyArray<[string, number, "ipv4" | "ipv6"]> = [
  ["0.0.0.0", 8, "ipv4"],
  ["10.0.0.0", 8, "ipv4"],
  ["100.64.0.0", 10, "ipv4"], // CGNAT, Tailscale
  ["127.0.0.0", 8, "ipv4"],
  ["169.254.0.0", 16, "ipv4"], // link-local, cloud metadata
  ["172.16.0.0", 12, "ipv4"],
  ["192.0.0.0", 24, "ipv4"],
  ["192.168.0.0", 16, "ipv4"],
  ["198.18.0.0", 15, "ipv4"],
  ["224.0.0.0", 3, "ipv4"], // multicast + reserved
  ["::", 128, "ipv6"],
  ["::1", 128, "ipv6"],
  ["fc00::", 7, "ipv6"],
  ["fe80::", 10, "ipv6"],
  ["ff00::", 8, "ipv6"],
]

const privateRanges = new BlockList()
for (const [network, prefix, family] of PRIVATE_RANGES) privateRanges.addSubnet(network, prefix, family)

/** Extracts the IPv4 address from an IPv4-mapped IPv6 address (::ffff:a.b.c.d or ::ffff:7f00:1). */
function mappedIpv4(ip: string): string | null {
  const match = ip.toLowerCase().match(/^(?:0{0,4}:){0,5}:?ffff:(.+)$/)
  if (!match) return null
  const tail = match[1]
  if (isIP(tail) === 4) return tail
  const hex = tail.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!hex) return null
  const high = Number.parseInt(hex[1], 16)
  const low = Number.parseInt(hex[2], 16)
  return [high >> 8, high & 255, low >> 8, low & 255].join(".")
}

export function isPrivateAddress(ip: string): boolean {
  const family = isIP(ip)
  if (family === 4) return privateRanges.check(ip, "ipv4")
  if (family !== 6) return true
  const v4 = mappedIpv4(ip)
  return v4 ? privateRanges.check(v4, "ipv4") : privateRanges.check(ip, "ipv6")
}

export function parseHttpUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new UrlGuardError("URL tidak valid")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UrlGuardError("Hanya URL http/https yang diizinkan")
  }
  if (url.username || url.password) {
    throw new UrlGuardError("URL tidak boleh berisi kredensial")
  }
  return url
}

/** Rejects URLs that resolve to private/loopback addresses unless allowed. */
export async function assertPublicHost(url: URL, allowPrivate: boolean): Promise<void> {
  if (allowPrivate) return
  const host = url.hostname.replace(/^\[|\]$/g, "")
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address)
  if (addresses.length === 0 || addresses.some(isPrivateAddress)) {
    throw new UrlGuardError("Host ini mengarah ke jaringan privat dan tidak diizinkan di server ini")
  }
}

export function hostMatches(hostname: string, allowedSuffixes: readonly string[]): boolean {
  const host = hostname.toLowerCase()
  return allowedSuffixes.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

/** fetch that never follows redirects, so a validated host cannot bounce the request elsewhere. */
export const noRedirectFetch: typeof fetch = (input, init) => fetch(input, { ...init, redirect: "error" })

/** Reads a response body, aborting once it grows past `maxBytes`. */
export async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0)
  if (declared > maxBytes) throw new Error("Respons upstream terlalu besar")
  if (!response.body) return Buffer.alloc(0)
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error("Respons upstream terlalu besar")
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}
