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

  it("allows a longer wait for the first chunk", () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    const timer = createIdleTimer(1000, onIdle, 5000)
    vi.advanceTimersByTime(4000)
    expect(onIdle).not.toHaveBeenCalled()
    timer.touch()
    vi.advanceTimersByTime(1001)
    expect(onIdle).toHaveBeenCalledWith("between")
  })

  it("reports a silent start", () => {
    vi.useFakeTimers()
    const onIdle = vi.fn()
    createIdleTimer(1000, onIdle, 5000)
    vi.advanceTimersByTime(5001)
    expect(onIdle).toHaveBeenCalledWith("first")
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
