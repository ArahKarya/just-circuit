import { useEffect, useRef, useState } from "react"

/** Topics that cached server data belongs to; writers announce changes so readers refetch. */
type Listener = () => void
const listeners = new Map<string, Set<Listener>>()

export function notifyChange(...topics: string[]): void {
  for (const topic of topics) listeners.get(topic)?.forEach((listener) => listener())
}

function subscribe(topic: string, listener: Listener): () => void {
  const set = listeners.get(topic) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(topic, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(topic)
  }
}

export interface LiveData<T> {
  data: T | undefined
  error: Error | null
}

/**
 * Loads server data and reloads it whenever one of `topics` changes
 * (the server-backed replacement for Dexie's useLiveQuery).
 */
export function useLiveData<T>(load: (() => Promise<T>) | null, topics: readonly string[]): LiveData<T> {
  const [state, setState] = useState<LiveData<T>>({ data: undefined, error: null })
  const loadRef = useRef(load)
  loadRef.current = load
  const key = topics.join("|")
  const enabled = load !== null

  useEffect(() => {
    if (!enabled) {
      setState({ data: undefined, error: null })
      return
    }
    let generation = 0
    const refresh = () => {
      const current = ++generation
      loadRef.current?.()
        .then((data) => current === generation && setState({ data, error: null }))
        .catch((error: unknown) => current === generation && setState((prev) => ({ data: prev.data, error: error instanceof Error ? error : new Error(String(error)) })))
    }
    setState({ data: undefined, error: null })
    refresh()
    const unsubscribers = key.split("|").map((topic) => subscribe(topic, refresh))
    return () => {
      generation = -1
      unsubscribers.forEach((unsubscribe) => unsubscribe())
    }
  }, [key, enabled])

  return state
}
