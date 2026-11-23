// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { TemplateMessage } from './graph'

/** A transport owns its session lifecycle and delivery. Each backend has its own credential shape. */
export interface WhatsAppProvider<Connection, BindInput, State, Bound> {
  bind: (input: BindInput) => Promise<Bound>
  status: (connection: Connection) => Promise<State>
  disconnect: (connection: Connection) => Promise<void>
  send: (connection: Connection, phone: string, content: string, template?: TemplateMessage) => Promise<string>
}
