import { expect, test } from "./fixtures"

// Uses the live jlcsearch.tscircuit.com and EasyEDA APIs (through /api/jlc/proxy).
test("imports a JLCPCB part into the project", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByRole("button", { name: "Impor part JLCPCB" }).click()
  const search = page.getByPlaceholder(/Search JLCPCB/i)
  await search.fill("C46749")
  await search.press("Enter")
  await page.getByText("C46749").first().click({ timeout: 30_000 })
  await page.getByRole("button", { name: "Import", exact: true }).click()

  await expect(page.getByText(/C46749 diimpor sebagai/).first()).toBeVisible({ timeout: 60_000 })
  await expect(page.getByRole("list", { name: "File proyek" }).getByRole("button", { name: "C46749.tsx" })).toBeVisible()
  await expect(page.locator(".monaco-editor")).toContainText('from "./imports/C46749"')
})
