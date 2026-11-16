import { describe, expect, it } from "vitest"
import { classifyRunErrors } from "./run-status"

describe("classifyRunErrors", () => {
  it("treats supplier polarity mismatches and *_warning types as warnings", () => {
    const polarity = {
      type: "source_component_misconfigured_error",
      message: '<led name=".D1" /> maps pin 1 to the anode, but supplier part jlcpcb:C3030991 maps pin 1 to the cathode. Update pinLabels or use a supplier part with matching diode polarity.',
    }
    const result = classifyRunErrors([polarity, { type: "source_pin_missing_trace_warning", message: "pin tidak terhubung" }, "Error: komponen salah"])
    expect(result.warnings).toHaveLength(2)
    expect(result.errors).toEqual(["Error: komponen salah"])
  })

  it("reads messages from error objects", () => {
    expect(classifyRunErrors([{ error_message: "x" }, { error: "y" }]).errors).toEqual(["x", "y"])
  })
})
