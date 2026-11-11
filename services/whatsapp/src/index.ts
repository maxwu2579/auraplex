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

import 'dotenv/config'
import { systemAccountUuid } from '@hcengineering/core'
import { setMetadata } from '@hcengineering/platform'
import serverClient, { getAccountClient } from '@hcengineering/server-client'
import serverToken, { generateToken } from '@hcengineering/server-token'
import { readConfig } from './config'
import { ConnectionStore } from './integrations'
import { createApp } from './server'
import { PersistentInbox } from './inbox'
import { WorkspaceReceiver } from './workspaceClient'

const config = readConfig()
setMetadata(serverClient.metadata.Endpoint, config.accountsUrl)
setMetadata(serverToken.metadata.Secret, config.secret)
setMetadata(serverToken.metadata.Service, 'whatsapp')
const account = getAccountClient(generateToken(systemAccountUuid, undefined, { service: 'whatsapp' }))
const store = new ConnectionStore(account)
const receiver = new WorkspaceReceiver(account, store)
const inbox = new PersistentInbox(
  config.inboxDirectory ?? '/var/lib/whatsapp/inbox',
  (batch) => receiver.consume(batch),
  () => {
    console.error('WhatsApp delivery will retry; pending events are preserved')
  }
)
async function main (): Promise<void> {
  await inbox.start()
  const server = createApp(config, store, inbox).listen(config.port, () => {
    console.log('WhatsApp service started', { port: config.port })
  })
  const shutdown = (): void => {
    server.close(() => {
      void inbox.close().then(() => receiver.close())
    })
  }
  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}
void main().catch(() => {
  console.error('WhatsApp service could not start')
  process.exitCode = 1
})
