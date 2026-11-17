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
import { createGlobalMemoryStore } from "./storage/global-memory"
import { createLibraryStore } from "./storage/library"
import { createPreferencesStore } from "./storage/preferences"
import { createWorkspaceStore } from "./storage/workspaces"
import { TINY_PNG } from "./test-fixtures/make-pdf"

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
  const app = createApp({ auth, projects, settings: createSettingsStore(dataDir, createSecretBox(randomBytes(32))), workspaces: createWorkspaceStore(projects), preferences: createPreferencesStore(dataDir), memory: createGlobalMemoryStore(dataDir), library: createLibraryStore(dataDir) })
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

describe("chat attachments", () => {
  it("uploads raw bytes, serves them safely and removes them with the chat", async () => {
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: csrf, body: JSON.stringify({ password: PASSWORD }) })
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]
    const json = { ...csrf, cookie }
    const created = await (await fetch(`${base}/api/projects`, { method: "POST", headers: json, body: JSON.stringify({ name: "Lampiran", entrypoint: "index.circuit.tsx", files: { "index.circuit.tsx": "1" } }) })).json()
    const url = `${base}/api/projects/${created.data.id}/attachments`
    const upload = (body: Buffer, name: string, headers: Record<string, string> = {}) =>
      fetch(url, { method: "POST", headers: { cookie, "X-CDS-Request": "1", "Content-Type": "application/octet-stream", "X-File-Name": encodeURIComponent(name), ...headers }, body: new Uint8Array(body) })

    expect((await upload(TINY_PNG, "skema.png", { "X-CDS-Request": "" })).status).toBe(403)
    const bad = await upload(Buffer.from("<svg onload=alert(1)>"), "x.svg")
    expect(bad.status).toBe(400)

    const uploaded = await upload(TINY_PNG, "skema rangkaian.png")
    expect(uploaded.status).toBe(201)
    const meta = (await uploaded.json()).data
    expect(meta).toMatchObject({ name: "skema rangkaian.png", kind: "image", mediaType: "image/png" })

    const served = await fetch(`${url}/${meta.id}`, { headers: { cookie } })
    expect(served.headers.get("content-type")).toBe("image/png")
    expect(served.headers.get("content-security-policy")).toContain("sandbox")
    expect(served.headers.get("content-disposition")).toContain("inline; filename*=UTF-8''skema%20rangkaian.png")
    expect(Buffer.from(await served.arrayBuffer()).equals(TINY_PNG)).toBe(true)
    expect((await fetch(`${url}/${meta.id}`)).status).toBe(401)

    const text = (await (await upload(Buffer.from("R1 1k"), "bom.csv")).json()).data
    expect((await fetch(`${url}/${text.id}`, { headers: { cookie } })).headers.get("content-disposition")).toMatch(/^attachment/)

    const tooBig = await upload(Buffer.alloc(3 * 1024 * 1024, 0x61), "besar.txt")
    expect(tooBig.status).toBe(413)
    expect((await tooBig.json()).error).toMatch(/File teks terlalu besar/)

    // The message keeps what the server knows about the file, not what the browser claims.
    const fake = { ...meta, name: "palsu.exe", size: 1 }
    const unknown = { ...meta, id: "00000000-0000-0000-0000-000000000000" }
    const posted = await fetch(`${base}/api/projects/${created.data.id}/messages`, { method: "POST", headers: json, body: JSON.stringify({ id: "m1", role: "user", content: "lihat", createdAt: 1, attachments: [fake, unknown] }) })
    expect((await posted.json()).data.attachments).toEqual([{ id: meta.id, name: "skema rangkaian.png", kind: "image", mediaType: "image/png", size: TINY_PNG.length }])
    expect((await fetch(`${url}/${meta.id}`, { method: "DELETE", headers: json })).status).toBe(400)
    expect((await fetch(`${base}/api/projects/${created.data.id}/messages`, { method: "DELETE", headers: json })).status).toBe(200)
    expect((await fetch(`${url}/${meta.id}`, { headers: { cookie } })).status).toBe(404)
  })
})

describe("part search API", () => {
  it("validates queries and never downloads from private addresses", async () => {
    const login = await fetch(`${base}/api/auth/login`, { method: "POST", headers: csrf, body: JSON.stringify({ password: PASSWORD }) })
    const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0]
    expect((await fetch(`${base}/api/parts/search?q=${encodeURIComponent("<script>")}`, { headers: { cookie } })).status).toBe(400)
    expect((await fetch(`${base}/api/parts/search?q=NE555&sources=evil`, { headers: { cookie } })).status).toBe(400)
    const created = await (await fetch(`${base}/api/projects`, { method: "POST", headers: { ...csrf, cookie }, body: JSON.stringify({ name: "Parts", entrypoint: "index.circuit.tsx", files: { "index.circuit.tsx": "1" } }) })).json()
    const download = await fetch(`${base}/api/parts/datasheet`, { method: "POST", headers: { ...csrf, cookie }, body: JSON.stringify({ projectId: created.data.id, url: `${base}/api/health`, name: "X1" }) })
    expect(download.status).toBe(400)
    expect((await download.json()).error).toMatch(/privat/)
  })
})

