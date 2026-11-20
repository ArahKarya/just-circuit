import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./index.css"
import { migrateStorageKeys } from "./lib/storage-keys"
import { installBugCapture } from "./lib/bug-capture"
import { bugReportsRepo } from "./lib/repo"

// Before anything reads storage: carry over values saved when the app was called CDS.
migrateStorageKeys()
// Uncaught browser errors become bug reports (Pengaturan → Bug) for a coding agent to fix.
installBugCapture((report) => bugReportsRepo.create({ ...report, source: "client" }))

const root = document.getElementById("root")
if (!root) throw new Error("Elemen #root tidak ditemukan")

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
