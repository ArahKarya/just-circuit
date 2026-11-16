import { describe, expect, it } from "vitest"
import { changesFromReply } from "./reply-changes"

const ENTRY = "index.circuit.tsx"
const edit = (path: string, search: string, replace: string) =>
  `\`\`\`tsx edit=${path}\n<<<<<<< SEARCH\n${search}\n=======\n${replace}\n>>>>>>> REPLACE\n\`\`\``

describe("changesFromReply", () => {
  it("combines full files and edits", () => {
    const reply = ["```tsx file=lib/a.tsx\nexport const A = 1\n```", edit(ENTRY, "<board>", '<board width="10mm">')].join("\n")
    const result = changesFromReply(reply, { [ENTRY]: "export default () => <board></board>\n" }, ENTRY)
    expect(result.failures).toEqual([])
    expect(result.changes).toEqual({ "lib/a.tsx": "export const A = 1\n", [ENTRY]: 'export default () => <board width="10mm"></board>\n' })
  })

  it("lets an edit refine a file sent in full in the same reply", () => {
    const reply = ["```tsx file=lib/a.tsx\nexport const A = 1\n```", edit("lib/a.tsx", "A = 1", "A = 2")].join("\n")
    expect(changesFromReply(reply, {}, ENTRY).changes["lib/a.tsx"]).toBe("export const A = 2\n")
  })

  it("reports failed edits without changing the file", () => {
    const result = changesFromReply(edit(ENTRY, "<chip", "x"), { [ENTRY]: "export default () => <board />\n" }, ENTRY)
    expect(result.changes).toEqual({})
    expect(result.failures).toHaveLength(1)
  })
})
