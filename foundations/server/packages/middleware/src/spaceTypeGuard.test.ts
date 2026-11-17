// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import core, { AccountRole, type Class, type Doc, type Ref, type Tx } from '@hcengineering/core'
import { modifiesSpaceTypes, SpaceTypeGuardMiddleware } from './spaceTypeGuard'

const same = (a: Ref<Class<Doc>>, b: Ref<Class<Doc>>): boolean => a === b
const tx = (kind: string, objectClass: string): Tx => ({ _class: kind, objectClass }) as unknown as Tx
test.each([core.class.TxCreateDoc, core.class.TxUpdateDoc, core.class.TxRemoveDoc, core.class.TxMixin])(
  'protects space configuration for transaction %s',
  (kind) => {
    for (const cls of [core.class.SpaceType, core.class.Role, core.class.Permission]) {
      expect(modifiesSpaceTypes(tx(kind, cls), same)).toBe(true)
    }
    expect(modifiesSpaceTypes(tx(kind, 'unrelated'), same)).toBe(false)
  }
)
test('inspects transactions inside a conditional batch', () => {
  const batch = { _class: core.class.TxApplyIf, txes: [tx(core.class.TxUpdateDoc, core.class.Role)] } as unknown as Tx
  expect(modifiesSpaceTypes(batch, same)).toBe(true)
})

test('ordinary project, task, document space and drive changes are not space type changes', () => {
  for (const cls of ['tracker:class:Project', 'tracker:class:Issue', 'document:class:Teamspace', 'drive:class:Drive']) {
    for (const kind of [core.class.TxCreateDoc, core.class.TxUpdateDoc, core.class.TxMixin]) {
      expect(modifiesSpaceTypes(tx(kind, cls), same)).toBe(false)
    }
  }
})

test('server denies ordinary members and allows owner and system', async () => {
  const middleware = await SpaceTypeGuardMiddleware.create(
    {} as any,
    { hierarchy: { isDerived: same } } as any,
    undefined
  )
  const provide = jest.fn().mockResolvedValue({})
  ;(middleware as any).provideTx = provide
  const change = [tx(core.class.TxUpdateDoc, core.class.Role)]
  const context = (role: AccountRole, primarySocialId = 'person'): any => ({
    contextData: { account: { role, primarySocialId } }
  })
  await expect(middleware.tx(context(AccountRole.User), change)).rejects.toThrow()
  await expect(middleware.tx(context(AccountRole.Maintainer), change)).rejects.toThrow()
  await expect(middleware.tx(context(AccountRole.Admin), change)).rejects.toThrow()
  await expect(middleware.tx(context(AccountRole.Owner), change)).resolves.toBeDefined()
  await expect(middleware.tx(context(AccountRole.User, core.account.System), change)).resolves.toBeDefined()
})
