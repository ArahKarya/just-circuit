import { expect, test, type Page } from "./fixtures"

async function addMockConnection(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByLabel("Model", { exact: true }).fill("mock-1")
  await page.getByRole("button", { name: "Simpan" }).click()
}

test("renders the starter project with the bundled eval worker", async ({ page }) => {
  const urls: string[] = []
  page.on("request", (request) => urls.push(request.url()))
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByText("Schematic", { exact: true }).click()
  await expect(page.getByText("330Ω", { exact: true })).toBeVisible()
  expect(urls.some((url) => url.includes("/vendor/tscircuit-eval-"))).toBe(true)
  // The worker script itself never comes from a CDN (runframe may still list versions for its menu).
  expect(urls.filter((url) => /@tscircuit\/eval.*entrypoint/.test(url))).toEqual([])
})

test("applies a partial edit after the AI corrects a SEARCH that didn't match", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await addMockConnection(page)

  await page.getByLabel("Pesan untuk AI").fill("EDIT ganti resistor ke 470")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText(/Edit gagal diterapkan/)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("Resistor diganti 470Ω.")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByText("Schematic", { exact: true }).click()
  await expect(page.getByText("470Ω", { exact: true })).toBeVisible()

  await page.getByRole("tab", { name: "Kode" }).click()
  // The rest of the file is untouched.
  // Monaco can take a while to start when the machine is busy.
  await expect(page.locator(".monaco-editor")).toContainText('color="red"', { timeout: 20_000 })
})

test("configures an AI connection, generates a circuit and auto-fixes a failed build", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByRole("button", { name: "Ambil model" }).click()
  await expect(page.getByText("2 model ditemukan")).toBeVisible()
  await page.getByLabel("Model", { exact: true }).fill("mock-1")
  await page.getByRole("button", { name: "Simpan" }).click()

  await page.getByLabel("Pesan untuk AI").fill("Buat LED biru")
  await page.getByLabel("Pesan untuk AI").press("Enter")

  // First reply builds with an error, the app sends the error back, the second reply fixes it.
  await expect(page.getByText("Sudah diperbaiki: LED biru")).toBeVisible({ timeout: 60_000 })
  await expect(page.getByText("Ini rangkaian LED.")).toBeVisible()
  await expect(page.getByText(/gagal di-build/)).toBeVisible()
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByText("Schematic", { exact: true }).click()
  await expect(page.getByText("220Ω", { exact: true })).toBeVisible()

  await page.getByRole("tab", { name: "Kode" }).click()
  await expect(page.locator(".monaco-editor")).toContainText('color="blue"')
})

test("shows the model's thinking and elapsed time while it reasons", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByRole("button", { name: "Pengaturan", exact: true }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByLabel("Model", { exact: true }).fill("mock-1")
  await page.getByRole("button", { name: "Simpan" }).click()

  await page.getByLabel("Pesan untuk AI").fill("THINK lalu buat LED")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText(/Berpikir… \d+ dtk/)).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText(/menghitung nilai resistor/).first()).toBeVisible()
  await expect(page.getByText("Sudah diperbaiki: LED biru")).toBeVisible({ timeout: 30_000 })
})
