import { expect, test } from "./fixtures"

test("reports a bug by hand, records browser errors automatically, and tracks their status", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  // An uncaught error in the page is filed on its own.
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error("boom dari tes e2e")
    })
  })

  await page.getByRole("button", { name: "Laporkan bug" }).click()
  const dialog = page.getByRole("dialog")
  await dialog.getByLabel("Judul bug").fill("3D viewer tidak muncul")
  await dialog.getByLabel("Apa yang terjadi?").fill("Klik tab 3D, muncul Error Loading 3D Viewer")
  await dialog.getByRole("button", { name: "Catat bug" }).click()
  await expect(page.getByText(/Bug tercatat/)).toBeVisible()

  await expect(dialog.getByText("3D viewer tidak muncul")).toBeVisible()
  await expect(dialog.getByText("Error: boom dari tes e2e")).toBeVisible()
  await expect(dialog.getByText("Error di browser", { exact: true })).toBeVisible()

  // The manual report carries the build state and the browser error as context.
  await dialog.getByText("3D viewer tidak muncul").click()
  await expect(dialog.getByText(/Status build: ok/)).toBeVisible()
  await expect(dialog.getByText(/Error browser .*boom dari tes e2e/)).toBeVisible()

  const row = dialog.getByRole("listitem").filter({ hasText: "3D viewer tidak muncul" })
  await row.getByRole("button", { name: "Tandai sudah diperbaiki" }).click()
  await expect(dialog.getByText("3D viewer tidak muncul")).toBeHidden()
  await dialog.getByRole("button", { name: "Tampilkan semua" }).click()
  await expect(dialog.getByText("Diperbaiki")).toBeVisible()
})

test("the agent reports app bugs, and lessons learned from outside data wait for approval", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK", { exact: true })).toBeVisible({ timeout: 60_000 })
  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByLabel("Model", { exact: true }).fill("mock-1")
  await page.getByLabel("Mode agen").check()
  await page.getByRole("button", { name: "Simpan" }).click()
  await expect(page.getByRole("dialog", { name: "Pengaturan" })).toBeHidden()

  await page.getByLabel("Pesan untuk AI").fill("AGENT-BUG coba board W5500")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText("Selesai, bug aplikasi sudah dilaporkan.")).toBeVisible({ timeout: 120_000 })

  // The agent searched a part catalog, so its lesson is shown for approval instead of saved silently.
  const approval = page.getByRole("dialog", { name: "Setujui catatan memori" })
  await expect(approval).toContainText("Pelajaran: W5500 butuh kristal 25MHz (datasheet hal. 9)")
  await approval.getByRole("button", { name: "Simpan ke memori" }).click()
  await expect(page.getByText("AI mencatat 1 hal ke memori")).toBeVisible()

  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByRole("tab", { name: "Memori" }).click()
  await expect(page.getByLabel("Memori global (semua proyek)")).toHaveValue(/Pelajaran: W5500 butuh kristal 25MHz/)
  await page.keyboard.press("Escape")

  await page.getByRole("button", { name: "Laporkan bug" }).click()
  const dialog = page.getByRole("dialog", { name: "Laporkan bug" })
  await expect(dialog.getByText("build_circuit mengembalikan hasil kosong")).toBeVisible()
  await expect(dialog.getByText("Dilaporkan agen AI")).toBeVisible()
})
