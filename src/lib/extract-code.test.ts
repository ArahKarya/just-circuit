import { describe, expect, it } from "vitest"
import { extractFiles, stripCodeBlocks } from "./extract-code"

const ENTRY = "index.circuit.tsx"

describe("extractFiles", () => {
  it("reads a block that names its file", () => {
    const reply = "Ini rangkaiannya.\n```tsx file=index.circuit.tsx\nexport default () => <board />\n```"
    expect(extractFiles(reply, ENTRY)).toEqual([{ path: ENTRY, content: "export default () => <board />\n" }])
  })

  it("applies an unnamed tsx block to the entrypoint", () => {
    const reply = "```tsx\nexport default () => <board />\n```"
    expect(extractFiles(reply, ENTRY)[0].path).toBe(ENTRY)
  })

  it("keeps several named files and lets the last block for a path win", () => {
    const reply = [
      "```tsx file=lib/Led.tsx\nexport const Led = () => null\n```",
      "```tsx file=index.circuit.tsx\nexport default () => <board>v1</board>\n```",
      "```tsx path=\"index.circuit.tsx\"\nexport default () => <board>v2</board>\n```",
    ].join("\n")
    const files = extractFiles(reply, ENTRY)
    expect(files.map((f) => f.path)).toEqual(["lib/Led.tsx", ENTRY])
    expect(files[1].content).toContain("v2")
  })

  it("ignores non-code blocks and unsafe paths", () => {
    const reply = [
      "```bash\nnpm i\n```",
      "```tsx file=../secret.tsx\nexport default 1\n```",
      "```tsx\nconst x = 1\n```",
    ].join("\n")
    expect(extractFiles(reply, ENTRY)).toEqual([])
  })
})

describe("stripCodeBlocks", () => {
  it("replaces blocks with a marker", () => {
    expect(stripCodeBlocks("A\n```tsx file=a.tsx\nx\n```\nB")).toBe("A\n\n[kode: a.tsx]\n\nB")
  })
})
