// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { getMetadata } from '@hcengineering/platform'
import presentation from '@hcengineering/presentation'

export async function mailAutomationRequest<T> (body?: object): Promise<T> {
  const response = await fetch('/prospect-mail-api/mail-automation', {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: 'Bearer ' + (getMetadata(presentation.metadata.Token) ?? ''),
      'Content-Type': 'application/json'
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store'
  })
  if (!response.ok) throw new Error('Mail automation request failed')
  return await response.json() as T
}
