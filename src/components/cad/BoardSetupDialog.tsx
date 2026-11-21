import { Layers, Plus } from "lucide-react"
import { useState } from "react"
import toast from "react-hot-toast"
import {
  BOARD_LAYER_VALUES,
  BOARD_MATERIAL_VALUES,
  FABRICATOR_PRESET_VALUES,
  VIA_TENTING_VALUES,
  boardDraftErrors,
  boardFieldText,
  buildBoardPatch,
  readBoardConfig,
  saveBoardConfig,
  type BoardConfig,
  type BoardField,
} from "../../lib/tsx-board"
import { addNetRule } from "../../lib/tsx-rules"
import type { Project, ProjectFiles } from "../../lib/types"
import { Button, Field, Modal, SelectField } from "../ui"

interface BoardSetupDialogProps {
  project: Project
  onCommitFiles: (nextFiles: ProjectFiles) => void
  onClose: () => void
}

type Option = { value: string; label: string }

const LAYER_LABELS: Record<string, string> = {
  "1": "1 Layer (Single-sided)",
  "2": "2 Layer (Standar)",
  "4": "4 Layer (Signal/GND/PWR/Signal)",
  "6": "6 Layer",
  "8": "8 Layer",
  "10": "10 Layer",
}

const MATERIAL_LABELS: Record<string, string> = {
  fr4: "FR-4 (Rigid standar)",
  fr1: "FR-1 (Ekonomis)",
  flex: "Flex PCB (Polyimide)",
}

const FAB_LABELS: Record<string, string> = {
  jlcpcb_economy: "JLCPCB Economy",
  jlcpcb_standard: "JLCPCB Standard",
  jlcpcb_economy_20260912: "JLCPCB Economy (2026-09-12)",
  jlcpcb_standard_20260912: "JLCPCB Standard (2026-09-12)",
}

const TENTING_LABELS: Record<string, string> = {
  true: "Tented (true)",
  false: "Tidak di-tent (false)",
  both_sides: "Tented kedua sisi",
  top_and_bottom_tented: "Top & bottom tented",
  top_tented: "Top tented",
  bottom_tented: "Bottom tented",
  exposed: "Exposed (terbuka)",
}

/** Option list with a "default" entry and the current value kept even if it is not a known one. */
function buildOptions(values: readonly string[], labels: Record<string, string>, defaultLabel: string, current: string): Option[] {
  const known = values.map((value) => ({ value, label: labels[value] ?? value }))
  const extra = current && !values.includes(current) ? [{ value: current, label: `${current} (tidak dikenal)` }] : []
  return [{ value: "", label: defaultLabel }, ...known, ...extra]
}

function initialDraft(config: BoardConfig | null): Record<BoardField, string> {
  const text = (field: BoardField) => (config ? boardFieldText(config[field]) : "")
  return {
    width: text("width"),
    height: text("height"),
    layers: text("layers"),
    material: text("material"),
    thickness: text("thickness"),
    borderRadius: text("borderRadius"),
    fabricatorPreset: text("fabricatorPreset"),
    defaultViaTenting: text("defaultViaTenting"),
    allowBlindAndBuriedVias: text("allowBlindAndBuriedVias"),
    title: text("title"),
  }
}

const EXPRESSION_HINT = "Ditulis sebagai ekspresi. Ubah langsung di editor kode."

export function BoardSetupDialog({ project, onCommitFiles, onClose }: BoardSetupDialogProps) {
  const [initial] = useState(() => readBoardConfig(project.files, project.entrypoint))
  const [draft, setDraft] = useState<Record<BoardField, string>>(() => initialDraft(initial))
  const [netName, setNetName] = useState("V5")
  const [netTraceW, setNetTraceW] = useState("0.5mm")

  const isExpression = (field: BoardField) => initial?.[field].kind === "expression"
  const errors = initial ? boardDraftErrors(initial, draft) : {}
  const hasErrors = Object.keys(errors).length > 0
  const setField = (field: BoardField) => (value: string) => setDraft((prev) => ({ ...prev, [field]: value }))

  const saveBoard = () => {
    if (!initial) {
      toast.error("Tag <board> tidak ditemukan di file utama")
      return
    }
    if (Object.keys(buildBoardPatch(initial, draft)).length === 0) {
      toast("Tidak ada perubahan pada <board>")
      onClose()
      return
    }
    const res = saveBoardConfig(project.files, project.entrypoint, initial, draft)
    if (res.status === "updated") {
      onCommitFiles(res.files)
      toast.success("Pengaturan board & stackup disimpan ke kode TSX")
      onClose()
    } else if (res.status === "invalid") {
      toast.error("Perbaiki kolom yang tidak valid sebelum menyimpan")
    } else if (res.status === "unsupported") {
      toast.error(`Properti ${res.prop} ditulis sebagai ekspresi, jadi tidak diubah`)
    } else {
      toast.error("Tag <board> tidak ditemukan di file utama")
    }
  }

  const insertNetClass = () => {
    if (!netName.trim()) return
    const res = addNetRule(project.files, project.entrypoint, { name: netName.trim(), nominalTraceWidth: netTraceW })
    if (res.status === "updated") {
      onCommitFiles(res.files)
      toast.success(`Aturan net ${netName.trim()} ditambahkan`)
    } else {
      toast.error("Tag <board> tidak ditemukan di file utama")
    }
  }

  const textField = (field: BoardField, label: string, placeholder: string) => (
    <Field
      label={label}
      value={draft[field]}
      placeholder={placeholder}
      disabled={isExpression(field)}
      aria-invalid={errors[field] !== undefined}
      className={errors[field] ? "border-danger" : ""}
      hint={isExpression(field) ? EXPRESSION_HINT : errors[field]}
      onChange={(e) => setField(field)(e.target.value)}
    />
  )

  const selectField = (field: BoardField, label: string, values: readonly string[], labels: Record<string, string>, defaultLabel: string) =>
    isExpression(field) ? (
      <Field label={label} value={draft[field]} disabled hint={EXPRESSION_HINT} readOnly />
    ) : (
      <SelectField
        label={label}
        options={buildOptions(values, labels, defaultLabel, draft[field])}
        value={draft[field]}
        onChange={(e) => setField(field)(e.target.value)}
      />
    )

  return (
    <Modal
      title="Setup Board, Stackup & Aturan Net"
      subtitle={`Mengatur properti <board> dan kelas net di ${project.entrypoint}. Hanya kolom yang diubah yang ditulis ke kode.`}
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" disabled={!initial || hasErrors} onClick={saveBoard}>
            Simpan ke &lt;board&gt;
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
            <Layers size={15} className="text-accent" /> Dimensi & Stackup Fisik
          </h3>
          {!initial && <p className="text-xs text-warn">File utama tidak punya tag &lt;board&gt;.</p>}
          <div className="grid gap-3 sm:grid-cols-3">
            {textField("width", "Lebar board", "50mm")}
            {textField("height", "Tinggi board", "35mm")}
            {textField("borderRadius", "Radius sudut (borderRadius)", "mis. 2mm")}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {selectField("layers", "Jumlah Layer", BOARD_LAYER_VALUES, LAYER_LABELS, "Bawaan (2 layer)")}
            {selectField("material", "Material", BOARD_MATERIAL_VALUES, MATERIAL_LABELS, "Bawaan (FR-4)")}
            {textField("thickness", "Ketebalan board", "1.6mm")}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            {selectField("fabricatorPreset", "Preset Pabrik (DFM)", FABRICATOR_PRESET_VALUES, FAB_LABELS, "Bawaan (tanpa preset)")}
            {selectField("defaultViaTenting", "Via Tenting", VIA_TENTING_VALUES, TENTING_LABELS, "Bawaan pabrik")}
            {textField("title", "Judul Board (Title Block)", "mis. Power Supply Rev 1.0")}
          </div>
          {isExpression("allowBlindAndBuriedVias") ? (
            <p className="text-xs text-muted">allowBlindAndBuriedVias: {EXPRESSION_HINT}</p>
          ) : (
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
              <input
                type="checkbox"
                checked={draft.allowBlindAndBuriedVias === "true"}
                onChange={(e) => setField("allowBlindAndBuriedVias")(e.target.checked ? "true" : "")}
                className="size-4 accent-emerald-500"
              />
              Izinkan Blind &amp; Buried Vias (untuk board 4+ layer)
            </label>
          )}
        </section>

        <section className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
          <h3 className="text-sm font-semibold text-ink">Tambah Net Class (&lt;net&gt;)</h3>
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <Field label="Nama Net" value={netName} placeholder="V5 / GND / HIGH_V" onChange={(e) => setNetName(e.target.value)} />
            <Field label="Lebar trace nominal" value={netTraceW} placeholder="0.5mm" onChange={(e) => setNetTraceW(e.target.value)} />
            <Button size="sm" onClick={insertNetClass}>
              <Plus size={13} /> Tambah aturan net
            </Button>
          </div>
          <p className="text-[11px] leading-relaxed text-muted">
            tscircuit hanya mendukung lebar trace nominal per net (nominalTraceWidth). Clearance per net dan aturan DRC kustom belum bisa
            ditulis dari sini: &lt;drccheck&gt; butuh fungsi checkFn yang tidak punya akses ke lebar trace atau jarak antar-copper.
          </p>
        </section>
      </div>
    </Modal>
  )
}
