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
    graphVersion: WHATSAPP_GRAPH_VERSION
  }
}
