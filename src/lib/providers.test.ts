import { describe, expect, it } from "vitest"
import { supportsTemperature, temperatureFor } from "./providers"
import type { Connection } from "./types"

const connection = (model: string, temperatureMode?: Connection["temperatureMode"]): Connection => ({
  id: "c",
  name: "c",
  kind: "anthropic",
  baseUrl: "",
  apiKey: "",
  model,
  temperatureMode,
})

describe("temperatureFor", () => {
  it("omits temperature for models that reject it", () => {
    expect(supportsTemperature("cc/claude-sonnet-5-5")).toBe(false)
    expect(supportsTemperature("ag/claude-opus-5-5-medium")).toBe(false)
    expect(supportsTemperature("openai/gpt-5.1")).toBe(false)
    expect(supportsTemperature("o3-mini")).toBe(false)
    expect(temperatureFor(connection("cc/claude-sonnet-5-5"), 0.2)).toBeUndefined()
  })

  it("sends it for other models", () => {
    expect(supportsTemperature("claude-3-5-sonnet-latest")).toBe(true)
    expect(temperatureFor(connection("gemini-2.5-flash"), 0.2)).toBe(0.2)
    expect(temperatureFor(connection("llama-3.3-70b"), 0.2)).toBe(0.2)
  })

  it("follows the per-connection override", () => {
    expect(temperatureFor(connection("cc/claude-sonnet-5-5", "send"), 0.2)).toBe(0.2)
    expect(temperatureFor(connection("gemini-2.5-flash", "omit"), 0.2)).toBeUndefined()
  })
})
