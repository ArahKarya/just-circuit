/**
 * Pure TypeScript PCB Engineering Calculators (KiCad PCB Calculator equivalent).
 * Includes IPC-2221 trace ampacity/width, via current, microstrip & differential
 * impedance, E24 voltage divider, LED current limiter, voltage clearance, and RC/LC filter.
 */

export const E24_SERIES = [
  1.0, 1.1, 1.2, 1.3, 1.5, 1.6, 1.8, 2.0, 2.2, 2.4, 2.7, 3.0,
  3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1,
] as const

const MILS_PER_MM = 39.37007874
/** 1 oz/ft^2 copper thickness in mils (~35 um). */
const MILS_PER_OZ = 1.378
const COPPER_RESISTIVITY_OHM_CM = 1.724e-6

/** Rounds a resistance value to the nearest E24 standard resistor (ohms). */
export function nearestE24(ohms: number): number {
  if (!Number.isFinite(ohms) || ohms <= 0) return 100
  const exp = Math.floor(Math.log10(ohms))
  const base = 10 ** exp
  let best = E24_SERIES[0] * base
  let bestErr = Math.abs(best - ohms)
  for (const decade of [base, base * 10]) {
    for (const v of E24_SERIES) {
      const cand = v * decade
      const err = Math.abs(cand - ohms)
      if (err < bestErr) {
        bestErr = err
        best = cand
      }
    }
  }
  return Number(best.toPrecision(3))
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
  r1Ohms: number
  r2Ohms: number
  r1Label: string
  r2Label: string
  actualVout: number
  errorPercent: number
  currentMa: number
}

/** Finds the closest E24 resistor pair (R1 top, R2 bottom) for a target voltage divider. */
export function calcVoltageDivider(vin: number, targetVout: number, r2BaseOhms = 10_000): DividerResult {
  const safeVin = Math.max(0.01, vin)
  const safeVout = Math.max(0.001, Math.min(safeVin - 0.001, targetVout))
  const targetRatio = safeVout / safeVin
  const r2 = nearestE24(Math.max(10, r2BaseOhms))
  const idealR1 = r2 * (1 / targetRatio - 1)
  const r1 = nearestE24(idealR1)
  const actualVout = safeVin * (r2 / (r1 + r2))
  const errorPercent = ((actualVout - safeVout) / safeVout) * 100
  const currentMa = (safeVin / (r1 + r2)) * 1000
  return {
    r1Ohms: r1,
    r2Ohms: r2,
    r1Label: formatResistance(r1),
    r2Label: formatResistance(r2),
    actualVout: Number(actualVout.toFixed(4)),
    errorPercent: Number(errorPercent.toFixed(2)),
    currentMa: Number(currentMa.toFixed(3)),
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

/** Calculates series current-limiting resistor and wattage for an LED. */
export function calcLedResistor(vSupply: number, vForward: number, targetMa: number): LedResistorResult {
  const vDrop = Math.max(0.05, vSupply - vForward)
  const iA = Math.max(0.0005, targetMa / 1000)
  const idealOhms = vDrop / iA
  const standardOhms = nearestE24(idealOhms)
  const actualCurrentA = vDrop / standardOhms
  const powerMw = vDrop * actualCurrentA * 1000
  const recommendedPackage = powerMw <= 40 ? "0402" : powerMw <= 70 ? "0603" : powerMw <= 100 ? "0805" : powerMw <= 200 ? "1206" : "2512"
  return {
    idealOhms: Number(idealOhms.toFixed(1)),
    standardOhms,
    standardLabel: formatResistance(standardOhms),
    actualCurrentMa: Number((actualCurrentA * 1000).toFixed(2)),
    powerMw: Number(powerMw.toFixed(2)),
    recommendedPackage,
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
