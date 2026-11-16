import { test as base, expect, type Page } from "@playwright/test"

/** Every test starts from an empty server-side data dir. */
export const test = base.extend({
  page: async ({ page }, use) => {
    const response = await page.request.post("/api/test/reset", { headers: { "X-CDS-Request": "1" } })
    expect(response.ok()).toBe(true)
    await use(page)
  },
})

export { expect }
export type { Page }
