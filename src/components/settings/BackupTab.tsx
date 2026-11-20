import { Download, Upload } from "lucide-react"
import { useRef, useState } from "react"
import { z } from "zod"
import { withDefaults } from "../../lib/preferences"
import type { AiSettings, Preferences } from "../../lib/types"
import { Button } from "../ui"

interface BackupTabProps {
  ai: AiSettings
  preferences: Preferences
  /** Puts imported values into the drafts; they are saved with the dialog's Save button. */
  onImport: (ai: AiSettings, preferences: Preferences) => void
}

const BACKUP_VERSION = 1

const backupSchema = z
  .object({
    /** Backups made when the app was called CDS carry `cds` instead. */
    justCircuit: z.literal("settings-backup").optional(),
    cds: z.literal("settings-backup").optional(),
    version: z.literal(BACKUP_VERSION),
    ai: z.object({
      activeConnectionId: z.string().nullable(),
      autoFixConnectionId: z.string().nullable().optional(),
      temperature: z.number(),
      maxOutputTokens: z.number(),
      autoFixAttempts: z.number(),
      historyLimit: z.number().optional(),
      connections: z.array(
        z
          .object({
            id: z.string(),
            name: z.string(),
            kind: z.enum(["openai-compatible", "anthropic", "gemini"]),
            baseUrl: z.string(),
            model: z.string(),
          })
          .passthrough(),
      ),
    }),
    preferences: z.record(z.string(), z.unknown()),
  })
  .refine((backup) => backup.justCircuit || backup.cds, "Bukan file backup Just Circuit")

/** Settings without API keys, as a downloadable JSON file. */
function backupJson(ai: AiSettings, preferences: Preferences): string {
  const connections = ai.connections.map(({ apiKey: _key, hasApiKey: _has, clearApiKey: _clear, ...rest }) => rest)
  return JSON.stringify(
    { justCircuit: "settings-backup", version: BACKUP_VERSION, exportedAt: new Date().toISOString(), ai: { ...ai, connections }, preferences },
    null,
    2,
  )
}

export function BackupTab({ ai, preferences, onImport }: BackupTabProps) {
  const input = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const download = () => {
    const url = URL.createObjectURL(new Blob([backupJson(ai, preferences)], { type: "application/json" }))
    const link = document.createElement("a")
    link.href = url
    link.download = `just-circuit-pengaturan-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const load = async (file: File) => {
    try {
      const parsed = backupSchema.parse(JSON.parse(await file.text()))
      const connections = parsed.ai.connections.map((c) => ({ ...c, apiKey: "" }) as AiSettings["connections"][number])
      onImport({ ...parsed.ai, connections }, withDefaults(parsed.preferences as Partial<Preferences>))
      setMessage({ ok: true, text: `${connections.length} koneksi dan preferensi dimuat. Klik Simpan, lalu isi ulang API key-nya.` })
    } catch {
      setMessage({ ok: false, text: "File bukan cadangan pengaturan Just Circuit yang valid." })
    }
  }

  return (
    <div className="space-y-4 rounded-xl border border-line bg-surface/40 p-4">
      <p className="text-xs leading-relaxed text-muted">
        Cadangan berisi koneksi AI (tanpa API key) dan preferensi tampilan. Proyek dicadangkan lewat folder data server atau Unduh ZIP.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={download}>
          <Download size={14} />
          Unduh cadangan
        </Button>
        <Button onClick={() => input.current?.click()}>
          <Upload size={14} />
          Muat cadangan
        </Button>
        <input
          ref={input}
          type="file"
          accept="application/json,.json"
          aria-label="File cadangan pengaturan"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ""
            if (file) void load(file)
          }}
        />
      </div>
      {message && (
        <p
          role={message.ok ? "status" : "alert"}
          className={`rounded-lg border px-3 py-2 text-xs ${
            message.ok ? "border-accent/30 bg-accent/10 text-accent" : "border-danger/35 bg-danger/10 text-danger"
          }`}
        >
          {message.text}
        </p>
      )}
    </div>
  )
}
