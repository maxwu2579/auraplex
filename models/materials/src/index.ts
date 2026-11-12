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

import { type Domain, IndexKind } from '@hcengineering/core'
import {
  type Builder,
  Collection,
  Index,
  Model,
  Prop,
  TypeNumber,
  TypeString,
  TypeTimestamp,
  UX
} from '@hcengineering/model'
import core, { TAttachedDoc, TDoc } from '@hcengineering/model-core'
import attachment from '@hcengineering/model-attachment'
import workbench from '@hcengineering/model-workbench'
import materials, { materialsId, type Material, type MovementKind, type StockMovement } from '@hcengineering/materials'

export { materialsId } from '@hcengineering/materials'
export default materials
export const DOMAIN_MATERIALS = 'materials' as Domain

@Model(materials.class.Material, core.class.Doc, DOMAIN_MATERIALS)
@UX(materials.string.Materials, materials.icon.Materials, undefined, 'name')
export class TMaterial extends TDoc implements Material {
  @Prop(TypeString(), materials.string.Code) @Index(IndexKind.FullText) code!: string
  @Prop(TypeString(), materials.string.Code) @Index(IndexKind.Indexed) normalizedCode!: string
  @Prop(TypeString(), materials.string.Name) @Index(IndexKind.FullText) name!: string
  @Prop(TypeString(), materials.string.Model) model!: string
  @Prop(TypeString(), materials.string.Brand) brand!: string
  @Prop(TypeString(), materials.string.Category) category!: string
  @Prop(TypeString(), materials.string.Group) group!: string
  @Prop(TypeString(), materials.string.Rack) rack!: string
  @Prop(TypeString(), materials.string.Level) level!: string
  @Prop(TypeNumber(), materials.string.MinimumStock) minimumStock?: number
  @Prop(TypeString(), materials.string.Unit) unit!: string
  @Prop(TypeString(), materials.string.Notes) notes!: string
  @Prop(Collection(attachment.class.Photo), materials.string.Photos) photos?: number
  @Prop(TypeNumber(), materials.string.Stock) stock!: number
  @Prop(TypeTimestamp(), materials.string.LastMovement) lastMovementOn?: number
  @Prop(Collection(materials.class.StockMovement), materials.string.Movements) movements?: number
}

@Model(materials.class.StockMovement, core.class.AttachedDoc, DOMAIN_MATERIALS)
@UX(materials.string.Movements, materials.icon.Materials)
export class TStockMovement extends TAttachedDoc implements StockMovement {
  declare attachedTo: StockMovement['attachedTo']
  declare attachedToClass: StockMovement['attachedToClass']
  @Prop(TypeString(), materials.string.Type) kind!: MovementKind
  @Prop(TypeNumber(), materials.string.Quantity) quantity!: number
  @Prop(TypeNumber(), materials.string.Change) delta!: number
  @Prop(TypeNumber(), materials.string.Balance) balance!: number
  @Prop(TypeString(), materials.string.Purpose) purpose?: string
  @Prop(TypeString(), materials.string.Reason) reason?: string
}
export function createModel (builder: Builder): void {
  builder.createModel(TMaterial, TStockMovement)
  builder.createDoc(
    workbench.class.Application,
    core.space.Model,
    {
      label: materials.string.Materials,
      icon: materials.icon.Materials,
      alias: materialsId,
      hidden: false,
      navigatorModel: {
        specials: [
          {
            id: 'directory',
            label: materials.string.Directory,
            icon: materials.icon.Materials,
            component: materials.component.Directory
          }
        ],
        spaces: []
      }
    },
    materials.app.Materials
  )
}
