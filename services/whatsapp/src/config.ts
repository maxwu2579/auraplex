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

export interface Config {
  port: number
  accountsUrl: string
  secret: string
  publicUrl: string
  allowedOrigins: string[]
  graphUrl: string
  graphVersion: string
  appSecret?: string
  verifyToken?: string
  inboxDirectory?: string
  /** Free-form reply window; shorten with WHATSAPP_REPLY_WINDOW_MINUTES for local testing only. */
  replyWindowMs?: number
}

function replyWindow (minutes: string | undefined): number {
  const value = Number(minutes ?? '')
  // Meta's real window is 24 hours; a longer value would only produce errors from Meta.
  if (minutes === undefined || minutes === '' || !Number.isFinite(value) || value <= 0 || value > 1440) {
    return REPLY_WINDOW_MS
  }
  return Math.round(value * 60 * 1000)
}

export function readConfig (): Config {
  const { ACCOUNTS_URL, SECRET, WHATSAPP_PUBLIC_URL, WHATSAPP_GRAPH_VERSION } = process.env
  if (
    ACCOUNTS_URL === undefined ||
    SECRET === undefined ||
    WHATSAPP_PUBLIC_URL === undefined ||
    WHATSAPP_GRAPH_VERSION === undefined
  ) {
    throw new Error('ACCOUNTS_URL, SECRET, WHATSAPP_PUBLIC_URL and WHATSAPP_GRAPH_VERSION are required')
  }
  return {
    port: Number(process.env.PORT ?? 8098),
    accountsUrl: ACCOUNTS_URL,
    secret: SECRET,
    publicUrl: WHATSAPP_PUBLIC_URL.replace(/\/$/, ''),
    allowedOrigins: (process.env.WHATSAPP_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean),
    graphUrl: process.env.WHATSAPP_GRAPH_URL ?? 'https://graph.facebook.com',
    appSecret: process.env.WHATSAPP_APP_SECRET ?? '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN ?? '',
    inboxDirectory: process.env.WHATSAPP_INBOX_DIR ?? '/var/lib/whatsapp/inbox',
    graphVersion: WHATSAPP_GRAPH_VERSION,
    replyWindowMs: replyWindow(process.env.WHATSAPP_REPLY_WINDOW_MINUTES)
  }
}
