// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { AccountUuid, AttachedDoc, Class, Doc, Ref } from '@hcengineering/core'
import type { MailAutomation } from './automation'
import type { MergeRecord } from './review'
import type { Lead } from '@hcengineering/lead'
import { plugin, type Asset, type IntlString, type Plugin } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'

export const prospectsId = 'prospects' as Plugin
/** Serialize conditional writes to the prospect and its related records. */
export const prospectWriteScope = 'prospect-write'
export type ProspectStatus = 'new' | 'sent' | 'replied' | 'do-not-send' | 'bounced' | 'converted'
export interface ProspectFieldDef {
  key: string
  builtin: boolean
  label: string
  type: 'text' | 'date' | 'select'
  options?: string[]
  hidden: boolean
  order: number
}
export interface ProspectTemplate extends Doc {
  fields: ProspectFieldDef[]
  removedFields?: ProspectFieldDef[]
}
export interface Prospect extends Doc {
  custom?: Record<string, string | number>
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
  lead?: Ref<Lead> | null
  mailStatus?: Exclude<ProspectStatus, 'converted'>
  photos?: number
  lastEmailAt?: number
  emailCount: number
  owner?: AccountUuid
  mailMessages?: number
  followUp?: Ref<Doc>
  recognitionModel?: string
  recognizedAt?: number
  recognitionBy?: AccountUuid
  recognitionConfirmed: boolean
  /** Why a person should check this card (see review.ts); empty or missing = nothing to check. */
  review?: string[]
  /** SHA-256 of the uploaded front photo, so the same picture is not saved twice. */
  photoHash?: string
  /** Cards a person said are not the same as this one. */
  notDuplicate?: Array<Ref<Prospect>>
  mergedFrom?: MergeRecord[]
  /** Old customer brought in by an import: no new-customer introduction, campaigns only. */
  imported?: boolean
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
  automation?: 'intro' | 'campaign'
  campaign?: string
  forwardRecipients?: AccountUuid[]
  forwardedOn?: number
}
export interface ProspectMailCursor extends Doc {
  uidValidity: string
  uid: number
}
export default plugin(prospectsId, {
  class: {
    Prospect: '' as Ref<Class<Prospect>>,
    ProspectTemplate: '' as Ref<Class<ProspectTemplate>>,
    ProspectMail: '' as Ref<Class<ProspectMail>>,
    MailAutomation: '' as Ref<Class<MailAutomation>>,
    ProspectMailCursor: '' as Ref<Class<ProspectMailCursor>>
  },
  ids: { MailAutomation: '' as Ref<MailAutomation> },
  template: { Default: '' as Ref<ProspectTemplate> },
  app: { Prospects: '' as Ref<Doc> },
  component: { ProspectPanel: '' as AnyComponent, Directory: '' as AnyComponent, Statistics: '' as AnyComponent, TemplateSettings: '' as AnyComponent, MailAutomation: '' as AnyComponent, ReviewQueue: '' as AnyComponent },
  icon: { Prospects: '' as Asset },
  string: {
    ReviewPage: '' as IntlString,
    AutoMail: '' as IntlString,
    AutoMailSettings: '' as IntlString,
    AutoMailRefresh: '' as IntlString,
    AutoMailFailed: '' as IntlString,
    AutoMailQuota: '' as IntlString,
    AutoMailEnabled: '' as IntlString,
    AutoMailLimit: '' as IntlString,
    AutoMailWait: '' as IntlString,
    AutoMailLanguage: '' as IntlString,
    AutoMailVariables: '' as IntlString,
    AutoMailSave: '' as IntlString,
    AutoMailIntro: '' as IntlString,
    AutoMailOldest: '' as IntlString,
    AutoMailEstimate: '' as IntlString,
    AutoMailRemove: '' as IntlString,
    AutoMailCampaign: '' as IntlString,
    AutoMailProgress: '' as IntlString,
    AutoMailRunning: '' as IntlString,
    AutoMailPaused: '' as IntlString,
    AutoMailDone: '' as IntlString,
    AutoMailStopped: '' as IntlString,
    AutoMailDaysLeft: '' as IntlString,
    AutoMailResume: '' as IntlString,
    AutoMailPause: '' as IntlString,
    AutoMailStop: '' as IntlString,
    AutoMailCreate: '' as IntlString,
    AutoMailCampaignName: '' as IntlString,
    AutoMailStart: '' as IntlString,
    AutoMailHistory: '' as IntlString,
    AutoMailUncertain: '' as IntlString,
    AutoMailQueuedIntro: '' as IntlString,
    AutoMailQueuedCampaign: '' as IntlString,
    AutoMailSent: '' as IntlString,
    AutoMailReplyPending: '' as IntlString,
    AutoMailCancel: '' as IntlString,
    AutoMailCustomerReply: '' as IntlString,
    AutoMailOptOut: '' as IntlString,

    PageLibrary: '' as IntlString,
    PageStatistics: '' as IntlString,
    PageProspects: '' as IntlString,
    PageAdd: '' as IntlString,
    PageUpload: '' as IntlString,
    PageExport: '' as IntlString,
    PageFront: '' as IntlString,
    PageBack: '' as IntlString,
    PageNoBack: '' as IntlString,
    PageReview: '' as IntlString,
    PageClearQueue: '' as IntlString,
    PageStatus: '' as IntlString,
    PageAll: '' as IntlString,
    PageMissing: '' as IntlString,
    PageSource: '' as IntlString,
    PageCountry: '' as IntlString,
    PageIndustry: '' as IntlString,
    PageClearFilters: '' as IntlString,
    PageActions: '' as IntlString,
    PageEdit: '' as IntlString,
    PageDelete: '' as IntlString,
    PageName: '' as IntlString,
    PageCompany: '' as IntlString,
    PageJobTitle: '' as IntlString,
    PageMobile: '' as IntlString,
    PagePhone: '' as IntlString,
    PageEmail: '' as IntlString,
    PageWebsite: '' as IntlString,
    PageAddress: '' as IntlString,
    PageNotes: '' as IntlString,
    PageNew: '' as IntlString,
    PageSent: '' as IntlString,
    PageReplied: '' as IntlString,
    PageOptOut: '' as IntlString,
    PageBounced: '' as IntlString,
    PageConverted: '' as IntlString,
    PageConvertToLead: '' as IntlString,
    PageOpenLead: '' as IntlString,
    PageLeadFailed: '' as IntlString,
    PageLeadTimeout: '' as IntlString,
    PageSourceDate: '' as IntlString,
    PageLastEmail: '' as IntlString,
    PageSendCount: '' as IntlString,
    PageModel: '' as IntlString,
    PageRecognizedAt: '' as IntlString,
    PageConfirmed: '' as IntlString,
    PageYes: '' as IntlString,
    PageNo: '' as IntlString,
    PageClose: '' as IntlString,
    PageRequiredFront: '' as IntlString,
    PageOptionalBack: '' as IntlString,
    PageRecognize: '' as IntlString,
    PageReviewHelp: '' as IntlString,
    PageVerify: '' as IntlString,
    PageOwner: '' as IntlString,
    PageSubject: '' as IntlString,
    PageBody: '' as IntlString,
    PageMail: '' as IntlString,
    PageNoneSelected: '' as IntlString,
    PageNoMail: '' as IntlString,
    PageConfirmSent: '' as IntlString,
    PageConfirmUnsent: '' as IntlString,
    PageTotal: '' as IntlString,
    PageWeek: '' as IntlString,
    PageMonth: '' as IntlString,
    PageSearch: '' as IntlString,
 Prospects: '' as IntlString, Directory: '' as IntlString, Statistics: '' as IntlString, TemplateSettings: '' as IntlString }
})
export * from './rules'
export * from './mailRules'
export * from './template'

export * from './automation'
export * from './review'
export * from './importRows'
