//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { mkdtemp, readdir, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { PersistentInbox } from '../inbox'

async function until (check: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('Queue did not reach expected state')
}

it('persists accepted events, retries failures across restart, and removes successful events', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'auraplex-wa-inbox-'))
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'auraplex-wa-inbox-')) {
    throw new Error('Unsafe test directory')
  }
  const failed = jest.fn(async () => {
    throw new Error('workspace unavailable')
  })
  const first = new PersistentInbox(directory, failed)
  const received = jest.fn(async () => {})
  const second = new PersistentInbox(directory, received)
  try {
    await first.start(20)
    await first.enqueue({ messages: [], statuses: [] })
    await until(async () => failed.mock.calls.length > 0)
    await first.close()
    expect((await readdir(directory)).filter((file) => file.endsWith('.json'))).toHaveLength(1)
    await second.start(20)
    await until(
      async () =>
        received.mock.calls.length > 0 &&
        (await readdir(directory)).filter((file) => file.endsWith('.json')).length === 0
    )
    expect(received).toHaveBeenCalledTimes(1)
  } finally {
    await first.close()
    await second.close()
    await rm(directory, { recursive: true })
  }
})

it('quarantines after five attempts across restarts, logs once, and continues processing good events', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'auraplex-wa-inbox-'))
  if (!resolve(directory).startsWith(resolve(tmpdir()) + sep + 'auraplex-wa-inbox-')) {
    throw new Error('Unsafe test directory')
  }
  const log = jest.fn()
  const consume = jest.fn(async (): Promise<void> => {
    throw new Error('removed workspace')
  })
  const first = new PersistentInbox(directory, consume, log)
  const second = new PersistentInbox(directory, consume, log)
  try {
    await first.start(60000)
    await first.enqueue({ messages: [], statuses: [] })
    await until(async () => (await readdir(directory)).some((f) => f.includes('.retry-1.')))
    await first.close()
    await second.start(20)
    await until(async () => (await readdir(join(directory, 'failed'))).length === 1)
    const attempts = consume.mock.calls.length
    expect(attempts).toBe(5)
    expect(log).toHaveBeenCalledTimes(1)
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(consume).toHaveBeenCalledTimes(attempts)
    consume.mockImplementation(async () => {})
    await second.enqueue({ messages: [], statuses: [] })
    await until(async () => consume.mock.calls.length === attempts + 1)
    expect(log).toHaveBeenCalledTimes(1)
    expect((await readdir(join(directory, 'failed'))).length).toBe(1)
  } finally {
    await first.close()
    await second.close()
    await rm(directory, { recursive: true })
  }
})
