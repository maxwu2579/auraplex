// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { type Domain, IndexKind } from '@hcengineering/core'
import {
  type Builder,
  Model,
  Hidden,
  Prop,
  Index,
  UX,
  TypeString,
  TypeNumber,
  TypeTimestamp,
  TypeBoolean,
  TypeAccountUuid,
  TypeRef,
  TypeRecord,
  ArrOf,
  Collection
} from '@hcengineering/model'
import core, { TAttachedDoc, TDoc } from '@hcengineering/model-core'
import attachment from '@hcengineering/model-attachment'
import lead from '@hcengineering/lead'
import workbench from '@hcengineering/model-workbench'
import prospects, {
  defaultProspectFields,
  prospectsId,
  type ProspectTemplate,
  type Prospect,
  type ProspectMail,
  type ProspectMailCursor,
  type MailAutomation,
  type ProspectStatus
} from '@hcengineering/prospects'
export { prospectsId } from '@hcengineering/prospects'
export default prospects
export { prospectsOperation } from './migration'
export const DOMAIN_PROSPECTS = 'prospects' as Domain

@Model(prospects.class.Prospect, core.class.Doc, DOMAIN_PROSPECTS)
@UX(prospects.string.Prospects, prospects.icon.Prospects, undefined, 'name')
export class TProspect extends TDoc implements Prospect {
  @Hidden() @Prop(TypeRecord(), prospects.string.Prospects) custom?: Prospect['custom']
  @Prop(TypeString(), prospects.string.Prospects) name!: string
  @Prop(TypeString(), prospects.string.Prospects) company!: string
  @Prop(TypeString(), prospects.string.Prospects) title!: string
  @Prop(TypeString(), prospects.string.Prospects) mobile!: string
  @Prop(TypeString(), prospects.string.Prospects) phone!: string
  @Prop(TypeString(), prospects.string.Prospects) email!: string
  @Prop(TypeString(), prospects.string.Prospects) @Index(IndexKind.Indexed) normalizedEmail!: string
  @Prop(TypeString(), prospects.string.Prospects) website!: string
  @Prop(TypeString(), prospects.string.Prospects) address!: string
  @Prop(TypeString(), prospects.string.Prospects) country!: string
  @Prop(TypeString(), prospects.string.Prospects) industry!: string
  @Prop(TypeString(), prospects.string.Prospects) source!: string
  @Prop(TypeTimestamp(), prospects.string.Prospects) sourceDate?: number
  @Prop(TypeString(), prospects.string.Prospects) notes!: string
  @Prop(TypeString(), prospects.string.Prospects) status!: ProspectStatus
  @Prop(TypeRef(lead.class.Lead), prospects.string.PageOpenLead) lead?: Prospect['lead']
  @Hidden() @Prop(TypeString(), prospects.string.Prospects) mailStatus?: Prospect['mailStatus']
  @Prop(Collection(attachment.class.Photo), prospects.string.Prospects) photos?: number
  @Prop(TypeTimestamp(), prospects.string.Prospects) lastEmailAt?: number
  @Prop(TypeNumber(), prospects.string.Prospects) emailCount!: number
  @Prop(TypeAccountUuid(), prospects.string.Prospects) owner?: Prospect['owner']
  @Prop(Collection(prospects.class.ProspectMail), prospects.string.Prospects) mailMessages?: number
  @Prop(TypeString(), prospects.string.Prospects) recognitionModel?: string
  @Prop(TypeTimestamp(), prospects.string.Prospects) recognizedAt?: number
  @Prop(TypeAccountUuid(), prospects.string.Prospects) recognitionBy?: Prospect['recognitionBy']
  @Prop(TypeBoolean(), prospects.string.Prospects) recognitionConfirmed!: boolean
  @Hidden() review?: Prospect['review']
  @Hidden() photoHash?: string
  @Hidden() notDuplicate?: Prospect['notDuplicate']
  @Hidden() mergedFrom?: Prospect['mergedFrom']
  @Hidden() imported?: boolean
}
@Model(prospects.class.ProspectMail, core.class.AttachedDoc, DOMAIN_PROSPECTS)
@UX(prospects.string.Prospects, prospects.icon.Prospects)
export class TProspectMail extends TAttachedDoc implements ProspectMail {
  declare attachedTo: ProspectMail['attachedTo']
  declare attachedToClass: ProspectMail['attachedToClass']
  @Prop(TypeString(), prospects.string.Prospects) direction!: ProspectMail['direction']
  @Prop(TypeString(), prospects.string.Prospects) delivery!: ProspectMail['delivery']
  @Prop(TypeString(), prospects.string.Prospects) @Index(IndexKind.Indexed) messageId!: string
  @Prop(TypeString(), prospects.string.Prospects) sender!: string
  @Prop(TypeString(), prospects.string.Prospects) recipient!: string
  @Prop(TypeString(), prospects.string.Prospects) subject!: string
  @Prop(TypeString(), prospects.string.Prospects) body!: string
  @Prop(TypeTimestamp(), prospects.string.Prospects) sentAt!: number
  @Prop(TypeAccountUuid(), prospects.string.Prospects) actor?: ProspectMail['actor']
  @Hidden() automation?: ProspectMail['automation']
  @Hidden() campaign?: string
  @Hidden() forwardRecipients?: ProspectMail['forwardRecipients']
  @Hidden() forwardedOn?: number
  @Prop(TypeRef(prospects.class.ProspectMail), prospects.string.Prospects) replyTo?: ProspectMail['replyTo']
}
@Model(prospects.class.ProspectMailCursor, core.class.Doc, DOMAIN_PROSPECTS)
export class TProspectMailCursor extends TDoc implements ProspectMailCursor {
  @Prop(TypeString(), prospects.string.Prospects) uidValidity!: string
  @Prop(TypeNumber(), prospects.string.Prospects) uid!: number
}
@Model(prospects.class.ProspectTemplate, core.class.Doc, DOMAIN_PROSPECTS)
export class TProspectTemplate extends TDoc implements ProspectTemplate {
  @Prop(ArrOf(TypeRecord()), prospects.string.Prospects) fields!: ProspectTemplate['fields']
  @Prop(ArrOf(TypeRecord()), prospects.string.Prospects) removedFields?: ProspectTemplate['removedFields']
}

@Model(prospects.class.MailAutomation, core.class.Doc, DOMAIN_PROSPECTS)
export class TMailAutomation extends TDoc implements MailAutomation {
  @Hidden() settings!: MailAutomation['settings']
  @Hidden() enrolledFrom?: number
  @Hidden() releasedThrough?: number
  @Hidden() removed!: MailAutomation['removed']
  @Hidden() campaign?: MailAutomation['campaign']
}

export function createModel (builder: Builder): void {
  builder.createModel(TProspect, TProspectMail, TProspectMailCursor, TProspectTemplate, TMailAutomation)
  builder.mixin(prospects.class.Prospect, core.class.Class, 'view:mixin:ObjectPanel' as any, {
    component: prospects.component.ProspectPanel
  })
  builder.createDoc(prospects.class.ProspectTemplate, core.space.Model, { fields: [...defaultProspectFields] },
    prospects.template.Default)
  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: prospects.string.Prospects,
      icon: prospects.icon.Prospects,
      alias: prospectsId,
      hidden: false,
      navigatorModel: {
        specials: [
          {
            id: 'directory',
            label: prospects.string.Directory,
            icon: prospects.icon.Prospects,
            component: prospects.component.Directory
          },
          {
            id: 'statistics',
            label: prospects.string.Statistics,
            icon: prospects.icon.Prospects,
            component: prospects.component.Statistics
          },
          {
            id: 'review',
            label: prospects.string.ReviewPage,
            icon: prospects.icon.Prospects,
            component: prospects.component.ReviewQueue,
            editModule: 'prospects'
          },
          {
            id: 'mail-automation',
            label: prospects.string.AutoMail,
            icon: prospects.icon.Prospects,
            component: prospects.component.MailAutomation,
            editModule: 'prospects'
          },
          {
            id: 'template',
            label: prospects.string.TemplateSettings,
            icon: prospects.icon.Prospects,
            component: prospects.component.TemplateSettings,
            editModule: 'prospects'
          }
        ],
        spaces: []
      }
    },
    prospects.app.Prospects
  )
}
