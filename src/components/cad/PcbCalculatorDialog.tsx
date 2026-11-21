import { Calculator, Copy, Sparkles } from "lucide-react"
import { useMemo, useState } from "react"
import toast from "react-hot-toast"
import {
  calcDiffPairImpedance,
  calcLedResistor,
  calcMicrostripImpedance,
  calcRcFilter,
  calcTraceWidthIpc2221,
  calcViaCurrent,
  calcVoltageClearanceIpc2221,
  calcVoltageDivider,
} from "../../lib/pcb-calc"
import { Button, Field, Modal } from "../ui"

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

export function PcbCalculatorDialog({ onSendToAi, onClose }: PcbCalculatorDialogProps) {
  const [tab, setTab] = useState<CalcTab>("trace")

  // Trace width inputs
  const [traceCurrent, setTraceCurrent] = useState(1.5)
  const [tempRise, setTempRise] = useState(10)
  const [copperOz, setCopperOz] = useState(1)
  const [internalLayer, setInternalLayer] = useState(false)

  // Via inputs
  const [viaHole, setViaHole] = useState(0.3)
  const [viaPlating, setViaPlating] = useState(25)
  const [boardThick, setBoardThick] = useState(1.6)

  // Impedance inputs
  const [impW, setImpW] = useState(0.35)
  const [impS, setImpS] = useState(0.15)
  const [impH, setImpH] = useState(0.2)
  const [impEr, setImpEr] = useState(4.4)

  // Divider inputs
  const [divVin, setDivVin] = useState(5)
  const [divVout, setDivVout] = useState(3.3)
  const [divR2, setDivR2] = useState(10_000)

  // LED inputs
  const [ledVs, setLedVs] = useState(5)
  const [ledVf, setLedVf] = useState(2.0)
  const [ledMa, setLedMa] = useState(10)

  // Clearance inputs
  const [peakVolt, setPeakVolt] = useState(24)

  // RC filter inputs
  const [rcR, setRcR] = useState(1000)
  const [rcC, setRcC] = useState(100)

  const traceRes = useMemo(() => calcTraceWidthIpc2221(traceCurrent, tempRise, copperOz, internalLayer), [traceCurrent, tempRise, copperOz, internalLayer])
  const viaRes = useMemo(() => calcViaCurrent(viaHole, viaPlating, boardThick, tempRise), [viaHole, viaPlating, boardThick, tempRise])
  const msRes = useMemo(() => calcMicrostripImpedance(impW, impH, copperOz * 0.035, impEr), [impW, impH, copperOz, impEr])
  const diffRes = useMemo(() => calcDiffPairImpedance(impW, impS, impH, copperOz * 0.035, impEr), [impW, impS, impH, copperOz, impEr])
  const divRes = useMemo(() => calcVoltageDivider(divVin, divVout, divR2), [divVin, divVout, divR2])
  const ledRes = useMemo(() => calcLedResistor(ledVs, ledVf, ledMa), [ledVs, ledVf, ledMa])
  const clrRes = useMemo(() => calcVoltageClearanceIpc2221(peakVolt), [peakVolt])
  const rcRes = useMemo(() => calcRcFilter(rcR, rcC), [rcR, rcC])

  const summaryForAi = (): string => {
    switch (tab) {
      case "trace":
        return `Gunakan lebar trace minimal ${traceRes.widthMm}mm (tembaga ${copperOz}oz, ${internalLayer ? "internal" : "eksternal"}) untuk jalur daya berarus ${traceCurrent}A (ΔT ${tempRise}°C).`
      case "via":
        return `Gunakan via diameter lubang ${viaHole}mm (kapasitas ${viaRes.maxCurrentA}A per via) untuk jalur daya.`
      case "impedance":
        return `Atur trace impedansi terkontrol lebar ${impW}mm (Z0 ≈ ${msRes.z0Ohms}Ω) dan differential pair spasi ${impS}mm (Zdiff ≈ ${diffRes.zDiffOhms}Ω) pada dielektrik ${impH}mm Er=${impEr}.`
      case "divider":
        return `Tambahkan pembagi tegangan ${divVin}V ke ${divRes.actualVout}V menggunakan R1=${divRes.r1Label} dan R2=${divRes.r2Label} (seri E24).`
      case "led":
        return `Tambahkan resistor pembatas arus LED sebesar ${ledRes.standardLabel} paket ${ledRes.recommendedPackage} untuk sumber ${ledVs}V, Vf=${ledVf}V (arus ${ledRes.actualCurrentMa}mA, daya ${ledRes.powerMw}mW).`
      case "clearance":
        return `Terapkan aturan clearance minimal ${clrRes.externalCoatedMm}mm (coated) / ${clrRes.externalUncoatedMm}mm (uncoated) untuk jalur tegangan puncak ${peakVolt}V (IPC-2221).`
      case "filter":
        return `Tambahkan filter RC low-pass dengan R=${rcR}Ω dan C=${rcC}nF (frekuensi cutoff fc=${rcRes.cutoffHz}Hz).`
    }
  }

  const copySummary = () => {
    void navigator.clipboard.writeText(summaryForAi()).then(() => toast.success("Hasil kalkulasi disalin"))
  }

  return (
    <Modal
      title="Kalkulator PCB (ala KiCad)"
      subtitle="IPC-2221, impedansi, pembagi tegangan E24, resistor LED, via & filter RC"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={copySummary}>
            <Copy size={14} /> Salin hasil
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onSendToAi(summaryForAi())
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

        {tab === "trace" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
              <Field label="Arus (Ampere)" type="number" step="0.1" min={0.01} value={traceCurrent} onChange={(e) => setTraceCurrent(Number(e.target.value) || 0)} />
              <Field label="Kenaikan suhu maks ΔT (°C)" type="number" step="1" min={1} value={tempRise} onChange={(e) => setTempRise(Number(e.target.value) || 10)} />
              <Field label="Ketebalan tembaga (oz/ft²)" type="number" step="0.5" min={0.5} value={copperOz} onChange={(e) => setCopperOz(Number(e.target.value) || 1)} />
              <label className="flex cursor-pointer items-center gap-2 text-xs text-ink">
                <input type="checkbox" checked={internalLayer} onChange={(e) => setInternalLayer(e.target.checked)} className="size-4 accent-emerald-500" />
                Layer internal (In1/In2)
              </label>
            </div>
            <div className="space-y-2.5 rounded-xl border border-accent/25 bg-accent/8 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-accent">
                <Calculator size={14} /> Hasil IPC-2221
              </p>
              <Metric label="Lebar trace minimal" value={`${traceRes.widthMm} mm (${traceRes.widthMils} mil)`} highlight />
              <Metric label="Resistansi per cm" value={`${traceRes.resistanceMOhmPerCm} mΩ/cm`} />
              <Metric label="Drop tegangan per cm" value={`${traceRes.voltageDropMvPerCm} mV/cm`} />
              <Metric label="Rugi daya per cm" value={`${traceRes.powerLossMwPerCm} mW/cm`} />
            </div>
          </div>
        )}

        {tab === "via" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
              <Field label="Diameter lubang via (mm)" type="number" step="0.05" min={0.15} value={viaHole} onChange={(e) => setViaHole(Number(e.target.value) || 0.3)} />
              <Field label="Ketebalan plating (µm)" type="number" step="5" min={10} value={viaPlating} onChange={(e) => setViaPlating(Number(e.target.value) || 25)} />
              <Field label="Ketebalan board (mm)" type="number" step="0.2" min={0.4} value={boardThick} onChange={(e) => setBoardThick(Number(e.target.value) || 1.6)} />
            </div>
            <div className="space-y-2.5 rounded-xl border border-accent/25 bg-accent/8 p-4">
              <p className="text-xs font-semibold text-accent">Kapasitas Via</p>
              <Metric label="Arus maksimum (ΔT 10°C)" value={`${viaRes.maxCurrentA} A`} highlight />
              <Metric label="Resistansi DC via" value={`${viaRes.resistanceMOhm} mΩ`} />
              <Metric label="Luas penampang tembaga" value={`${viaRes.areaMil2} mil²`} />
            </div>
          </div>
        )}

        {tab === "impedance" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
              <Field label="Lebar trace W (mm)" type="number" step="0.05" min={0.08} value={impW} onChange={(e) => setImpW(Number(e.target.value) || 0.2)} />
              <Field label="Jarak antar trace S (mm, diff-pair)" type="number" step="0.05" min={0.08} value={impS} onChange={(e) => setImpS(Number(e.target.value) || 0.15)} />
              <Field label="Tinggi dielektrik ke GND H (mm)" type="number" step="0.05" min={0.05} value={impH} onChange={(e) => setImpH(Number(e.target.value) || 0.2)} />
              <Field label="Konstanta dielektrik Er (FR4 ≈ 4.4)" type="number" step="0.1" min={1} value={impEr} onChange={(e) => setImpEr(Number(e.target.value) || 4.4)} />
            </div>
            <div className="space-y-2.5 rounded-xl border border-accent/25 bg-accent/8 p-4">
              <p className="text-xs font-semibold text-accent">Impedansi Microstrip</p>
              <Metric label="Single-ended Z0" value={`${msRes.z0Ohms} Ω`} highlight />
              <Metric label="Differential Zdiff (USB=90Ω, Eth=100Ω)" value={`${diffRes.zDiffOhms} Ω`} highlight />
              <Metric label="Odd-mode Zodd" value={`${diffRes.zOddOhms} Ω`} />
              <Metric label="Er efektif / Delay" value={`${msRes.erEff} / ${msRes.delayPsPerMm} ps/mm`} />
            </div>
          </div>
        )}

        {tab === "divider" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
              <Field label="Tegangan input Vin (V)" type="number" step="0.1" value={divVin} onChange={(e) => setDivVin(Number(e.target.value) || 5)} />
              <Field label="Target output Vout (V)" type="number" step="0.1" value={divVout} onChange={(e) => setDivVout(Number(e.target.value) || 3.3)} />
              <Field label="Skala R2 bawah (Ω)" type="number" step="1000" value={divR2} onChange={(e) => setDivR2(Number(e.target.value) || 10000)} />
            </div>
            <div className="space-y-2.5 rounded-xl border border-accent/25 bg-accent/8 p-4">
              <p className="text-xs font-semibold text-accent">Pasangan Resistor E24 Terbaik</p>
              <Metric label="R1 (atas)" value={`${divRes.r1Label} (${divRes.r1Ohms} Ω)`} highlight />
              <Metric label="R2 (bawah)" value={`${divRes.r2Label} (${divRes.r2Ohms} Ω)`} highlight />
              <Metric label="Vout aktual" value={`${divRes.actualVout} V (galat ${divRes.errorPercent}%)`} />
              <Metric label="Arus bocor divider" value={`${divRes.currentMa} mA`} />
            </div>
          </div>
        )}

        {tab === "led" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
              <Field label="Tegangan suplai Vs (V)" type="number" step="0.1" value={ledVs} onChange={(e) => setLedVs(Number(e.target.value) || 5)} />
              <Field label="Tegangan maju LED Vf (V)" type="number" step="0.1" hint="Merah ~1.9V, Hijau ~2.2V, Biru/Putih ~3.0V" value={ledVf} onChange={(e) => setLedVf(Number(e.target.value) || 2.0)} />
              <Field label="Target arus (mA)" type="number" step="1" value={ledMa} onChange={(e) => setLedMa(Number(e.target.value) || 10)} />
            </div>
            <div className="space-y-2.5 rounded-xl border border-accent/25 bg-accent/8 p-4">
              <p className="text-xs font-semibold text-accent">Resistor Seri LED</p>
              <Metric label="Resistor E24 disarankan" value={`${ledRes.standardLabel} (ideal ${ledRes.idealOhms} Ω)`} highlight />
              <Metric label="Arus aktual" value={`${ledRes.actualCurrentMa} mA`} />
              <Metric label="Disipasi daya resistor" value={`${ledRes.powerMw} mW`} />
              <Metric label="Paket SMD minimal" value={ledRes.recommendedPackage} />
            </div>
          </div>
        )}

        {tab === "clearance" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
              <Field label="Tegangan puncak antar konduktor (V)" type="number" step="10" min={0} value={peakVolt} onChange={(e) => setPeakVolt(Number(e.target.value) || 0)} />
            </div>
            <div className="space-y-2.5 rounded-xl border border-accent/25 bg-accent/8 p-4">
              <p className="text-xs font-semibold text-accent">Jarak Aman Minimal (IPC-2221)</p>
              <Metric label="Eksternal (dengan soldermask)" value={`${clrRes.externalCoatedMm} mm`} highlight />
              <Metric label="Eksternal (tanpa soldermask / pad)" value={`${clrRes.externalUncoatedMm} mm`} highlight />
              <Metric label="Layer internal" value={`${clrRes.internalMm} mm`} />
            </div>
          </div>
        )}

        {tab === "filter" && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-line bg-surface/40 p-4">
              <Field label="Resistansi R (Ω)" type="number" step="100" value={rcR} onChange={(e) => setRcR(Number(e.target.value) || 1000)} />
              <Field label="Kapasitansi C (nF)" type="number" step="10" value={rcC} onChange={(e) => setRcC(Number(e.target.value) || 100)} />
            </div>
            <div className="space-y-2.5 rounded-xl border border-accent/25 bg-accent/8 p-4">
              <p className="text-xs font-semibold text-accent">Respons Filter RC Low-Pass</p>
              <Metric label="Frekuensi cutoff (-3dB)" value={rcRes.cutoffHz >= 1000 ? `${(rcRes.cutoffHz / 1000).toFixed(2)} kHz` : `${rcRes.cutoffHz} Hz`} highlight />
              <Metric label="Konstanta waktu τ = R·C" value={`${rcRes.tauMs} ms`} />
            </div>
          </div>
        )}
      </div>
    </Modal>
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
