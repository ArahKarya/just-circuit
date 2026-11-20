import { describe, expect, it } from "vitest"
import { bugFingerprint, redactSecrets, toPlainText, toSingleLine } from "./bug-reports"

describe("redactSecrets", () => {
  it("hides keys in their common shapes", () => {
    const cases = [
      "key sk-abcdefghijklmnopqrstuvwxyz",
      "https://generativelanguage.googleapis.com/v1/models?key=AIzaSyShortKey123&alt=sse",
      "https://user:hunter2pass@host.example/x",
      'headers {"x-goog-api-key": "abc123secret"}',
      "Cookie: just_circuit_session=abcdef123456",
      "client_secret=abcdef123456",
      "Authorization: Bearer abc.def.ghi123",
      "?sig=abcdef0123&x=1",
    ]
    for (const text of cases) {
      const out = redactSecrets(text)
      expect(out, text).toContain("[disembunyikan]")
      expect(out).not.toMatch(/abcdefghijklmnop|ShortKey123|hunter2pass|abc123secret|abcdef123456|def\.ghi123|abcdef0123/)
    }
    expect(redactSecrets("model gpt-5 timeout setelah 120 detik")).toBe("model gpt-5 timeout setelah 120 detik")
  })

  it("hides exact known secrets of any format", () => {
    expect(redactSecrets("provider said: bad key q9Zx!7#weird", ["q9Zx!7#weird"])).toBe("provider said: bad key [disembunyikan]")
  })
})

describe("plain text", () => {
  it("strips terminal escapes, control and bidi characters", () => {
    expect(toSingleLine("x\n[open] fake\u001b[31m red\u001b[0m ‮evil")).toBe("x [open] fake red evil")
    expect(toPlainText("a\r\nb\u0007c\u001b[2J\td")).toBe("a\nbc\td")
  })
})

describe("bugFingerprint", () => {
  it("treats repeats with different numbers as the same problem", () => {
    expect(bugFingerprint("server", "timeout after 121s", "llm")).toBe(bugFingerprint("server", "timeout after 125s", "llm"))
    expect(bugFingerprint("server", "timeout", "llm")).not.toBe(bugFingerprint("client", "timeout", "llm"))
  })
})
