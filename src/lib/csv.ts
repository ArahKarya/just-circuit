/** Characters that make spreadsheet apps evaluate a cell as a formula (CSV injection). */
const FORMULA_START = /^[=+\-@\t\r]/
const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/

/** Quotes one CSV cell; a formula-looking value gets a leading apostrophe so it stays text. */
export function csvCell(value: unknown): string {
  const text = String(value ?? "")
  const safe = FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

/** Serialises rows to CSV with every cell quoted and neutralised. */
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\n")
}
