import { createServer, type Server } from "node:http"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { downloadPublicFile } from "./download"

let server: Server
let base: string

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/file.pdf" })
      res.end()
      return
    }
    if (req.url === "/big") {
      res.writeHead(200)
      res.end(Buffer.alloc(5000))
      return
    }
    res.writeHead(200, { "Content-Type": "application/pdf" })
    res.end("%PDF-1.4 test")
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

describe("datasheet downloads", () => {
  it("refuses private, loopback and non-http addresses", async () => {
    for (const url of [`${base}/file.pdf`, "http://localhost:1/x.pdf", "http://localhost/x.pdf", "http://[::1]/x.pdf", "http://10.0.0.5/x.pdf", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd"]) {
      await expect(downloadPublicFile(url, 1000)).rejects.toThrow(/privat|http\/https|port 80/)
    }
  })

  it("only uses the web ports and never downgrades https", async () => {
    await expect(downloadPublicFile("http://example.com:22/x.pdf", 1000)).rejects.toThrow(/port 80 dan 443/)
    await expect(downloadPublicFile("https://example.com:8443/x.pdf", 1000)).rejects.toThrow(/port 80 dan 443/)
  })

  it("follows redirects and stops at the size limit (test server allowed explicitly)", async () => {
    const download = await downloadPublicFile(`${base}/redirect`, 1000, { allowPrivate: true })
    expect(download.bytes.toString()).toBe("%PDF-1.4 test")
    expect(download.url).toBe(`${base}/file.pdf`)
    await expect(downloadPublicFile(`${base}/big`, 1000, { allowPrivate: true })).rejects.toThrow(/terlalu besar/)
  })
})
