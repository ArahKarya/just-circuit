import { simulateCircuit } from "./circuit-sim"
import { extractNetlist, MAX_SPICE_NODES, type ExtractedNetlist, type NetlistBranch, type Supply } from "./spice-netlist"
import { luFactor, luSolve, solveComplex, type LuFactors } from "./spice-solve"

export { MAX_SPICE_NODES, parseFarads, parseHenries } from "./spice-netlist"

/**
 * Pure TypeScript SPICE-class circuit solvers for Just Circuit:
 * - Transient (backward-Euler time-domain oscilloscope for RC/RL/RLC/LED circuits)
 * - AC frequency sweep (complex nodal analysis around the DC operating point -> Bode dB & phase)
 * - DC sweep (supply voltage sweep for IV curves & threshold analysis)
 *
 * GND nets and supply rails are fixed-voltage nodes; every other node is solved.
 * Diodes/LEDs are piecewise-linear (Vf in series with DIODE_RON when on, open when off).
 */

const GMIN = 1e-9
const DIODE_RON = 10
const DIODE_GOFF = 1e-9
const CAP_DC_G = 1e-12
const INDUCTOR_DC_G = 1e3
/** Emission coefficient x thermal voltage for small-signal diode conductance (n ~ 2). */
const N_VT = 0.05
const MAX_DIODE_SMALL_SIGNAL_G = 1
const MAX_DIODE_PASSES = 8
const DIODE_HYSTERESIS_V = 1e-6
const LU_CACHE_LIMIT = 64

const MIN_STEPS = 200
const MAX_STEPS = 10_000
/** Rough per-run budget of multiply-adds for back-substitution (n^2 per step). */
const STEP_WORK_BUDGET = 4e7
const MAX_OUTPUT_POINTS = 1500
const MIN_DURATION_MS = 0.01
const MAX_DURATION_MS = 5000

const MIN_AC_HZ = 0.1
const AC_MIN_SPAN = 10
const MIN_AC_POINTS = 15
const MAX_AC_POINTS = 120
const DB_FLOOR_MAG = 1e-6

export interface SimMessages {
  /** Set when the analysis cannot run; no waveform should be drawn. */
  error?: string
  tooLarge?: boolean
  warnings: string[]
  notes: string[]
  /** Parts the solver does not model (ICs, transistors, ...). */
  ignoredParts: string[]
  groundLabels: string[]
}

// ---------------------------------------------------------------------------
// Shared preparation
// ---------------------------------------------------------------------------

interface NodeMap {
  /** Unknown index per node, or -1 for fixed-voltage nodes (GND and supply rails). */
  readonly unknownOf: Int32Array
  readonly n: number
}

interface Prepared {
  readonly nl: ExtractedNetlist
  readonly source: Supply
  readonly map: NodeMap
  readonly messages: SimMessages
}

type Preparation = { ok: true; value: Prepared } | { ok: false; messages: SimMessages }

const baseMessages = (nl: ExtractedNetlist): SimMessages => ({
  warnings: [...nl.warnings],
  notes: [],
  ignoredParts: [...nl.ignoredParts],
  groundLabels: nl.groundIdx.map((i) => nl.labels[i]),
})

function pickSource(nl: ExtractedNetlist, sourceRail: string | undefined): Supply | null {
  const wanted = sourceRail?.toUpperCase()
  return nl.supplies.find((s) => s.name.toUpperCase() === wanted) ?? nl.supplies[0] ?? null
}

function preparationError(nl: ExtractedNetlist, analysis: string): string | null {
  if (nl.tooLarge) {
    return `Rangkaian terlalu besar untuk simulasi ${analysis} di browser (${nl.nodeCount} node, maks ${MAX_SPICE_NODES}). Simulasikan satu blok rangkaian di proyek terpisah.`
  }
  if (nl.groundIdx.length === 0) {
    return "Tidak ada net GND sebagai referensi 0V. Hubungkan rangkaian ke net.GND agar hasil simulasi bermakna."
  }
  if (nl.supplies.length === 0) {
    return "Tidak ditemukan net sumber tegangan (mis. VCC, 5V, 3V3) untuk dieksitasi."
  }
  if (nl.branches.length === 0) return "Tidak ada komponen R/C/L/LED/dioda yang bisa disimulasikan."
  return null
}

function prepare(circuitJson: readonly unknown[], sourceRail: string | undefined, analysis: string): Preparation {
  const nl = extractNetlist(circuitJson)
  const messages = baseMessages(nl)
  const error = preparationError(nl, analysis)
  const source = pickSource(nl, sourceRail)
  if (error || !source) return { ok: false, messages: { ...messages, error: error ?? "Sumber tegangan tidak ditemukan.", tooLarge: nl.tooLarge } }
  const fixed = new Set([...nl.groundIdx, ...nl.supplies.map((s) => s.idx)])
  const unknownOf = new Int32Array(nl.nodeCount).fill(-1)
  let n = 0
  for (let i = 0; i < nl.nodeCount; i += 1) if (!fixed.has(i)) unknownOf[i] = n++
  if (sourceRail && source.name.toUpperCase() !== sourceRail.toUpperCase()) {
    messages.warnings.push(`Rail "${sourceRail}" tidak ditemukan; memakai ${source.name} sebagai sumber.`)
  }
  return { ok: true, value: { nl, source, map: { unknownOf, n }, messages } }
}

// ---------------------------------------------------------------------------
// Real nodal assembly + piecewise-linear diode iteration
// ---------------------------------------------------------------------------

/** Each branch is linearised as i(a->b) = g * (va - vb) - ieq. */
interface Linearised {
  readonly g: Float64Array
  readonly ieq: Float64Array
}

function assembleMatrix({ unknownOf, n }: NodeMap, branches: readonly NetlistBranch[], g: Float64Array): Float64Array {
  const m = new Float64Array(n * n)
  for (let i = 0; i < n; i += 1) m[i * n + i] = GMIN
  branches.forEach((br, k) => {
    const ua = unknownOf[br.a]
    const ub = unknownOf[br.b]
    if (br.a === br.b) return
    if (ua >= 0) m[ua * n + ua] += g[k]
    if (ub >= 0) m[ub * n + ub] += g[k]
    if (ua >= 0 && ub >= 0) {
      m[ua * n + ub] -= g[k]
      m[ub * n + ua] -= g[k]
    }
  })
  return m
}

function assembleRhs({ unknownOf, n }: NodeMap, branches: readonly NetlistBranch[], lin: Linearised, fixedV: Float64Array): Float64Array {
  const rhs = new Float64Array(n)
  branches.forEach((br, k) => {
    const ua = unknownOf[br.a]
    const ub = unknownOf[br.b]
    if (br.a === br.b) return
    if (ua >= 0) rhs[ua] += lin.ieq[k] + (ub < 0 ? lin.g[k] * fixedV[br.b] : 0)
    if (ub >= 0) rhs[ub] += -lin.ieq[k] + (ua < 0 ? lin.g[k] * fixedV[br.a] : 0)
  })
  return rhs
}

function expand({ unknownOf }: NodeMap, x: Float64Array, fixedV: Float64Array): Float64Array {
  return Float64Array.from(fixedV, (fv, i) => (unknownOf[i] >= 0 ? x[unknownOf[i]] : fv))
}

const diodeLinear = (br: NetlistBranch, on: boolean): [number, number] =>
  on ? [1 / DIODE_RON, br.value / DIODE_RON] : [DIODE_GOFF, 0]

function nextDiodeStates(branches: readonly NetlistBranch[], v: Float64Array, on: readonly boolean[]): boolean[] {
  return branches.map((br, k) => {
    if (br.kind !== "D") return false
    const vd = v[br.a] - v[br.b]
    return on[k] ? vd >= br.value - DIODE_HYSTERESIS_V : vd > br.value + DIODE_HYSTERESIS_V
  })
}

const stateKey = (on: readonly boolean[]): string => on.map((b) => (b ? "1" : "0")).join("")

interface DiodeSolve {
  readonly v: Float64Array
  readonly on: boolean[]
  readonly lin: Linearised
}

/**
 * Solves the network, re-linearising diodes until their on/off states are
 * self-consistent (fixed-point passes). LU factors are cached per state set.
 */
function solveWithDiodes(
  p: Prepared,
  linearise: (on: readonly boolean[]) => Linearised,
  fixedV: Float64Array,
  initialOn: readonly boolean[],
  cache: Map<string, LuFactors>,
): DiodeSolve {
  let on = [...initialOn]
  let result: DiodeSolve | null = null
  for (let pass = 0; pass < MAX_DIODE_PASSES; pass += 1) {
    const lin = linearise(on)
    const key = stateKey(on)
    const lu = cache.get(key) ?? luFactor(assembleMatrix(p.map, p.nl.branches, lin.g), p.map.n)
    if (!cache.has(key)) {
      if (cache.size >= LU_CACHE_LIMIT) cache.clear()
      cache.set(key, lu)
    }
    const v = expand(p.map, luSolve(lu, assembleRhs(p.map, p.nl.branches, lin, fixedV)), fixedV)
    result = { v, on, lin }
    const next = nextDiodeStates(p.nl.branches, v, on)
    if (stateKey(next) === key) break
    on = next
  }
  return result!
}

function fixedVoltages(p: Prepared, sourceV: number, otherRails: "dc" | "zero"): Float64Array {
  const v = new Float64Array(p.nl.nodeCount)
  for (const s of p.nl.supplies) v[s.idx] = otherRails === "dc" ? s.voltage : 0
  v[p.source.idx] = sourceV
  return v
}

// ---------------------------------------------------------------------------
// Transient
// ---------------------------------------------------------------------------

export interface TimeStepRequest {
  durationS: number
  periodS?: number
  minTauS?: number
  maxSteps?: number
}

export interface TimeStepChoice {
  dtS: number
  steps: number
  warnings: string[]
}

const fmtTime = (s: number): string =>
  s >= 1e-3 ? `${Number((s * 1e3).toPrecision(3))} ms` : s >= 1e-6 ? `${Number((s * 1e6).toPrecision(3))} µs` : `${Number((s * 1e9).toPrecision(3))} ns`

/** Picks dt = min(duration/MIN_STEPS, period/20, tau/10), capped by the step budget. */
export function chooseTimeStep({ durationS, periodS, minTauS, maxSteps = MAX_STEPS }: TimeStepRequest): TimeStepChoice {
  const targets = [durationS / MIN_STEPS, periodS ? periodS / 20 : Infinity, minTauS ? minTauS / 10 : Infinity]
  const ideal = Math.min(...targets)
  const steps = Math.max(1, Math.min(maxSteps, Math.ceil(durationS / ideal - 1e-9)))
  const dtS = durationS / steps
  const warnings: string[] = []
  if (periodS && dtS > periodS / 10) {
    warnings.push(`Kurang dari 10 titik per periode sinyal (langkah ${fmtTime(dtS)}) — perpendek durasi agar gelombang tidak ter-alias.`)
  }
  if (minTauS && dtS > minTauS / 2) {
    warnings.push(`Konstanta waktu terkecil (${fmtTime(minTauS)}) lebih pendek dari langkah ${fmtTime(dtS)} — perpendek durasi untuk melihat transien cepat.`)
  }
  return { dtS, steps, warnings }
}

interface TimeScales {
  minTauS?: number
  hasLC: boolean
}

/** Estimates the fastest RC, L/R and LC time scales from components sharing a node. */
function estimateTimeScales(branches: readonly NetlistBranch[]): TimeScales {
  const touches = (x: NetlistBranch, y: NetlistBranch) => x.a === y.a || x.a === y.b || x.b === y.a || x.b === y.b
  const resistors = branches.filter((b) => b.kind === "R")
  const caps = branches.filter((b) => b.kind === "C")
  const inds = branches.filter((b) => b.kind === "L")
  const adjR = (x: NetlistBranch) => resistors.filter((r) => touches(r, x)).map((r) => r.value)
  const rc = caps.flatMap((c) => (adjR(c).length ? [c.value * Math.min(...adjR(c))] : []))
  const lr = inds.flatMap((l) => (adjR(l).length ? [l.value / Math.max(...adjR(l))] : []))
  // LC ringing period / (2*pi) keeps the same "tau / 10" resolution rule.
  const lc = caps.flatMap((c) => inds.filter((l) => touches(l, c)).map((l) => Math.sqrt(l.value * c.value)))
  const all = [...rc, ...lr, ...lc].filter((t) => t > 0 && Number.isFinite(t))
  return { minTauS: all.length ? Math.min(...all) : undefined, hasLC: caps.length > 0 && inds.length > 0 }
}

export interface TransientOptions {
  sourceRail?: string
  waveform?: "step" | "sine" | "pulse"
  /** Defaults to the DC voltage of the source rail. */
  amplitudeV?: number
  frequencyHz?: number
  durationMs?: number
}

export interface TransientResult extends SimMessages {
  timesMs: number[]
  signals: Record<string, number[]>
  nodeLabels: string[]
  sourceLabel: string
  dtMs?: number
}

function sourceAt(wave: NonNullable<TransientOptions["waveform"]>, amp: number, freq: number, k: number, tSec: number): number {
  if (wave === "step") return k === 0 ? 0 : amp
  if (wave === "sine") return amp * 0.5 * (1 + Math.sin(2 * Math.PI * freq * tSec))
  return Math.sin(2 * Math.PI * freq * tSec) >= 0 ? amp : 0
}

function transientLineariser(branches: readonly NetlistBranch[], dt: number, vPrev: Float64Array, iL: Float64Array) {
  return (on: readonly boolean[]): Linearised => {
    const g = new Float64Array(branches.length)
    const ieq = new Float64Array(branches.length)
    branches.forEach((br, k) => {
      if (br.kind === "R") g[k] = 1 / Math.max(1e-3, br.value)
      else if (br.kind === "C") {
        g[k] = br.value / dt
        ieq[k] = g[k] * (vPrev[br.a] - vPrev[br.b])
      } else if (br.kind === "L") {
        g[k] = dt / Math.max(1e-12, br.value)
        ieq[k] = -iL[k]
      } else [g[k], ieq[k]] = diodeLinear(br, on[k])
    })
    return { g, ieq }
  }
}

function transientNotes(p: Prepared, scales: TimeScales): string[] {
  const notes = p.nl.supplies.length > 1 ? ["Rail daya selain sumber ditahan pada tegangan DC-nya."] : []
  if (scales.hasLC) {
    notes.push("Metode backward-Euler meredam osilasi LC: ringing tampak lebih kecil dan lebih cepat hilang dibanding rangkaian nyata.")
  }
  if (p.nl.branches.some((b) => b.kind === "D")) {
    notes.push(`LED/dioda dimodelkan piecewise-linear (Vf + ${DIODE_RON}Ω saat menyala, terbuka saat mati).`)
  }
  return notes
}

const emptyTransient = (messages: SimMessages): TransientResult => ({ ...messages, timesMs: [], signals: {}, nodeLabels: [], sourceLabel: "" })

/** Runs a backward-Euler time-domain transient simulation (oscilloscope). */
export function runTransientSim(circuitJson: readonly unknown[], opts: TransientOptions = {}): TransientResult {
  const prep = prepare(circuitJson, opts.sourceRail, "transien")
  if (!prep.ok) return emptyTransient(prep.messages)
  const p = prep.value
  const wave = opts.waveform ?? "step"
  const amp = opts.amplitudeV ?? p.source.voltage
  const freq = Math.max(1e-3, opts.frequencyHz ?? 1000)
  const requestedMs = opts.durationMs ?? 5
  const durationMs = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, requestedMs))
  const scales = estimateTimeScales(p.nl.branches)
  const maxSteps = Math.max(MIN_STEPS, Math.min(MAX_STEPS, Math.floor(STEP_WORK_BUDGET / Math.max(1, p.map.n * p.map.n))))
  const step = chooseTimeStep({ durationS: durationMs / 1000, periodS: wave === "step" ? undefined : 1 / freq, minTauS: scales.minTauS, maxSteps })
  const durationWarn = durationMs !== requestedMs ? [`Durasi dibatasi ke ${durationMs} ms (rentang ${MIN_DURATION_MS}–${MAX_DURATION_MS} ms).`] : []

  const B = p.nl.branches.length
  let vPrev: Float64Array = new Float64Array(p.nl.nodeCount)
  let iL: Float64Array = new Float64Array(B)
  let on: boolean[] = new Array<boolean>(B).fill(false)
  const cache = new Map<string, LuFactors>()
  const stride = Math.max(1, Math.ceil((step.steps + 1) / MAX_OUTPUT_POINTS))
  const timesMs: number[] = []
  const signals: Record<string, number[]> = Object.fromEntries(p.nl.labels.map((l) => [l, [] as number[]]))

  for (let k = 0; k <= step.steps; k += 1) {
    const tSec = k * step.dtS
    const fixedV = fixedVoltages(p, sourceAt(wave, amp, freq, k, tSec), "dc")
    const solved = solveWithDiodes(p, transientLineariser(p.nl.branches, step.dtS, vPrev, iL), fixedV, on, cache)
    iL = Float64Array.from(iL, (prev, j) => {
      const br = p.nl.branches[j]
      return br.kind === "L" ? solved.lin.g[j] * (solved.v[br.a] - solved.v[br.b]) - solved.lin.ieq[j] : prev
    })
    vPrev = solved.v
    on = solved.on
    if (k % stride !== 0 && k !== step.steps) continue
    timesMs.push(Number((tSec * 1000).toPrecision(6)))
    p.nl.labels.forEach((lbl, idx) => signals[lbl].push(Number(solved.v[idx].toFixed(4))))
  }

  return {
    ...p.messages,
    warnings: [...p.messages.warnings, ...durationWarn, ...step.warnings],
    notes: transientNotes(p, scales),
    timesMs,
    signals,
    nodeLabels: [...p.nl.labels],
    sourceLabel: p.source.name,
    dtMs: step.dtS * 1000,
  }
}

// ---------------------------------------------------------------------------
// AC sweep
// ---------------------------------------------------------------------------

export interface AcSweepOptions {
  sourceRail?: string
  startHz?: number
  stopHz?: number
  points?: number
  /** DC voltage of the source rail for the operating point; defaults to the rail's nominal voltage. */
  dcBiasV?: number
}

export interface AcSweepResult extends SimMessages {
  freqsHz: number[]
  magnitudeDb: Record<string, number[]>
  phaseDeg: Record<string, number[]>
  nodeLabels: string[]
  sourceLabel: string
}

function dcLineariser(branches: readonly NetlistBranch[]) {
  return (on: readonly boolean[]): Linearised => {
    const g = new Float64Array(branches.length)
    const ieq = new Float64Array(branches.length)
    branches.forEach((br, k) => {
      if (br.kind === "R") g[k] = 1 / Math.max(1e-3, br.value)
      else if (br.kind === "C") g[k] = CAP_DC_G
      else if (br.kind === "L") g[k] = INDUCTOR_DC_G
      else [g[k], ieq[k]] = diodeLinear(br, on[k])
    })
    return { g, ieq }
  }
}

/** Small-signal diode conductance at the DC operating point: open when off, Id / (n·Vt) when on. */
function diodeSmallSignal(p: Prepared, dcBiasV: number): Float64Array {
  const branches = p.nl.branches
  const op = solveWithDiodes(p, dcLineariser(branches), fixedVoltages(p, dcBiasV, "dc"), new Array<boolean>(branches.length).fill(false), new Map())
  return Float64Array.from(branches, (br, k) => {
    if (br.kind !== "D" || !op.on[k]) return DIODE_GOFF
    const id = (op.v[br.a] - op.v[br.b] - br.value) / DIODE_RON
    return id > 0 ? Math.min(MAX_DIODE_SMALL_SIGNAL_G, id / N_VT) : DIODE_GOFF
  })
}

function branchAdmittance(br: NetlistBranch, omega: number, gDiode: number): [number, number] {
  if (br.kind === "R") return [1 / Math.max(1e-3, br.value), 0]
  if (br.kind === "C") return [0, omega * br.value]
  if (br.kind === "L") return [0, -1 / Math.max(1e-12, omega * br.value)]
  return [gDiode, 0]
}

/** Solves node phasors for a 1V AC excitation at the source node (other rails are AC ground). */
function solveAcPoint(p: Prepared, omega: number, gDiode: Float64Array): { re: Float64Array; im: Float64Array } {
  const { unknownOf, n } = p.map
  const aRe = new Float64Array(n * n)
  const aIm = new Float64Array(n * n)
  const bRe = new Float64Array(n)
  const bIm = new Float64Array(n)
  for (let i = 0; i < n; i += 1) aRe[i * n + i] = GMIN
  p.nl.branches.forEach((br, k) => {
    if (br.a === br.b) return
    const [yr, yi] = branchAdmittance(br, omega, gDiode[k])
    for (const [x, y] of [[br.a, br.b], [br.b, br.a]] as const) {
      const ux = unknownOf[x]
      if (ux < 0) continue
      aRe[ux * n + ux] += yr
      aIm[ux * n + ux] += yi
      const uy = unknownOf[y]
      if (uy >= 0) {
        aRe[ux * n + uy] -= yr
        aIm[ux * n + uy] -= yi
      } else if (y === p.source.idx) {
        // Source phasor is 1 + 0j, so the coupling term is just y.
        bRe[ux] += yr
        bIm[ux] += yi
      }
    }
  })
  const x = solveComplex(aRe, aIm, { re: bRe, im: bIm }, n)
  const fixedRe = Float64Array.from({ length: p.nl.nodeCount }, (_, i) => (i === p.source.idx ? 1 : 0))
  return {
    re: Float64Array.from(fixedRe, (v, i) => (unknownOf[i] >= 0 ? x.re[unknownOf[i]] : v)),
    im: Float64Array.from(fixedRe, (_, i) => (unknownOf[i] >= 0 ? x.im[unknownOf[i]] : 0)),
  }
}

function acRange(opts: AcSweepOptions): { startHz: number; stopHz: number; points: number; warnings: string[] } {
  const startHz = Math.max(MIN_AC_HZ, opts.startHz ?? 10)
  const requestedStop = opts.stopHz ?? 1_000_000
  const stopHz = Math.max(startHz * AC_MIN_SPAN, requestedStop)
  const warnings =
    stopHz !== requestedStop
      ? [`Frekuensi akhir dinaikkan ke ${Number(stopHz.toPrecision(4))} Hz (minimal ${AC_MIN_SPAN}× frekuensi awal).`]
      : []
  const points = Math.max(MIN_AC_POINTS, Math.min(MAX_AC_POINTS, opts.points ?? 60))
  return { startHz, stopHz, points, warnings }
}

const emptyAc = (messages: SimMessages): AcSweepResult => ({ ...messages, freqsHz: [], magnitudeDb: {}, phaseDeg: {}, nodeLabels: [], sourceLabel: "" })

/** Runs a small-signal AC frequency sweep (Bode magnitude dB & phase deg). */
export function runAcSweepSim(circuitJson: readonly unknown[], opts: AcSweepOptions = {}): AcSweepResult {
  const prep = prepare(circuitJson, opts.sourceRail, "AC sweep")
  if (!prep.ok) return emptyAc(prep.messages)
  const p = prep.value
  const range = acRange(opts)
  const gDiode = diodeSmallSignal(p, opts.dcBiasV ?? p.source.voltage)
  const magnitudeDb: Record<string, number[]> = Object.fromEntries(p.nl.labels.map((l) => [l, [] as number[]]))
  const phaseDeg: Record<string, number[]> = Object.fromEntries(p.nl.labels.map((l) => [l, [] as number[]]))
  const freqsHz: number[] = []
  const logStart = Math.log10(range.startHz)
  const logStop = Math.log10(range.stopHz)

  for (let k = 0; k < range.points; k += 1) {
    const freq = 10 ** (logStart + ((logStop - logStart) * k) / (range.points - 1))
    const v = solveAcPoint(p, 2 * Math.PI * freq, gDiode)
    freqsHz.push(Number(freq.toPrecision(4)))
    p.nl.labels.forEach((lbl, idx) => {
      const mag = Math.max(DB_FLOOR_MAG, Math.hypot(v.re[idx], v.im[idx]))
      magnitudeDb[lbl].push(Number((20 * Math.log10(mag)).toFixed(2)))
      phaseDeg[lbl].push(Number(((Math.atan2(v.im[idx], v.re[idx]) * 180) / Math.PI).toFixed(1)))
    })
  }

  const notes = p.nl.branches.some((b) => b.kind === "D")
    ? ["LED/dioda dilinearkan pada titik kerja DC: dioda mati = terbuka, dioda menyala = konduktansi sinyal kecil Id/(n·Vt)."]
    : []
  return {
    ...p.messages,
    warnings: [...p.messages.warnings, ...range.warnings],
    notes,
    freqsHz,
    magnitudeDb,
    phaseDeg,
    nodeLabels: [...p.nl.labels],
    sourceLabel: p.source.name,
  }
}

// ---------------------------------------------------------------------------
// DC sweep
// ---------------------------------------------------------------------------

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
