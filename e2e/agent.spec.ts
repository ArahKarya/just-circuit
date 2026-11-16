import { expect, test, type Page } from "./fixtures"

async function setUpAgent(page: Page, serverBuild: boolean): Promise<void> {
  await page.goto("/")
  await expect(page.getByText("Build OK", { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByLabel("Model", { exact: true }).fill("mock-1")
  await page.getByLabel("Mode agen").check()
  if (serverBuild) await page.getByLabel("Izinkan agen menjalankan build di server").check()
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page.getByRole("dialog", { name: "Pengaturan" })).toBeHidden()
  await expect(page.getByRole("button", { name: "Mode agen" })).toHaveAttribute("aria-pressed", "true")
}

async function runAgent(page: Page, expectedSummary: string): Promise<void> {
  await page.getByLabel("Pesan untuk AI").fill("AGENT ganti R1 jadi 1k")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText(expectedSummary)).toBeVisible({ timeout: 180_000 })
}

test("agent mode reads, edits, lets the preview check, records a version and proposes a command", async ({ page }) => {
  await setUpAgent(page, false)
  await runAgent(page, "Selesai: R1 diganti 1k. Build dicek preview.")

  await page.getByText("4 langkah agen").click()
  const steps = page.getByRole("list", { name: "Langkah agen" }).first()
  await expect(steps).toContainText("Baca index.circuit.tsx")
  await expect(steps).toContainText("Ubah index.circuit.tsx")
  await expect(steps).toContainText("Build di server dimatikan")

  // The editor and preview reload the agent's change and the preview builds it.
  await expect(page.getByText("Build OK", { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByText("Schematic", { exact: true }).click()
  await expect(page.getByText("1kΩ", { exact: true })).toBeVisible({ timeout: 30_000 })

  await page.getByRole("button", { name: "Riwayat", exact: true }).click()
  await expect(page.getByRole("list", { name: "Daftar versi" }).getByRole("button").first()).toContainText("AI (agen): AGENT ganti R1 jadi 1k")
  await page.getByRole("button", { name: "Tutup" }).click()

  // A proposed command is only pasted: it runs when the user presses Enter, and never again by itself.
  await page.getByRole("button", { name: "Tempel ke terminal" }).click()
  const terminal = page.getByTestId("terminal").first()
  await expect(terminal).toContainText("echo PERINTAH-$((40+2))", { timeout: 30_000 })
  await page.waitForTimeout(1500)
  await expect(terminal).not.toContainText("PERINTAH-42")
  await terminal.click()
  await page.keyboard.press("Enter")
  await expect(terminal).toContainText("PERINTAH-42")

  await page.getByRole("button", { name: "Tutup panel terminal" }).click()
  await page.keyboard.press("Control+Backquote")
  await page.waitForTimeout(3000)
  await expect(page.getByTestId("terminal").first()).not.toContainText("PERINTAH")
})

test("with server builds allowed, the agent builds in the sandbox", async ({ page }) => {
  test.setTimeout(300_000)
  await setUpAgent(page, true)
  await runAgent(page, "Selesai: R1 diganti 1k. Build OK.")
  await page.getByText("4 langkah agen").click()
  await expect(page.getByRole("list", { name: "Langkah agen" }).first()).toContainText("build OK")
})
