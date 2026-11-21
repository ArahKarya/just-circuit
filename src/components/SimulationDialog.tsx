import { Activity, CheckCircle2, CircleAlert, Plus, Sparkles, TrendingUp, TriangleAlert, Waves, Zap } from "lucide-react"
import { useMemo, useState } from "react"
import toast from "react-hot-toast"
import { simulateCircuit, type SimFinding } from "../lib/circuit-sim"
import { runAcSweepSim, runDcSweepSim, runTransientSim } from "../lib/spice-sim"
import { insertIntoBoard } from "../lib/tsx-ast"
import type { Project, ProjectFiles } from "../lib/types"
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

export function SimulationDialog({ project, circuitJson, onCommitFiles, onAskAiToFix, canAskAi, onClose }: SimulationDialogProps) {
  const [tab, setTab] = useState<SimTab>("dc")
  const [defaultVcc, setDefaultVcc] = useState(5)
  const [railOverrides, setRailOverrides] = useState<Record<string, number>>({})
  const [closedSwitches, setClosedSwitches] = useState<Set<string>>(() => new Set())

  // Transient controls
  const [waveform, setWaveform] = useState<"step" | "sine" | "pulse">("step")
  const [ampV, setAmpV] = useState(5)
  const [freqHz, setFreqHz] = useState(1000)
  const [durationMs, setDurationMs] = useState(5)

  // AC Sweep controls
  const [startHz, setStartHz] = useState(10)
  const [stopHz, setStopHz] = useState(100_000)
  const [probeNode, setProbeNode] = useState<string>("")

  // DC Sweep controls
  const [sweepStopV, setSweepStopV] = useState(12)

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
  const transient = useMemo(
    () =>
      tab === "transient"
        ? runTransientSim(circuitJson, { sourceRail: primaryRail, waveform, amplitudeV: ampV, frequencyHz: freqHz, durationMs, steps: 100 })
        : null,
    [tab, circuitJson, primaryRail, waveform, ampV, freqHz, durationMs],
  )
  const acSweep = useMemo(
    () => (tab === "ac" ? runAcSweepSim(circuitJson, { sourceRail: primaryRail, startHz, stopHz, points: 60 }) : null),
    [tab, circuitJson, primaryRail, startHz, stopHz],
  )
  const dcSweep = useMemo(
    () => (tab === "dcsweep" ? runDcSweepSim(circuitJson, { railName: primaryRail, startV: 0, stopV: sweepStopV, steps: 24 }) : null),
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

  const insertSpicePrimitive = () => {
    const snippet =
      tab === "ac"
        ? `<analogacsweep startFrequency="${startHz}Hz" stopFrequency="${stopHz}Hz" />`
        : `<analogtransientsimulation duration="${durationMs}ms" timePerStep="${Number((durationMs / 100).toFixed(3))}ms" />`
    const res = insertIntoBoard(project.files, project.entrypoint, snippet)
    if (res.status === "updated") {
      onCommitFiles(res.files)
      toast.success("Primitif simulasi SPICE ditambahkan ke kode TSX")
    }
  }

  const nonGroundNodes = (transient?.nodeLabels ?? acSweep?.nodeLabels ?? []).filter((n) => !/^(gnd|vss|0v)$/i.test(n))
  const activeProbe = probeNode && nonGroundNodes.includes(probeNode) ? probeNode : (nonGroundNodes.find((n) => n !== primaryRail) ?? nonGroundNodes[0] ?? "")

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
        {tab === "transient" && transient && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/40 p-3 text-xs">
              <label className="flex items-center gap-1.5">
                <span className="text-muted">Gelombang ({transient.sourceLabel}):</span>
                <select value={waveform} onChange={(e) => setWaveform(e.target.value as "step" | "sine" | "pulse")} className="h-7 rounded border border-line bg-panel px-2 text-xs text-ink">
                  <option value="step">Step (0 → V)</option>
                  <option value="pulse">Square / Pulse</option>
                  <option value="sine">Sinus</option>
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-muted">Amp</span>
                <input type="number" step="0.5" value={ampV} onChange={(e) => setAmpV(Number(e.target.value) || 5)} className="h-7 w-14 rounded border border-line bg-panel px-1.5 font-mono text-xs text-ink" />
                <span className="text-muted">V</span>
              </label>
              {waveform !== "step" && (
                <label className="flex items-center gap-1">
                  <span className="text-muted">Frek</span>
                  <input type="number" step="100" value={freqHz} onChange={(e) => setFreqHz(Number(e.target.value) || 1000)} className="h-7 w-20 rounded border border-line bg-panel px-1.5 font-mono text-xs text-ink" />
                  <span className="text-muted">Hz</span>
                </label>
              )}
              <label className="flex items-center gap-1">
                <span className="text-muted">Durasi</span>
                <input type="number" step="1" value={durationMs} onChange={(e) => setDurationMs(Number(e.target.value) || 5)} className="h-7 w-16 rounded border border-line bg-panel px-1.5 font-mono text-xs text-ink" />
                <span className="text-muted">ms</span>
              </label>
            </div>
            {transient.tooLarge ? (
              <p className="rounded-xl border border-warn/30 bg-warn/10 p-4 text-xs text-warn">Board terlalu besar untuk simulasi transien langsung di browser.</p>
            ) : (
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
          </div>
        )}

        {/* TAB 3: AC SWEEP (BODE PLOT) */}
        {tab === "ac" && acSweep && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/40 p-3 text-xs">
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
              <label className="flex items-center gap-1">
                <span className="text-muted">Dari</span>
                <input type="number" value={startHz} onChange={(e) => setStartHz(Number(e.target.value) || 10)} className="h-7 w-20 rounded border border-line bg-panel px-1.5 font-mono text-xs text-ink" />
                <span className="text-muted">Hz</span>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-muted">Sampai</span>
                <input type="number" value={stopHz} onChange={(e) => setStopHz(Number(e.target.value) || 100000)} className="h-7 w-24 rounded border border-line bg-panel px-1.5 font-mono text-xs text-ink" />
                <span className="text-muted">Hz</span>
              </label>
            </div>
            {acSweep.tooLarge ? (
              <p className="rounded-xl border border-warn/30 bg-warn/10 p-4 text-xs text-warn">Board terlalu besar untuk AC sweep di browser.</p>
            ) : activeProbe ? (
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
            ) : (
              <p className="text-xs text-muted">Tidak ada node aktif untuk AC sweep.</p>
            )}
          </div>
        )}

        {/* TAB 4: DC SWEEP */}
        {tab === "dcsweep" && dcSweep && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/40 p-3 text-xs">
              <span className="text-muted">Sweep Rail <strong className="font-mono text-ink">{dcSweep.railName}</strong> dari 0V sampai:</span>
              <input type="number" step="1" min={1} max={48} value={sweepStopV} onChange={(e) => setSweepStopV(Number(e.target.value) || 12)} className="h-7 w-16 rounded border border-line bg-panel px-1.5 font-mono text-xs text-ink" />
              <span className="text-muted">V</span>
            </div>
            <WaveformChart
              title={`Kurva Arus Suplai vs Tegangan ${dcSweep.railName}`}
              xLabel="V"
              yLabel="mA"
              xs={dcSweep.voltages}
              series={[{ name: "Total Arus (mA)", color: "#fbbf24", ys: dcSweep.totalCurrentMa }]}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}

function WaveformChart({
  title,
  xLabel,
  yLabel,
  xs,
  series,
  logX = false,
}: {
  title: string
  xLabel: string
  yLabel: string
  xs: number[]
  series: { name: string; color: string; ys: number[] }[]
  logX?: boolean
}) {
  const W = 560
  const H = 200
  const padL = 48
  const padR = 16
  const padT = 14
  const padB = 26
  const plotW = W - padL - padR
  const plotH = H - padT - padB

  const allY = series.flatMap((s) => s.ys)
  const minY = allY.length > 0 ? Math.min(...allY) : 0
  const maxY = allY.length > 0 ? Math.max(...allY) : 5
  const spanY = Math.max(0.01, maxY - minY)

  const xMin = xs[0] ?? 0
  const xMax = xs[xs.length - 1] ?? 1
  const mapX = (x: number, i: number) => {
    if (xs.length <= 1) return padL
    if (logX && xMin > 0 && xMax > xMin) {
      return padL + ((Math.log10(Math.max(xMin, x)) - Math.log10(xMin)) / (Math.log10(xMax) - Math.log10(xMin))) * plotW
    }
    return padL + (i / (xs.length - 1)) * plotW
  }
  const mapY = (y: number) => padT + plotH - ((y - minY) / spanY) * plotH

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-[#090c10]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-panel px-3 py-1.5 text-[11px]">
        <span className="font-semibold text-ink">{title}</span>
        <div className="flex flex-wrap gap-2">
          {series.map((s) => (
            <span key={s.name} className="inline-flex items-center gap-1 font-mono text-[10px] text-muted">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-52 w-full">
        {/* Horizontal grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = padT + plotH * t
          const val = maxY - spanY * t
          return (
            <g key={t}>
              <line x1={padL} y1={y} x2={W - padR} y2={y} stroke="#1f2533" strokeWidth={1} />
              <text x={padL - 6} y={y + 3} textAnchor="end" fill="#8b95a7" fontSize={9} fontFamily="var(--font-mono)">
                {val.toFixed(1)}
              </text>
            </g>
          )
        })}
        {/* Curves */}
        {series.map((s) => {
          if (s.ys.length < 2) return null
          const pts = s.ys.map((y, i) => `${mapX(xs[i] ?? i, i).toFixed(1)},${mapY(y).toFixed(1)}`).join(" ")
          return <polyline key={s.name} points={pts} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
        })}
        {/* Axis labels */}
        <text x={padL} y={H - 6} fill="#8b95a7" fontSize={9} fontFamily="var(--font-mono)">
          {xMin} {xLabel}
        </text>
        <text x={W - padR} y={H - 6} textAnchor="end" fill="#8b95a7" fontSize={9} fontFamily="var(--font-mono)">
          {xMax} {xLabel}
        </text>
        <text x={12} y={padT + 8} fill="#8b95a7" fontSize={9} fontFamily="var(--font-mono)">
          {yLabel}
        </text>
      </svg>
    </div>
  )
}
