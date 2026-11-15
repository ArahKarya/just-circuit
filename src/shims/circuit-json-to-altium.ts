/**
 * Altium export ships only as a git-hosted package that needs a Bun build step,
 * so CDS replaces it with this stub. Every other export format still works.
 */
export async function convertCircuitJsonToAltiumZip(): Promise<Uint8Array> {
  throw new Error("Ekspor Altium belum didukung di Circuit Design Studio. Pakai ekspor KiCad lalu impor ke Altium.")
}
