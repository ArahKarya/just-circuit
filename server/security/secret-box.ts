import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"
import { writeFileAtomic } from "../storage/fs-utils.js"

const ALGORITHM = "aes-256-gcm"
const KEY_BYTES = 32
const IV_BYTES = 12
const VERSION = "v1"

/** Encrypts small secrets (API keys) at rest with AES-256-GCM. */
export interface SecretBox {
  seal: (plain: string) => string
  open: (sealed: string) => string
}

export function createSecretBox(key: Buffer): SecretBox {
  if (key.length !== KEY_BYTES) throw new Error(`Secret key must be ${KEY_BYTES} bytes`)
  return {
    seal(plain) {
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv(ALGORITHM, key, iv)
      const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
      return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(":")
    },
    open(sealed) {
      const [version, iv, tag, data] = sealed.split(":")
      if (version !== VERSION || !iv || !tag || data === undefined) throw new Error("Unrecognized secret format")
      const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(iv, "base64"))
      decipher.setAuthTag(Buffer.from(tag, "base64"))
      return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8")
    },
  }
}

function parseKey(value: string): Buffer {
  const trimmed = value.trim()
  const key = /^[0-9a-f]{64}$/i.test(trimmed) ? Buffer.from(trimmed, "hex") : Buffer.from(trimmed, "base64")
  if (key.length !== KEY_BYTES) throw new Error("JUST_CIRCUIT_SECRET must be 32 bytes (64 hex characters or base64)")
  return key
}

/** Uses JUST_CIRCUIT_SECRET when set, otherwise a key file generated once inside the data dir (mode 600). */
export async function loadSecretKey(configured: string, dataDir: string): Promise<Buffer> {
  if (configured) return parseKey(configured)
  const file = path.join(dataDir, "secret.key")
  try {
    return parseKey(await readFile(file, "utf8"))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const key = randomBytes(KEY_BYTES)
  await writeFileAtomic(file, key.toString("hex"), { mode: 0o600 })
  return key
}
