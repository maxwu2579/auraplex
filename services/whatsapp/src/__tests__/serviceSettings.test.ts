// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { randomBytes } from 'crypto'
import { changeSettings, publicSettings, runtimeConfig } from '../serviceSettings'

test('service settings responses expose only secret suffixes', () => {
  const secret = randomBytes(24).toString('hex')
  const settings = changeSettings({}, { wahaApiKey: secret, regenerateWebhook: true }, new Set())
  const publicValue = publicSettings(settings.value)
  expect(publicValue.wahaApiKey).toBe('••••' + secret.slice(-4))
  expect(JSON.stringify(publicValue)).not.toContain(secret)
  expect(JSON.stringify(publicValue)).not.toContain(settings.value.webhookSecret)
})

test('only workspace members may be selected and short secrets are fully masked', () => {
  expect(() => changeSettings({}, { supervisors: ['outsider'] }, new Set(['member']))).toThrow()
  const { value } = changeSettings({}, { supervisors: ['member', 'member'], historyDays: 45 }, new Set(['member']))
  expect(value.supervisors).toEqual(['member'])
  expect(publicSettings({ mailPassword: randomBytes(2).toString('hex') }).mailPassword).toBe('••••')
  expect(runtimeConfig({
    port: 0, accountsUrl: '', secret: '', publicUrl: '', graphUrl: '',
    graphVersion: '', allowedOrigins: [], wahaApiKey: 'test-fallback'
  }, value).wahaApiKey).toBe('test-fallback')
})
