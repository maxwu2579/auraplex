// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.

/** Check current access before each outgoing message. Keep messages in order. */
export function guardOutgoingMessages<T> (
  connection: { send: (message: T) => void, close: () => void },
  allowed: () => Promise<boolean>,
  limit = 128
): () => void {
  const send = connection.send.bind(connection)
  let queue = Promise.resolve()
  let pending = 0
  let stopped = false
  const stop = (): void => {
    stopped = true
  }
  connection.send = (message: T): void => {
    if (stopped) return
    pending++
    if (pending > limit) {
      stop()
      connection.close()
      return
    }
    queue = queue
      .then(async () => {
        if (stopped) return
        if (!(await allowed())) {
          stop()
          connection.close()
          return
        }
        if (!stopped) send(message)
      })
      .catch(() => {
        stop()
        connection.close()
      })
      .finally(() => {
        pending--
      })
  }
  return stop
}
