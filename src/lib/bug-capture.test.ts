import { describe, expect, it } from "vitest"
import { createErrorCollector, describeThrown, MAX_AUTO_REPORTS_PER_SESSION, shouldIgnore } from "./bug-capture"

describe("bug capture", () => {
  it("files each distinct error once and stops after the session limit", () => {
    const c = createErrorCollector()
    expect(c.capture({ message: "TypeError: a is undefined" })).toMatchObject({ source: "client", title: "TypeError: a is undefined" })
    expect(c.capture({ message: "TypeError: a is undefined" })).toBeNull()
    for (let i = 0; i < MAX_AUTO_REPORTS_PER_SESSION + 3; i += 1) c.capture({ message: `Error ${"x".repeat(i + 1)}` })
    expect(c.capture({ message: "Brand new error" })).toBeNull()
    expect(c.recent().length).toBeLessThanOrEqual(20)
  })

  it("ignores browser noise, aborts and extension errors", () => {
    expect(shouldIgnore({ message: "ResizeObserver loop completed with undelivered notifications." })).toBe(true)
    expect(shouldIgnore({ message: "Script error." })).toBe(true)
    expect(shouldIgnore({ message: "AbortError: signal is aborted without reason" })).toBe(true)
    expect(shouldIgnore({ message: "x", filename: "chrome-extension://abc/content.js" })).toBe(true)
    expect(shouldIgnore({ message: "TypeError: Failed to fetch dynamically imported module: /x.js" })).toBe(false)
  })

  it("describes thrown values of any kind", () => {
    expect(describeThrown(new TypeError("bad")).message).toBe("TypeError: bad")
    expect(describeThrown("plain").message).toBe("plain")
    expect(describeThrown({ code: 1 }).message).toBe('{"code":1}')
  })
})
