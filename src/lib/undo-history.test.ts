import { describe, expect, it } from "vitest"
import { EMPTY_HISTORY, rebaseFiles, recordEdit, redoEdit, undoEdit } from "./undo-history"

const A = { "index.circuit.tsx": "v1", "lib/a.tsx": "a1" }

describe("undo-history", () => {
  it("undoes and redoes only the files an edit touched", () => {
    const after = { ...A, "index.circuit.tsx": "v2" }
    const h = recordEdit(EMPTY_HISTORY, A, after)
    // A later hand edit to another file must survive the undo.
    const current = { ...after, "lib/a.tsx": "a2-typed" }
    const u = undoEdit(h, current)
    expect(u.status).toBe("ok")
    if (u.status !== "ok") return
    expect(u.files).toEqual({ "index.circuit.tsx": "v1", "lib/a.tsx": "a2-typed" })
    const r = redoEdit(u.history, u.files)
    expect(r.status).toBe("ok")
    if (r.status !== "ok") return
    expect(r.files).toEqual(current)
  })

  it("refuses to undo over a file changed since the edit", () => {
    const after = { ...A, "index.circuit.tsx": "v2" }
    const h = recordEdit(EMPTY_HISTORY, A, after)
    const u = undoEdit(h, { ...after, "index.circuit.tsx": "v3-by-ai" })
    expect(u).toEqual({ status: "conflict", paths: ["index.circuit.tsx"] })
  })

  it("ignores no-op edits and reports an empty stack", () => {
    expect(recordEdit(EMPTY_HISTORY, A, { ...A })).toBe(EMPTY_HISTORY)
    expect(undoEdit(EMPTY_HISTORY, A).status).toBe("empty")
  })

  it("handles added and removed files", () => {
    const after = { "index.circuit.tsx": "v1", "lib/new.tsx": "n" }
    const u = undoEdit(recordEdit(EMPTY_HISTORY, A, after), after)
    expect(u.status === "ok" && u.files).toEqual(A)
  })

  it("keeps an earlier edit when a second edit was computed from a stale snapshot", () => {
    const rendered = { "index.circuit.tsx": "base", "lib/a.tsx": "a1" }
    const latest = { ...rendered, "lib/a.tsx": "a2-first-edit" }
    const next = { ...rendered, "index.circuit.tsx": "second-edit" }
    expect(rebaseFiles(rendered, next, latest)).toEqual({ "index.circuit.tsx": "second-edit", "lib/a.tsx": "a2-first-edit" })
  })
})
