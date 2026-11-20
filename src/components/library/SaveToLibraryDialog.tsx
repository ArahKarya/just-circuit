import { TriangleAlert } from "lucide-react"
import { useMemo, useState } from "react"
import toast from "react-hot-toast"
import { selectForLibrary } from "../../lib/library"
import { errorText } from "../../lib/notify"
import { libraryRepo } from "../../lib/repo"
import type { Project } from "../../lib/types"
import { Button, Field, Modal } from "../ui"

interface SaveToLibraryDialogProps {
  project: Project
  path: string
  onClose: () => void
}

function defaultName(path: string): string {
  const base = path.split("/").pop() ?? path
  return base.replace(/\.(circuit\.)?(tsx|ts|jsx|js)$/, "").replace(/[-_]+/g, " ").replace(/^\w/, (c) => c.toUpperCase())
}

export function SaveToLibraryDialog({ project, path, onClose }: SaveToLibraryDialogProps) {
  const selection = useMemo(() => {
    try {
      return { ok: true as const, value: selectForLibrary(project, path) }
    } catch (error) {
      return { ok: false as const, error: errorText(error) }
    }
  }, [project, path])
  const [name, setName] = useState(defaultName(path))
  const [description, setDescription] = useState("")
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!selection.ok) return
    setBusy(true)
    try {
      await libraryRepo.create({ name: name.trim() || defaultName(path), description, entry: selection.value.entry, files: selection.value.files })
      toast.success(`${name} disimpan ke library`)
      onClose()
    } catch (error) {
      toast.error(errorText(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Simpan ke library"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" disabled={busy || !selection.ok} onClick={() => void save()}>
            Simpan
          </Button>
        </>
      }
    >
      {!selection.ok ? (
        <p className="rounded-lg border border-danger/35 bg-danger/10 p-3 text-sm text-danger">{selection.error}</p>
      ) : (
        <div className="space-y-3.5">
          <Field label="Nama komponen" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          <Field
            label="Keterangan"
            placeholder="mis. AMS1117-3.3 + kapasitor, input 5V"
            value={description}
            maxLength={500}
            onChange={(e) => setDescription(e.target.value)}
          />
          <p className="rounded-lg border border-line bg-surface/50 px-3 py-2 text-xs text-muted">
            {Object.keys(selection.value.files).length} file dari <span className="font-mono text-ink">{path}</span>, file utama{" "}
            <span className="font-mono text-ink">{selection.value.entry}</span>.
          </p>
          {selection.value.missingImports.length > 0 && (
            <p className="flex items-start gap-2 rounded-xl border border-warn/30 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
              <TriangleAlert size={14} className="mt-0.5 shrink-0" />
              <span>
                Import berikut ada di luar {path} dan tidak ikut disimpan: {selection.value.missingImports.join(", ")}. Simpan foldernya sekalian, atau impor ulang di proyek tujuan.
              </span>
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}
