import { expect, test } from "./fixtures"

const BROKEN_LAYOUT = `export default () => (
  <board width="20mm" height="12mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={0.3} pcbY={0} />
    <capacitor name="C1" capacitance="100nF" footprint="0603" pcbX={15} />
  </board>
)
`

test("lists DRC/ERC problems, jumps to the component and asks the AI to fix them", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK", { exact: true })).toBeVisible({ timeout: 60_000 })
  const projects = (await (await page.request.get("/api/projects")).json()).data as { id: string }[]
  await page.request.put(`/api/projects/${projects[0].id}`, { headers: { "X-Just-Circuit-Request": "1" }, data: { entrypoint: "index.circuit.tsx", files: { "index.circuit.tsx": BROKEN_LAYOUT } } })
  await page.reload()
  await expect(page.getByRole("button", { name: "Build error" })).toBeVisible({ timeout: 90_000 })

  // The header status opens the problems tab.
  await page.getByRole("button", { name: "Build error" }).click()
  await expect(page.getByRole("tab", { name: /Masalah/ })).toHaveAttribute("aria-selected", "true")
  const list = page.getByRole("list", { name: "Daftar masalah" })
  await expect(list).toContainText("R1 overlaps R2")
  await expect(list).toContainText("C1 extends outside board boundaries")

  await page.getByRole("button", { name: /^Error \d+/ }).click()
  await expect(list.getByLabel("peringatan")).toHaveCount(0)

  // Clicking a component name jumps to its declaration in the code.
  await list.getByRole("listitem").filter({ hasText: "C1 extends outside" }).getByRole("button", { name: "C1" }).click()
  await expect(page.getByRole("tab", { name: "Kode" })).toHaveAttribute("aria-selected", "true")
  await expect(page.locator(".monaco-editor .current-line").first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator(".monaco-editor")).toContainText('name="C1"', { timeout: 20_000 })

  // Ask the AI to fix: the errors are sent as a fix request.
  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByLabel("Model", { exact: true }).fill("mock-1")
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page.getByRole("dialog", { name: "Pengaturan" })).toBeHidden()
  await page.getByRole("tab", { name: /Masalah/ }).click()
  await page.getByRole("button", { name: "Minta AI perbaiki" }).click()
  await expect(page.getByText(/R1 overlaps R2.*\[R1, R2\]/).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("Sudah diperbaiki: LED biru")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText("Build OK", { exact: true })).toBeVisible({ timeout: 60_000 })
})
