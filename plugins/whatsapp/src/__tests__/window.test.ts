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

import {
  REPLY_WINDOW_MS,
  isReplyWindowOpen,
  isValidTemplateParameter,
  lastIncomingAt,
  renderTemplate,
  templateParameterCount
} from '..'

const hour = 60 * 60 * 1000

describe('24 hour reply window', () => {
  it('uses the latest incoming message and ignores our own replies', () => {
    const now = 1_800_000_000_000
    const messages = [
      { direction: 'incoming' as const, sendOn: now - 30 * hour },
      { direction: 'incoming' as const, sendOn: now - 25 * hour },
      { direction: 'outgoing' as const, sendOn: now - hour }
    ]
    const last = lastIncomingAt(messages)
    expect(last).toBe(now - 25 * hour)
    expect(isReplyWindowOpen(last, now)).toBe(false)
  })

  it('is open just before 24 hours and closed exactly at 24 hours', () => {
    const now = 1_800_000_000_000
    expect(isReplyWindowOpen(now - REPLY_WINDOW_MS + 1, now)).toBe(true)
    expect(isReplyWindowOpen(now - REPLY_WINDOW_MS, now)).toBe(false)
  })

  it('is closed when the customer never wrote', () => {
    expect(lastIncomingAt([{ direction: 'outgoing', sendOn: 1 }])).toBeUndefined()
    expect(isReplyWindowOpen(undefined, Date.now())).toBe(false)
  })

  it('honours a shorter threshold for testing', () => {
    const now = 1_800_000_000_000
    expect(isReplyWindowOpen(now - 3 * 60 * 1000, now, 2 * 60 * 1000)).toBe(false)
    expect(isReplyWindowOpen(now - 60 * 1000, now, 2 * 60 * 1000)).toBe(true)
  })
})

describe('templates', () => {
  it('counts positional variables and rejects named ones', () => {
    expect(templateParameterCount('Hello')).toBe(0)
    expect(templateParameterCount('您好 {{1}}，产品 {{2}} 到了，{{1}}')).toBe(2)
    expect(templateParameterCount('Hi {{ 1 }}')).toBe(1)
    expect(templateParameterCount('Hi {{customer_name}}')).toBe(-1)
  })

  it('fills variables and keeps placeholders that are still empty', () => {
    expect(renderTemplate('您好 {{1}}，产品 {{2}}', ['王先生', 'A1'])).toBe('您好 王先生，产品 A1')
    expect(renderTemplate('您好 {{1}}，产品 {{2}}', ['王先生'])).toBe('您好 王先生，产品 {{2}}')
  })

  it('applies the Meta rules for variable values', () => {
    expect(isValidTemplateParameter('王先生')).toBe(true)
    expect(isValidTemplateParameter('  ')).toBe(false)
    expect(isValidTemplateParameter('a\nb')).toBe(false)
    expect(isValidTemplateParameter('a     b')).toBe(false)
    expect(isValidTemplateParameter('x'.repeat(1025))).toBe(false)
  })
})
