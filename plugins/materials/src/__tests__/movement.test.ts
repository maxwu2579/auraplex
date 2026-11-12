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

import { formatQuantity, isLowStock, parseQuantity, planMovement } from '..'

describe('stock movements', () => {
  it('adds and removes stock', () => {
    expect(planMovement(10, 'in', 5)).toEqual({ delta: 5, balance: 15 })
    expect(planMovement(10, 'out', 4)).toEqual({ delta: -4, balance: 6 })
    expect(planMovement(10, 'out', 10)).toEqual({ delta: -10, balance: 0 })
  })

  it('never lets stock go below zero', () => {
    expect(planMovement(3, 'out', 3.001)).toEqual({ error: 'Insufficient' })
    expect(planMovement(0, 'out', 1)).toEqual({ error: 'Insufficient' })
  })

  it('rejects zero, negative and over-precise amounts', () => {
    expect(planMovement(10, 'in', 0)).toEqual({ error: 'InvalidQuantity' })
    expect(planMovement(10, 'out', -1)).toEqual({ error: 'InvalidQuantity' })
    expect(planMovement(10, 'in', 0.0001)).toEqual({ error: 'InvalidQuantity' })
    expect(planMovement(10, 'in', Number.NaN)).toEqual({ error: 'InvalidQuantity' })
  })

  it('keeps decimals exact', () => {
    expect(planMovement(0.1, 'in', 0.2)).toEqual({ delta: 0.2, balance: 0.3 })
    expect(planMovement(1.5, 'out', 0.25)).toEqual({ delta: -0.25, balance: 1.25 })
  })

  it('sets the counted stock on adjustment and needs a reason', () => {
    expect(planMovement(10, 'adjust', 7, 'stocktake')).toEqual({ delta: -3, balance: 7 })
    expect(planMovement(10, 'adjust', 12, 'found more')).toEqual({ delta: 2, balance: 12 })
    expect(planMovement(10, 'adjust', 0, 'all used')).toEqual({ delta: -10, balance: 0 })
    expect(planMovement(10, 'adjust', 7, '  ')).toEqual({ error: 'ReasonRequired' })
    expect(planMovement(10, 'adjust', 10, 'same')).toEqual({ error: 'NoChange' })
  })

  it('takes over the opening stock without a reason', () => {
    expect(planMovement(0, 'opening', 36)).toEqual({ delta: 36, balance: 36 })
  })
})

describe('quantity input', () => {
  it('accepts plain numbers with up to 3 decimals', () => {
    expect(parseQuantity('12')).toBe(12)
    expect(parseQuantity(' 1.5 ')).toBe(1.5)
    expect(parseQuantity('0,25')).toBe(0.25)
    expect(parseQuantity('0')).toBe(0)
  })

  it('rejects anything else', () => {
    for (const text of ['', '-1', '1.2345', 'abc', '0+10', '1e3', '1.']) {
      expect(parseQuantity(text)).toBeUndefined()
    }
  })

  it('formats without trailing zeros', () => {
    expect(formatQuantity(1.5)).toBe('1.5')
    expect(formatQuantity(0.1 + 0.2)).toBe('0.3')
    expect(formatQuantity(7)).toBe('7')
  })
})

describe('low stock', () => {
  it('needs a minimum to be low', () => {
    expect(isLowStock({ stock: 2, minimumStock: 5 })).toBe(true)
    expect(isLowStock({ stock: 5, minimumStock: 5 })).toBe(false)
    expect(isLowStock({ stock: 0, minimumStock: undefined })).toBe(false)
  })
})
