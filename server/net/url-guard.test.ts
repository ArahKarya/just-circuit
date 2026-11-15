import { describe, expect, it } from "vitest"
import { assertPublicHost, hostMatches, isPrivateAddress, parseHttpUrl, readLimited, UrlGuardError } from "./url-guard"

describe("url guard", () => {
  it("detects private addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.174", "172.20.0.1", "169.254.169.254", "100.101.203.54", "::1", "fd00::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "2606:4700::1111"]) {
      expect(isPrivateAddress(ip), ip).toBe(false)
    }
  })

  it("only accepts http(s) URLs without credentials", () => {
    expect(parseHttpUrl("https://api.groq.com/openai/v1").hostname).toBe("api.groq.com")
    expect(() => parseHttpUrl("file:///etc/passwd")).toThrow(UrlGuardError)
    expect(() => parseHttpUrl("https://u:p@example.com")).toThrow(UrlGuardError)
    expect(() => parseHttpUrl("not a url")).toThrow(UrlGuardError)
  })

  it("blocks private hosts unless allowed", async () => {
    await expect(assertPublicHost(new URL("http://127.0.0.1:11434"), false)).rejects.toThrow(UrlGuardError)
    await expect(assertPublicHost(new URL("http://127.0.0.1:11434"), true)).resolves.toBeUndefined()
  })

  it("matches host suffixes exactly", () => {
    expect(hostMatches("modules.easyeda.com", ["easyeda.com"])).toBe(true)
    expect(hostMatches("easyeda.com", ["easyeda.com"])).toBe(true)
    expect(hostMatches("evileasyeda.com", ["easyeda.com"])).toBe(false)
  })
})

describe("url guard edge cases", () => {
  it("catches IPv4-mapped IPv6 in hex form and extra reserved ranges", () => {
    for (const ip of ["::ffff:7f00:1", "::ffff:a9fe:a9fe", "fe90::1", "198.18.0.1", "192.0.0.8", "224.0.0.1", "not-an-ip"]) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    expect(isPrivateAddress("::ffff:808:808")).toBe(false)
  })

  it("rejects bracketed mapped loopback URLs", async () => {
    await expect(assertPublicHost(new URL("http://[::ffff:127.0.0.1]:8080"), false)).rejects.toThrow(UrlGuardError)
  })
})

describe("readLimited", () => {
  it("aborts when the body is larger than allowed", async () => {
    await expect(readLimited(new Response("x".repeat(100)), 10)).rejects.toThrow(/terlalu besar/)
    expect((await readLimited(new Response("hello"), 10)).toString()).toBe("hello")
  })
})
