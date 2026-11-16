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
          className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-sm focus:border-accent focus:outline-none"
        />
        <Button type="submit" variant="primary" disabled={busy}><Save size={15} />Simpan versi</Button>
      </form>

      {versions.error ? (
        <p className="text-sm text-danger">{versions.error.message}</p>
      ) : !versions.data ? (
        <p className="flex items-center gap-2 text-sm text-muted"><Loader2 size={14} className="animate-spin" />Memuat riwayat…</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-[16rem_1fr]">
          <ul className="max-h-[55vh] divide-y divide-line overflow-y-auto rounded-md border border-line" aria-label="Daftar versi">
            {versions.data.map((version, index) => (
              <li key={version.sha}>
                <button
                  type="button"
                  aria-current={current?.sha === version.sha}
                  onClick={() => {
                    setSelected(version)
                    setConfirming(false)
                  }}
                  className={`block w-full px-3 py-2 text-left ${current?.sha === version.sha ? "bg-raised" : "hover:bg-raised/60"}`}
                >
                  <span className="block truncate text-sm">{version.message}</span>
                  <span className="block text-xs text-muted">
                    {DATE_FORMAT.format(version.createdAt)} · {version.files.length} file{index === 0 ? " · terbaru" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <section className="min-w-0 space-y-3">
            {current && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="min-w-0 text-sm">
                  <span className="font-mono text-xs text-muted">{current.shortSha}</span> {current.message}
                </p>
                {current.sha !== versions.data[0]?.sha &&
                  (confirming ? (
                    <span className="flex items-center gap-2">
                      <span className="text-xs text-muted">Isi file sekarang disimpan sebagai versi dulu.</span>
                      <Button variant="primary" disabled={busy} onClick={() => void restore(current)}>Kembalikan</Button>
                      <Button onClick={() => setConfirming(false)}>Batal</Button>
                    </span>
                  ) : (
                    <Button onClick={() => setConfirming(true)}><RotateCcw size={14} />Kembalikan ke versi ini</Button>
                  ))}
              </div>
            )}
            {diff.error ? (
              <p className="text-sm text-danger">{diff.error.message}</p>
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
