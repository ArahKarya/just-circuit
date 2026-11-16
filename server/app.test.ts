import { randomBytes } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import type { Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { createApp } from "./app"
import { createAuth } from "./auth/auth"
import { createSessionStore } from "./auth/sessions"
import { hashPassword } from "./security/password"
import { createSecretBox } from "./security/secret-box"
import { createProjectStore } from "./storage/projects"
import { createSettingsStore } from "./storage/settings"
import { createWorkspaceStore } from "./storage/workspaces"

const PASSWORD = "kata-sandi-uji-123"
let dataDir: string
let server: Server
let base: string

beforeAll(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "cds-app-"))
  const auth = createAuth({
    passwordHash: await hashPassword(PASSWORD),
    sessions: createSessionStore(dataDir, 60_000),
    cookieSecure: false,
    loginRateLimitPerMinute: 100,
  })
  const projects = createProjectStore(dataDir)
  const app = createApp({ auth, projects, settings: createSettingsStore(dataDir, createSecretBox(randomBytes(32))), workspaces: createWorkspaceStore(projects) })
  server = app.listen(0, "127.0.0.1")
  await new Promise((resolve) => server.once("listening", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await rm(dataDir, { recursive: true, force: true })
})

const csrf = { "X-CDS-Request": "1", "Content-Type": "application/json" }

async function login(password: string): Promise<Response> {
  return fetch(`${base}/api/auth/login`, { method: "POST", headers: csrf, body: JSON.stringify({ password }) })
}

describe("API with a password", () => {
  it("keeps health public and everything else behind login", async () => {
    expect((await fetch(`${base}/api/health`)).status).toBe(200)
    expect((await fetch(`${base}/api/projects`)).status).toBe(401)
    expect((await fetch(`${base}/api/settings`)).status).toBe(401)
    expect((await fetch(`${base}/api/jlc/proxy`)).status).toBe(401)
    const me = await (await fetch(`${base}/api/auth/me`)).json()
    expect(me.data).toEqual({ authRequired: true, authenticated: false })
  })

  it("rejects a wrong password and accepts the right one with an httpOnly cookie", async () => {
    expect((await login("salah")).status).toBe(401)
    const ok = await login(PASSWORD)
    expect(ok.status).toBe(200)
    const cookie = ok.headers.get("set-cookie") ?? ""
    expect(cookie).toMatch(/cds_session=/)
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Strict/i)

    const session = cookie.split(";")[0]
    const projects = await fetch(`${base}/api/projects`, { headers: { cookie: session } })
    expect(projects.status).toBe(200)

    // Signed in but without the CSRF header: state changes are refused.
    const noCsrf = await fetch(`${base}/api/projects`, { method: "POST", headers: { cookie: session, "Content-Type": "application/json" }, body: "{}" })
    expect(noCsrf.status).toBe(403)

    await fetch(`${base}/api/auth/logout`, { method: "POST", headers: { ...csrf, cookie: session } })
    expect((await fetch(`${base}/api/projects`, { headers: { cookie: session } })).status).toBe(401)
  })

  it("refuses login without the CSRF header", async () => {
    const response = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password: PASSWORD }) })
    expect(response.status).toBe(403)
  })
})
