// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { randomUUID } from 'node:crypto'
import core, { type AccountUuid, type Ref, type TxOperations } from '@hcengineering/core'
import contact, { formatName } from '@hcengineering/contact'
import prospects, {
  canSendMail, defaultAutomation, formatMarketingMail, introCandidates, marketingEmail, readAutomationSettings, readMailTemplate,
  type MailAutomation, type MailCampaign, type MailTemplate, type Prospect, type ProspectMail
} from '@hcengineering/prospects'
import { singaporeClock, workdays } from './schedule'
import type { ScheduledRecords } from './scheduledRecords'
import type { Sender } from './sender'
import { MailUserError } from './errors'

const dayMs = 86_400_000
export function mailSlots (now: number, limit: number): number[] {
  const day = singaporeClock(now)
  const hour = Number(day.time.slice(0, 2)) - 9
  if (!workdays.includes(day.weekday) || hour < 0 || hour >= 8) return []
  const first = Math.floor(hour * limit / 8)
  const stop = Math.floor((hour + 1) * limit / 8)
  return Array.from({ length: stop - first }, (_, index) => index + first)
}

type Control = Pick<MailAutomation, 'settings' | 'enrolledFrom' | 'releasedThrough' | 'removed' | 'campaign'>
const defaultControl: Control = { settings: defaultAutomation, removed: [] }
const campaignRunning = (campaign: MailCampaign | undefined): campaign is MailCampaign =>
  campaign !== undefined && (campaign.status === 'active' || campaign.status === 'paused')

function startDate (value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export class AutomatedMail {
  constructor (private readonly client: TxOperations, private readonly records: ScheduledRecords) {}

  private async read (): Promise<MailAutomation | undefined> {
    return await this.client.findOne(prospects.class.MailAutomation, { _id: prospects.ids.MailAutomation })
  }

  private async change (update: (state: Control) => Partial<Control>): Promise<void> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const doc = await this.read()
      const changes = update(doc ?? defaultControl)
      if (Object.keys(changes).length === 0) return
      const ops = this.client.apply('prospect-mail-automation')
      if (doc === undefined) {
        ops.notMatch(prospects.class.MailAutomation, { _id: prospects.ids.MailAutomation })
        await ops.createDoc(prospects.class.MailAutomation, core.space.Workspace, { ...defaultControl, ...changes }, prospects.ids.MailAutomation)
      } else {
        ops.match(prospects.class.MailAutomation, { _id: doc._id, modifiedOn: doc.modifiedOn })
        await ops.update(doc, changes)
      }
      if ((await ops.commit()).result) return
    }
    throw new MailUserError('Concurrent changes')
  }

  async action (actor: AccountUuid, value: unknown, now = Date.now()): Promise<void> {
    if (value === null || typeof value !== 'object') throw new MailUserError('Invalid action')
    const input = value as Record<string, unknown>
    if (input.op === 'settings') {
      const settings = readAutomationSettings(input.settings)
      if (settings === undefined) throw new MailUserError('Invalid settings')
      await this.change((state) => ({
        settings,
        ...(settings.enabled && state.enrolledFrom === undefined ? { enrolledFrom: now } : {})
      }))
      return
    }
    if (input.op === 'create') {
      const template = readMailTemplate(input.template)
      const start = input.start
      const title = typeof input.title === 'string' ? input.title.trim().slice(0, 120) : ''
      if (template === undefined || !startDate(start) || title === '') throw new MailUserError('Invalid campaign')
      const customers = await this.client.findAll(prospects.class.Prospect, {})
      const addresses = new Set<string>()
      const ids = customers.flatMap((customer) => {
        const email = marketingEmail(customer)
        if (email === undefined || addresses.has(email)) return []
        addresses.add(email)
        return [customer._id]
      })
      await this.change((state) => {
        if (campaignRunning(state.campaign) || (state.campaign?.status === 'done' && state.campaign.notified !== true)) {
          throw new MailUserError('Another campaign is still active')
        }
        return { campaign: { id: randomUUID(), title, template, start, status: 'active', customers: ids, removed: [], actor } }
      })
      return
    }
    const id = input.id as Ref<Prospect>
    if (input.op === 'remove-intro' && typeof id === 'string') {
      await this.change((state) => !state.removed.includes(id) ? { removed: [...state.removed, id] } : {})
      return
    }
    await this.change((state) => {
      const campaign = state.campaign
      if (!campaignRunning(campaign) || input.campaign !== campaign.id) throw new MailUserError('Campaign changed')
      if (input.op === 'remove-campaign' && typeof id === 'string' && campaign.customers.includes(id)) {
        return { campaign: { ...campaign, removed: [...new Set([...campaign.removed, id])] } }
      }
      const status = input.op === 'pause' ? 'paused' : input.op === 'resume' ? 'active' : input.op === 'stop' ? 'stopped' : undefined
      if (status === undefined) throw new MailUserError('Invalid action')
      return { campaign: { ...campaign, status } }
    })
  }

  private async snapshot (control: Control): Promise<{ customers: Prospect[], intro: Prospect[], mail: ProspectMail[] }> {
    const [customers, mail] = await Promise.all([
      this.client.findAll(prospects.class.Prospect, {}),
      this.client.findAll(prospects.class.ProspectMail, { direction: 'outgoing' })
    ])
    return {
      customers, mail,
      intro: control.enrolledFrom === undefined ? []
        : introCandidates(customers, control.enrolledFrom, new Set(control.removed), new Set(mail.map((entry) => entry.attachedTo)))
    }
  }

  async dashboard (now = Date.now()): Promise<Record<string, unknown>> {
    const state = (await this.read()) ?? defaultControl
    const { customers, intro, mail } = await this.snapshot(state)
    const campaign = state.campaign
    const sent = mail.filter((entry) => entry.automation !== undefined && entry.delivery === 'sent' &&
      singaporeClock(entry.sentAt).date === singaporeClock(now).date).length
    const oldest = intro[0]?.createdOn
    const due = oldest === undefined ? undefined
      : (intro.length >= state.settings.limit || oldest <= (state.releasedThrough ?? -1)) ? now
        : oldest + state.settings.waitDays * dayMs
    return {
      settings: state.settings, sent, oldest, due,
      intro: intro.map(({ _id, name }) => ({ id: _id, name })),
      campaign: campaign === undefined ? undefined : {
        ...campaign,
        total: campaign.customers.length,
        sent: mail.filter((entry) => entry.campaign === campaign.id && entry.delivery === 'sent').length,
        pending: this.remainingCampaign(campaign, state, customers, intro, mail).map(({ _id, name }) => ({ id: _id, name }))
      },
      log: mail.filter((entry) => entry.automation !== undefined).sort((a, b) => b.sentAt - a.sentAt).slice(0, 100)
        .map(({ _id, attachedTo, sentAt, automation, delivery, subject }) => ({ id: _id, prospect: attachedTo, sentAt, automation, delivery, subject }))
    }
  }

  private remainingCampaign (
    campaign: MailCampaign, state: Control, customers: Prospect[], intro: Prospect[], mail: ProspectMail[]
  ): Prospect[] {
    const excluded = new Set([...campaign.removed, ...mail.filter((entry) => entry.campaign === campaign.id).map((entry) => entry.attachedTo)])
    if (state.settings.enabled) for (const customer of intro) excluded.add(customer._id)
    const members = new Set(campaign.customers)
    return customers.filter((customer) => members.has(customer._id) && !excluded.has(customer._id) && marketingEmail(customer) !== undefined)
  }

  async check (
    now: number, sender: Sender, onFailure: () => void,
    onComplete: (campaign: MailCampaign, sent: number) => Promise<void>
  ): Promise<void> {
    let control = await this.read()
    if (control === undefined) return
    const { customers, intro, mail } = await this.snapshot(control)
    if (control.settings.enabled && (intro.length >= control.settings.limit ||
      (intro[0] !== undefined && now - (intro[0].createdOn ?? now) >= control.settings.waitDays * dayMs &&
        (intro[0].createdOn ?? now) > (control.releasedThrough ?? -1)))) {
      await this.change(() => ({ releasedThrough: now }))
      control = await this.read()
      if (control === undefined) return
    }
    const campaign = control.campaign
    const date = singaporeClock(now).date
    const queue = intro.filter((customer) => control?.settings.enabled === true && (customer.createdOn ?? now) <= (control?.releasedThrough ?? -1))
      .map((customer) => ({ customer, kind: 'intro' as const }))
    const campaignQueue = campaign?.status === 'active' && campaign.start <= date
      ? this.remainingCampaign(campaign, control, customers, intro, mail).map((customer) => ({ customer, kind: 'campaign' as const }))
      : []
    const candidates = [...queue, ...campaignQueue]
    // Every hour has a fixed set of database-backed slots shared by both queues.
    for (const slot of mailSlots(now, control.settings.limit)) {
      if (candidates.length === 0) break
      if (!await this.records.claim('prospect-slot', date, String(slot))) continue
      while (candidates.length > 0) {
        const item = candidates.shift()
        if (item !== undefined && await this.send(item.customer, item.kind, campaign, sender, onFailure)) break
      }
    }
    await this.finishCampaign(campaign, date, onComplete)
  }

  private async send (
    customer: Prospect, kind: 'intro' | 'campaign', campaign: MailCampaign | undefined, sender: Sender, onFailure: () => void
  ): Promise<boolean> {
    const current = await this.read()
    if (current === undefined || (kind === 'intro' && !current.settings.enabled)) return false
    const fresh = await this.client.findOne(prospects.class.Prospect, { _id: customer._id })
    const email = fresh === undefined ? undefined : marketingEmail(fresh)
    if (fresh === undefined || email === undefined || email !== marketingEmail(customer) || canSendMail(fresh, Date.now()) !== undefined) return false
    let template: MailTemplate
    if (kind === 'intro') {
      if (current.removed.includes(customer._id) || fresh.status !== 'new' || (fresh.emailCount ?? 0) > 0) return false
      const duplicates = await this.client.findAll(prospects.class.Prospect, { normalizedEmail: email }, { limit: 2 })
      if (duplicates.length > 1) return false
      template = current.settings[current.settings.language]
    } else {
      if (campaign === undefined || current.campaign?.id !== campaign.id || current.campaign.status !== 'active' ||
        current.campaign.removed.includes(customer._id)) return false
      template = campaign.template
    }
    const identity = fresh.owner === undefined
      ? await this.client.findOne(contact.class.SocialIdentity, { _id: (fresh.createdBy ?? fresh.modifiedBy) as Ref<import('@hcengineering/contact').SocialIdentity> & typeof fresh.modifiedBy })
      : undefined
    const creator = identity === undefined ? undefined : await this.client.findOne(contact.mixin.Employee, { _id: identity.attachedTo as Ref<import('@hcengineering/contact').Employee> })
    const actor = fresh.owner ?? creator?.personUuid ?? campaign?.actor
    if (actor === undefined) return false
    if (fresh.owner === undefined && kind === 'intro') {
      const assign = this.client.apply('prospect-mail-automation')
      assign.match(prospects.class.Prospect, { _id: fresh._id, modifiedOn: fresh.modifiedOn })
      await assign.update(fresh, { owner: actor })
      if (!(await assign.commit()).result) return false
    }
    const person = await this.client.findOne(contact.class.Person, { personUuid: actor })
    const message = formatMarketingMail(template, fresh, person === undefined ? '' : formatName(person.name))
    const key = kind === 'intro' ? 'once' : campaign?.id ?? ''
    if (!await this.records.claim(`prospect-${kind}`, key, email)) return false
    try {
      // A deterministic request ID is recorded by Sender before contacting SMTP.
      await sender.send(actor, fresh._id, `${key}-${fresh._id}`, message.subject, message.body, { kind, campaign: campaign?.id && kind === 'campaign' ? campaign.id : undefined })
    } catch {
      onFailure()
      if (kind === 'intro') await this.change((state) => ({ removed: [...new Set([...state.removed, fresh._id])] }))
      else await this.change((state) => state.campaign?.id !== campaign?.id || state.campaign === undefined ? {}
        : { campaign: { ...state.campaign, removed: [...new Set([...state.campaign.removed, fresh._id])] } })
    }
    return true
  }

  private async finishCampaign (
    campaign: MailCampaign | undefined, date: string, notify: (campaign: MailCampaign, count: number) => Promise<void>
  ): Promise<void> {
    if (campaign === undefined || campaign.start > date || campaign.status === 'paused' || campaign.status === 'stopped') return
    const state = await this.read()
    if (state?.campaign?.id !== campaign.id || state.campaign.notified === true) return
    const { customers, mail } = await this.snapshot(state)
    const history = mail.filter((entry) => entry.campaign === campaign.id)
    if (state.campaign.status === 'active') {
      const pending = this.remainingCampaign(state.campaign, state, customers, [], mail)
      if (pending.length > 0 || history.some((entry) => entry.delivery === 'sending' && Date.now() - entry.sentAt < 300_000)) return
      await this.change((value) => value.campaign?.id === campaign.id && value.campaign.status === 'active'
        ? { campaign: { ...value.campaign, status: 'done' } } : {})
    }
    const ready = (await this.read())?.campaign
    if (ready?.id !== campaign.id || ready.status !== 'done' || ready.notified === true) return
    await notify(ready, history.filter((entry) => entry.delivery === 'sent').length)
    await this.change((value) => value.campaign?.id === campaign.id
      ? { campaign: { ...value.campaign, notified: true } } : {})
  }
}
