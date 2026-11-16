import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto"

const KEY_LENGTH = 64
const DEFAULT_COST = { N: 2 ** 15, r: 8, p: 1 }
const PREFIX = "scrypt"

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // maxmem must cover 128 * N * r bytes.
    scrypt(password, salt, KEY_LENGTH, { ...options, maxmem: 256 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key)))
  })
}

/** Returns "scrypt$N$r$p$salt$hash" (base64), safe to keep in .env. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const key = await derive(password, salt, DEFAULT_COST)
  const { N, r, p } = DEFAULT_COST
  return [PREFIX, N, r, p, salt.toString("base64"), key.toString("base64")].join("$")
}

export function isPasswordHash(value: string): boolean {
  const parts = value.split("$")
  return parts.length === 6 && parts[0] === PREFIX && parts.slice(1, 4).every((n) => /^\d+$/.test(n))
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isPasswordHash(stored)) return false
  const [, N, r, p, salt, hash] = stored.split("$")
  const expected = Buffer.from(hash, "base64")
  const actual = await derive(password, Buffer.from(salt, "base64"), { N: Number(N), r: Number(r), p: Number(p) })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
