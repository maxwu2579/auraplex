// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid, AttachedDoc, Class, Doc, Ref } from '@hcengineering/core'
import { plugin, type Asset, type IntlString, type Plugin } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'

export const prospectsId = 'prospects' as Plugin
export type ProspectStatus = 'new' | 'sent' | 'replied' | 'do-not-send' | 'bounced'
export interface Prospect extends Doc {
  name: string
  company: string
  title: string
  mobile: string
  phone: string
  email: string
  normalizedEmail: string
  website: string
  address: string
  country: string
  industry: string
  source: string
  sourceDate?: number
  notes: string
  status: ProspectStatus
  photos?: number
  lastEmailAt?: number
  emailCount: number
  owner?: AccountUuid
  mailMessages?: number
  recognitionModel?: string
  recognizedAt?: number
  recognitionBy?: AccountUuid
  recognitionConfirmed: boolean
}
export interface ProspectMail extends AttachedDoc<Prospect> {
  direction: 'outgoing' | 'incoming' | 'forward'
  delivery: 'sending' | 'sent' | 'failed' | 'uncertain' | 'received'
  messageId: string
  sender: string
  recipient: string
  subject: string
  body: string
  sentAt: number
  actor?: AccountUuid
  replyTo?: Ref<ProspectMail>
}
export interface ProspectMailCursor extends Doc {
  uidValidity: string
  uid: number
}
export default plugin(prospectsId, {
  class: {
    Prospect: '' as Ref<Class<Prospect>>,
    ProspectMail: '' as Ref<Class<ProspectMail>>,
    ProspectMailCursor: '' as Ref<Class<ProspectMailCursor>>
  },
  app: { Prospects: '' as Ref<Doc> },
  component: { Directory: '' as AnyComponent, Statistics: '' as AnyComponent },
  icon: { Prospects: '' as Asset },
  string: { Prospects: '' as IntlString, Directory: '' as IntlString, Statistics: '' as IntlString }
})
export * from './rules'
export * from './mailRules'
