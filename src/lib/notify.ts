import toast from "react-hot-toast"

export function errorText(error: unknown, fallback = "Terjadi kesalahan"): string {
  return error instanceof Error ? error.message : fallback
}

/** Runs an async UI action and shows failures as a toast instead of failing silently. */
export async function attempt(action: () => Promise<void>, fallback?: string): Promise<boolean> {
  try {
    await action()
    return true
  } catch (error) {
    toast.error(errorText(error, fallback))
    return false
  }
}
