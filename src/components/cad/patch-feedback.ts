import toast from "react-hot-toast"
import type { PatchResult } from "../../lib/tsx-ast"

/** Tells the user why a visual edit could not be written to the code, instead of dropping it. */
export function reportPatchFailure(name: string, result: Exclude<PatchResult, { status: "updated" }>): void {
  if (result.status === "unsupported") {
    toast.error(`${name}: properti ${result.prop} di ${result.path} ditulis sebagai ekspresi, jadi tidak bisa diubah dari sini. Ubah langsung di editor kode.`)
  } else {
    toast.error(`${name} tidak ditemukan di kode. Mungkin baru saja diubah atau dihapus.`)
  }
}
