<!-- Copyright © 2026 Auraplex. Licensed under EPL-2.0. -->
<script lang="ts">
  import { t } from '../trStore'
  import { translate, translateCB, type IntlString } from '@hcengineering/platform'
  import { languageStore } from '@hcengineering/ui'
  import { Label } from '@hcengineering/ui'

  import { departmentModuleLevel } from '@hcengineering/presentation'
  $: moduleCanEdit = $departmentModuleLevel('prospects') === 'edit'
  import contact, { formatName, type Employee } from '@hcengineering/contact'
  import { SortingOrder, type AccountUuid } from '@hcengineering/core'
  import { getMetadata } from '@hcengineering/platform'
  import presentation, { createQuery, getClient } from '@hcengineering/presentation'
  import prospects, { type Prospect, type ProspectMail } from '@hcengineering/prospects'
  import { onMount } from 'svelte'

  /** Mail for one customer: owner, sending, history and forwarding replies to the owner. */
  export let value: Prospect

  const client = getClient()
  let configured = false
  let address = ''
  let lastPoll: { at: number, ok: boolean, error?: string } | undefined
  let statusMessage = $t('正在检查邮件服务…')
  let owner: AccountUuid | '' = value.owner ?? ''
  let employees: Employee[] = []
  let mails: ProspectMail[] = []
  let subject = ''
  let body = ''
  let busy = false
  let error = ''
  let notice = ''
  // Kept until the server answers, so a retry of the same message can never send it twice.
  let sendRequest: string | undefined
  const forwardRequests = new Map<string, string>()

  const employeeQuery = createQuery()
  employeeQuery.query(contact.mixin.Employee, { active: true }, (result) => {
    employees = result.filter((it) => it.personUuid !== undefined)
  })
  const mailQuery = createQuery()
  $: mailQuery.query(
    prospects.class.ProspectMail,
    { attachedTo: value._id },
    (result) => {
      mails = result
    },
    { sort: { sentAt: SortingOrder.Descending } }
  )
  $: forwards = mails.filter((it) => it.direction === 'forward')

  const headers = (): Record<string, string> => ({
    Authorization: 'Bearer ' + (getMetadata(presentation.metadata.Token) ?? ''),
    'Content-Type': 'application/json'
  })
  async function loadStatus (): Promise<void> {
    try {
      const res = await fetch('/prospect-mail-api/status', { headers: headers() })
      if (!res.ok) {
        statusMessage = res.status === 503 ? $t('邮件未配置') : $t('邮件服务连不上')
        return
      }
      const data = await res.json()
      configured = data.configured === true
      address = typeof data.address === 'string' ? data.address : ''
      lastPoll = data.lastPoll
      statusMessage = configured ? '' : $t('邮件未配置')
    } catch {
      statusMessage = $t('邮件服务连不上')
    }
  }
  onMount(loadStatus)

  async function post (path: string, payload: Record<string, string>): Promise<void> {
    const res = await fetch(`/prospect-mail-api/${path}`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload)
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      throw new Error(typeof data.error === 'string' ? data.error : $t('邮件服务连不上'))
    }
  }
  async function saveOwner (): Promise<void> {
    error = ''
    try {
      if (owner === '') await client.update(value, { $unset: { owner: true } })
      else await client.update(value, { owner })
    } catch {
      error = $t('负责人保存失败')
    }
  }
  async function send (): Promise<void> {
    if (busy || subject.trim() === '' || body.trim() === '') return
    busy = true
    error = ''
    notice = ''
    sendRequest = sendRequest ?? crypto.randomUUID()
    try {
      await post('send', { prospectId: value._id, requestId: sendRequest, subject, body })
      sendRequest = undefined
      subject = ''
      body = ''
      notice = $t('已发出。')
    } catch (e) {
      error = e instanceof Error ? e.message : $t('发送失败')
    } finally {
      busy = false
    }
  }
  async function forward (reply: ProspectMail): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    notice = ''
    const request = forwardRequests.get(reply._id) ?? crypto.randomUUID()
    forwardRequests.set(reply._id, request)
    try {
      await post('forward', { prospectId: value._id, replyId: reply._id, requestId: request })
      forwardRequests.delete(reply._id)
      notice = $t('已转给负责人。')
    } catch (e) {
      error = e instanceof Error ? e.message : $t('转发失败')
    } finally {
      busy = false
    }
  }
  /** After the user has looked in Gmail's Sent folder, record what really happened. */
  async function resolve (mail: ProspectMail, delivered: boolean): Promise<void> {
    error = ''
    try {
      const ops = client.apply('prospect-mail-resolve')
      ops.match(prospects.class.ProspectMail, { _id: mail._id, delivery: mail.delivery })
      await ops.update(mail, { delivery: delivered ? 'sent' : 'failed' })
      if (delivered && mail.direction === 'outgoing') {
        const current = await client.findOne(prospects.class.Prospect, { _id: value._id })
        if (current !== undefined) {
          await ops.update(current, {
            lastEmailAt: Math.max(current.lastEmailAt ?? 0, mail.sentAt),
            ...(current.status === 'new' ? { status: 'sent' } : {})
          })
          await ops.update(current, { $inc: { emailCount: 1 } })
        }
      }
      if (!(await ops.commit()).result) error = $t('记录已经变化，请刷新后再看。')
    } catch {
      error = $t('保存失败')
    }
  }
  const time = (t: number): string => new Date(t).toLocaleString()
  const kind = (mail: ProspectMail): string =>
    mail.direction === 'incoming' ? $t('客户回复') : mail.direction === 'forward' ? $t('转给负责人') : $t('发出')
  const deliveryText: Record<ProspectMail['delivery'], string> = {
    sending: $t('正在发送'),
    sent: $t('已发出'),
    failed: $t('没发出'),
    uncertain: $t('结果不确定'),
    received: $t('已收到')
  }
  $: canSend = configured && value.status !== 'do-not-send' && value.status !== 'bounced'
  $: ownerPerson = owner === '' ? undefined : employees.find((it) => it.personUuid === owner)
  $: ownerLabel = ownerPerson === undefined ? $t('负责人') : formatName(ownerPerson.name)
  function localizer (language: string): (id: IntlString) => string {
    return (id) => {
      let value = ''
      translateCB(id, {}, language, (text) => { value = text })
      return value
    }
  }
  let local = localizer('en')
  async function updateLanguage (language: string): Promise<void> {
    await translate(prospects.string.PageLibrary, {}, language)
    if (language === $languageStore) local = localizer(language)
  }
  $: void updateLanguage($languageStore)
</script>

<section class="mail">
  <h3><Label label={prospects.string.PageMail} /></h3>
  <p class="hint">
    {#if statusMessage !== ''}{statusMessage}{:else}发件邮箱：{address}{#if lastPoll !== undefined}
        ；上次检查收件箱：{time(lastPoll.at)}
        {lastPoll.ok ? $t('正常') : (lastPoll.error ?? $t('失败'))}{/if}{/if}
  </p>
  <label class="owner"
    ><Label label={prospects.string.PageOwner} /><select bind:value={owner} on:change={saveOwner}
      ><option value="">{local(prospects.string.PageNoneSelected)}</option>{#each employees as employee (employee._id)}<option
          value={employee.personUuid}>{formatName(employee.name)}</option
        >{/each}</select
    ></label
  >
  {#if canSend}
    <label><Label label={prospects.string.PageSubject} /><input disabled={busy} maxlength="200" bind:value={subject} /></label>
    <label><Label label={prospects.string.PageBody} /><textarea disabled={busy} rows="5" maxlength="30000" bind:value={body} /></label>
    <div class="row">
      <button disabled={!moduleCanEdit || busy || subject.trim() === '' || body.trim() === ''} on:click={send}
        >{busy ? $t('处理中…') : `发送给 ${value.email}`}</button
      >
    </div>
  {:else if configured}
    <p class="hint">这个客户的状态是$t('不要再发')或$t('邮件退回')，不能发邮件。</p>
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}{#if notice}<p class="ok">{notice}</p>{/if}
  {#if mails.length === 0}
    <p class="hint"><Label label={prospects.string.PageNoMail} /></p>
  {:else}
    <ul>
      {#each mails as mail (mail._id)}
        <li class:incoming={mail.direction === 'incoming'}>
          <div class="meta">
            <strong>{kind(mail)}</strong>
            <span>{time(mail.sentAt)}</span>
            <span>{mail.direction === 'incoming' ? mail.sender : mail.recipient}</span>
            <span class="state {mail.delivery}">{deliveryText[mail.delivery] ?? mail.delivery}</span>
          </div>
          <div class="subject">{mail.subject}</div>
          {#if mail.direction !== 'forward'}<pre>{mail.body}</pre>{/if}
          {#if mail.delivery === 'uncertain' || (mail.delivery === 'sending' && Date.now() - mail.sentAt > 120000)}
            <div class="row">
              <span class="hint">请到 Gmail 的$t('已发送')里看看这封有没有发出：</span>
              <button
                on:click={() => {
                  void resolve(mail, true)
                }}><Label label={prospects.string.PageConfirmSent} /></button
              >
              <button
                on:click={() => {
                  void resolve(mail, false)
                }}><Label label={prospects.string.PageConfirmUnsent} /></button
              >
            </div>
          {/if}
          {#if mail.direction === 'incoming'}
            {@const done = forwards.filter((it) => it.replyTo === mail._id && it.delivery !== 'failed')}
            <div class="row">
              {#each done as item (item._id)}<span class="hint"
                  >已转给 {item.recipient}（{time(item.sentAt)}，{deliveryText[item.delivery]}）</span
                >{/each}
              {#if done.length === 0}
                <button
                  disabled={busy || !configured || owner === ''}
                  title={owner === '' ? $t('请先选择负责人') : ''}
                  on:click={() => {
                    void forward(mail)
                  }}>转给{ownerLabel}</button
                >
              {/if}
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .mail {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--theme-divider-color);
  }
  h3 {
    margin: 0;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .owner {
    max-width: 20rem;
  }
  input,
  select,
  textarea,
  button {
    color: var(--theme-content-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    padding: 0.45rem;
    border-radius: 0.3rem;
    font: inherit;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .row {
    display: flex;
    gap: 0.6rem;
    align-items: center;
    flex-wrap: wrap;
  }
  .hint {
    color: var(--theme-dark-color);
    margin: 0;
  }
  .ok {
    color: var(--theme-won-color, #3a9b5d);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  li {
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.4rem;
    padding: 0.6rem;
  }
  li.incoming {
    border-color: #3b5bdb;
  }
  .meta {
    display: flex;
    gap: 0.8rem;
    flex-wrap: wrap;
    font-size: 0.85rem;
  }
  .subject {
    font-weight: 600;
    margin: 0.3rem 0;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: inherit;
    margin: 0;
    max-height: 12rem;
    overflow: auto;
  }
  .state.uncertain,
  .state.failed {
    color: var(--theme-error-color);
  }
</style>
