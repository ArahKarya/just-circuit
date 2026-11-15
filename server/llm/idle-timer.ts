export interface IdleTimer {
  /** Call whenever data arrives. */
  touch: () => void
  stop: () => void
}

/**
 * Calls `onIdle` once if no data arrives in time: `firstMs` for the first
 * chunk (reasoning models may think silently for minutes), then `idleMs`
 * between chunks.
 */
export function createIdleTimer(idleMs: number, onIdle: (phase: "first" | "between") => void, firstMs: number = idleMs): IdleTimer {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  let received = false
  const arm = (ms: number) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (!stopped) {
        stopped = true
        onIdle(received ? "between" : "first")
      }
    }, ms)
  }
  arm(firstMs)
  return {
    touch: () => {
      if (stopped) return
      received = true
      arm(idleMs)
    },
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
