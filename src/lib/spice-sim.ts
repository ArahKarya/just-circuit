import { inferRailVoltage, MAX_SIM_NODES, parseOhms, simulateCircuit } from "./circuit-sim"

/**
 * Pure TypeScript SPICE-class circuit solvers for Just Circuit:
 * - Transient (Backward Euler time-domain oscilloscope for RC/RL/RLC/LED circuits)
 * - AC Frequency Sweep (Complex MNA Bode magnitude dB & phase deg)
 * - DC Sweep (Supply voltage sweep for IV curves & threshold analysis)
 */

type RawEl = Record<string, unknown> & { type?: string }
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined)
const GND_PATTERN = /^(gnd|agnd|dgnd|pgnd|vss|0v|ground|com)$/i

export function parseFarads(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw !== "string") return null
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(p|n|u|µ|m)?f?$/i)
  if (!m) return null
  const val = Number(m[1])
  if (!Number.isFinite(val) || val <= 0) return null
  const unit = (m[2] ?? "").toLowerCase()
  const mult = unit === "p" ? 1e-12 : unit === "n" ? 1e-9 : unit === "u" || unit === "µ" ? 1e-6 : unit === "m" ? 1e-3 : 1
  return val * mult
}

export function parseHenries(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw
  if (typeof raw !== "string") return null
  const m = raw.trim().match(/^(\d+(?:\.\d+)?)\s*(p|n|u|µ|m)?h?$/i)
  if (!m) return null
  const val = Number(m[1])
  if (!Number.isFinite(val) || val <= 0) return null
  const unit = (m[2] ?? "").toLowerCase()
  const mult = unit === "p" ? 1e-12 : unit === "n" ? 1e-9 : unit === "u" || unit === "µ" ? 1e-6 : unit === "m" ? 1e-3 : 1
  return val * mult
}

class UnionFind {
  private parent = new Map<string, string>()
  find(x: string): string {
    let cur = x
    while (this.parent.has(cur) && this.parent.get(cur) !== cur) cur = this.parent.get(cur)!
    this.parent.set(x, cur)
    return cur
  }
  union(a: string, b: string): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
}

interface NetlistBranch {
  id: string
  name: string
  kind: "R" | "C" | "L" | "D"
  value: number
  a: number
  b: number
}

interface ExtractedNetlist {
  nodeCount: number
  labels: string[]
  groundIdx: number[]
  supplyIdxByName: Map<string, number>
  branches: NetlistBranch[]
  tooLarge: boolean
}

function extractNetlist(circuitJson: readonly unknown[]): ExtractedNetlist {
  const elements = circuitJson.filter((e): e is RawEl => Boolean(e) && typeof e === "object")
  const comps = new Map<string, { id: string; name: string; ftype: string; raw: RawEl; ports: string[] }>()
  const netById = new Map<string, string>()
  const portIds: string[] = []

  for (const el of elements) {
    if (el.type === "source_component" && str(el.source_component_id)) {
      const id = str(el.source_component_id)!
      comps.set(id, { id, name: str(el.name) ?? id, ftype: str(el.ftype) ?? "simple_chip", raw: el, ports: [] })
    } else if (el.type === "source_net" && str(el.source_net_id) && str(el.name)) {
      netById.set(str(el.source_net_id)!, str(el.name)!)
    }
  }
  for (const el of elements) {
    if (el.type !== "source_port" || !str(el.source_port_id) || !str(el.source_component_id)) continue
    const pid = str(el.source_port_id)!
    const comp = comps.get(str(el.source_component_id)!)
    if (!comp) continue
    comp.ports.push(pid)
    portIds.push(pid)
  }

  const uf = new UnionFind()
  for (const p of portIds) uf.find(`p:${p}`)
  for (const n of netById.keys()) uf.find(`n:${n}`)
  for (const el of elements) {
    if (el.type !== "source_trace") continue
    const ports = Array.isArray(el.connected_source_port_ids) ? el.connected_source_port_ids.filter((v): v is string => typeof v === "string") : []
    const nets = Array.isArray(el.connected_source_net_ids) ? el.connected_source_net_ids.filter((v): v is string => typeof v === "string") : []
    const keys = [...ports.map((p) => `p:${p}`), ...nets.map((n) => `n:${n}`)]
    for (let i = 1; i < keys.length; i += 1) uf.union(keys[0], keys[i])
  }
  const byUpper = new Map<string, string>()
  for (const [id, name] of netById.entries()) {
    const u = name.toUpperCase()
    if (byUpper.has(u)) uf.union(byUpper.get(u)!, `n:${id}`)
    else byUpper.set(u, `n:${id}`)
  }

  const namesByRoot = new Map<string, string[]>()
  for (const [id, name] of netById.entries()) {
    const r = uf.find(`n:${id}`)
    if (!namesByRoot.has(r)) namesByRoot.set(r, [])
    namesByRoot.get(r)!.push(name)
  }
  const allRoots = [...new Set([...portIds.map((p) => uf.find(`p:${p}`)), ...namesByRoot.keys()])]
  if (allRoots.length > MAX_SIM_NODES) {
    return { nodeCount: allRoots.length, labels: [], groundIdx: [], supplyIdxByName: new Map(), branches: [], tooLarge: true }
  }

  const idxByRoot = new Map<string, number>()
  const labels: string[] = []
  const groundIdx: number[] = []
  const supplyIdxByName = new Map<string, number>()

  allRoots.forEach((r, i) => {
    idxByRoot.set(r, i)
    const names = namesByRoot.get(r) ?? []
    const label = names[0] ?? `N${i + 1}`
    labels.push(label)
    if (names.some((n) => GND_PATTERN.test(n))) groundIdx.push(i)
    for (const n of names) {
      if (!GND_PATTERN.test(n) && inferRailVoltage(n) !== null) {
        supplyIdxByName.set(n, i)
      }
    }
  })

  const branches: NetlistBranch[] = []
  for (const c of comps.values()) {
    if (c.ports.length < 2) continue
    const a = idxByRoot.get(uf.find(`p:${c.ports[0]}`))
    const b = idxByRoot.get(uf.find(`p:${c.ports[1]}`))
    if (a === undefined || b === undefined) continue
    if (c.ftype === "simple_resistor") {
      const r = parseOhms(c.raw.resistance ?? c.raw.display_resistance) ?? 1000
      branches.push({ id: c.id, name: c.name, kind: "R", value: r, a, b })
    } else if (c.ftype === "simple_capacitor") {
      const cap = parseFarads(c.raw.capacitance ?? c.raw.display_capacitance) ?? 100e-9
      branches.push({ id: c.id, name: c.name, kind: "C", value: cap, a, b })
    } else if (c.ftype === "simple_inductor") {
      const ind = parseHenries(c.raw.inductance ?? c.raw.display_inductance) ?? 10e-6
      branches.push({ id: c.id, name: c.name, kind: "L", value: ind, a, b })
    } else if (c.ftype === "simple_led" || c.ftype === "simple_diode") {
      branches.push({ id: c.id, name: c.name, kind: "D", value: c.ftype === "simple_led" ? 2.0 : 0.7, a, b })
    }
  }

  return { nodeCount: allRoots.length, labels, groundIdx, supplyIdxByName, branches, tooLarge: false }
}

function solveReal(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col += 1) {
    let pivotRow = col
    let maxVal = Math.abs(M[col][col])
    for (let r = col + 1; r < n; r += 1) {
      const v = Math.abs(M[r][col])
      if (v > maxVal) {
        maxVal = v
        pivotRow = r
      }
    }
    if (maxVal < 1e-15) continue
    if (pivotRow !== col) [M[col], M[pivotRow]] = [M[pivotRow], M[col]]
    const pivot = M[col][col]
    for (let r = col + 1; r < n; r += 1) {
      const f = M[r][col] / pivot
      if (f === 0) continue
      for (let c = col; c <= n; c += 1) M[r][c] -= f * M[col][c]
    }
  }
  const x = new Array<number>(n).fill(0)
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = M[i][n]
    for (let j = i + 1; j < n; j += 1) sum -= M[i][j] * x[j]
    x[i] = Math.abs(M[i][i]) > 1e-15 ? sum / M[i][i] : 0
  }
  return x
}

type Complex = [number, number] // [re, im]
const cAdd = (a: Complex, b: Complex): Complex => [a[0] + b[0], a[1] + b[1]]
const cSub = (a: Complex, b: Complex): Complex => [a[0] - b[0], a[1] - b[1]]
const cMul = (a: Complex, b: Complex): Complex => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]]
const cDiv = (a: Complex, b: Complex): Complex => {
  const d = b[0] * b[0] + b[1] * b[1]
  return d < 1e-30 ? [0, 0] : [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]
}
const cAbs = (a: Complex): number => Math.hypot(a[0], a[1])

function solveComplex(A: Complex[][], b: Complex[]): Complex[] {
  const n = b.length
  const M: Complex[][] = A.map((row, i) => [...row.map((c): Complex => [c[0], c[1]]), [b[i][0], b[i][1]]])
  for (let col = 0; col < n; col += 1) {
    let pivotRow = col
    let maxVal = cAbs(M[col][col])
    for (let r = col + 1; r < n; r += 1) {
      const v = cAbs(M[r][col])
      if (v > maxVal) {
        maxVal = v
        pivotRow = r
      }
    }
    if (maxVal < 1e-18) continue
    if (pivotRow !== col) [M[col], M[pivotRow]] = [M[pivotRow], M[col]]
    const pivot = M[col][col]
    for (let r = col + 1; r < n; r += 1) {
      const f = cDiv(M[r][col], pivot)
      if (f[0] === 0 && f[1] === 0) continue
      for (let c = col; c <= n; c += 1) M[r][c] = cSub(M[r][c], cMul(f, M[col][c]))
    }
  }
  const x: Complex[] = Array.from({ length: n }, () => [0, 0])
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum: Complex = M[i][n]
    for (let j = i + 1; j < n; j += 1) sum = cSub(sum, cMul(M[i][j], x[j]))
    x[i] = cAbs(M[i][i]) > 1e-18 ? cDiv(sum, M[i][i]) : [0, 0]
  }
  return x
}

export interface TransientOptions {
  sourceRail?: string
  waveform?: "step" | "sine" | "pulse"
  amplitudeV?: number
  frequencyHz?: number
  durationMs?: number
  steps?: number
}

export interface TransientResult {
  tooLarge?: boolean
  timesMs: number[]
  signals: Record<string, number[]>
  nodeLabels: string[]
  sourceLabel: string
}

/** Runs Backward-Euler time-domain transient simulation (oscilloscope). */
export function runTransientSim(circuitJson: readonly unknown[], opts: TransientOptions = {}): TransientResult {
  const nl = extractNetlist(circuitJson)
  if (nl.tooLarge || nl.nodeCount === 0) {
    return { tooLarge: nl.tooLarge, timesMs: [], signals: {}, nodeLabels: [], sourceLabel: "" }
  }
  const durationMs = Math.max(0.05, Math.min(5000, opts.durationMs ?? 5))
  const steps = Math.max(20, Math.min(240, opts.steps ?? 100))
  const dt = (durationMs / 1000) / steps
  const amp = opts.amplitudeV ?? 5
  const freq = opts.frequencyHz ?? 1000
  const wave = opts.waveform ?? "step"

  const supplyEntries = [...nl.supplyIdxByName.entries()]
  const chosenEntry = (opts.sourceRail && nl.supplyIdxByName.has(opts.sourceRail))
    ? [opts.sourceRail, nl.supplyIdxByName.get(opts.sourceRail)!] as const
    : supplyEntries[0] ?? null
  const srcIdx = chosenEntry ? chosenEntry[1] : -1
  const sourceLabel = chosenEntry ? chosenEntry[0] : "(tanpa sumber)"

  const N = nl.nodeCount
  let prevV = new Array<number>(N).fill(0)
  const indCurrent = new Map<string, number>()

  const timesMs: number[] = []
  const signals: Record<string, number[]> = {}
  for (const label of nl.labels) signals[label] = []

  const stampG = (G: number[][], a: number, b: number, g: number) => {
    if (a === b) return
    G[a][a] += g
    G[b][b] += g
    G[a][b] -= g
    G[b][a] -= g
  }

  for (let k = 0; k <= steps; k += 1) {
    const tSec = k * dt
    let vSrc = amp
    if (wave === "step") vSrc = k === 0 ? 0 : amp
    else if (wave === "sine") vSrc = amp * 0.5 * (1 + Math.sin(2 * Math.PI * freq * tSec))
    else if (wave === "pulse") vSrc = Math.sin(2 * Math.PI * freq * tSec) >= 0 ? amp : 0

    const G = Array.from({ length: N }, () => new Array<number>(N).fill(0))
    const I = new Array<number>(N).fill(0)
    for (let i = 0; i < N; i += 1) G[i][i] += 1e-9
    for (const gIdx of nl.groundIdx) G[gIdx][gIdx] += 1e6
    if (srcIdx >= 0 && !nl.groundIdx.includes(srcIdx)) {
      const gSrc = 100 // 0.01 ohm source
      G[srcIdx][srcIdx] += gSrc
      I[srcIdx] += vSrc * gSrc
    }

    for (const br of nl.branches) {
      if (br.kind === "R") {
        stampG(G, br.a, br.b, 1 / Math.max(1e-3, br.value))
      } else if (br.kind === "C") {
        const gc = br.value / dt
        const vp = prevV[br.a] - prevV[br.b]
        stampG(G, br.a, br.b, gc)
        I[br.a] += gc * vp
        I[br.b] -= gc * vp
      } else if (br.kind === "L") {
        const gl = dt / Math.max(1e-12, br.value)
        const il = indCurrent.get(br.id) ?? 0
        stampG(G, br.a, br.b, gl)
        I[br.a] -= il
        I[br.b] += il
      } else if (br.kind === "D") {
        const vdPrev = prevV[br.a] - prevV[br.b]
        if (vdPrev > br.value) {
          const gd = 1 / 10
          stampG(G, br.a, br.b, gd)
          I[br.a] += br.value * gd
          I[br.b] -= br.value * gd
        } else {
          stampG(G, br.a, br.b, 1e-7)
        }
      }
    }

    const vNow = solveReal(G, I)
    for (const br of nl.branches) {
      if (br.kind === "L") {
        const prevI = indCurrent.get(br.id) ?? 0
        indCurrent.set(br.id, prevI + ((vNow[br.a] - vNow[br.b]) * dt) / Math.max(1e-12, br.value))
      }
    }
    prevV = vNow
    timesMs.push(Number((tSec * 1000).toFixed(4)))
    nl.labels.forEach((lbl, idx) => {
      signals[lbl].push(Number(vNow[idx].toFixed(4)))
    })
  }

  return { timesMs, signals, nodeLabels: nl.labels, sourceLabel }
}

export interface AcSweepOptions {
  sourceRail?: string
  startHz?: number
  stopHz?: number
  points?: number
}

export interface AcSweepResult {
  tooLarge?: boolean
  freqsHz: number[]
  magnitudeDb: Record<string, number[]>
  phaseDeg: Record<string, number[]>
  nodeLabels: string[]
  sourceLabel: string
}

/** Runs small-signal AC Frequency Sweep (Complex MNA -> Bode magnitude dB & phase deg). */
export function runAcSweepSim(circuitJson: readonly unknown[], opts: AcSweepOptions = {}): AcSweepResult {
  const nl = extractNetlist(circuitJson)
  if (nl.tooLarge || nl.nodeCount === 0) {
    return { tooLarge: nl.tooLarge, freqsHz: [], magnitudeDb: {}, phaseDeg: {}, nodeLabels: [], sourceLabel: "" }
  }
  const startHz = Math.max(0.1, opts.startHz ?? 10)
  const stopHz = Math.max(startHz * 10, opts.stopHz ?? 1_000_000)
  const points = Math.max(15, Math.min(120, opts.points ?? 60))

  const supplyEntries = [...nl.supplyIdxByName.entries()]
  const chosenEntry = (opts.sourceRail && nl.supplyIdxByName.has(opts.sourceRail))
    ? [opts.sourceRail, nl.supplyIdxByName.get(opts.sourceRail)!] as const
    : supplyEntries[0] ?? null
  const srcIdx = chosenEntry ? chosenEntry[1] : -1
  const sourceLabel = chosenEntry ? chosenEntry[0] : "(tanpa sumber)"

  const N = nl.nodeCount
  const freqsHz: number[] = []
  const magnitudeDb: Record<string, number[]> = {}
  const phaseDeg: Record<string, number[]> = {}
  for (const lbl of nl.labels) {
    magnitudeDb[lbl] = []
    phaseDeg[lbl] = []
  }

  const stampY = (Y: Complex[][], a: number, b: number, y: Complex) => {
    if (a === b) return
    Y[a][a] = cAdd(Y[a][a], y)
    Y[b][b] = cAdd(Y[b][b], y)
    Y[a][b] = cSub(Y[a][b], y)
    Y[b][a] = cSub(Y[b][a], y)
  }

  const logStart = Math.log10(startHz)
  const logStop = Math.log10(stopHz)

  for (let k = 0; k < points; k += 1) {
    const freq = 10 ** (logStart + ((logStop - logStart) * k) / (points - 1))
    const omega = 2 * Math.PI * freq
    const Y: Complex[][] = Array.from({ length: N }, () => Array.from({ length: N }, (): Complex => [0, 0]))
    const I: Complex[] = Array.from({ length: N }, (): Complex => [0, 0])

    for (let i = 0; i < N; i += 1) Y[i][i] = [1e-9, 0]
    for (const gIdx of nl.groundIdx) Y[gIdx][gIdx] = cAdd(Y[gIdx][gIdx], [1e6, 0])
    if (srcIdx >= 0 && !nl.groundIdx.includes(srcIdx)) {
      Y[srcIdx][srcIdx] = cAdd(Y[srcIdx][srcIdx], [100, 0])
      I[srcIdx] = [100, 0] // 1V AC excitation (0 dB reference)
    }

    for (const br of nl.branches) {
      if (br.kind === "R") {
        stampY(Y, br.a, br.b, [1 / Math.max(1e-3, br.value), 0])
      } else if (br.kind === "C") {
        stampY(Y, br.a, br.b, [0, omega * br.value])
      } else if (br.kind === "L") {
        const xl = omega * Math.max(1e-12, br.value)
        stampY(Y, br.a, br.b, [0, -1 / Math.max(1e-9, xl)])
      } else if (br.kind === "D") {
        stampY(Y, br.a, br.b, [1 / 100, 0])
      }
    }

    const v = solveComplex(Y, I)
    freqsHz.push(Number(freq.toPrecision(4)))
    nl.labels.forEach((lbl, idx) => {
      const mag = Math.max(1e-6, cAbs(v[idx]))
      const db = 20 * Math.log10(mag)
      const deg = (Math.atan2(v[idx][1], v[idx][0]) * 180) / Math.PI
      magnitudeDb[lbl].push(Number(db.toFixed(2)))
      phaseDeg[lbl].push(Number(deg.toFixed(1)))
    })
  }

  return { freqsHz, magnitudeDb, phaseDeg, nodeLabels: nl.labels, sourceLabel }
}

export interface DcSweepResult {
  voltages: number[]
  totalCurrentMa: number[]
  railName: string
}

/** Sweeps the primary supply rail from startV to stopV to produce a DC transfer/IV curve. */
export function runDcSweepSim(
  circuitJson: readonly unknown[],
  opts: { railName?: string; startV?: number; stopV?: number; steps?: number } = {},
): DcSweepResult {
  const base = simulateCircuit(circuitJson)
  const railName = opts.railName || base.rails[0]?.name || "VCC"
  const startV = opts.startV ?? 0
  const stopV = opts.stopV ?? 12
  const steps = Math.max(5, Math.min(40, opts.steps ?? 24))
  const voltages: number[] = []
  const totalCurrentMa: number[] = []
  for (let i = 0; i <= steps; i += 1) {
    const v = startV + ((stopV - startV) * i) / steps
    const r = simulateCircuit(circuitJson, { railVoltages: { [railName]: v }, defaultVcc: v })
    voltages.push(Number(v.toFixed(2)))
    totalCurrentMa.push(r.totalCurrentMa)
  }
  return { voltages, totalCurrentMa, railName }
}
