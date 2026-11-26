//
// Copyright © 2024 Hardcore Engineering Inc.
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

import core, {
  type MeasureContext,
  type Tx,
  type TxApplyIf,
  type TxApplyResult,
  type TxResult
} from '@hcengineering/core'
import type { Middleware, PipelineContext, TxMiddlewareResult } from '@hcengineering/server-core'
import { BaseMiddleware } from '@hcengineering/server-core'

/**
 * Will support apply tx
 * @public
 */
export class ApplyTxMiddleware extends BaseMiddleware implements Middleware {
  private readonly scopes = new Map<string, Promise<void>>()

  static async create (ctx: MeasureContext, context: PipelineContext, next?: Middleware): Promise<Middleware> {
    return new ApplyTxMiddleware(context, next)
  }

  async tx (ctx: MeasureContext, txes: Tx[]): Promise<TxMiddlewareResult> {
    const result: TxResult[] = []

    let part: Tx[] = []
    for (const tx of txes) {
      if (this.context.hierarchy.isDerived(tx._class, core.class.TxApplyIf)) {
        if (part.length > 0) {
          part = []
          result.push(await this.provideTx(ctx, part))
        }
        const applyIf = tx as TxApplyIf
        const release = applyIf.scope == null ? undefined : await this.acquireScope(applyIf.scope)
        try {
          const check = applyIf.scope == null ? { passed: true } : await this.verifyApplyIf(ctx, applyIf)
          if (check.passed) {
            const applyResult: TxApplyResult = {
              success: true,
              serverTime: 0
            }
            result.push(applyResult)

            const st = Date.now()
            const r = await this.provideTx(ctx, applyIf.txes)
            if (Object.keys(r).length > 0) {
              result.push(r)
            }
            applyResult.serverTime = Date.now() - st
          } else {
            ctx.warn('TxApplyIf failed', {
              scope: applyIf.scope,
              reason: check.reason,
              measureName: applyIf.measureName,
              matchCount: applyIf.match?.length ?? 0,
              notMatchCount: applyIf.notMatch?.length ?? 0,
              txCount: applyIf.txes.length
            })
            result.push({
              success: false
            })
          }
        } finally {
          release?.()
        }
      } else {
        part.push(tx)
      }
    }
    if (part.length > 0) {
      result.push(await this.provideTx(ctx, part))
    }
    if (Array.isArray(result) && result.length === 1) {
      return result[0]
    }
    return result
  }

  private async acquireScope (scope: string): Promise<() => void> {
    const previous = this.scopes.get(scope)
    let finish!: () => void
    const current = new Promise<void>((resolve) => { finish = resolve })
    // Enqueue before waiting so callers arriving together cannot acquire the same scope.
    this.scopes.set(scope, current)
    await previous
    return () => {
      if (this.scopes.get(scope) === current) this.scopes.delete(scope)
      finish()
    }
  }

  private async verifyApplyIf (ctx: MeasureContext, applyIf: TxApplyIf): Promise<{ passed: boolean, reason?: string }> {
    let passed = true
    let reason: string | undefined
    if (applyIf.match != null) {
      for (const { _class, query } of applyIf.match) {
        const res = await this.provideFindAll(ctx, _class, query, { limit: 1 })
        if (res.length === 0) {
          passed = false
          reason = `match query failed: class=${_class}, query=${JSON.stringify(query)}`
          break
        }
      }
    }
    if (passed && applyIf.notMatch != null) {
      for (const { _class, query } of applyIf.notMatch) {
        const res = await this.provideFindAll(ctx, _class, query, { limit: 1 })
        if (res.length > 0) {
          passed = false
          reason = `notMatch query failed: class=${_class}, query=${JSON.stringify(query)} (found ${res.length} matching document(s))`
          break
        }
      }
    }
    return { passed, reason }
  }
}
