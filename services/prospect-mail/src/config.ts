// Copyright © 2026 Auraplex. Licensed under EPL-2.0.

export interface MailServer {
  host: string
  port: number
  secure: boolean
}
export interface ServiceConfig {
  port: number
  accountsUrl: string
  secret: string
  /** Workspace UUID whose prospects this mailbox serves. */
  workspace?: string
  taskFrontUrl?: string
  address?: string
  password?: string
  smtp: MailServer
  imap: MailServer
  pollMs: number
}

function server (env: NodeJS.ProcessEnv, prefix: string, host: string, port: number): MailServer {
  return {
    host: env[`${prefix}_HOST`] ?? host,
    port: Number(env[`${prefix}_PORT`] ?? port),
    secure: (env[`${prefix}_SECURE`] ?? 'true') !== 'false'
  }
}

/** Defaults are Gmail; the local test compose file points them at the fake mail server. */
export function readConfig (env: NodeJS.ProcessEnv): ServiceConfig {
  const text = (name: string): string | undefined => {
    const value = env[name]?.trim()
    return value === undefined || value === '' ? undefined : value
  }
  return {
    port: Number(env.PORT ?? '8102'),
    accountsUrl: env.ACCOUNTS_URL ?? '',
    secret: env.SERVER_SECRET ?? 'secret',
    workspace: text('MAIL_WORKSPACE'),
    taskFrontUrl: text('TASK_MAIL_FRONT_URL'),
    address: text('MAIL_ADDRESS'),
    // Google shows app passwords in groups of four; the spaces are not part of it.
    password: text('MAIL_PASSWORD')?.replace(/\s/g, ''),
    smtp: server(env, 'MAIL_SMTP', 'smtp.gmail.com', 465),
    imap: server(env, 'MAIL_IMAP', 'imap.gmail.com', 993),
    pollMs: Math.max(30, Number(env.MAIL_POLL_SECONDS ?? '90')) * 1000
  }
}
