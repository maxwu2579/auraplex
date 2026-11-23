// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { randomBytes } from 'crypto'
import type { Config } from './config'

export interface ServiceSettings {
  wahaUrl?: string
  wahaApiKey?: string
  webhookSecret?: string
  mediaLimitMb?: number
  historyDays?: number
  supervisors?: string[]
  aiUrl?: string
  aiModel?: string
  aiKey?: string
  mailAddress?: string
  mailPassword?: string
  mailSmtpHost?: string
  mailSmtpPort?: number
  mailImapHost?: string
  mailImapPort?: number
}

export function publicSettings (value: ServiceSettings): Record<string, unknown> {
  const mask = (secret?: string): string | undefined => secret
    ? '••••' + (secret.length > 4 ? secret.slice(-4) : '')
    : undefined
  return {
    wahaUrl: value.wahaUrl, wahaApiKey: mask(value.wahaApiKey), webhookSecret: mask(value.webhookSecret),
    mediaLimitMb: value.mediaLimitMb ?? 20, historyDays: value.historyDays ?? 0,
    supervisors: value.supervisors ?? [],
    aiUrl: value.aiUrl, aiModel: value.aiModel, aiKey: mask(value.aiKey),
    mailAddress: value.mailAddress, mailPassword: mask(value.mailPassword),
    mailSmtpHost: value.mailSmtpHost, mailSmtpPort: value.mailSmtpPort,
    mailImapHost: value.mailImapHost, mailImapPort: value.mailImapPort
  }
}

export function changeSettings (
  previous: ServiceSettings, patch: unknown, allowedMembers: Set<string>
): { value: ServiceSettings, fields: string[] } {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid settings')
  const value = { ...previous }
  const fields: string[] = []
  for (const [key, data] of Object.entries(patch)) {
    if (key === 'wahaUrl') {
      if (data === null) delete value.wahaUrl
      else {
        if (typeof data !== 'string' || data.length > 2048) throw new Error('Invalid URL')
        const url = new URL(data)
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
          throw new Error('Invalid URL')
        }
        value.wahaUrl = url.toString()
      }
    } else if (key === 'wahaApiKey') {
      if (data === null) delete value.wahaApiKey
      else {
        if (typeof data !== 'string' || !/^[\x21-\x7e]{1,1024}$/.test(data)) throw new Error('Invalid key')
        value.wahaApiKey = data
      }
    } else if (key === 'aiUrl' || key === 'aiModel' || key === 'aiKey' || key === 'mailAddress' || key === 'mailPassword' ||
      key === 'mailSmtpHost' || key === 'mailImapHost') {
      if (data === null) delete value[key]
      else {
        if (typeof data !== 'string' || data.length > 2048 || /[\r\n\0]/.test(data)) throw new Error('Invalid parameter')
        value[key] = data
      }
    } else if (key === 'mailSmtpPort' || key === 'mailImapPort') {
      if (data === null) delete value[key]
      else {
        if (typeof data !== 'number' || !Number.isInteger(data) || data < 1 || data > 65535) throw new Error('Invalid port')
        value[key] = data
      }
    } else if (key === 'regenerateWebhook' && data === true) {
      value.webhookSecret = randomBytes(32).toString('hex')
    } else if (key === 'mediaLimitMb' || key === 'historyDays') {
      if (typeof data !== 'number' || !Number.isInteger(data) ||
        data < (key === 'mediaLimitMb' ? 1 : 0) || data > (key === 'mediaLimitMb' ? 100 : 90)) throw new Error('Invalid number')
      value[key] = data
    } else if (key === 'supervisors') {
      if (!Array.isArray(data) || data.some((member) => typeof member !== 'string' || !allowedMembers.has(member))) {
        throw new Error('Invalid supervisor')
      }
      value.supervisors = [...new Set<string>(data)]
    } else {
      throw new Error('Unknown setting')
    }
    fields.push(key)
  }
  return { value, fields }
}

export function runtimeConfig (base: Config, settings: ServiceSettings): Config {
  return {
    ...base,
    wahaUrl: settings.wahaUrl ?? base.wahaUrl,
    wahaApiKey: settings.wahaApiKey ?? base.wahaApiKey,
    wahaWebhookSecret: settings.webhookSecret ?? base.wahaWebhookSecret,
    mediaLimitMb: settings.mediaLimitMb,
    historyDays: settings.historyDays
  }
}
