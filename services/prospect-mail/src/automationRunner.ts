// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import { AccountRole, type TxOperations } from '@hcengineering/core'
import type { AccountClient } from '@hcengineering/account-client'
import prospects, { type MailCampaign } from '@hcengineering/prospects'
import { addProspectNotice } from './prospectNotice'
import { prospectDepartments, prospectLeads } from './prospectPermissions'
import type { ScheduledRecords } from './scheduledRecords'
import type { SendTaskMail } from './taskReminders'

export async function campaignCompletion (
  client: TxOperations, account: AccountClient, records: ScheduledRecords, send: SendTaskMail | undefined,
  campaign: MailCampaign, count: number
): Promise<void> {
  const doc = await client.findOne(prospects.class.MailAutomation, { _id: prospects.ids.MailAutomation })
  if (doc === undefined) return
  const [teams, members] = await Promise.all([prospectDepartments(client), account.getWorkspaceMembers()])
  const leads = prospectLeads(teams, members.filter((member) => member.role === AccountRole.Owner).map((member) => member.person))
  const body = `广告《${campaign.title}》已发完 ${count} 封，请准备新的广告。\nCampaign “${campaign.title}” finished. ${count} emails sent. Please prepare the next campaign.`
  for (const user of leads) {
    if (await records.claim('campaign-inbox', campaign.id, user)) {
      try {
        const ops = client.apply('prospect-mail-notifications')
        await addProspectNotice(client, ops, doc, user, campaign.id, Date.now(), prospects.string.AutoMail, body)
        await ops.commit()
      } catch {
        console.error(JSON.stringify({ event: 'campaign-completion-inbox-failed' }))
      }
    }
    if (send !== undefined && await records.claim('campaign-mail', campaign.id, user)) {
      try {
        await send(user, 'Auraplex · 广告已发完 / Campaign finished', body)
      } catch {
        console.error(JSON.stringify({ event: 'campaign-completion-mail-failed' }))
      }
    }
  }
}
