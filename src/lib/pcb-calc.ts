/**
 * Pure TypeScript PCB Engineering Calculators (KiCad PCB Calculator equivalent).
 * Includes IPC-2221 trace ampacity/width, via current, microstrip & differential
 * impedance, E24/E96 voltage divider, LED current limiter, voltage clearance, and RC/LC filter.
 */

export const E24_SERIES = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,
  3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
] as const

const MILS_PER_MM = 39.37007874
/** 1 oz/ft^2 copper thickness in mils (~35 um). */
const MILS_PER_OZ = 1.378
const COPPER_RESISTIVITY_OHM_CM = 1.724e-6

/** E96 (1%) values: 10^(i/96) rounded to three significant figures. */
export const E96_SERIES: readonly number[] = Array.from({ length: 96 }, (_, i) => Number((10 ** (i / 96)).toPrecision(3)))

export type ResistorSeries = "E24" | "E96"

/** Failed calculation: the inputs cannot produce a physically meaningful result. */
export interface CalcError {
  ok: false
  error: string
}

export type CalcResult<T> = ({ ok: true } & T) | CalcError

const seriesValues = (series: ResistorSeries): readonly number[] => (series === "E96" ? E96_SERIES : E24_SERIES)

/** Standard values of a series between 1 ohm and ~10 Mohm (decades 10^0..10^6). */
function seriesTable(series: ResistorSeries): readonly number[] {
  return [0, 1, 2, 3, 4, 5, 6].flatMap((exp) => seriesValues(series).map((v) => Number((v * 10 ** exp).toPrecision(3))))
}

/** Rounds a resistance to the nearest standard value of the series, or null for non-positive input. */
export function nearestInSeries(ohms: number, series: ResistorSeries = "E24"): number | null {
  if (!Number.isFinite(ohms) || ohms <= 0) return null
  const exp = Math.floor(Math.log10(ohms))
  const candidates = [exp - 1, exp, exp + 1].flatMap((e) => seriesValues(series).map((v) => v * 10 ** e))
  const best = candidates.reduce((a, b) => (Math.abs(b - ohms) < Math.abs(a - ohms) ? b : a))
  return Number(best.toPrecision(3))
}

/** Rounds a resistance value to the nearest E24 standard resistor (ohms), or null for non-positive input. */
export function nearestE24(ohms: number): number | null {
  return nearestInSeries(ohms, "E24")
}

export function formatResistance(ohms: number): string {
  if (ohms >= 1e6) return `${Number((ohms / 1e6).toPrecision(3))}M`
  if (ohms >= 1e3) return `${Number((ohms / 1e3).toPrecision(3))}k`
  return `${Number(ohms.toPrecision(3))}`
}

export interface TraceWidthResult {
  widthMm: number
  widthMils: number
  areaMil2: number
  resistanceMOhmPerCm: number
  voltageDropMvPerCm: number
  powerLossMwPerCm: number
}

/** IPC-2221 trace width for a target DC current (A) and temperature rise (°C). */
export function calcTraceWidthIpc2221(
  currentA: number,
  tempRiseC = 10,
  ozCopper = 1,
  isInternal = false,
): TraceWidthResult {
  const I = Math.max(0.001, currentA)
  const dT = Math.max(1, tempRiseC)
  const k = isInternal ? 0.024 : 0.048
  const b = 0.44
  const c = 0.725
  const areaMil2 = Math.pow(I / (k * Math.pow(dT, b)), 1 / c)
  const thicknessMils = Math.max(0.2, ozCopper) * MILS_PER_OZ
  const widthMils = areaMil2 / thicknessMils
  const widthMm = widthMils / MILS_PER_MM
  const areaCm2 = areaMil2 * 6.4516e-6
  const tempFactor = 1 + 0.00393 * (25 + dT - 20)
  const rPerCm = (COPPER_RESISTIVITY_OHM_CM * tempFactor) / Math.max(1e-9, areaCm2)
  return {
    widthMm: Number(widthMm.toFixed(3)),
    widthMils: Number(widthMils.toFixed(2)),
    areaMil2: Number(areaMil2.toFixed(2)),
    resistanceMOhmPerCm: Number((rPerCm * 1000).toFixed(3)),
    voltageDropMvPerCm: Number((rPerCm * I * 1000).toFixed(3)),
    powerLossMwPerCm: Number((rPerCm * I * I * 1000).toFixed(3)),
  }
}

/** Inverse IPC-2221: maximum safe DC current (A) for a given trace width (mm). */
export function calcTraceMaxCurrent(
  widthMm: number,
  tempRiseC = 10,
  ozCopper = 1,
  isInternal = false,
): number {
  const widthMils = Math.max(0.5, widthMm * MILS_PER_MM)
  const thicknessMils = Math.max(0.2, ozCopper) * MILS_PER_OZ
  const areaMil2 = widthMils * thicknessMils
  const k = isInternal ? 0.024 : 0.048
  const currentA = k * Math.pow(Math.max(1, tempRiseC), 0.44) * Math.pow(areaMil2, 0.725)
  return Number(currentA.toFixed(3))
}

export interface ViaCurrentResult {
  maxCurrentA: number
  resistanceMOhm: number
  areaMil2: number
}

/** IPC-2221 via current capacity and DC resistance for a plated through-hole via. */
export function calcViaCurrent(
  holeDiameterMm: number,
  platingUm = 25,
  boardThicknessMm = 1.6,
  tempRiseC = 10,
): ViaCurrentResult {
  const dMm = Math.max(0.1, holeDiameterMm)
  const tMm = Math.max(0.005, platingUm / 1000)
  const areaMm2 = Math.PI * (dMm + tMm) * tMm
  const areaMil2 = areaMm2 * MILS_PER_MM * MILS_PER_MM
  const maxCurrentA = 0.048 * Math.pow(Math.max(1, tempRiseC), 0.44) * Math.pow(areaMil2, 0.725)
  const areaCm2 = areaMm2 / 100
  const lengthCm = Math.max(0.02, boardThicknessMm / 10)
  const resistanceMOhm = ((COPPER_RESISTIVITY_OHM_CM * lengthCm) / areaCm2) * 1000
  return {
    maxCurrentA: Number(maxCurrentA.toFixed(3)),
    resistanceMOhm: Number(resistanceMOhm.toFixed(3)),
    areaMil2: Number(areaMil2.toFixed(2)),
  }
}

export interface ImpedanceResult {
  z0Ohms: number
  erEff: number
  delayPsPerMm: number
}

/** IPC-2141 / Hammerstad-Jensen outer-layer microstrip characteristic impedance. */
export function calcMicrostripImpedance(widthMm: number, heightMm: number, copperMm = 0.035, er = 4.4): ImpedanceResult {
  const w = Math.max(0.05, widthMm)
  const h = Math.max(0.03, heightMm)
  const t = Math.max(0.005, copperMm)
  const we = w + (t / Math.PI) * Math.log((4 * Math.E) / Math.sqrt((t / h) ** 2 + Math.pow(1 / Math.PI / (w / t + 1.1), 2)))
  const u = we / h
  const erEff = (er + 1) / 2 + ((er - 1) / 2) * Math.pow(1 + 12 / u, -0.5)
  const z0 =
    u <= 1
      ? (60 / Math.sqrt(erEff)) * Math.log(8 / u + u / 4)
      : (120 * Math.PI) / (Math.sqrt(erEff) * (u + 1.393 + 0.667 * Math.log(u + 1.444)))
  const delayPsPerMm = (Math.sqrt(erEff) / 299.792458) * 1000
  return {
    z0Ohms: Number(z0.toFixed(2)),
    erEff: Number(erEff.toFixed(3)),
    delayPsPerMm: Number(delayPsPerMm.toFixed(2)),
  }
}

export interface DiffPairImpedanceResult {
  zDiffOhms: number
  zOddOhms: number
  z0Ohms: number
}

/** Edge-coupled microstrip differential pair impedance approximation. */
export function calcDiffPairImpedance(
  widthMm: number,
  spacingMm: number,
  heightMm: number,
  copperMm = 0.035,
  er = 4.4,
): DiffPairImpedanceResult {
  const single = calcMicrostripImpedance(widthMm, heightMm, copperMm, er)
  const s = Math.max(0.05, spacingMm)
  const h = Math.max(0.03, heightMm)
  const coupling = 0.48 * Math.exp(-0.96 * (s / h))
  const zDiff = 2 * single.z0Ohms * (1 - coupling)
  return {
    zDiffOhms: Number(zDiff.toFixed(2)),
    zOddOhms: Number((zDiff / 2).toFixed(2)),
    z0Ohms: single.z0Ohms,
  }
}

export interface DividerResult {
  series: ResistorSeries
  r1Ohms: number
  r2Ohms: number
  r1Label: string
  r2Label: string
  actualVout: number
  errorPercent: number
  currentMa: number
}

interface DividerPair {
  r1: number
  r2: number
  ratioErr: number
  scaleErr: number
}

function validateDivider(vin: number, targetVout: number, r2BaseOhms: number): CalcError | null {
  if (!Number.isFinite(vin) || vin <= 0) return { ok: false, error: "Vin harus lebih dari 0 V." }
  if (!Number.isFinite(targetVout) || targetVout <= 0) return { ok: false, error: "Vout harus lebih dari 0 V." }
  if (targetVout >= vin) {
    return { ok: false, error: "Vout harus lebih kecil dari Vin — pembagi resistif tidak bisa menaikkan tegangan." }
  }
  if (!Number.isFinite(r2BaseOhms) || r2BaseOhms <= 0) return { ok: false, error: "Skala R2 harus lebih dari 0 Ω." }
  return null
}

/** Picks the pair with the smallest ratio error, breaking ties by closeness of R2 to the requested scale. */
function isBetterPair(a: DividerPair, b: DividerPair): boolean {
  const tol = 1e-9
  if (a.ratioErr < b.ratioErr - tol) return true
  return Math.abs(a.ratioErr - b.ratioErr) <= tol && a.scaleErr < b.scaleErr
}

function searchDividerPair(targetRatio: number, r2BaseOhms: number, series: ResistorSeries): DividerPair {
  const table = seriesTable(series)
  // R2 stays within half a decade of the requested scale so the divider current stays as intended.
  const r2Candidates = table.filter((v) => Math.abs(Math.log10(v / r2BaseOhms)) <= 0.5)
  const r2List = r2Candidates.length > 0 ? r2Candidates : [nearestInSeries(r2BaseOhms, series) ?? r2BaseOhms]
  let best: DividerPair | null = null
  for (const r2 of r2List) {
    for (const r1 of table) {
      const cand: DividerPair = {
        r1,
        r2,
        ratioErr: Math.abs(r2 / (r1 + r2) - targetRatio),
        scaleErr: Math.abs(Math.log10(r2 / r2BaseOhms)),
      }
      if (!best || isBetterPair(cand, best)) best = cand
    }
  }
  return best!
}

/** Searches all standard R1 (top) / R2 (bottom) pairs for the closest divider ratio. */
export function calcVoltageDivider(
  vin: number,
  targetVout: number,
  r2BaseOhms = 10_000,
  series: ResistorSeries = "E24",
): CalcResult<DividerResult> {
  const invalid = validateDivider(vin, targetVout, r2BaseOhms)
  if (invalid) return invalid
  const { r1, r2 } = searchDividerPair(targetVout / vin, r2BaseOhms, series)
  const actualVout = vin * (r2 / (r1 + r2))
  return {
    ok: true,
    series,
    r1Ohms: r1,
    r2Ohms: r2,
    r1Label: formatResistance(r1),
    r2Label: formatResistance(r2),
    actualVout: Number(actualVout.toFixed(4)),
    errorPercent: Number((((actualVout - targetVout) / targetVout) * 100).toFixed(2)),
    currentMa: Number(((vin / (r1 + r2)) * 1000).toFixed(3)),
  }
}

export interface LedResistorResult {
  idealOhms: number
  standardOhms: number
  standardLabel: string
  actualCurrentMa: number
  powerMw: number
  recommendedPackage: string
}

const packageForPower = (powerMw: number): string =>
  powerMw <= 40 ? "0402" : powerMw <= 70 ? "0603" : powerMw <= 100 ? "0805" : powerMw <= 200 ? "1206" : "2512"

/** Calculates series current-limiting resistor and wattage for an LED. */
export function calcLedResistor(
  vSupply: number,
  vForward: number,
  targetMa: number,
  series: ResistorSeries = "E24",
): CalcResult<LedResistorResult> {
  if (!Number.isFinite(vForward) || vForward < 0) return { ok: false, error: "Vf LED tidak boleh negatif." }
  if (!Number.isFinite(vSupply) || vSupply <= vForward) {
    return { ok: false, error: "Tegangan suplai (Vs) harus lebih besar dari Vf LED agar LED bisa menyala." }
  }
  if (!Number.isFinite(targetMa) || targetMa <= 0) return { ok: false, error: "Target arus harus lebih dari 0 mA." }
  const vDrop = vSupply - vForward
  const idealOhms = vDrop / (targetMa / 1000)
  const standardOhms = nearestInSeries(idealOhms, series)
  if (standardOhms === null) return { ok: false, error: "Resistor ideal tidak valid." }
  const actualCurrentA = vDrop / standardOhms
  const powerMw = vDrop * actualCurrentA * 1000
  return {
    ok: true,
    idealOhms: Number(idealOhms.toFixed(1)),
    standardOhms,
    standardLabel: formatResistance(standardOhms),
    actualCurrentMa: Number((actualCurrentA * 1000).toFixed(2)),
    powerMw: Number(powerMw.toFixed(2)),
    recommendedPackage: packageForPower(powerMw),
  }
}

export interface ClearanceResult {
  externalUncoatedMm: number
  externalCoatedMm: number
  internalMm: number
}

/** IPC-2221 Table 6-1 minimum conductor spacing by peak voltage (V). */
export function calcVoltageClearanceIpc2221(peakVoltageV: number): ClearanceResult {
  const v = Math.max(0, peakVoltageV)
  if (v <= 15) return { externalUncoatedMm: 0.1, externalCoatedMm: 0.05, internalMm: 0.05 }
  if (v <= 30) return { externalUncoatedMm: 0.1, externalCoatedMm: 0.05, internalMm: 0.05 }
  if (v <= 50) return { externalUncoatedMm: 0.6, externalCoatedMm: 0.13, internalMm: 0.1 }
  if (v <= 100) return { externalUncoatedMm: 0.6, externalCoatedMm: 0.13, internalMm: 0.1 }
  if (v <= 150) return { externalUncoatedMm: 0.6, externalCoatedMm: 0.4, internalMm: 0.2 }
  if (v <= 170) return { externalUncoatedMm: 1.25, externalCoatedMm: 0.4, internalMm: 0.2 }
  if (v <= 250) return { externalUncoatedMm: 1.25, externalCoatedMm: 0.4, internalMm: 0.2 }
  if (v <= 300) return { externalUncoatedMm: 1.25, externalCoatedMm: 0.4, internalMm: 0.2 }
  if (v <= 500) return { externalUncoatedMm: 2.5, externalCoatedMm: 0.8, internalMm: 0.25 }
  const extra = v - 500
  return {
    externalUncoatedMm: Number((2.5 + extra * 0.005).toFixed(2)),
    externalCoatedMm: Number((0.8 + extra * 0.00305).toFixed(2)),
    internalMm: Number((0.25 + extra * 0.0025).toFixed(2)),
  }
}

export interface RcFilterResult {
  cutoffHz: number
  tauMs: number
}

/** Calculates first-order RC filter -3dB cutoff frequency and time constant. */
export function calcRcFilter(resistanceOhms: number, capacitanceNf: number): RcFilterResult {
  const r = Math.max(0.1, resistanceOhms)
  const c = Math.max(1e-15, capacitanceNf * 1e-9)
  const cutoffHz = 1 / (2 * Math.PI * r * c)
  const tauMs = r * c * 1000
  return {
    cutoffHz: Number(cutoffHz.toFixed(2)),
    tauMs: Number(tauMs.toFixed(4)),
  }
}
