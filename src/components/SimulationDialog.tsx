import { Activity, CheckCircle2, CircleAlert, Sparkles, TriangleAlert, Zap } from "lucide-react"
import { useMemo, useState } from "react"
import { simulateCircuit, type SimFinding } from "../lib/circuit-sim"
import { Button, Modal } from "./ui"

interface SimulationDialogProps {
  circuitJson: unknown[]
  onAskAiToFix: (findings: SimFinding[]) => void
  canAskAi: boolean
  onClose: () => void
}

export function SimulationDialog({ circuitJson, onAskAiToFix, canAskAi, onClose }: SimulationDialogProps) {
  const [defaultVcc, setDefaultVcc] = useState(5)
  const [railOverrides, setRailOverrides] = useState<Record<string, number>>({})
  const [closedSwitches, setClosedSwitches] = useState<Set<string>>(() => new Set())

  const report = useMemo(
    () =>
      simulateCircuit(circuitJson, {
        defaultVcc,
        railVoltages: railOverrides,
        closedSwitches,
      }),
    [circuitJson, defaultVcc, railOverrides, closedSwitches],
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

  return (
    <Modal
      title="Simulasi Listrik & Arus (DC)"
      subtitle="Analisis titik kerja DC (MNA): cek hubung singkat, arus berlebih, daya resistor & polaritas LED"
      wide
      onClose={onClose}
      footer={
        <>
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
        {/* Summary KPI Cards */}
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

        {/* Supply voltage & switch controls */}
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

        {/* Findings (Errors & Warnings) */}
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
                  {finding.severity === "error" ? (
                    <CircleAlert size={15} className="mt-0.5 shrink-0" />
                  ) : (
                    <TriangleAlert size={15} className="mt-0.5 shrink-0" />
                  )}
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="font-semibold">{finding.title}</p>
                    <p className="leading-relaxed text-ink/85">{finding.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Component Telemetry Table */}
        <section className="space-y-2">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted">
            <Activity size={13} /> Arus & Daya per Komponen
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

        {/* Node Voltages */}
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
      </div>
    </Modal>
  )
}
