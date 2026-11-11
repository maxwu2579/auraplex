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

import { mkdir, readdir, writeFile, rename, readFile, unlink } from 'fs/promises'
import { randomUUID } from 'crypto'
import { join } from 'path'
import type { WebhookBatch } from './webhook'

// Attempt counts live in filenames, so restarts do not reset the retry budget.
export class PersistentInbox {
  private processing = false
  private stopped = false
  private timer: NodeJS.Timeout | undefined
  private drainPromise: Promise<void> = Promise.resolve()
  private storageErrorReported = false

  constructor (
    private readonly directory: string,
    private readonly consume: (batch: WebhookBatch) => Promise<void>,
    private readonly onError: (file?: string) => void = () => {},
    private readonly maxAttempts = 5
  ) {}

  async start (interval = 5000): Promise<void> {
    await mkdir(this.directory, { recursive: true })
    await mkdir(join(this.directory, 'failed'), { recursive: true })
    this.timer = setInterval(() => {
      this.schedule()
    }, interval)
    this.schedule()
  }

  async enqueue (batch: WebhookBatch): Promise<void> {
    const file = join(this.directory, randomUUID() + '.json')
    await writeFile(file + '.tmp', JSON.stringify(batch), { mode: 0o600 })
    await rename(file + '.tmp', file)
    this.schedule()
  }

  private schedule (): void {
    if (this.processing || this.stopped) return
    this.processing = true
    this.drainPromise = this.drain().finally(() => {
      this.processing = false
    })
  }

  async drain (): Promise<void> {
    try {
      const files = (await readdir(this.directory)).filter((file) => file.endsWith('.json')).sort()
      for (const file of files) {
        if (this.stopped) break
        const filename = join(this.directory, file)
        try {
          await this.consume(JSON.parse(await readFile(filename, 'utf8')) as WebhookBatch)
          await unlink(filename)
        } catch {
          const match = /^(.*?)(?:\.retry-(\d+))?\.json$/.exec(file)
          if (match === null) continue
          const attempts = Number(match[2] ?? 0) + 1
          if (attempts >= this.maxAttempts) {
            await rename(filename, join(this.directory, 'failed', match[1] + '.json'))
            this.onError(match[1] + '.json')
          } else {
            await rename(filename, join(this.directory, match[1] + '.retry-' + attempts + '.json'))
          }
        }
      }
      this.storageErrorReported = false
    } catch {
      if (!this.storageErrorReported) this.onError()
      this.storageErrorReported = true
    }
  }

  async close (): Promise<void> {
    this.stopped = true
    if (this.timer !== undefined) clearInterval(this.timer)
    await this.drainPromise
  }
}
