import { describe, expect, it } from "vitest"
import { platformConfigFor, skippedLabel } from "./build-scope"

describe("build scope", () => {
  it("maps switches to tscircuit platform options", () => {
    expect(platformConfigFor(undefined)).toBeUndefined()
    expect(platformConfigFor({ schematicDisabled: false, routingDisabled: false })).toBeUndefined()
    expect(platformConfigFor({ schematicDisabled: true })).toEqual({ schematicDisabled: true })
    expect(platformConfigFor({ schematicDisabled: true, routingDisabled: true })).toEqual({ schematicDisabled: true, routingDisabled: true })
  })

  it("names what is skipped", () => {
    expect(skippedLabel({})).toBe("")
    expect(skippedLabel({ routingDisabled: true })).toBe("tanpa routing")
    expect(skippedLabel({ schematicDisabled: true, routingDisabled: true })).toBe("tanpa skematik & routing")
  })
})
