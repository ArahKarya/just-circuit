import { APICallError } from "ai"
import { describe, expect, it } from "vitest"
import { describeProviderError } from "./errors"
import { normalizeBaseUrl } from "./providers"

describe("normalizeBaseUrl", () => {
  it("adds the version path when only a host is given", () => {
    expect(normalizeBaseUrl(new URL("http://100.101.203.54:20128"), "anthropic")).toBe("http://100.101.203.54:20128/v1")
    expect(normalizeBaseUrl(new URL("http://localhost:11434/"), "openai-compatible")).toBe("http://localhost:11434/v1")
    expect(normalizeBaseUrl(new URL("https://proxy.example.com"), "gemini")).toBe("https://proxy.example.com/v1beta")
  })

  it("keeps an explicit path and trims trailing slashes", () => {
    expect(normalizeBaseUrl(new URL("https://openrouter.ai/api/v1/"), "openai-compatible")).toBe("https://openrouter.ai/api/v1")
    expect(normalizeBaseUrl(new URL("https://api.anthropic.com/v1"), "anthropic")).toBe("https://api.anthropic.com/v1")
  })
})

describe("describeProviderError", () => {
  const make = (statusCode: number, url = "http://host:20128/messages?key=secret") =>
    new APICallError({ message: "Not Found", url, requestBodyValues: {}, statusCode })

  it("explains a 404 and names the URL without its query string", () => {
    const text = describeProviderError(make(404))
    expect(text).toContain("HTTP 404 (http://host:20128/messages)")
    expect(text).toContain("Base URL")
    expect(text).not.toContain("secret")
  })

  it("explains auth and quota errors", () => {
    expect(describeProviderError(make(401))).toContain("API key ditolak")
    expect(describeProviderError(make(429))).toContain("Kuota")
  })

  it("falls back to the plain message for other errors", () => {
    expect(describeProviderError(new Error("boom"))).toBe("boom")
  })
})
