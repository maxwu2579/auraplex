import core, { AccountRole } from '@hcengineering/core'
import contact from '@hcengineering/contact'
import materials from '@hcengineering/materials'
import notification from '@hcengineering/notification'
import { OnMaterialStockMovement } from '../index'

jest.mock('@hcengineering/account-client', () => ({
  getClient: () => ({
    getWorkspaceMembers: async () => [
      { person: 'owner', role: AccountRole.Owner },
      { person: 'member', role: AccountRole.User }
    ]
  })
}))
jest.mock('@hcengineering/server-token', () => ({ generateToken: () => 'test-token' }))
jest.mock('@hcengineering/server-contact', () => ({
  getPersonSpaces: async () => [{ _id: 'owner-space', person: 'owner-person' }],
  getAccountBySocialId: jest.fn(),
  getEmployeesBySocialIds: jest.fn()
}))

function fixture (): any {
  return {
    workspace: { uuid: 'workspace' },
    ctx: { contextData: { broadcast: { txes: [] } } },
    txes: [],
    cache: new Map(),
    contextCache: new Map(),
    removedMap: new Map(),
    findAll: async (_ctx: any, cls: string) => {
      if (cls === materials.class.Material) {
        return [
          {
            _id: 'material',
            _class: cls,
            space: 'space',
            code: 'TEST',
            name: 'Test',
            stock: 4,
            minimumStock: 5,
            rack: 'A',
            level: '1'
          }
        ]
      }
      if (cls === contact.mixin.Employee) { return [{ _id: 'owner-person', personUuid: 'owner', active: true, role: 'USER' }] }
      if (cls === contact.class.SocialIdentity) return []
      if (cls === notification.class.DocNotifyContext) return [{ _id: 'context', objectId: 'material', user: 'owner' }]
      return []
    },
    txFactory: { createTxCreateDoc: (cls: string, space: string, attributes: any) => ({ cls, space, attributes }) }
  }
}
function movement (kind: string, balance: number, delta: number): any {
  return {
    _class: core.class.TxCreateDoc,
    objectClass: materials.class.StockMovement,
    attachedTo: 'material',
    attributes: { kind, balance, delta },
    modifiedBy: 'author',
    modifiedOn: 1
  }
}

test('sends only to the owner when stock crosses below the minimum', async () => {
  const result: any[] = await OnMaterialStockMovement([movement('out', 4, -1)], fixture())
  expect(result).toHaveLength(1)
  expect(result[0].attributes.user).toBe('owner')
  expect(result[0].attributes.objectId).toBe('material')
  expect(result[0].attributes.messageHtml).toContain('TEST')
})

test('does not send for opening stock or while stock stays low', async () => {
  expect(await OnMaterialStockMovement([movement('opening', 4, -1), movement('out', 3, -1)], fixture())).toHaveLength(0)
})
