import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { App } from "./App"
import "./index.css"
import { migrateStorageKeys } from "./lib/storage-keys"

// Before anything reads storage: carry over values saved when the app was called CDS.
migrateStorageKeys()

const root = document.getElementById("root")
if (!root) throw new Error("Elemen #root tidak ditemukan")

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
