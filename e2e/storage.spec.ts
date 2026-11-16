import { expect, test } from "./fixtures"

test("keeps code, chat and settings on the server across reloads; never returns API keys", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  await page.getByRole("button", { name: "Pengaturan AI" }).click()
  await page.getByLabel("Tambah dari preset").selectOption("custom")
  await page.getByRole("button", { name: "Tambah", exact: true }).click()
  await page.getByLabel("Base URL").fill("http://localhost:9911/v1")
  await page.getByLabel("API key").fill("sk-test-rahasia-123")
  await page.getByLabel("Model").fill("mock-1")
  await page.getByRole("button", { name: "Simpan" }).click()

  const settings = await (await page.request.get("/api/settings")).text()
  expect(settings).not.toContain("sk-test-rahasia-123")
  expect(JSON.parse(settings).data.connections[0]).toMatchObject({ apiKey: "", hasApiKey: true })

  await page.getByLabel("Pesan untuk AI").fill("Buat LED biru")
  await page.getByLabel("Pesan untuk AI").press("Enter")
  await expect(page.getByText("Sudah diperbaiki: LED biru")).toBeVisible({ timeout: 60_000 })

  await page.reload()
  await expect(page.getByText("Sudah diperbaiki: LED biru")).toBeVisible({ timeout: 30_000 })
  await page.getByRole("tab", { name: "Kode" }).click()
  await expect(page.locator(".monaco-editor")).toContainText('color="blue"')

  await page.getByRole("button", { name: "Pengaturan AI" }).click()
  await expect(page.getByLabel("API key")).toHaveAttribute("placeholder", /tersimpan/)
  await expect(page.getByLabel("API key")).toHaveValue("")
})

test("moves projects and chats from the browser's IndexedDB to the server", async ({ page }) => {
  // Same-origin page without the app, to seed the pre-server database the way Dexie stored it.
  await page.goto("/api/health")
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("circuit-design-studio", 10)
        request.onupgradeneeded = () => {
          const db = request.result
          db.createObjectStore("projects", { keyPath: "id" }).createIndex("updatedAt", "updatedAt")
          const messages = db.createObjectStore("messages", { keyPath: "id" })
          messages.createIndex("projectId", "projectId")
          messages.createIndex("createdAt", "createdAt")
          db.createObjectStore("settings", { keyPath: "key" })
        }
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const db = request.result
          const tx = db.transaction(["projects", "messages"], "readwrite")
          const code = 'export default () => (\n  <board width="10mm" height="10mm">\n    <resistor name="R9" resistance="4.7k" footprint="0603" />\n  </board>\n)\n'
          tx.objectStore("projects").put({ id: "old-1", name: "Proyek lama di browser", files: { "index.circuit.tsx": code }, entrypoint: "index.circuit.tsx", createdAt: 1, updatedAt: 2 })
          tx.objectStore("messages").put({ id: "m1", projectId: "old-1", role: "user", content: "pesan dari masa lalu", createdAt: 3 })
          tx.oncomplete = () => {
            db.close()
            resolve()
          }
          tx.onerror = () => reject(tx.error)
        }
      }),
  )

  await page.goto("/")
  await expect(page.getByText("1 proyek dari browser dipindahkan ke server")).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole("button", { name: "Proyek lama di browser" })).toBeVisible()
  await expect(page.getByText("pesan dari masa lalu")).toBeVisible()
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })

  // A second load does not import again.
  await page.reload()
  await expect(page.getByRole("button", { name: "Proyek lama di browser" })).toBeVisible({ timeout: 30_000 })
  const projects = await (await page.request.get("/api/projects")).json()
  expect(projects.data.map((p: { name: string }) => p.name)).toEqual(["Proyek lama di browser"])
})
