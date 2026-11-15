export interface IdleTimer {
  /** Call whenever data arrives. */
  touch: () => void
  stop: () => void
}

/** Calls `onIdle` once if `touch` is not called for `idleMs`. */
export function createIdleTimer(idleMs: number, onIdle: () => void): IdleTimer {
  let timer: ReturnType<typeof setTimeout> | null = null
  let stopped = false
  const arm = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (!stopped) {
        stopped = true
        onIdle()
      }
    }, idleMs)
  }
  arm()
  return {
    touch: () => {
      if (!stopped) arm()
    },
    stop: () => {
      stopped = true
      if (timer) clearTimeout(timer)
    },
  }
}
