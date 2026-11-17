// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import core, {
  AccountRole,
  TxProcessor,
  type Class,
  type Doc,
  type MeasureContext,
  type Ref,
  type SessionData,
  type Tx,
  type TxApplyIf,
  type TxCUD
} from '@hcengineering/core'
import platform, { PlatformError, Severity, Status } from '@hcengineering/platform'
import {
  BaseMiddleware,
  type Middleware,
  type PipelineContext,
  type TxMiddlewareResult
} from '@hcengineering/server-core'

/** Inspect nested conditional transactions too; otherwise callers could bypass the guard. */
export function modifiesSpaceTypes (
  tx: Tx,
  isDerived: (child: Ref<Class<Doc>>, parent: Ref<Class<Doc>>) => boolean
): boolean {
  if (tx._class === core.class.TxApplyIf) {
    return (tx as TxApplyIf).txes.some((item) => modifiesSpaceTypes(item, isDerived))
  }
  if (!TxProcessor.isExtendsCUD(tx._class)) return false
  const cls = (tx as TxCUD<Doc>).objectClass
  return [core.class.SpaceType, core.class.Role, core.class.Permission].some((target) => isDerived(cls, target))
}

export class SpaceTypeGuardMiddleware extends BaseMiddleware implements Middleware {
  static async create (
    _ctx: MeasureContext,
    context: PipelineContext,
    next: Middleware | undefined
  ): Promise<SpaceTypeGuardMiddleware> {
    return new SpaceTypeGuardMiddleware(context, next)
  }

  async tx (ctx: MeasureContext<SessionData>, txes: Tx[]): Promise<TxMiddlewareResult> {
    const account = ctx.contextData.account
    if (account.primarySocialId !== core.account.System && account.role !== AccountRole.Owner) {
      const hierarchy = this.context.hierarchy
      if (txes.some((tx) => modifiesSpaceTypes(tx, (child, parent) => hierarchy.isDerived(child, parent)))) {
        throw new PlatformError(new Status(Severity.ERROR, platform.status.Forbidden, {}))
      }
    }
    return await this.provideTx(ctx, txes)
  }
}
