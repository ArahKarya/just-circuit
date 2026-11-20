import { FileArchive, Plus } from "lucide-react"
import { useRef, useState } from "react"
import toast from "react-hot-toast"
import type { ProjectsState } from "../../hooks/useProjects"
import { attempt } from "../../lib/notify"
import { DEFAULT_TEMPLATE_ID, findTemplate, PROJECT_TEMPLATES } from "../../lib/templates"
import { readProjectZip } from "../../lib/zip-import"
import { Button, Field, SelectField } from "../ui"

interface NewProjectFormProps {
  projects: ProjectsState
  workspaceId: string
  onDone: () => void
}

const TEMPLATE_OPTIONS = PROJECT_TEMPLATES.map((t) => ({ value: t.id, label: t.label }))

export function NewProjectForm({ projects, workspaceId, onDone }: NewProjectFormProps) {
  const [name, setName] = useState("")
  const [templateId, setTemplateId] = useState(DEFAULT_TEMPLATE_ID)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    const ok = await attempt(action)
    setBusy(false)
    if (ok) onDone()
  }

  const create = () => run(async () => void (await projects.create(name || "Proyek baru", { templateId, workspaceId })))

  const importZip = (file: File) =>
    run(async () => {
      const imported = await readProjectZip(await file.arrayBuffer(), file.name)
      await projects.insert({ name: imported.name, entrypoint: imported.entrypoint, files: imported.files, workspaceId })
      const note =
        imported.skipped.length > 0
          ? ` (${imported.skipped.length} file dilewati: ${imported.skipped.slice(0, 3).join(", ")}${imported.skipped.length > 3 ? ", …" : ""})`
          : ""
      toast.success(`${imported.name} diimpor, ${Object.keys(imported.files).length} file${note}`)
    })

  return (
    <form
      className="space-y-3 rounded-xl border border-line bg-surface/40 p-3.5"
      onSubmit={(event) => {
        event.preventDefault()
        void create()
      }}
    >
      <div className="grid gap-2.5 sm:grid-cols-[1fr_12rem]">
        <Field label="Proyek baru" placeholder="mis. PLC Pico 8 input" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
        <SelectField label="Template" options={TEMPLATE_OPTIONS} value={templateId} onChange={(e) => setTemplateId(e.target.value)} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">{findTemplate(templateId).description}</p>
        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInput}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            aria-label="File ZIP proyek"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ""
              if (file) void importZip(file)
            }}
          />
          <Button size="sm" onClick={() => fileInput.current?.click()} disabled={busy}>
            <FileArchive size={14} />
            Impor ZIP
          </Button>
          <Button size="sm" variant="primary" type="submit" disabled={busy}>
            <Plus size={14} />
            Buat
          </Button>
        </div>
      </div>
    </form>
  )
}
