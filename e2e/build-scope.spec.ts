import { expect, test } from "./fixtures"

const OVERLAP = `export default () => (
  <board width="20mm" height="12mm">
    <resistor name="R1" resistance="1k" footprint="0603" pcbX={0} pcbY={0} />
    <resistor name="R2" resistance="1k" footprint="0603" pcbX={0.3} pcbY={0} />
    <trace from=".R1 > .pin2" to=".R2 > .pin1" />
  </board>
)
`

test("the schematic and PCB routing can be switched off per project; the AI hears about it and about the problems", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK", { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByRole("tab", { name: /schematic/i }).first().click()
  await expect(page.locator("svg text").filter({ hasText: "R1" }).first()).toBeVisible()

  const schematic = page.getByRole("button", { name: "Skematik", exact: true })
  const routing = page.getByRole("button", { name: "Routing", exact: true })
  await expect(schematic).toHaveAttribute("aria-pressed", "true")
  await schematic.click()
  await expect(schematic).toHaveAttribute("aria-pressed", "false")
  await expect(page.getByRole("button", { name: "Build OK (tanpa skematik)" })).toBeVisible({ timeout: 60_000 })
  // The evaluator really skipped it: the schematic view is empty.
  await page.getByRole("tab", { name: /schematic/i }).first().click()
  await expect(page.locator("svg text").filter({ hasText: "R1" })).toHaveCount(0)
  await routing.click()
  await expect(page.getByRole("button", { name: "Build OK (tanpa skematik & routing)" })).toBeVisible({ timeout: 60_000 })

  // Stored with the project.
  await page.reload()
  await expect(page.getByRole("button", { name: "Skematik", exact: true })).toHaveAttribute("aria-pressed", "false")
  await expect(page.getByRole("button", { name: "Routing", exact: true })).toHaveAttribute("aria-pressed", "false")

  // Placement checks still run without routing, and the AI gets the problem list and the scope.
  const projects = (await (await page.request.get("/api/projects")).json()).data as { id: string }[]
  await page.request.put(`/api/projects/${projects[0].id}`, { headers: { "X-CDS-Request": "1" }, data: { entrypoint: "index.circuit.tsx", files: { "index.circuit.tsx": OVERLAP } } })
  await page.reload()
  await expect(page.getByRole("button", { name: "Build error" })).toBeVisible({ timeout: 60_000 })
  await page.getByRole("button", { name: "Build error" }).click()
  await expect(page.getByRole("list", { name: "Daftar masalah" })).toContainText("R1 overlaps R2")

  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByLabel("Model", { exact: true }).fill("mock-1")
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page.getByRole("dialog", { name: "Pengaturan" })).toBeHidden()
  await page.getByRole("tab", { name: "Chat" }).click()
  await page.getByLabel("Pesan untuk AI").fill("ECHO-CONTEXT")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText(/Konteks: masalah [1-9]\d*, dimatikan: the schematic and PCB autorouting/)).toBeVisible({ timeout: 30_000 })
})
