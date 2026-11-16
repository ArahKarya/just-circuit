import { mkdtemp, realpath, rm } from "node:fs/promises"
import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import WebSocket from "ws"
import { attachTerminalServer, isSameOrigin, shellEnv } from "./terminal-server"

let server: Server
let port: number
let projectDir: string

beforeAll(async () => {
  projectDir = await realpath(await mkdtemp(path.join(tmpdir(), "cds-term-")))
  server = createServer((_req, res) => res.end())
  attachTerminalServer(server, {
    enabled: true,
    shell: "/bin/sh",
    maxSessions: 2,
    hostGuard: { allowedHosts: [], allowAnyHost: false, loginDisabled: false },
    isSignedIn: async (req) => (req.headers.cookie ?? "").includes("cds_session=ok"),
    projectDir: async (id) => {
      if (id !== "p1") throw new Error("unknown")
      return projectDir
    },
  })
  server.listen(0, "127.0.0.1")
  await new Promise((resolve) => server.once("listening", resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await rm(projectDir, { recursive: true, force: true })
})

function open(query: string, headers: Record<string, string>): WebSocket {
  return new WebSocket(`ws://127.0.0.1:${port}/api/terminal?${query}`, { headers })
}

function rejection(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => ws.on("unexpected-response", (_req, res) => resolve(res.statusCode ?? 0)))
}

const good = { origin: "", cookie: "cds_session=ok" }
const originFor = () => `http://127.0.0.1:${port}`

describe("terminal server", () => {
  it("refuses missing login, foreign origins and unknown projects", async () => {
    expect(await rejection(open("project=p1", { origin: originFor() }))).toBe(401)
    expect(await rejection(open("project=p1", { ...good, origin: "http://evil.example" }))).toBe(403)
    expect(await rejection(open("project=nope", { ...good, origin: originFor() }))).toBe(404)
  })

  it("runs commands in the project folder without CDS secrets in the environment", async () => {
    process.env.CDS_SECRET = "jangan-bocor"
    const ws = open("project=p1", { ...good, origin: originFor() })
    let output = ""
    ws.on("message", (data) => {
      output += data.toString()
    })
    await new Promise((resolve) => ws.once("open", resolve))
    ws.send(JSON.stringify({ t: "r", c: 120, r: 40 }))
    ws.send(JSON.stringify({ t: "i", d: 'echo "CWD=$(pwd)"; echo "SECRET=[$CDS_SECRET]"; exit\n' }))
    await new Promise((resolve) => ws.once("close", resolve))
    delete process.env.CDS_SECRET
    expect(output).toContain(`CWD=${projectDir}`)
    expect(output).toContain("SECRET=[]")
  })
})

describe("limits", () => {
  it("survives oversized frames, closes unknown upgrade paths and frees slots", async () => {
    const big = open("project=p1", { ...good, origin: originFor() })
    await new Promise((resolve) => big.once("open", resolve))
    big.send("x".repeat(70 * 1024))
    await new Promise((resolve) => big.once("close", resolve))

    const other = new WebSocket(`ws://127.0.0.1:${port}/other`, { headers: { origin: originFor() } })
    await new Promise((resolve) => other.once("error", resolve))

    // Both slots are free again (max 2): two fresh terminals still open.
    const a = open("project=p1", { ...good, origin: originFor() })
    const b = open("project=p1", { ...good, origin: originFor() })
    await Promise.all([new Promise((r) => a.once("open", r)), new Promise((r) => b.once("open", r))])
    expect(await rejection(open("project=p1", { ...good, origin: originFor() }))).toBe(429)
    a.close()
    b.close()
    await Promise.all([new Promise((r) => a.once("close", r)), new Promise((r) => b.once("close", r))])
  })
})

describe("helpers", () => {
  it("strips secrets from the shell environment", () => {
    const env = shellEnv({ PATH: "/bin", CDS_PASSWORD_HASH: "x", OPENAI_API_KEY: "k", GITHUB_TOKEN: "t", HOME: "/h", AWS_SECRET_ACCESS_KEY: "a", DATABASE_URL: "postgres://u:p@h", LC_ALL: "C" })
    expect(env.PATH).toBe("/bin")
    expect(env.HOME).toBe("/h")
    expect(env.CDS_PASSWORD_HASH).toBeUndefined()
    expect(env.OPENAI_API_KEY).toBeUndefined()
    expect(env.GITHUB_TOKEN).toBeUndefined()
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined()
    expect(env.DATABASE_URL).toBeUndefined()
    expect(env.LC_ALL).toBe("C")
    expect(env.TERM).toBe("xterm-256color")
  })

  it("compares Origin with Host including the port", () => {
    expect(isSameOrigin("http://localhost:5180", "localhost:5180")).toBe(true)
    expect(isSameOrigin("http://localhost:5181", "localhost:5180")).toBe(false)
    expect(isSameOrigin(undefined, "localhost:5180")).toBe(false)
  })
})
