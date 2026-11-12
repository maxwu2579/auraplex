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

import type { AttachedDoc, Class, Doc, Ref } from '@hcengineering/core'
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
  movements?: number
}

/**
 * opening: first stock taken over from Excel (step 3)
 * in / out: goods received / issued
 * adjust: stocktake; `quantity` is the counted stock
 */
export type MovementKind = 'opening' | 'in' | 'out' | 'adjust'

/** One stock change. Never edited or removed; a mistake is corrected with an adjustment. */
export interface StockMovement extends AttachedDoc<Material> {
  kind: MovementKind
  /** in / out: amount moved (> 0). adjust / opening: counted stock (>= 0). */
  quantity: number
  /** Signed change applied to the stock. */
  delta: number
  /** Stock after this movement. */
  balance: number
  /** Purpose or document number, optional. */
  purpose?: string
  /** Why an adjustment was made; required for adjust. */
  reason?: string
}

export type MovementError = 'InvalidQuantity' | 'Insufficient' | 'ReasonRequired' | 'NoChange'

export type MovementPlan = { delta: number, balance: number } | { error: MovementError }

const SCALE = 1000

/** Quantities keep at most 3 decimals; integer arithmetic avoids 0.1 + 0.2 style errors. */
function toUnits (value: number): number {
  return Math.round(value * SCALE)
}

/** Parses a typed quantity. Returns undefined for anything that is not a plain number with at most 3 decimals. */
export function parseQuantity (text: string): number | undefined {
  const value = text.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,3})?$/.test(value)) return undefined
  const number = Number(value)
  return Number.isFinite(number) && number <= 1e9 ? number : undefined
}

/** Works out a movement against the current stock, or why it is not allowed. Stock never goes below zero. */
export function planMovement (stock: number, kind: MovementKind, quantity: number, reason = ''): MovementPlan {
  if (!Number.isFinite(quantity) || quantity < 0 || toUnits(quantity) / SCALE !== quantity) {
    return { error: 'InvalidQuantity' }
  }
  const current = toUnits(stock)
  const amount = toUnits(quantity)
  let next: number
  if (kind === 'in' || kind === 'out') {
    if (amount === 0) return { error: 'InvalidQuantity' }
    next = kind === 'in' ? current + amount : current - amount
    if (next < 0) return { error: 'Insufficient' }
  } else {
    if (kind === 'adjust' && reason.trim() === '') return { error: 'ReasonRequired' }
    next = amount
    if (kind === 'adjust' && next === current) return { error: 'NoChange' }
  }
  return { delta: (next - current) / SCALE, balance: next / SCALE }
}

/** Below the minimum stock. A missing minimum never counts as low. */
export function isLowStock (material: Pick<Material, 'stock' | 'minimumStock'>): boolean {
  return material.minimumStock !== undefined && material.minimumStock !== null && material.stock < material.minimumStock
}

/** Shows up to 3 decimals without trailing zeros. */
export function formatQuantity (value: number): string {
  return String(Math.round(value * SCALE) / SCALE)
}
export function normalizeCode (value: string): string {
  return value.normalize('NFKC').trim().toUpperCase()
}
export default plugin(materialsId, {
  class: { Material: '' as Ref<Class<Material>>, StockMovement: '' as Ref<Class<StockMovement>> },
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
    SelectImage: '' as IntlString,
    LastMovement: '' as IntlString,
    Movements: '' as IntlString,
    StockIn: '' as IntlString,
    StockOut: '' as IntlString,
    Adjust: '' as IntlString,
    Opening: '' as IntlString,
    History: '' as IntlString,
    Quantity: '' as IntlString,
    CountedQuantity: '' as IntlString,
    Purpose: '' as IntlString,
    Reason: '' as IntlString,
    CurrentStock: '' as IntlString,
    StockAfter: '' as IntlString,
    Submit: '' as IntlString,
    Close: '' as IntlString,
    Time: '' as IntlString,
    Type: '' as IntlString,
    Change: '' as IntlString,
    Balance: '' as IntlString,
    By: '' as IntlString,
    NoMovements: '' as IntlString,
    InvalidQuantity: '' as IntlString,
    Insufficient: '' as IntlString,
    ReasonRequired: '' as IntlString,
    NoChange: '' as IntlString,
    StockChanged: '' as IntlString,
    DeletePhoto: '' as IntlString,
    LowStock: '' as IntlString,
    Actions: '' as IntlString
  }
})
