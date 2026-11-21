import { Calculator, CircleAlert, Copy, Sparkles } from "lucide-react"
import { useMemo, useState, type ReactNode } from "react"
import toast from "react-hot-toast"
import { numberOrNull, parseNumberInput, type NumberInputSpec, type ParsedNumber } from "../../lib/numeric-input"
import {
  calcDiffPairImpedance,
  calcLedResistor,
  calcMicrostripImpedance,
  calcRcFilter,
  calcTraceWidthIpc2221,
  calcViaCurrent,
  calcVoltageClearanceIpc2221,
  calcVoltageDivider,
  type ResistorSeries,
} from "../../lib/pcb-calc"
import { Button, INPUT_CLASS, Modal } from "../ui"

type CalcTab = "trace" | "via" | "impedance" | "divider" | "led" | "clearance" | "filter"

interface PcbCalculatorDialogProps {
  onSendToAi: (prompt: string) => void
  onClose: () => void
}

const TABS: { id: CalcTab; label: string }[] = [
  { id: "trace", label: "Lebar Trace (IPC-2221)" },
  { id: "via", label: "Arus Via" },
  { id: "impedance", label: "Impedansi & Diff-Pair" },
  { id: "divider", label: "Pembagi Tegangan" },
  { id: "led", label: "Resistor LED" },
  { id: "clearance", label: "Clearance Tegangan" },
  { id: "filter", label: "Filter RC" },
]

const OZ_TO_MM = 0.035

interface FieldDef {
  label: string
  initial: string
  spec: NumberInputSpec
  hint?: string
}

/** Every numeric input of the calculator; via and impedance own their ΔT / copper weight. */
const FIELDS = {
  traceCurrent: { label: "Arus (Ampere)", initial: "1.5", spec: { gt: 0, max: 500 } },
  traceTempRise: { label: "Kenaikan suhu maks ΔT (°C)", initial: "10", spec: { min: 1, max: 100 } },
  traceCopperOz: { label: "Ketebalan tembaga (oz/ft²)", initial: "1", spec: { gt: 0, max: 10 } },
  viaHole: { label: "Diameter lubang via (mm)", initial: "0.3", spec: { gt: 0, max: 10 } },
  viaPlating: { label: "Ketebalan plating (µm)", initial: "25", spec: { gt: 0, max: 200 } },
  viaBoardThick: { label: "Ketebalan board (mm)", initial: "1.6", spec: { gt: 0, max: 10 } },
  viaTempRise: { label: "Kenaikan suhu maks ΔT (°C)", initial: "10", spec: { min: 1, max: 100 } },
  impW: { label: "Lebar trace W (mm)", initial: "0.35", spec: { gt: 0, max: 20 } },
  impS: { label: "Jarak antar trace S (mm, diff-pair)", initial: "0.15", spec: { gt: 0, max: 20 } },
  impH: { label: "Tinggi dielektrik ke GND H (mm)", initial: "0.2", spec: { gt: 0, max: 10 } },
  impEr: { label: "Konstanta dielektrik Er (FR4 ≈ 4.4)", initial: "4.4", spec: { min: 1, max: 20 } },
  impCopperOz: { label: "Ketebalan tembaga (oz/ft²)", initial: "1", spec: { gt: 0, max: 10 } },
  divVin: { label: "Tegangan input Vin (V)", initial: "5", spec: { gt: 0 } },
  divVout: { label: "Target output Vout (V)", initial: "3.3", spec: { gt: 0 } },
  divR2: { label: "Skala R2 bawah (Ω)", initial: "10000", spec: { gt: 0 } },
  ledVs: { label: "Tegangan suplai Vs (V)", initial: "5", spec: { gt: 0 } },
  ledVf: { label: "Tegangan maju LED Vf (V)", initial: "2", spec: { min: 0 }, hint: "Merah ~1.9V, Hijau ~2.2V, Biru/Putih ~3.0V" },
  ledMa: { label: "Target arus (mA)", initial: "10", spec: { gt: 0 } },
  peakVolt: { label: "Tegangan puncak antar konduktor (V)", initial: "24", spec: { min: 0 } },
  rcR: { label: "Resistansi R (Ω)", initial: "1000", spec: { gt: 0 } },
  rcC: { label: "Kapasitansi C (nF)", initial: "100", spec: { gt: 0 } },
} satisfies Record<string, FieldDef>

type FieldKey = keyof typeof FIELDS
type RawValues = Record<FieldKey, string>
type ParsedValues = Record<FieldKey, ParsedNumber>

const TAB_FIELDS: Record<CalcTab, FieldKey[]> = {
  trace: ["traceCurrent", "traceTempRise", "traceCopperOz"],
  via: ["viaHole", "viaPlating", "viaBoardThick", "viaTempRise"],
  impedance: ["impW", "impS", "impH", "impEr", "impCopperOz"],
  divider: ["divVin", "divVout", "divR2"],
  led: ["ledVs", "ledVf", "ledMa"],
  clearance: ["peakVolt"],
  filter: ["rcR", "rcC"],
}

const fieldKeys = Object.keys(FIELDS) as FieldKey[]
const initialRaw = (): RawValues => Object.fromEntries(fieldKeys.map((k) => [k, FIELDS[k].initial])) as RawValues
const parseAll = (raw: RawValues): ParsedValues =>
  Object.fromEntries(fieldKeys.map((k) => [k, parseNumberInput(raw[k], (FIELDS[k] as FieldDef).spec)])) as ParsedValues

/** Values of a tab's fields, or null when any of them is invalid. */
function tabValues(parsed: ParsedValues, tab: CalcTab): Record<FieldKey, number> | null {
  const values = TAB_FIELDS[tab].map((k) => [k, numberOrNull(parsed[k])] as const)
  if (values.some(([, v]) => v === null)) return null
  return Object.fromEntries(values) as Record<FieldKey, number>
}

interface Outcome {
  panel: ReactNode
  summary: string | null
}

function invalidOutcome(message: string): Outcome {
  return {
    panel: (
      <p className="flex items-start gap-2 text-xs text-danger">
        <CircleAlert size={14} className="mt-0.5 shrink-0" /> {message}
      </p>
    ),
    summary: null,
  }
}

const INVALID_INPUT = "Perbaiki masukan yang ditandai merah."

function traceOutcome(v: Record<FieldKey, number>, internal: boolean): Outcome {
  const res = calcTraceWidthIpc2221(v.traceCurrent, v.traceTempRise, v.traceCopperOz, internal)
  return {
    panel: (
      <ResultPanel title={<><Calculator size={14} /> Hasil IPC-2221</>}>
        <Metric label="Lebar trace minimal" value={`${res.widthMm} mm (${res.widthMils} mil)`} highlight />
        <Metric label="Resistansi per cm" value={`${res.resistanceMOhmPerCm} mΩ/cm`} />
        <Metric label="Drop tegangan per cm" value={`${res.voltageDropMvPerCm} mV/cm`} />
        <Metric label="Rugi daya per cm" value={`${res.powerLossMwPerCm} mW/cm`} />
      </ResultPanel>
    ),
    summary: `Gunakan lebar trace minimal ${res.widthMm}mm (tembaga ${v.traceCopperOz}oz, ${internal ? "internal" : "eksternal"}) untuk jalur daya berarus ${v.traceCurrent}A (ΔT ${v.traceTempRise}°C).`,
  }
}

function viaOutcome(v: Record<FieldKey, number>): Outcome {
  const res = calcViaCurrent(v.viaHole, v.viaPlating, v.viaBoardThick, v.viaTempRise)
  return {
    panel: (
      <ResultPanel title="Kapasitas Via">
        <Metric label={`Arus maksimum (ΔT ${v.viaTempRise}°C)`} value={`${res.maxCurrentA} A`} highlight />
        <Metric label="Resistansi DC via" value={`${res.resistanceMOhm} mΩ`} />
        <Metric label="Luas penampang tembaga" value={`${res.areaMil2} mil²`} />
      </ResultPanel>
    ),
    summary: `Gunakan via diameter lubang ${v.viaHole}mm (kapasitas ${res.maxCurrentA}A per via pada ΔT ${v.viaTempRise}°C) untuk jalur daya.`,
  }
}

function impedanceOutcome(v: Record<FieldKey, number>): Outcome {
  const copperMm = v.impCopperOz * OZ_TO_MM
  const ms = calcMicrostripImpedance(v.impW, v.impH, copperMm, v.impEr)
  const diff = calcDiffPairImpedance(v.impW, v.impS, v.impH, copperMm, v.impEr)
  return {
    panel: (
      <ResultPanel title={`Impedansi Microstrip (tembaga ${v.impCopperOz}oz)`}>
        <Metric label="Single-ended Z0" value={`${ms.z0Ohms} Ω`} highlight />
        <Metric label="Differential Zdiff (USB=90Ω, Eth=100Ω)" value={`${diff.zDiffOhms} Ω`} highlight />
        <Metric label="Odd-mode Zodd" value={`${diff.zOddOhms} Ω`} />
        <Metric label="Er efektif / Delay" value={`${ms.erEff} / ${ms.delayPsPerMm} ps/mm`} />
      </ResultPanel>
    ),
    summary: `Atur trace impedansi terkontrol lebar ${v.impW}mm (Z0 ≈ ${ms.z0Ohms}Ω) dan differential pair spasi ${v.impS}mm (Zdiff ≈ ${diff.zDiffOhms}Ω) pada dielektrik ${v.impH}mm Er=${v.impEr}, tembaga ${v.impCopperOz}oz.`,
  }
}

function dividerOutcome(v: Record<FieldKey, number>, series: ResistorSeries): Outcome {
  const res = calcVoltageDivider(v.divVin, v.divVout, v.divR2, series)
  if (!res.ok) return invalidOutcome(res.error)
  return {
    panel: (
      <ResultPanel title={`Pasangan Resistor ${series} Terbaik`}>
        <Metric label="R1 (atas)" value={`${res.r1Label} (${res.r1Ohms} Ω)`} highlight />
        <Metric label="R2 (bawah)" value={`${res.r2Label} (${res.r2Ohms} Ω)`} highlight />
        <Metric label="Vout aktual" value={`${res.actualVout} V (galat ${res.errorPercent}%)`} />
        <Metric label="Arus bocor divider" value={`${res.currentMa} mA`} />
      </ResultPanel>
    ),
    summary: `Tambahkan pembagi tegangan ${v.divVin}V ke ${res.actualVout}V menggunakan R1=${res.r1Label} dan R2=${res.r2Label} (seri ${series}).`,
  }
}

function ledOutcome(v: Record<FieldKey, number>): Outcome {
  const res = calcLedResistor(v.ledVs, v.ledVf, v.ledMa)
  if (!res.ok) return invalidOutcome(res.error)
  return {
    panel: (
      <ResultPanel title="Resistor Seri LED">
        <Metric label="Resistor E24 disarankan" value={`${res.standardLabel} (ideal ${res.idealOhms} Ω)`} highlight />
        <Metric label="Arus aktual" value={`${res.actualCurrentMa} mA`} />
        <Metric label="Disipasi daya resistor" value={`${res.powerMw} mW`} />
        <Metric label="Paket SMD minimal" value={res.recommendedPackage} />
      </ResultPanel>
    ),
    summary: `Tambahkan resistor pembatas arus LED sebesar ${res.standardLabel} paket ${res.recommendedPackage} untuk sumber ${v.ledVs}V, Vf=${v.ledVf}V (arus ${res.actualCurrentMa}mA, daya ${res.powerMw}mW).`,
  }
}

function clearanceOutcome(v: Record<FieldKey, number>): Outcome {
  const res = calcVoltageClearanceIpc2221(v.peakVolt)
  return {
    panel: (
      <ResultPanel title="Jarak Aman Minimal (IPC-2221)">
        <Metric label="Eksternal (dengan soldermask)" value={`${res.externalCoatedMm} mm`} highlight />
        <Metric label="Eksternal (tanpa soldermask / pad)" value={`${res.externalUncoatedMm} mm`} highlight />
        <Metric label="Layer internal" value={`${res.internalMm} mm`} />
      </ResultPanel>
    ),
    summary: `Terapkan aturan clearance minimal ${res.externalCoatedMm}mm (coated) / ${res.externalUncoatedMm}mm (uncoated) untuk jalur tegangan puncak ${v.peakVolt}V (IPC-2221).`,
  }
}

function filterOutcome(v: Record<FieldKey, number>): Outcome {
  const res = calcRcFilter(v.rcR, v.rcC)
  return {
    panel: (
      <ResultPanel title="Respons Filter RC Low-Pass">
        <Metric label="Frekuensi cutoff (-3dB)" value={res.cutoffHz >= 1000 ? `${(res.cutoffHz / 1000).toFixed(2)} kHz` : `${res.cutoffHz} Hz`} highlight />
        <Metric label="Konstanta waktu τ = R·C" value={`${res.tauMs} ms`} />
      </ResultPanel>
    ),
    summary: `Tambahkan filter RC low-pass dengan R=${v.rcR}Ω dan C=${v.rcC}nF (frekuensi cutoff fc=${res.cutoffHz}Hz).`,
  }
}

function computeOutcome(tab: CalcTab, parsed: ParsedValues, internal: boolean, series: ResistorSeries): Outcome {
  const v = tabValues(parsed, tab)
  if (!v) return invalidOutcome(INVALID_INPUT)
  switch (tab) {
    case "trace":
      return traceOutcome(v, internal)
    case "via":
      return viaOutcome(v)
    case "impedance":
      return impedanceOutcome(v)
    case "divider":
      return dividerOutcome(v, series)
    case "led":
      return ledOutcome(v)
    case "clearance":
      return clearanceOutcome(v)
    case "filter":
      return filterOutcome(v)
  }
}

export function PcbCalculatorDialog({ onSendToAi, onClose }: PcbCalculatorDialogProps) {
  const [tab, setTab] = useState<CalcTab>("trace")
  const [raw, setRaw] = useState<RawValues>(initialRaw)
  const [internalLayer, setInternalLayer] = useState(false)
  const [series, setSeries] = useState<ResistorSeries>("E24")
  const parsed = useMemo(() => parseAll(raw), [raw])
  const outcome = useMemo(() => computeOutcome(tab, parsed, internalLayer, series), [tab, parsed, internalLayer, series])

  const field = (key: FieldKey) => (
    <NumField key={key} def={FIELDS[key]} value={raw[key]} parsed={parsed[key]} onChange={(v) => setRaw((prev) => ({ ...prev, [key]: v }))} />
  )

  const copySummary = () => {
    if (!outcome.summary) return
    void navigator.clipboard.writeText(outcome.summary).then(() => toast.success("Hasil kalkulasi disalin"))
  }

  return (
    <Modal
      title="Kalkulator PCB (ala KiCad)"
      subtitle="IPC-2221, impedansi, pembagi tegangan E24/E96, resistor LED, via & filter RC"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={copySummary} disabled={!outcome.summary}>
            <Copy size={14} /> Salin hasil
          </Button>
          <Button
            variant="primary"
            disabled={!outcome.summary}
            onClick={() => {
              if (!outcome.summary) return
              onSendToAi(outcome.summary)
              onClose()
            }}
          >
            <Sparkles size={14} /> Terapkan lewat AI
          </Button>
          <Button onClick={onClose}>Tutup</Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface/70 p-1" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                tab === t.id ? "bg-raised text-ink shadow-xs" : "text-muted hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
            {TAB_FIELDS[tab].map(field)}
            {tab === "trace" && (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                <input type="checkbox" checked={internalLayer} onChange={(e) => setInternalLayer(e.target.checked)} className="size-4 accent-emerald-500" />
                Layer internal (In1/In2)
              </label>
            )}
            {tab === "divider" && (
              <label className="flex items-center gap-2 text-xs text-ink">
                <span className="text-muted">Seri resistor</span>
                <select value={series} onChange={(e) => setSeries(e.target.value as ResistorSeries)} className="h-8 rounded-lg border border-line bg-surface px-2 text-xs text-ink">
                  <option value="E24">E24 (5%)</option>
                  <option value="E96">E96 (1%)</option>
                </select>
              </label>
            )}
          </div>
          <div className="space-y-2.5 rounded-xl border border-accent/25 bg-accent/8 p-4">{outcome.panel}</div>
        </div>
      </div>
    </Modal>
  )
}

function NumField({ def, value, parsed, onChange }: { def: FieldDef; value: string; parsed: ParsedNumber; onChange: (raw: string) => void }) {
  const id = `pcbcalc-${def.label.replace(/\W+/g, "-").toLowerCase()}`
  return (
    <label htmlFor={id} className="block space-y-1.5">
      <span className="block text-xs font-medium text-muted">{def.label}</span>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        aria-invalid={!parsed.ok}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLASS} ${parsed.ok ? "" : "border-danger focus:border-danger"}`}
      />
      {!parsed.ok ? (
        <span className="block text-[11px] text-danger">{parsed.error}</span>
      ) : (
        def.hint && <span className="block text-[11px] leading-relaxed text-muted">{def.hint}</span>
      )}
    </label>
  )
}

function ResultPanel({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <>
      <p className="flex items-center gap-1.5 text-xs font-semibold text-accent">{title}</p>
      {children}
    </>
  )
}

function Metric({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-line/50 pb-1.5 last:border-0 last:pb-0">
      <span className="text-xs text-muted">{label}</span>
      <span className={`font-mono font-semibold tabular-nums ${highlight ? "text-sm text-accent" : "text-xs text-ink"}`}>{value}</span>
    </div>
  )
}
