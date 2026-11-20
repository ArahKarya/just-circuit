import { Loader2, RotateCcw, Save } from "lucide-react"
import { useState } from "react"
import toast from "react-hot-toast"
import { useLiveData } from "../../lib/live-data"
import { attempt } from "../../lib/notify"
import { TOPICS, versionsRepo } from "../../lib/repo"
import type { Version } from "../../lib/types"
import { Button, Modal } from "../ui"
import { DiffView } from "./DiffView"

interface HistoryDialogProps {
  projectId: string
  /** Saves pending typing before the history is changed. */
  flush: () => Promise<void>
  onClose: () => void
}

const DATE_FORMAT = new Intl.DateTimeFormat("id-ID", { dateStyle: "medium", timeStyle: "short" })

export function HistoryDialog({ projectId, flush, onClose }: HistoryDialogProps) {
  const versions = useLiveData(() => versionsRepo.list(projectId), [TOPICS.versions(projectId)])
  const [selected, setSelected] = useState<Version | null>(null)
  const current = selected ?? versions.data?.[0] ?? null
  const diff = useLiveData(current ? () => versionsRepo.diff(projectId, current.sha) : null, current ? [`diff:${current.sha}`] : [])
  const [message, setMessage] = useState("")
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    await attempt(action)
    setBusy(false)
  }

  const saveVersion = () =>
    run(async () => {
      await flush()
      const sha = await versionsRepo.save(projectId, message.trim() || "Simpan manual")
      toast[sha ? "success" : "error"](sha ? "Versi disimpan" : "Tidak ada perubahan sejak versi terakhir")
      setMessage("")
      setSelected(null)
    })

  const restore = (version: Version) =>
    run(async () => {
      await flush()
      await versionsRepo.restore(projectId, version.sha)
      toast.success(`Dikembalikan ke versi ${version.shortSha}`)
      onClose()
    })

  return (
    <Modal title="Riwayat versi" wide onClose={onClose}>
      <form
        className="mb-4 flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void saveVersion()
        }}
      >
        <input
          aria-label="Keterangan versi"
          placeholder="Keterangan, mis. sebelum ganti layout"
          value={message}
          maxLength={200}
          onChange={(e) => setMessage(e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/55 transition focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
        />
        <Button type="submit" variant="primary" disabled={busy}>
          <Save size={14} />
          Simpan versi
        </Button>
      </form>

      {versions.error ? (
        <p className="rounded-lg border border-danger/35 bg-danger/10 p-3 text-sm text-danger">{versions.error.message}</p>
      ) : !versions.data ? (
        <p className="flex items-center gap-2 py-6 text-sm text-muted">
          <Loader2 size={14} className="animate-spin text-accent" />
          Memuat riwayat…
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[17rem_1fr]">
          <ul className="max-h-[55vh] divide-y divide-line overflow-y-auto rounded-xl border border-line bg-surface/40" aria-label="Daftar versi">
            {versions.data.map((version, index) => {
              const active = current?.sha === version.sha
              return (
                <li key={version.sha}>
                  <button
                    type="button"
                    aria-current={active}
                    onClick={() => {
                      setSelected(version)
                      setConfirming(false)
                    }}
                    className={`block w-full px-3.5 py-2.5 text-left transition ${
                      active ? "bg-raised text-ink" : "hover:bg-raised/45"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-ink">{version.message}</span>
                      {index === 0 && (
                        <span className="shrink-0 rounded-full border border-accent/30 bg-accent/12 px-1.5 py-0.2 text-[10px] font-medium text-accent">
                          terbaru
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-muted tabular-nums">
                      {DATE_FORMAT.format(version.createdAt)} · {version.files.length} file
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <section className="min-w-0 space-y-3">
            {current && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface/40 px-3.5 py-2.5">
                <p className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="rounded-md border border-line bg-panel px-1.5 py-0.5 font-mono text-xs text-accent">{current.shortSha}</span>
                  <span className="truncate font-medium text-ink">{current.message}</span>
                </p>
                {current.sha !== versions.data[0]?.sha &&
                  (confirming ? (
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted">Isi file sekarang disimpan sebagai versi dulu.</span>
                      <Button size="sm" variant="primary" disabled={busy} onClick={() => void restore(current)}>
                        Kembalikan
                      </Button>
                      <Button size="sm" onClick={() => setConfirming(false)}>
                        Batal
                      </Button>
                    </span>
                  ) : (
                    <Button size="sm" onClick={() => setConfirming(true)}>
                      <RotateCcw size={13} />
                      Kembalikan ke versi ini
                    </Button>
                  ))}
              </div>
            )}
            {diff.error ? (
              <p className="rounded-lg border border-danger/35 bg-danger/10 p-3 text-sm text-danger">{diff.error.message}</p>
            ) : diff.data ? (
              <div className="max-h-[50vh] overflow-auto">
                <DiffView diff={diff.data.diff} truncated={diff.data.truncated} />
              </div>
            ) : (
              current && <p className="text-sm text-muted">Memuat perubahan…</p>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
