import { Layers, Plus, ShieldCheck } from "lucide-react"
import { useState } from "react"
import toast from "react-hot-toast"
import { addDrcCheck, addNetRule, patchBoardProps, readBoardConfig } from "../../lib/tsx-ast"
import type { Project, ProjectFiles } from "../../lib/types"
import { Button, Field, Modal, SelectField } from "../ui"

interface BoardSetupDialogProps {
  project: Project
  onCommitFiles: (nextFiles: ProjectFiles) => void
  onClose: () => void
}

const LAYER_OPTIONS = [
  { value: "1", label: "1 Layer (Single-sided)" },
  { value: "2", label: "2 Layer (Standar)" },
  { value: "4", label: "4 Layer (Signal/GND/PWR/Signal)" },
  { value: "6", label: "6 Layer" },
  { value: "8", label: "8 Layer" },
] as const

const MATERIAL_OPTIONS = [
  { value: "fr4", label: "FR-4 (Rigid standar)" },
  { value: "fr1", label: "FR-1 (Ekonomis)" },
  { value: "flex", label: "Flex PCB (Polyimide)" },
] as const

const FAB_OPTIONS = [
  { value: "", label: "Bawaan (tanpa preset)" },
  { value: "jlcpcb_economy", label: "JLCPCB Economy" },
  { value: "jlcpcb_standard", label: "JLCPCB Standard" },
] as const

const TENTING_OPTIONS = [
  { value: "", label: "Bawaan pabrik" },
  { value: "both_sides", label: "Tented kedua sisi (top & bottom)" },
  { value: "top_tented", label: "Top tented" },
  { value: "bottom_tented", label: "Bottom tented" },
  { value: "exposed", label: "Exposed (terbuka)" },
] as const

export function BoardSetupDialog({ project, onCommitFiles, onClose }: BoardSetupDialogProps) {
  const initial = readBoardConfig(project.files, project.entrypoint)
  const [width, setWidth] = useState(initial.width)
  const [height, setHeight] = useState(initial.height)
  const [layers, setLayers] = useState(String(initial.layers))
  const [material, setMaterial] = useState(initial.material)
  const [thickness, setThickness] = useState(initial.thickness)
  const [borderRadius, setBorderRadius] = useState(initial.borderRadius)
  const [fabricatorPreset, setFabricatorPreset] = useState(initial.fabricatorPreset)
  const [defaultViaTenting, setDefaultViaTenting] = useState(initial.defaultViaTenting)
  const [allowBlindBuried, setAllowBlindBuried] = useState(initial.allowBlindAndBuriedVias)
  const [title, setTitle] = useState(initial.title)

  // Quick Net Class & DRC rule insertion
  const [netName, setNetName] = useState("V5")
  const [netTraceW, setNetTraceW] = useState("0.5mm")
  const [netClearance, setNetClearance] = useState("0.25mm")

  const [drcName, setDrcName] = useState("power_rules")
  const [drcMinW, setDrcMinW] = useState("0.15mm")
  const [drcMinClr, setDrcMinClr] = useState("0.15mm")

  const saveBoard = () => {
    const res = patchBoardProps(
      project.files,
      project.entrypoint,
      {
        width: width.trim() || undefined,
        height: height.trim() || undefined,
        layers: Number(layers) === 2 ? undefined : Number(layers),
        material: material === "fr4" ? undefined : material,
        thickness: thickness.trim() && thickness.trim() !== "1.6mm" ? thickness.trim() : undefined,
        borderRadius: borderRadius.trim() || undefined,
        fabricatorPreset: fabricatorPreset || undefined,
        defaultViaTenting: defaultViaTenting || undefined,
        allowBlindAndBuriedVias: allowBlindBuried ? true : undefined,
        title: title.trim() || undefined,
      },
      { force: true },
    )
    if (res.status === "updated") {
      onCommitFiles(res.files)
      toast.success("Pengaturan board & stackup disimpan ke kode TSX")
      onClose()
    } else {
      toast.error("Tag <board> tidak ditemukan di file utama")
    }
  }

  const insertNetClass = () => {
    if (!netName.trim()) return
    const res = addNetRule(project.files, project.entrypoint, {
      name: netName.trim(),
      traceWidth: netTraceW,
      clearance: netClearance,
    })
    if (res.status === "updated") {
      onCommitFiles(res.files)
      toast.success(`Aturan net class ${netName.trim()} ditambahkan`)
    }
  }

  const insertDrc = () => {
    if (!drcName.trim()) return
    const res = addDrcCheck(project.files, project.entrypoint, {
      name: drcName.trim(),
      minTraceWidth: drcMinW,
      minClearance: drcMinClr,
    })
    if (res.status === "updated") {
      onCommitFiles(res.files)
      toast.success(`Aturan DRC kustom "${drcName.trim()}" ditambahkan`)
    }
  }

  return (
    <Modal
      title="Setup Board, Stackup & Design Rules"
      subtitle={`Mengatur properti <board>, kelas net, dan aturan DRC kustom di ${project.entrypoint}`}
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Batal</Button>
          <Button variant="primary" onClick={saveBoard}>
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
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Lebar board" value={width} placeholder="50mm" onChange={(e) => setWidth(e.target.value)} />
            <Field label="Tinggi board" value={height} placeholder="35mm" onChange={(e) => setHeight(e.target.value)} />
            <Field label="Radius sudut (borderRadius)" value={borderRadius} placeholder="mis. 2mm" onChange={(e) => setBorderRadius(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField label="Jumlah Layer" options={LAYER_OPTIONS} value={layers} onChange={(e) => setLayers(e.target.value)} />
            <SelectField label="Material" options={MATERIAL_OPTIONS} value={material} onChange={(e) => setMaterial(e.target.value)} />
            <Field label="Ketebalan board" value={thickness} placeholder="1.6mm" onChange={(e) => setThickness(e.target.value)} />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <SelectField label="Preset Pabrik (DFM)" options={FAB_OPTIONS} value={fabricatorPreset} onChange={(e) => setFabricatorPreset(e.target.value)} />
            <SelectField label="Via Tenting" options={TENTING_OPTIONS} value={defaultViaTenting} onChange={(e) => setDefaultViaTenting(e.target.value)} />
            <Field label="Judul Board (Title Block)" value={title} placeholder="mis. Power Supply Rev 1.0" onChange={(e) => setTitle(e.target.value)} />
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
            <input type="checkbox" checked={allowBlindBuried} onChange={(e) => setAllowBlindBuried(e.target.checked)} className="size-4 accent-emerald-500" />
            Izinkan Blind &amp; Buried Vias (untuk board 4+ layer)
          </label>
        </section>

        <div className="grid gap-4 sm:grid-cols-2">
          <section className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
            <h3 className="text-sm font-semibold text-ink">Tambah Net Class (&lt;net&gt;)</h3>
            <Field label="Nama Net" value={netName} placeholder="V5 / GND / HIGH_V" onChange={(e) => setNetName(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Lebar Trace" value={netTraceW} placeholder="0.5mm" onChange={(e) => setNetTraceW(e.target.value)} />
              <Field label="Clearance" value={netClearance} placeholder="0.25mm" onChange={(e) => setNetClearance(e.target.value)} />
            </div>
            <Button size="sm" onClick={insertNetClass}>
              <Plus size={13} /> Tambah aturan net
            </Button>
          </section>

          <section className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <ShieldCheck size={14} className="text-accent" /> Tambah Custom DRC (&lt;drccheck&gt;)
            </h3>
            <Field label="Nama Aturan" value={drcName} placeholder="power_rules" onChange={(e) => setDrcName(e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Min Trace Width" value={drcMinW} placeholder="0.15mm" onChange={(e) => setDrcMinW(e.target.value)} />
              <Field label="Min Clearance" value={drcMinClr} placeholder="0.15mm" onChange={(e) => setDrcMinClr(e.target.value)} />
            </div>
            <Button size="sm" onClick={insertDrc}>
              <Plus size={13} /> Tambah aturan DRC
            </Button>
          </section>
        </div>
      </div>
    </Modal>
  )
}
