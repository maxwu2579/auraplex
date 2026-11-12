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

import type { Class, Doc, Ref } from '@hcengineering/core'
import { plugin, type Asset, type IntlString, type Plugin } from '@hcengineering/platform'
import type { AnyComponent } from '@hcengineering/ui'

export const materialsId = 'materials' as Plugin
export interface Material extends Doc {
  code: string
  normalizedCode: string
  name: string
  model: string
  brand: string
  category: string
  group: string
  rack: string
  level: string
  minimumStock?: number
  unit: string
  notes: string
  photos?: number
  stock: number
  lastMovementOn?: number
}
export function normalizeCode (value: string): string {
  return value.normalize('NFKC').trim().toUpperCase()
}
export default plugin(materialsId, {
  class: { Material: '' as Ref<Class<Material>> },
  app: { Materials: '' as Ref<Doc> },
  icon: { Materials: '' as Asset },
  component: { Directory: '' as AnyComponent },
  string: {
    Materials: '' as IntlString,
    Directory: '' as IntlString,
    Create: '' as IntlString,
    Edit: '' as IntlString,
    Code: '' as IntlString,
    Name: '' as IntlString,
    Model: '' as IntlString,
    Brand: '' as IntlString,
    Category: '' as IntlString,
    Group: '' as IntlString,
    Rack: '' as IntlString,
    Level: '' as IntlString,
    MinimumStock: '' as IntlString,
    Unit: '' as IntlString,
    Notes: '' as IntlString,
    Stock: '' as IntlString,
    Photos: '' as IntlString,
    AddPhoto: '' as IntlString,
    Save: '' as IntlString,
    Cancel: '' as IntlString,
    Search: '' as IntlString,
    AllCategories: '' as IntlString,
    AllRacks: '' as IntlString,
    NoResults: '' as IntlString,
    Duplicate: '' as IntlString,
    Required: '' as IntlString,
    SaveFailed: '' as IntlString,
    PhotoFailed: '' as IntlString,
    InvalidMinimum: '' as IntlString,
    EditFirst: '' as IntlString,
    Conflict: '' as IntlString,
    SelectImage: '' as IntlString
  }
})
