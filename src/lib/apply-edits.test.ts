import { describe, expect, it } from "vitest"
import { applyEdits, extractEdits } from "./apply-edits"

const block = (path: string, ...hunks: [string, string][]) =>
  [
    `\`\`\`tsx edit=${path}`,
    ...hunks.map(([search, replace]) => `<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE`),
    "```",
  ].join("\n")

const SOURCE = `export default () => (
  <board width="30mm">
    <resistor name="R1" resistance="1k" footprint="0603" />
    <led name="D1" footprint="0603" />
  </board>
)
`

describe("extractEdits", () => {
  it("reads every hunk of an edit block", () => {
    const reply = `Ganti resistor.\n${block("index.circuit.tsx", ['resistance="1k"', 'resistance="330"'], ["<led", "<led color=\"red\""])}`
    expect(extractEdits(reply)).toEqual([
      {
        path: "index.circuit.tsx",
        hunks: [
          { search: 'resistance="1k"', replace: 'resistance="330"' },
          { search: "<led", replace: '<led color="red"' },
        ],
      },
    ])
  })

  it("ignores full-file blocks and unsafe paths", () => {
    const reply = ["```tsx file=index.circuit.tsx\nexport default 1\n```", block("../x.tsx", ["a", "b"])].join("\n")
    expect(extractEdits(reply)).toEqual([])
  })
})

describe("applyEdits", () => {
  it("replaces an exact match", () => {
    const result = applyEdits({ "index.circuit.tsx": SOURCE }, [{ path: "index.circuit.tsx", hunks: [{ search: 'resistance="1k"', replace: 'resistance="330"' }] }])
    expect(result.failures).toEqual([])
    expect(result.files["index.circuit.tsx"]).toContain('resistance="330"')
  })

  it("matches lines whose indentation differs", () => {
    const search = '<resistor name="R1" resistance="1k" footprint="0603" />\n<led name="D1" footprint="0603" />'
    const replace = '<resistor name="R1" resistance="330" footprint="0603" />'
    const result = applyEdits({ a: SOURCE }, [{ path: "a", hunks: [{ search, replace }] }])
    expect(result.failures).toEqual([])
    expect(result.files.a).toContain('    <resistor name="R1" resistance="330" footprint="0603" />\n  </board>')
    expect(result.files.a).not.toContain("<led")
  })

  it("leaves a file untouched when any of its hunks fails", () => {
    const result = applyEdits({ a: SOURCE }, [
      { path: "a", hunks: [{ search: 'resistance="1k"', replace: 'resistance="330"' }, { search: "<capacitor", replace: "x" }] },
    ])
    expect(result.files).toEqual({})
    expect(result.failures[0]).toContain("a")
    expect(result.failures[0]).toContain("<capacitor")
  })

  it("refuses an ambiguous search", () => {
    const result = applyEdits({ a: SOURCE }, [{ path: "a", hunks: [{ search: 'footprint="0603"', replace: "x" }] }])
    expect(result.failures[0]).toMatch(/lebih dari sekali/)
  })

  it("rejects an empty search on an existing file", () => {
    const result = applyEdits({ a: SOURCE }, [{ path: "a", hunks: [{ search: "", replace: "x" }] }])
    expect(result.files).toEqual({})
    expect(result.failures[0]).toMatch(/SEARCH kosong/)
  })

  it("creates a new file from an empty search", () => {
    const result = applyEdits({}, [{ path: "lib/new.tsx", hunks: [{ search: "", replace: "export const X = 1" }] }])
    expect(result.files["lib/new.tsx"]).toBe("export const X = 1\n")
  })

  it("applies hunks in order on top of earlier ones", () => {
    const result = applyEdits({ a: SOURCE }, [
      { path: "a", hunks: [{ search: 'resistance="1k"', replace: 'resistance="2k"' }, { search: 'resistance="2k"', replace: 'resistance="3k"' }] },
    ])
    expect(result.files.a).toContain('resistance="3k"')
  })
})
