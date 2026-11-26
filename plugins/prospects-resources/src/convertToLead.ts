// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// SPDX-License-Identifier: EPL-2.0
import contact, {
  AvatarType,
  combineName,
  findPerson,
  type Channel,
  type Contact,
  type Organization
} from '@hcengineering/contact'
import core, {
  generateId,
  SortingOrder,
  type AccountUuid,
  type AttachedData,
  type Ref,
  type TxOperations
} from '@hcengineering/core'
import lead, { type Customer, type Funnel, type Lead } from '@hcengineering/lead'
import prospects, {
  normalizeEmail,
  prospectMailStatus,
  prospectWriteScope,
  type Prospect
} from '@hcengineering/prospects'
import task, { makeRank } from '@hcengineering/task'
import { jsonToMarkup, MarkupNodeType } from '@hcengineering/text-core'

function channelsOf (prospect: Prospect): Array<AttachedData<Channel>> {
  const channels: Array<AttachedData<Channel>> = []
  const email = normalizeEmail(prospect.email)
  if (email !== '') channels.push({ provider: contact.channelProvider.Email, value: email })
  for (const value of new Set([prospect.mobile?.trim(), prospect.phone?.trim()])) {
    if (value !== undefined && value !== '') channels.push({ provider: contact.channelProvider.Phone, value })
  }
  return channels
}

export async function convertToLead (
  client: TxOperations,
  prospectId: Ref<Prospect>,
  actor: AccountUuid
): Promise<Ref<Lead>> {
  const prospect = await client.findOne(prospects.class.Prospect, { _id: prospectId })
  if (prospect === undefined) throw new Error('Business card is unavailable')
  if (prospect.lead != null) return prospect.lead

  const name = prospect.name.trim()
  const company = prospect.company.trim()
  if (name === '' && company === '') throw new Error('A person or company name is required')
  const owner =
    (prospect.owner === undefined
      ? undefined
      : await client.findOne(contact.mixin.Employee, { personUuid: prospect.owner })) ??
    (await client.findOne(contact.mixin.Employee, { personUuid: actor }))
  const funnel = await client.findOne(
    lead.class.Funnel,
    { archived: false },
    {
      sort: { createdOn: SortingOrder.Ascending, _id: SortingOrder.Ascending }
    }
  )
  const type = await client.findOne(task.class.ProjectType, { _id: funnel?.type ?? lead.template.DefaultFunnel })
  if (type === undefined) throw new Error('Sales funnel type is unavailable')
  const kind = await client.findOne(task.class.TaskType, { _id: { $in: type.tasks }, ofClass: lead.class.Lead })
  const status = kind?.statuses[0]
  if (kind === undefined || status === undefined) throw new Error('Sales funnel stages are unavailable')
  const sequence = await client.findOne(core.class.Sequence, { attachedTo: lead.class.Lead })
  if (sequence === undefined) throw new Error('Lead sequence is unavailable')

  const ops = client.apply(prospectWriteScope)
  const leadId = ('prospect-lead:' + prospectId) as Ref<Lead>
  ops.notMatch(lead.class.Lead, { _id: leadId })
  // Guard the whole transaction, including contacts, against concurrent conversions or edits.
  ops.match(prospects.class.Prospect, {
    _id: prospectId,
    lead: { $exists: false },
    modifiedOn: prospect.modifiedOn
  })
  const funnelId = funnel?._id ?? generateId<Funnel>()
  if (funnel === undefined) {
    ops.notMatch(lead.class.Funnel, { archived: false })
    await ops.createDoc(
      lead.class.Funnel,
      core.space.Space,
      {
        name: '销售漏斗',
        description: '',
        private: false,
        archived: false,
        members: [actor],
        owners: [actor],
        autoJoin: false,
        type: type._id
      },
      funnelId
    )
    await ops.createMixin(funnelId, lead.class.Funnel, core.space.Space, type.targetClass, {})
  } else {
    ops.match(lead.class.Funnel, { _id: funnelId, archived: false, type: type._id })
  }

  let org: Organization | undefined
  let orgId: Ref<Organization> | undefined
  if (company !== '') {
    // Query case-insensitively, then compare literally (a name can contain SQL wildcard characters).
    const match = { name: { $like: company.replace(/[\\%_]/g, '\\$&') } }
    const candidates = await client.findAll(contact.class.Organization, match)
    org = candidates.find((candidate) => candidate.name.trim().toLowerCase() === company.toLowerCase())
    orgId = org?._id ?? generateId<Organization>()
    if (org === undefined) {
      ops.notMatch(contact.class.Organization, match)
      await ops.createDoc(
        contact.class.Organization,
        contact.space.Contacts,
        {
          name: company,
          description: null,
          members: 0,
          avatarType: AvatarType.COLOR
        },
        orgId
      )
    }
  }

  const contactChannels = channelsOf(prospect)
  const personName = combineName(name !== '' ? name : company, '')
  const matches = (await findPerson(client, personName, contactChannels)).filter((match) =>
    client.getHierarchy().isDerived(match._class, contact.class.Person)
  )
  const person = matches.length === 1 ? matches[0] : undefined
  const personId = person?._id ?? generateId()
  if (person === undefined) {
    await ops.createDoc(
      contact.class.Person,
      contact.space.Contacts,
      {
        name: personName,
        avatarType: AvatarType.COLOR
      },
      personId
    )
  }
  const personSpace = person?.space ?? contact.space.Contacts
  const existingChannels =
    person === undefined ? [] : await client.findAll(contact.class.Channel, { attachedTo: personId })
  for (const channel of contactChannels) {
    if (
      !existingChannels.some(
        (existing) =>
          existing.provider === channel.provider && existing.value.trim().toLowerCase() === channel.value.toLowerCase()
      )
    ) {
      await ops.addCollection(contact.class.Channel, personSpace, personId, contact.class.Person, 'channels', channel)
    }
  }
  if (orgId !== undefined) {
    const orgSpace = org?.space ?? contact.space.Contacts
    const relation = { attachedTo: orgId, contact: personId }
    if (org === undefined || (await client.findOne(contact.class.Member, relation)) === undefined) {
      ops.notMatch(contact.class.Member, relation)
      await ops.addCollection(contact.class.Member, orgSpace, orgId, contact.class.Organization, 'members', {
        contact: personId
      })
    }
  }

  const customer: Contact | undefined = company !== '' ? org : person
  const customerId = orgId ?? personId
  if (customer === undefined || !client.getHierarchy().hasMixin(customer, lead.mixin.Customer)) {
    if (customer !== undefined) ops.notMatch(lead.mixin.Customer, { _id: customerId as Ref<Customer> })
    await ops.createMixin<Contact, Customer>(
      customerId,
      orgId === undefined ? contact.class.Person : contact.class.Organization,
      customer?.space ?? contact.space.Contacts,
      lead.mixin.Customer,
      { customerDescription: null }
    )
  }
  const last = await client.findOne(
    lead.class.Lead,
    { space: funnelId, status },
    { sort: { rank: SortingOrder.Descending } }
  )
  const incremented = await client.update(sequence, { $inc: { sequence: 1 } }, true)
  const number = (incremented as { object?: { sequence: number } }).object?.sequence
  if (typeof number !== 'number') throw new Error('Lead number could not be allocated')
  const description = jsonToMarkup({
    type: MarkupNodeType.doc,
    content: [
      ['职位 / Job title', prospect.title],
      ['国家 / Country', prospect.country],
      ['行业 / Industry', prospect.industry],
      ['来源 / Source', prospect.source],
      ['备注 / Notes', prospect.notes]
    ]
      .filter(([, value]) => value?.trim())
      .map(([label, value]) => ({
        type: MarkupNodeType.paragraph,
        content: [{ type: MarkupNodeType.text, text: `${label}: ${value}` }]
      }))
  })
  await ops.addCollection(
    lead.class.Lead,
    funnelId,
    customerId as Ref<Customer>,
    lead.mixin.Customer,
    'leads',
    {
      title: [company, name].filter(Boolean).join(' - '),
      description,
      number,
      identifier: `LEAD-${number}`,
      kind: kind._id,
      status,
      rank: makeRank(last?.rank, undefined),
      assignee: owner?._id ?? null,
      startDate: null,
      dueDate: null
    },
    leadId
  )
  await ops.update(prospect, { lead: leadId, status: 'converted', mailStatus: prospectMailStatus(prospect) })
  if ((await ops.commit()).result) return leadId
  const current = await client.findOne(prospects.class.Prospect, { _id: prospectId })
  if (current?.lead != null) return current.lead
  throw new Error('Business card or funnel changed. Retry conversion.')
}
