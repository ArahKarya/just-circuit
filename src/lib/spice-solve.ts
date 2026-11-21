/**
 * Dense linear solvers on flat Float64Arrays (row-major) for the SPICE engine.
 * Inputs are copied; callers' arrays are never modified.
 */

const PIVOT_EPS = 1e-18

export interface LuFactors {
  readonly n: number
  readonly lu: Float64Array
  readonly perm: Int32Array
}

/** LU factorisation with partial pivoting; reused across time steps while the matrix is unchanged. */
export function luFactor(matrix: Float64Array, n: number): LuFactors {
  const lu = Float64Array.from(matrix)
  const perm = Int32Array.from({ length: n }, (_, i) => i)
  for (let col = 0; col < n; col += 1) {
    let pivotRow = col
    let maxVal = Math.abs(lu[col * n + col])
    for (let r = col + 1; r < n; r += 1) {
      const v = Math.abs(lu[r * n + col])
      if (v > maxVal) {
        maxVal = v
        pivotRow = r
      }
    }
    if (maxVal < PIVOT_EPS) continue
    if (pivotRow !== col) swapRows(lu, perm, n, col, pivotRow)
    const pivot = lu[col * n + col]
    for (let r = col + 1; r < n; r += 1) {
      const f = lu[r * n + col] / pivot
      lu[r * n + col] = f
      if (f === 0) continue
      for (let c = col + 1; c < n; c += 1) lu[r * n + c] -= f * lu[col * n + c]
    }
  }
  return { n, lu, perm }
}

function swapRows(lu: Float64Array, perm: Int32Array, n: number, a: number, b: number): void {
  for (let c = 0; c < n; c += 1) {
    const t = lu[a * n + c]
    lu[a * n + c] = lu[b * n + c]
    lu[b * n + c] = t
  }
  const t = perm[a]
  perm[a] = perm[b]
  perm[b] = t
}

export function luSolve({ n, lu, perm }: LuFactors, rhs: Float64Array): Float64Array {
  const x = new Float64Array(n)
  for (let i = 0; i < n; i += 1) {
    let sum = rhs[perm[i]]
    for (let j = 0; j < i; j += 1) sum -= lu[i * n + j] * x[j]
    x[i] = sum
  }
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = x[i]
    for (let j = i + 1; j < n; j += 1) sum -= lu[i * n + j] * x[j]
    const d = lu[i * n + i]
    x[i] = Math.abs(d) > PIVOT_EPS ? sum / d : 0
  }
  return x
}

export interface ComplexVector {
  readonly re: Float64Array
  readonly im: Float64Array
}

/** Solves (Ar + j·Ai) x = (br + j·bi) by Gaussian elimination with partial pivoting. */
export function solveComplex(aRe: Float64Array, aIm: Float64Array, b: ComplexVector, n: number): ComplexVector {
  const mr = Float64Array.from(aRe)
  const mi = Float64Array.from(aIm)
  const br = Float64Array.from(b.re)
  const bi = Float64Array.from(b.im)
  for (let col = 0; col < n; col += 1) {
    const pivotRow = findComplexPivot(mr, mi, n, col)
    if (pivotRow < 0) continue
    if (pivotRow !== col) swapComplexRows(mr, mi, br, bi, n, col, pivotRow)
    eliminateBelow(mr, mi, br, bi, n, col)
  }
  return backSubstituteComplex(mr, mi, br, bi, n)
}

function findComplexPivot(mr: Float64Array, mi: Float64Array, n: number, col: number): number {
  let best = -1
  let bestMag = PIVOT_EPS
  for (let r = col; r < n; r += 1) {
    const mag = Math.hypot(mr[r * n + col], mi[r * n + col])
    if (mag > bestMag) {
      bestMag = mag
      best = r
    }
  }
  return best
}

function swapComplexRows(mr: Float64Array, mi: Float64Array, br: Float64Array, bi: Float64Array, n: number, a: number, b: number): void {
  for (let c = 0; c < n; c += 1) {
    const tr = mr[a * n + c]
    const ti = mi[a * n + c]
    mr[a * n + c] = mr[b * n + c]
    mi[a * n + c] = mi[b * n + c]
    mr[b * n + c] = tr
    mi[b * n + c] = ti
  }
  ;[br[a], br[b]] = [br[b], br[a]]
  ;[bi[a], bi[b]] = [bi[b], bi[a]]
}

function eliminateBelow(mr: Float64Array, mi: Float64Array, br: Float64Array, bi: Float64Array, n: number, col: number): void {
  const pr = mr[col * n + col]
  const pi = mi[col * n + col]
  const pd = pr * pr + pi * pi
  for (let r = col + 1; r < n; r += 1) {
    const xr = mr[r * n + col]
    const xi = mi[r * n + col]
    if (xr === 0 && xi === 0) continue
    // f = M[r][col] / pivot
    const fr = (xr * pr + xi * pi) / pd
    const fi = (xi * pr - xr * pi) / pd
    for (let c = col; c < n; c += 1) {
      const cr = mr[col * n + c]
      const ci = mi[col * n + c]
      mr[r * n + c] -= fr * cr - fi * ci
      mi[r * n + c] -= fr * ci + fi * cr
    }
    const sr = br[col]
    const si = bi[col]
    br[r] -= fr * sr - fi * si
    bi[r] -= fr * si + fi * sr
  }
}

function backSubstituteComplex(mr: Float64Array, mi: Float64Array, br: Float64Array, bi: Float64Array, n: number): ComplexVector {
  const xr = new Float64Array(n)
  const xi = new Float64Array(n)
  for (let i = n - 1; i >= 0; i -= 1) {
    let sr = br[i]
    let si = bi[i]
    for (let j = i + 1; j < n; j += 1) {
      const ar = mr[i * n + j]
      const ai = mi[i * n + j]
      sr -= ar * xr[j] - ai * xi[j]
      si -= ar * xi[j] + ai * xr[j]
    }
    const dr = mr[i * n + i]
    const di = mi[i * n + i]
    const d = dr * dr + di * di
    if (d < PIVOT_EPS * PIVOT_EPS) continue
    xr[i] = (sr * dr + si * di) / d
    xi[i] = (si * dr - sr * di) / d
  }
  return { re: xr, im: xi }
}
