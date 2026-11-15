import { afterEach, describe, expect, it, vi } from "vitest"
import { createIdleTimer } from "./idle-timer"

afterEach(() => vi.useRealTimers())

describe("createIdleTimer", () => {
  it("fires once after the idle period", () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    createIdleTimer(1000, onIdle)
    vi.advanceTimersByTime(999)
    expect(onIdle).not.toHaveBeenCalled()
    vi.advanceTimersByTime(5000)
    expect(onIdle).toHaveBeenCalledTimes(1)
  })

  it("is postponed by touch and cancelled by stop", () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    const timer = createIdleTimer(1000, onIdle)
    vi.advanceTimersByTime(800)
    timer.touch()
    vi.advanceTimersByTime(800)
    expect(onIdle).not.toHaveBeenCalled()
    timer.stop()
    vi.advanceTimersByTime(5000)
    expect(onIdle).not.toHaveBeenCalled()
  })
})
