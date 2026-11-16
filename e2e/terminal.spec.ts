import { expect, test, type Page } from "./fixtures"

/** A login shell (.zshrc, nvm…) may drop keystrokes typed before its prompt is ready: retry until it answers. */
async function waitForShell(page: Page): Promise<void> {
  const terminal = page.getByTestId("terminal").first()
  await expect(async () => {
    await page.keyboard.type("echo SIAP-$((40+2))\n")
    await expect(terminal).toContainText("SIAP-42", { timeout: 3_000 })
  }).toPass({ timeout: 45_000 })
}

test("runs commands in the project folder and shows files they create in the editor", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByText("Build OK")).toBeVisible({ timeout: 60_000 })
  await page.getByRole("tab", { name: "Kode" }).click()

  await page.keyboard.press("Control+Backquote")
  const terminal = page.getByTestId("terminal").first()
  await expect(terminal).toBeVisible()
  await terminal.click()
  await waitForShell(page)

  // Short markers: long lines wrap in xterm depending on the panel width.
  await page.keyboard.type('ls; echo "WS=$(basename "$(dirname "$PWD")")"\n')
  await expect(terminal).toContainText("index.circuit.tsx", { timeout: 15_000 })
  await expect(terminal).toContainText("WS=default")

  await page.keyboard.type("printf 'export const DariTerminal = () => null\\n' > dari-terminal.tsx\n")
  const tree = page.getByRole("list", { name: "File proyek" })
  await expect(tree.getByRole("button", { name: "dari-terminal.tsx", exact: true })).toBeVisible({ timeout: 15_000 })

  // Quick command button types into the active shell.
  await page.getByRole("button", { name: "git log" }).click()
  await expect(terminal).toContainText("Riwayat dimulai", { timeout: 15_000 })

  // The shell does not see server secrets.
  await terminal.click()
  await page.keyboard.type('echo "rahasia=[$CDS_E2E]"\n')
  await expect(terminal).toContainText("rahasia=[]")

  await page.getByRole("button", { name: "Tutup panel terminal" }).click()
  await expect(page.getByRole("region", { name: "Terminal" })).toHaveCount(0)
})
