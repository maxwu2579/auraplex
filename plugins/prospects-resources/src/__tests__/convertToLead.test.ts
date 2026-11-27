// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import contact from '@hcengineering/contact'
import core, { type AccountUuid, type Ref, type TxOperations } from '@hcengineering/core'
import lead from '@hcengineering/lead'
import prospects, { defaultProspectFields, type Prospect } from '@hcengineering/prospects'
import task from '@hcengineering/task'
import { convertToLead, LeadConversionTimeout } from '../convertToLead'

const actor = 'salesperson' as AccountUuid
const id = 'card' as Ref<Prospect>

function fixture (company: string, options: { organization?: boolean, converted?: boolean, funnel?: boolean } = {}) {
  const prospect = {
    _id: id,
    name: 'Max Wu',
    company,
    email: 'MAX@EXAMPLE.TEST',
    phone: '5550100',
    mobile: '5550100',
    owner: 'assigned-owner',
    status: 'do-not-send',
    title: 'Engineer',
    notes: 'Synthetic record',
    country: 'SG',
    industry: 'Manufacturing',
    source: 'Test',
    modifiedOn: 123,
    ...(options.converted === true ? { lead: 'already-linked' } : {})
  }
  const ops = {
    match: jest.fn(),
    notMatch: jest.fn(),
    createDoc: jest.fn().mockResolvedValue(undefined),
    createMixin: jest.fn().mockResolvedValue(undefined),
    addCollection: jest.fn().mockResolvedValue('prospect-lead:card'),
    update: jest.fn().mockResolvedValue(undefined),
    commit: jest.fn().mockResolvedValue({ result: true })
  }
  const org = {
    _id: 'existing-org',
    _class: contact.class.Organization,
    name: company.toUpperCase(),
    space: 'contact-space'
  }
  const findOne = jest.fn(async (cls: string) => {
    if (cls === prospects.class.Prospect) return prospect
    if (cls === contact.mixin.Employee) return { _id: 'employee-owner' }
    if (cls === lead.class.Funnel && options.funnel !== false) { return { _id: 'active-funnel', type: lead.template.DefaultFunnel } }
    if (cls === task.class.ProjectType) { return { _id: lead.template.DefaultFunnel, tasks: ['kind'], targetClass: 'funnel-type-mixin' } }
    if (cls === task.class.TaskType) return { _id: 'kind', statuses: ['new-status'] }
    if (cls === core.class.Sequence) return { _id: 'counter', sequence: 41 }
  })
  const client = {
    findOne,
    findAll: jest.fn(async (cls: string) =>
      cls === contact.class.Organization && options.organization === true ? [org] : []
    ),
    update: jest.fn().mockResolvedValue({ object: { sequence: 42 } }),
    apply: jest.fn().mockReturnValue(ops),
    getHierarchy: () => ({ hasMixin: () => false, isDerived: () => true })
  }
  return { client: client as unknown as TxOperations, ops, rawClient: client, prospect, org }
}

test('creates company, person with channels, and a lead for the assigned employee in a fallback funnel', async () => {
  const { client, rawClient, ops, prospect } = fixture('Max Example Trading Co.', { funnel: false })
  expect(await convertToLead(client, id, actor)).toBe('prospect-lead:card')
  expect(rawClient.findOne).toHaveBeenCalledWith(contact.mixin.Employee, { personUuid: 'assigned-owner' })
  expect(ops.createDoc).toHaveBeenCalledWith(
    lead.class.Funnel,
    core.space.Space,
    expect.objectContaining({ name: '销售漏斗', archived: false }),
    expect.any(String)
  )
  const funnelId = ops.createDoc.mock.calls.find(([cls]) => cls === lead.class.Funnel)?.[3]
  expect(rawClient.findOne.mock.calls.some(([cls]) => cls === lead.class.Lead)).toBe(false)
  expect(ops.createMixin).toHaveBeenCalledWith(funnelId, lead.class.Funnel, core.space.Space, 'funnel-type-mixin', {})
  expect(ops.notMatch).toHaveBeenCalledWith(lead.class.Funnel, { archived: false })
  expect(ops.createDoc).toHaveBeenCalledWith(
    contact.class.Organization,
    contact.space.Contacts,
    expect.objectContaining({ name: prospect.company }),
    expect.any(String)
  )
  expect(ops.createDoc).toHaveBeenCalledWith(
    contact.class.Person,
    contact.space.Contacts,
    expect.objectContaining({ name: ',Max Wu' }),
    expect.any(String)
  )
  expect(ops.addCollection).toHaveBeenCalledWith(
    contact.class.Channel,
    contact.space.Contacts,
    expect.any(String),
    contact.class.Person,
    'channels',
    { value: 'max@example.test', provider: contact.channelProvider.Email }
  )
  expect(
    ops.addCollection.mock.calls.filter(
      ([cls, , , , , fields]) => cls === contact.class.Channel && fields.provider === contact.channelProvider.Phone
    )
  ).toHaveLength(1)
  expect(ops.addCollection).toHaveBeenCalledWith(
    contact.class.Member,
    contact.space.Contacts,
    expect.any(String),
    contact.class.Organization,
    'members',
    expect.objectContaining({ contact: expect.any(String) })
  )
  expect(ops.addCollection).toHaveBeenCalledWith(
    lead.class.Lead,
    funnelId,
    expect.any(String),
    lead.mixin.Customer,
    'leads',
    expect.objectContaining({
      title: 'Max Example Trading Co. - Max Wu',
      assignee: 'employee-owner',
      status: 'new-status',
      identifier: 'LEAD-42',
      description: expect.stringContaining('Synthetic record')
    }),
    'prospect-lead:card'
  )
  expect(ops.update).toHaveBeenCalledWith(prospect, {
    lead: 'prospect-lead:card',
    status: 'converted',
    mailStatus: 'do-not-send'
  })
  expect(ops.commit).toHaveBeenCalledTimes(1)
})

test('uses the person as customer when the card has no company', async () => {
  const { client, ops, rawClient } = fixture('')
  await convertToLead(client, id, actor)
  expect(ops.createDoc.mock.calls.some(([cls]) => cls === lead.class.Funnel)).toBe(false)
  expect(rawClient.findOne).toHaveBeenCalledWith(lead.class.Lead, { space: 'active-funnel', status: 'new-status' },
    { sort: { rank: -1 } })
  const personId = ops.createDoc.mock.calls.find(([cls]) => cls === contact.class.Person)?.[3]
  expect(ops.createDoc).not.toHaveBeenCalledWith(
    contact.class.Organization,
    expect.anything(),
    expect.anything(),
    expect.anything()
  )
  expect(ops.createMixin).toHaveBeenCalledWith(
    personId,
    contact.class.Person,
    contact.space.Contacts,
    lead.mixin.Customer,
    { customerDescription: null }
  )
  expect(ops.addCollection).toHaveBeenCalledWith(
    lead.class.Lead,
    'active-funnel',
    personId,
    lead.mixin.Customer,
    'leads',
    expect.objectContaining({ title: 'Max Wu' }),
    'prospect-lead:card'
  )
})

test('reuses an organization whose name has different capitalization', async () => {
  const { client, rawClient, ops, org } = fixture('Max Example Trading Co.', { organization: true })
  await convertToLead(client, id, actor)
  expect(rawClient.findAll).toHaveBeenCalledWith(contact.class.Organization, {
    name: { $like: 'Max Example Trading Co.' }
  })
  expect(ops.createDoc).not.toHaveBeenCalledWith(
    contact.class.Organization,
    expect.anything(),
    expect.anything(),
    expect.anything()
  )
  expect(ops.addCollection).toHaveBeenCalledWith(
    lead.class.Lead,
    'active-funnel',
    org._id,
    lead.mixin.Customer,
    'leads',
    expect.anything(),
    'prospect-lead:card'
  )
})

test('opening an already converted card never attempts a write', async () => {
  const { client, rawClient, ops } = fixture('Max Example Trading Co.', { converted: true })
  expect(await convertToLead(client, id, actor)).toBe('already-linked')
  expect(rawClient.apply).not.toHaveBeenCalled()
  expect(ops.commit).not.toHaveBeenCalled()
})

test('a concurrent conversion returns the lead saved by the winning transaction', async () => {
  const { client, ops, rawClient, prospect } = fixture('')
  ops.commit.mockImplementationOnce(async () => {
    rawClient.findOne.mockResolvedValueOnce({ ...prospect, lead: 'winner' })
    return { result: false }
  })
  expect(await convertToLead(client, id, actor)).toBe('winner')
  expect(ops.match).toHaveBeenCalledWith(prospects.class.Prospect, {
    _id: id,
    lead: { $exists: false },
    modifiedOn: 123
  })
})

test('a stalled read times out and cannot start writes after it returns', async () => {
  jest.useFakeTimers()
  try {
    const { client, rawClient, ops, prospect } = fixture('')
    let finishRead!: (value: typeof prospect) => void
    rawClient.findOne.mockImplementationOnce(async () => await new Promise<typeof prospect>((resolve) => { finishRead = resolve }))
    const result = expect(convertToLead(client, id, actor)).rejects.toBeInstanceOf(LeadConversionTimeout)
    await jest.advanceTimersByTimeAsync(20_000)
    await result

    finishRead(prospect)
    await jest.advanceTimersByTimeAsync(0)
    expect(rawClient.update).not.toHaveBeenCalled()
    expect(ops.commit).not.toHaveBeenCalled()
  } finally {
    jest.useRealTimers()
  }
})

test('a stalled commit times out instead of leaving the conversion pending', async () => {
  jest.useFakeTimers()
  try {
    const { client, ops } = fixture('')
    ops.commit.mockImplementation(async () => await new Promise(() => {}))
    const result = expect(convertToLead(client, id, actor)).rejects.toBeInstanceOf(LeadConversionTimeout)
    await jest.advanceTimersByTimeAsync(20_000)
    await result
    expect(ops.commit).toHaveBeenCalledTimes(1)
  } finally {
    jest.useRealTimers()
  }
})

test('lead description uses visible custom fields and formats dates from the template', async () => {
  const { client, rawClient, ops, prospect } = fixture('')
  const card = {
    ...prospect,
    custom: { c_visit: Date.UTC(2026, 10, 27), c_hidden: 'Private note', c_removed: 'Removed earlier' }
  }
  rawClient.findOne.mockResolvedValueOnce(card)
  await convertToLead(client, id, actor, [
    ...defaultProspectFields.map((field) => ({ ...field, hidden: field.key === 'country' })),
    { key: 'c_visit', builtin: false, label: 'Visit', type: 'date', hidden: false, order: 12 },
    { key: 'c_hidden', builtin: false, label: 'Hidden', type: 'text', hidden: true, order: 13 }
  ])
  const leadWrite = ops.addCollection.mock.calls.find(([cls]) => cls === lead.class.Lead)
  const description: string = leadWrite?.[5].description
  expect(description).toContain('Visit: 2026-11-27')
  expect(description).not.toMatch(/Private note|Removed earlier|Country: SG/)
})
