// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { type Domain, IndexKind } from '@hcengineering/core'
import {
  type Builder,
  Model,
  Prop,
  Index,
  UX,
  TypeString,
  TypeNumber,
  TypeTimestamp,
  TypeBoolean,
  TypeAccountUuid,
  Collection
} from '@hcengineering/model'
import core, { TDoc } from '@hcengineering/model-core'
import attachment from '@hcengineering/model-attachment'
import workbench from '@hcengineering/model-workbench'
import prospects, { prospectsId, type Prospect, type ProspectStatus } from '@hcengineering/prospects'
export { prospectsId } from '@hcengineering/prospects'
export default prospects
export const DOMAIN_PROSPECTS = 'prospects' as Domain

@Model(prospects.class.Prospect, core.class.Doc, DOMAIN_PROSPECTS)
@UX(prospects.string.Prospects, prospects.icon.Prospects, undefined, 'name')
export class TProspect extends TDoc implements Prospect {
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
  @Prop(Collection(attachment.class.Photo), prospects.string.Prospects) photos?: number
  @Prop(TypeTimestamp(), prospects.string.Prospects) lastEmailAt?: number
  @Prop(TypeNumber(), prospects.string.Prospects) emailCount!: number
  @Prop(TypeString(), prospects.string.Prospects) recognitionModel?: string
  @Prop(TypeTimestamp(), prospects.string.Prospects) recognizedAt?: number
  @Prop(TypeAccountUuid(), prospects.string.Prospects) recognitionBy?: Prospect['recognitionBy']
  @Prop(TypeBoolean(), prospects.string.Prospects) recognitionConfirmed!: boolean
}
export function createModel (builder: Builder): void {
  builder.createModel(TProspect)
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
          }
        ],
        spaces: []
      }
    },
    prospects.app.Prospects
  )
}
