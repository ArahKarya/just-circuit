import { createHash, randomBytes } from "node:crypto"
import path from "node:path"
import { readJsonFile, writeJsonFile } from "../storage/fs-utils.js"

interface StoredSession {
  /** sha256 of the token; the token itself only lives in the browser cookie. */
  hash: string
  expiresAt: number
}

export interface SessionStore {
  create: () => Promise<{ token: string; expiresAt: number }>
  isValid: (token: string | undefined) => Promise<boolean>
  revoke: (token: string | undefined) => Promise<void>
}

const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex")

/** Login sessions persisted to dataDir/sessions.json so a server restart keeps users signed in. */
export function createSessionStore(dataDir: string, ttlMs: number, now: () => number = Date.now): SessionStore {
  const file = path.join(dataDir, "sessions.json")
  let cache: StoredSession[] | null = null

  async function load(): Promise<StoredSession[]> {
    cache ??= (await readJsonFile<StoredSession[]>(file, [])).filter((s) => s.expiresAt > now())
    return cache
  }

  async function persist(sessions: StoredSession[]): Promise<void> {
    cache = sessions
    await writeJsonFile(file, sessions, { mode: 0o600 })
  }

  return {
    async create() {
      const token = randomBytes(32).toString("base64url")
      const expiresAt = now() + ttlMs
      const live = (await load()).filter((s) => s.expiresAt > now())
      await persist([...live, { hash: hashToken(token), expiresAt }])
      return { token, expiresAt }
    },
    async isValid(token) {
      if (!token) return false
      const hash = hashToken(token)
      return (await load()).some((s) => s.hash === hash && s.expiresAt > now())
    },
    async revoke(token) {
      if (!token) return
      const hash = hashToken(token)
      await persist((await load()).filter((s) => s.hash !== hash))
    },
  }
}
