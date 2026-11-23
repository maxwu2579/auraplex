import { systemAccountUuid, type IntegrationKind, type PersonId } from '@hcengineering/core'
import { getClient } from '@hcengineering/account-client'
import { setMetadata } from '@hcengineering/platform'
import token, { generateToken } from '@hcengineering/server-token'
import { createApp } from './server'
const accountsUrl = process.env.ACCOUNTS_URL ?? ''
const secret = process.env.SERVER_SECRET
if (secret !== undefined && secret !== '') setMetadata(token.metadata.Secret, secret)
const port = Number(process.env.PORT ?? '8101')
createApp({
  accountsUrl,
  aiUrl: process.env.PROSPECTS_AI_URL,
  model: process.env.PROSPECTS_AI_MODEL,
  key: process.env.PROSPECTS_AI_KEY,
  resolve: async (workspace) => {
    if (!secret) return {}
    const serviceToken = generateToken(systemAccountUuid, workspace, { service: 'prospects-recognizer' })
    const result = await getClient(accountsUrl, serviceToken).getIntegrationSecret({
      workspaceUuid: workspace, socialId: '0' as PersonId,
      kind: 'auraplex-service-settings' as IntegrationKind, key: 'recognizer-settings'
    })
    if (result == null) return {}
    const { aiUrl, aiModel, aiKey } = JSON.parse(result.secret) as { aiUrl?: string, aiModel?: string, aiKey?: string }
    return { ...(aiUrl == null ? {} : { aiUrl }), ...(aiModel == null ? {} : { model: aiModel }), ...(aiKey == null ? {} : { key: aiKey }) }
  }
}).listen(port)
