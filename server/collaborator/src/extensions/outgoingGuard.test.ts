// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { guardOutgoingMessages } from './outgoingGuard'

test('does not send updates when read access is revoked', async () => {
  const send = jest.fn()
  const close = jest.fn()
  const connection = { send, close }
  const allowed = jest.fn().mockResolvedValue(false)
  guardOutgoingMessages(connection, allowed)
  connection.send('private update')
  await new Promise((resolve) => setImmediate(resolve))
  expect(send).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1)
})
test('sends authorized updates in order and closes on lookup failure', async () => {
  const send = jest.fn()
  const close = jest.fn()
  const connection = { send, close }
  const allowed = jest
    .fn()
    .mockResolvedValueOnce(true)
    .mockResolvedValueOnce(true)
    .mockRejectedValueOnce(new Error('offline'))
  guardOutgoingMessages(connection, allowed)
  connection.send('first')
  connection.send('second')
  connection.send('third')
  await new Promise((resolve) => setImmediate(resolve))
  expect(send.mock.calls).toEqual([['first'], ['second']])
  expect(close).toHaveBeenCalledTimes(1)
})
