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

import { REPLY_WINDOW_MS } from '@hcengineering/whatsapp'
import { readConfig } from '../config'

const saved = { ...process.env }
beforeEach(() => {
  process.env.ACCOUNTS_URL = 'http://account'
  process.env.SECRET = 'secret'
  process.env.WHATSAPP_PUBLIC_URL = 'http://localhost'
  process.env.WHATSAPP_GRAPH_VERSION = 'mock'
  delete process.env.WHATSAPP_REPLY_WINDOW_MINUTES
})
afterAll(() => {
  process.env = saved
})

it('uses the real 24 hour window unless a valid shorter test value is given', () => {
  expect(readConfig().replyWindowMs).toBe(REPLY_WINDOW_MS)
  process.env.WHATSAPP_REPLY_WINDOW_MINUTES = '2'
  expect(readConfig().replyWindowMs).toBe(2 * 60 * 1000)
  for (const value of ['0', '-5', 'abc', '2000', '']) {
    process.env.WHATSAPP_REPLY_WINDOW_MINUTES = value
    expect(readConfig().replyWindowMs).toBe(REPLY_WINDOW_MS)
  }
})
