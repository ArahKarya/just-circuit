import { describe, expect, it } from "vitest"
import { hashPassword, isPasswordHash, verifyPassword } from "./password"

describe("password hashing", () => {
  it("verifies the right password only", async () => {
    const hash = await hashPassword("rahasia-panjang")
    expect(isPasswordHash(hash)).toBe(true)
    expect(await verifyPassword("rahasia-panjang", hash)).toBe(true)
    expect(await verifyPassword("salah", hash)).toBe(false)
    expect(await verifyPassword("x", "not-a-hash")).toBe(false)
  })
})
