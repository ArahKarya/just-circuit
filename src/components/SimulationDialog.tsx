import { Activity, CheckCircle2, CircleAlert, Plus, Sparkles, TrendingUp, TriangleAlert, Waves, Zap } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import toast from "react-hot-toast"
import { simulateCircuit, type SimFinding } from "../lib/circuit-sim"
import { numberOrNull, parseNumberInput, type ParsedNumber } from "../lib/numeric-input"
import { runAcSweepSim, runDcSweepSim, runTransientSim } from "../lib/spice-sim"
import { insertIntoBoard } from "../lib/tsx-ast"
import type { Project, ProjectFiles } from "../lib/types"
import { SimMessagesPanel, SimNumberInput, WaveformChart } from "./SimPanels"
import { Button, Modal } from "./ui"

type SimTab = "dc" | "transient" | "ac" | "dcsweep"

interface SimulationDialogProps {
  project: Project
  circuitJson: unknown[]
  onCommitFiles: (nextFiles: ProjectFiles) => void
  onAskAiToFix: (findings: SimFinding[]) => void
  canAskAi: boolean
  onClose: () => void
}

const TRACE_COLORS = ["#34d399", "#38bdf8", "#fbbf24", "#f87171", "#c084fc"]
/** Delay before re-running a SPICE analysis after the user stops typing. */
const SIM_DEBOUNCE_MS = 400

type Waveform = "step" | "sine" | "pulse"

interface SimInputs {
  amp: string
  freq: string
  duration: string
  startHz: string
  stopHz: string
  sweepStopV: string
}

const INITIAL_INPUTS: SimInputs = { amp: "", freq: "1000", duration: "5", startHz: "10", stopHz: "100000", sweepStopV: "12" }

function parseSimInputs(raw: SimInputs): Record<keyof SimInputs, ParsedNumber> {
  return {
    amp: parseNumberInput(raw.amp, { gt: 0, max: 60, optional: true }),
    freq: parseNumberInput(raw.freq, { gt: 0, max: 1e9 }),
    duration: parseNumberInput(raw.duration, { min: 0.01, max: 5000 }),
    startHz: parseNumberInput(raw.startHz, { min: 0.1, max: 1e9 }),
    stopHz: parseNumberInput(raw.stopHz, { gt: 0, max: 1e10 }),
    sweepStopV: parseNumberInput(raw.sweepStopV, { gt: 0, max: 48 }),
  }
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(handle)
  }, [value, delayMs])
  return debounced
}

export function SimulationDialog({ project, circuitJson, onCommitFiles, onAskAiToFix, canAskAi, onClose }: SimulationDialogProps) {
  const [tab, setTab] = useState<SimTab>("dc")
  const [defaultVcc, setDefaultVcc] = useState(5)
  const [railOverrides, setRailOverrides] = useState<Record<string, number>>({})
  const [closedSwitches, setClosedSwitches] = useState<Set<string>>(() => new Set())
  const [waveform, setWaveform] = useState<Waveform>("step")
  const [probeNode, setProbeNode] = useState<string>("")
  const [inputs, setInputs] = useState<SimInputs>(INITIAL_INPUTS)
  const setInput = (key: keyof SimInputs) => (raw: string) => setInputs((prev) => ({ ...prev, [key]: raw }))
  const parsed = useMemo(() => parseSimInputs(inputs), [inputs])
  const debounced = useDebouncedValue(parsed, SIM_DEBOUNCE_MS)

  const report = useMemo(
    () =>
      simulateCircuit(circuitJson, {
        defaultVcc,
        railVoltages: railOverrides,
        closedSwitches,
      }),
    [circuitJson, defaultVcc, railOverrides, closedSwitches],
  )

  const primaryRail = report.rails[0]?.name
  const railVoltage = primaryRail ? (railOverrides[primaryRail] ?? report.rails[0].voltage) : defaultVcc
  const transientValid = debounced.amp.ok && debounced.duration.ok && (waveform === "step" || debounced.freq.ok)
  const acValid = debounced.startHz.ok && debounced.stopHz.ok
  const transient = useMemo(
    () =>
      tab === "transient" && transientValid
        ? runTransientSim(circuitJson, {
            sourceRail: primaryRail,
            waveform,
            amplitudeV: numberOrNull(debounced.amp) ?? railVoltage,
            frequencyHz: numberOrNull(debounced.freq) ?? undefined,
            durationMs: numberOrNull(debounced.duration) ?? undefined,
          })
        : null,
    [tab, transientValid, circuitJson, primaryRail, waveform, debounced, railVoltage],
  )
  const acSweep = useMemo(
    () =>
      tab === "ac" && acValid
        ? runAcSweepSim(circuitJson, {
            sourceRail: primaryRail,
            startHz: numberOrNull(debounced.startHz) ?? undefined,
            stopHz: numberOrNull(debounced.stopHz) ?? undefined,
            points: 60,
            dcBiasV: railVoltage,
          })
        : null,
    [tab, acValid, circuitJson, primaryRail, debounced, railVoltage],
  )
  const sweepStopV = numberOrNull(debounced.sweepStopV)
  const dcSweep = useMemo(
    () => (tab === "dcsweep" && sweepStopV !== null ? runDcSweepSim(circuitJson, { railName: primaryRail, startV: 0, stopV: sweepStopV, steps: 24 }) : null),
    [tab, circuitJson, primaryRail, sweepStopV],
  )

  const errors = report.findings.filter((f) => f.severity === "error")
  const warnings = report.findings.filter((f) => f.severity === "warning")

  const toggleSwitch = (name: string) => {
    setClosedSwitches((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  const insertFailureMessage = (status: string): string =>
    status === "not-found"
      ? "Elemen <board> tidak ditemukan di file entrypoint; tag SPICE tidak disisipkan."
      : "Kode board tidak bisa diubah otomatis; tambahkan tag SPICE secara manual."

  /** Builds the SPICE tag from the debounced snapshot that also produced the chart. */
  const spiceSnippet = (): string | null => {
    if (tab === "ac") {
      const startHz = numberOrNull(debounced.startHz)
      const stopHz = numberOrNull(debounced.stopHz)
      return startHz === null || stopHz === null ? null : `<analogacsweep startFrequency="${startHz}Hz" stopFrequency="${stopHz}Hz" />`
    }
    if (tab !== "transient") return null
    const durationMs = numberOrNull(debounced.duration)
    if (durationMs === null || !transient?.dtMs) return null
    return `<analogtransientsimulation duration="${durationMs}ms" timePerStep="${Number(transient.dtMs.toPrecision(3))}ms" />`
  }

  const insertSpicePrimitive = () => {
    const snippet = spiceSnippet()
    if (!snippet) {
      toast.error("Jalankan simulasi dengan nilai yang valid dulu")
      return
    }
    const res = insertIntoBoard(project.files, project.entrypoint, snippet)
    if (res.status !== "updated") {
      toast.error(insertFailureMessage(res.status))
      return
    }
    onCommitFiles(res.files)
    toast.success("Primitif simulasi SPICE ditambahkan ke kode TSX")
  }

  const sweepLabels = transient?.nodeLabels ?? acSweep?.nodeLabels ?? []
  const groundLabels = new Set(transient?.groundLabels ?? acSweep?.groundLabels ?? [])
  const nonGroundNodes = sweepLabels.filter((n) => !groundLabels.has(n))
  const activeProbe = probeNode && nonGroundNodes.includes(probeNode) ? probeNode : (nonGroundNodes.find((n) => n !== primaryRail) ?? nonGroundNodes[0] ?? "")
  const invalidNotice = <p className="rounded-xl border border-danger/30 bg-danger/8 p-3.5 text-xs text-danger">Perbaiki nilai yang ditandai merah untuk menjalankan simulasi.</p>

  return (
    <Modal
      title="Simulasi Listrik, Arus & SPICE"
      subtitle="Titik kerja DC (korsleting, arus LED, daya resistor), Transient Osiloskop, AC Bode Plot, & DC Sweep"
      wide
      onClose={onClose}
      footer={
        <>
          {(tab === "transient" || tab === "ac") && (
            <Button onClick={insertSpicePrimitive}>
              <Plus size={14} /> Sisipkan tag SPICE ke TSX
            </Button>
          )}
          {report.findings.length > 0 && (
            <Button
              variant="primary"
              disabled={!canAskAi}
              onClick={() => {
                onAskAiToFix(errors.length > 0 ? errors : report.findings)
                onClose()
              }}
            >
              <Sparkles size={14} /> Minta AI perbaiki temuan
            </Button>
          )}
          <Button onClick={onClose}>Tutup</Button>
        </>
      }
    >
      <div className="space-y-4">
        {/* Simulation Mode Tabs */}
        <div className="flex flex-wrap gap-1 rounded-xl border border-line bg-surface/70 p-1" role="tablist">
          {([
            ["dc", "DC & Cek Arus", Zap],
            ["transient", "Transient (Osiloskop)", Waves],
            ["ac", "AC Sweep (Bode Plot)", Activity],
            ["dcsweep", "DC Sweep (Kurva I–V)", TrendingUp],
          ] as const).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                tab === id ? "bg-raised text-ink shadow-xs" : "text-muted hover:text-ink"
              }`}
            >
              <Icon size={13} className={tab === id ? "text-accent" : ""} />
              {label}
            </button>
          ))}
        </div>

        {/* TAB 1: DC OPERATING POINT & SAFETY */}
        {tab === "dc" && (
          <>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              <div className="rounded-xl border border-line bg-surface/50 p-3">
                <p className="text-[11px] font-medium text-muted">Status Listrik</p>
                <p className={`mt-1 flex items-center gap-1.5 text-sm font-semibold ${report.ok ? "text-accent" : "text-danger"}`}>
                  {report.ok ? <CheckCircle2 size={15} /> : <CircleAlert size={15} />}
                  {report.ok ? (warnings.length > 0 ? `${warnings.length} Peringatan` : "Aman") : `${errors.length} Error`}
                </p>
              </div>
              <div className="rounded-xl border border-line bg-surface/50 p-3">
                <p className="text-[11px] font-medium text-muted">Total Arus Suplai</p>
                <p className="mt-1 font-mono text-sm font-semibold text-ink tabular-nums">
                  {report.totalCurrentMa >= 1000 ? `${(report.totalCurrentMa / 1000).toFixed(2)} A` : `${report.totalCurrentMa.toFixed(1)} mA`}
                </p>
              </div>
              <div className="rounded-xl border border-line bg-surface/50 p-3">
                <p className="text-[11px] font-medium text-muted">Total Disipasi Daya</p>
                <p className="mt-1 font-mono text-sm font-semibold text-ink tabular-nums">
                  {report.totalPowerMw >= 1000 ? `${(report.totalPowerMw / 1000).toFixed(2)} W` : `${report.totalPowerMw.toFixed(1)} mW`}
                </p>
              </div>
              <div className="rounded-xl border border-line bg-surface/50 p-3">
                <p className="text-[11px] font-medium text-muted">Node / Komponen</p>
                <p className="mt-1 font-mono text-sm font-semibold text-ink tabular-nums">
                  {report.nodes.length} node · {report.components.length} part
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/40 px-3.5 py-2.5 text-xs">
              <span className="flex items-center gap-1.5 font-semibold text-ink">
                <Zap size={13} className="text-accent" /> Sumber Tegangan:
              </span>
              {report.rails.length > 0 ? (
                report.rails.map((rail) => (
                  <label key={rail.nodeId} className="flex items-center gap-1.5">
                    <span className="font-mono text-muted">{rail.name}</span>
                    <input
                      type="number"
                      step="0.1"
                      min={0}
                      max={60}
                      aria-label={`Tegangan ${rail.name}`}
                      value={railOverrides[rail.name] ?? rail.voltage}
                      onChange={(e) => {
                        const v = Number.parseFloat(e.target.value)
                        if (Number.isFinite(v)) setRailOverrides((prev) => ({ ...prev, [rail.name]: v }))
                      }}
                      className="h-7 w-16 rounded-md border border-line bg-surface px-1.5 font-mono text-xs text-ink"
                    />
                    <span className="text-muted">V</span>
                  </label>
                ))
              ) : (
                <label className="flex items-center gap-1.5">
                  <span className="text-muted">Default VCC</span>
                  <input
                    type="number"
                    step="0.1"
                    min={0}
                    max={60}
                    value={defaultVcc}
                    onChange={(e) => {
                      const v = Number.parseFloat(e.target.value)
                      if (Number.isFinite(v)) setDefaultVcc(v)
                    }}
                    className="h-7 w-16 rounded-md border border-line bg-surface px-1.5 font-mono text-xs text-ink"
                  />
                  <span className="text-muted">V</span>
                </label>
              )}

              {report.switches.length > 0 && (
                <div className="flex items-center gap-1.5 border-l border-line pl-3">
                  <span className="text-muted">Saklar:</span>
                  {report.switches.map((sw) => {
                    const closed = closedSwitches.has(sw)
                    return (
                      <button
                        key={sw}
                        type="button"
                        aria-pressed={closed}
                        onClick={() => toggleSwitch(sw)}
                        className={`rounded-md border px-2 py-0.5 font-mono text-[11px] font-medium transition ${
                          closed ? "border-accent/40 bg-accent/15 text-accent" : "border-line bg-panel text-muted hover:text-ink"
                        }`}
                      >
                        {sw}: {closed ? "ON" : "OFF"}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <section className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Temuan Kelistrikan</h3>
              {report.findings.length === 0 ? (
                <p className="flex items-center gap-2 rounded-xl border border-accent/25 bg-accent/8 px-3.5 py-2.5 text-xs text-accent">
                  <CheckCircle2 size={15} /> Tidak ada masalah hubung singkat, arus berlebih, atau kelebihan daya yang terdeteksi.
                </p>
              ) : (
                <ul className="space-y-1.5" aria-label="Temuan simulasi">
                  {report.findings.map((finding) => (
                    <li
                      key={finding.id}
                      className={`flex items-start gap-2.5 rounded-xl border p-3 text-xs ${
                        finding.severity === "error"
                          ? "border-danger/35 bg-danger/8 text-danger"
                          : "border-warn/35 bg-warn/8 text-warn"
                      }`}
                    >
                      {finding.severity === "error" ? <CircleAlert size={15} className="mt-0.5 shrink-0" /> : <TriangleAlert size={15} className="mt-0.5 shrink-0" />}
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-semibold">{finding.title}</p>
                        <p className="leading-relaxed text-ink/85">{finding.detail}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
                <Activity size={13} /> Arus &amp; Daya per Komponen
              </h3>
              <div className="overflow-x-auto rounded-xl border border-line bg-surface/40">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-line bg-surface/70 text-[11px] text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Komponen</th>
                      <th className="px-3 py-2 font-medium">Nilai</th>
                      <th className="px-3 py-2 font-medium text-right">ΔV (V)</th>
                      <th className="px-3 py-2 font-medium text-right">Arus (mA)</th>
                      <th className="px-3 py-2 font-medium text-right">Daya (mW)</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {report.components.map((c) => (
                      <tr key={c.name} className="hover:bg-raised/40">
                        <td className="px-3 py-2 font-mono font-semibold text-ink">{c.name}</td>
                        <td className="px-3 py-2 font-mono text-muted">{c.value || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{c.voltageDrop.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{c.currentMa.toFixed(2)}</td>
                        <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{c.powerMw.toFixed(1)}</td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-medium ${
                              c.status === "error"
                                ? "bg-danger/15 text-danger"
                                : c.status === "warning"
                                  ? "bg-warn/15 text-warn"
                                  : c.status === "off"
                                    ? "bg-raised text-muted"
                                    : "bg-accent/12 text-accent"
                            }`}
                          >
                            {c.note ?? (c.status === "ok" ? "OK" : c.status)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {report.nodes.length > 0 && (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted">Tegangan Node / Net</h3>
                <div className="grid gap-1.5 sm:grid-cols-2 md:grid-cols-3">
                  {report.nodes.map((node) => (
                    <div key={node.id} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface/40 px-2.5 py-1.5 text-xs">
                      <div className="min-w-0">
                        <span className="block truncate font-mono font-semibold text-ink">{node.label}</span>
                        <span className="block truncate text-[10px] text-muted">{node.pins.slice(0, 4).join(", ") || "—"}</span>
                      </div>
                      <span className="shrink-0 font-mono font-semibold text-accent tabular-nums">{node.voltage.toFixed(2)} V</span>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* TAB 2: TRANSIENT OSCILLOSCOPE */}
        {tab === "transient" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface/40 p-3 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="text-muted">Gelombang ({transient?.sourceLabel || primaryRail || "sumber"}):</span>
                <select value={waveform} onChange={(e) => setWaveform(e.target.value as Waveform)} className="h-7 rounded border border-line bg-panel px-2 text-xs text-ink">
                  <option value="step">Step (0 → V)</option>
                  <option value="pulse">Square / Pulse</option>
                  <option value="sine">Sinus</option>
                </select>
              </label>
              <SimNumberInput label="Amp" unit="V" widthClass="w-16" value={inputs.amp} parsed={parsed.amp} onChange={setInput("amp")} placeholder={`${railVoltage}`} />
              {waveform !== "step" && (
                <SimNumberInput label="Frek" unit="Hz" value={inputs.freq} parsed={parsed.freq} onChange={setInput("freq")} />
              )}
              <SimNumberInput label="Durasi" unit="ms" widthClass="w-16" value={inputs.duration} parsed={parsed.duration} onChange={setInput("duration")} />
            </div>
            <p className="px-1 text-[11px] text-muted">Amplitudo kosong = tegangan rail DC ({railVoltage} V). Simulasi dijalankan ulang otomatis setelah Anda berhenti mengetik.</p>
            {!transient ? (
              invalidNotice
            ) : (
              <>
                <SimMessagesPanel messages={transient} />
                {!transient.error && (
                  <WaveformChart
                    title="Respons Waktu (Tegangan Node vs ms)"
                    xLabel="ms"
                    yLabel="V"
                    xs={transient.timesMs}
                    series={nonGroundNodes.slice(0, 5).map((lbl, idx) => ({
                      name: lbl,
                      color: TRACE_COLORS[idx % TRACE_COLORS.length],
                      ys: transient.signals[lbl] ?? [],
                    }))}
                  />
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 3: AC SWEEP (BODE PLOT) */}
        {tab === "ac" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface/40 p-3 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="text-muted">Probe Node:</span>
                <select value={activeProbe} onChange={(e) => setProbeNode(e.target.value)} className="h-7 rounded border border-line bg-panel px-2 font-mono text-xs text-ink">
                  {nonGroundNodes.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <SimNumberInput label="Dari" unit="Hz" value={inputs.startHz} parsed={parsed.startHz} onChange={setInput("startHz")} />
              <SimNumberInput label="Sampai" unit="Hz" widthClass="w-24" value={inputs.stopHz} parsed={parsed.stopHz} onChange={setInput("stopHz")} />
            </div>
            {!acSweep ? (
              invalidNotice
            ) : (
              <>
                <SimMessagesPanel messages={acSweep} />
                {!acSweep.error && activeProbe && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <WaveformChart
                      title={`Bode Magnitude — ${activeProbe} (dB)`}
                      xLabel="Hz (log)"
                      yLabel="dB"
                      xs={acSweep.freqsHz}
                      logX
                      series={[{ name: `${activeProbe} (dB)`, color: "#34d399", ys: acSweep.magnitudeDb[activeProbe] ?? [] }]}
                    />
                    <WaveformChart
                      title={`Bode Phase — ${activeProbe} (°)`}
                      xLabel="Hz (log)"
                      yLabel="°"
                      xs={acSweep.freqsHz}
                      logX
                      series={[{ name: `${activeProbe} (°)`, color: "#38bdf8", ys: acSweep.phaseDeg[activeProbe] ?? [] }]}
                    />
                  </div>
                )}
                {!acSweep.error && !activeProbe && <p className="text-xs text-muted">Tidak ada node aktif untuk AC sweep.</p>}
              </>
            )}
          </div>
        )}

        {/* TAB 4: DC SWEEP */}
        {tab === "dcsweep" && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-surface/40 p-3 text-xs">
              <SimNumberInput
                label={`Sweep rail ${dcSweep?.railName ?? primaryRail ?? "VCC"} dari 0 V sampai`}
                unit="V"
                widthClass="w-16"
                value={inputs.sweepStopV}
                parsed={parsed.sweepStopV}
                onChange={setInput("sweepStopV")}
              />
            </div>
            {!dcSweep ? invalidNotice : (
            <WaveformChart
              title={`Kurva Arus Suplai vs Tegangan ${dcSweep.railName}`}
              xLabel="V"
              yLabel="mA"
              xs={dcSweep.voltages}
              series={[{ name: "Total Arus (mA)", color: "#fbbf24", ys: dcSweep.totalCurrentMa }]}
            />
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
