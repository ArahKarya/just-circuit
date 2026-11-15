/** @resvg/resvg-js is a native Node addon; some tscircuit packages import it but never need it in the browser. */
export class Resvg {
  constructor() {
    throw new Error("@resvg/resvg-js tidak tersedia di browser")
  }
}
export default { Resvg }
