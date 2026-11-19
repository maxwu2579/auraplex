<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { Breadcrumb, Header, Label, languageStore } from '@hcengineering/ui'
  import { translate as translateTracking, translateCB, type IntlString } from '@hcengineering/platform'
  import contact, { formatName, type Employee, type SocialIdentity } from '@hcengineering/contact'
  import core, {
    AccountRole,
    SortingOrder,
    getCurrentAccount,
    type AccountUuid,
    type Class,
    type Doc,
    type PersonId,
    type Ref,
    type TxCUD,
    type TxCreateDoc,
    type TxMixin,
    type TxUpdateDoc
  } from '@hcengineering/core'
  import departments, { type AuditEvent, type DepartmentAccess } from '@hcengineering/departments'
  import hr from '@hcengineering/hr'
  import { translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { recordAudit } from '../audit'
  import { dateInput, dayStart, peopleOf, visibleDepartments } from '../trackingScope'
  import { createWorkbook, downloadWorkbook } from '../xlsx'

  /** 操作记录: who did what, when, filtered by person, date, department and kind. */
  const client = getClient()
  const hierarchy = client.getHierarchy()
  const me = getCurrentAccount()
  const owner = me.role === AccountRole.Owner

  interface Row {
    at: number
    who?: AccountUuid
    kind: string
    what: string
    detail: string
  }

  let all: DepartmentAccess[] = []
  let staff: Employee[] = []
  let socials: SocialIdentity[] = []
  let dept = ''
  let person = ''
  let kind = ''
  let from = dateInput(Date.now() - 6 * 86400000)
  let to = dateInput(Date.now())
  let rows: Row[] = []
  let loading = false
  let error = ''

  createQuery().query(hr.class.Department, {}, (res) => {
    all = res.flatMap((it) => hierarchy.asIf(it, departments.mixin.DepartmentAccess) ?? [])
  })
  createQuery().query(contact.mixin.Employee, {}, (res) => {
    staff = res.filter((it) => it.personUuid != null)
  })
  createQuery().query(contact.class.SocialIdentity, {}, (res) => {
    socials = res
  })

  $: visible = visibleDepartments(all, me.uuid, owner)
  $: scope = dept === '' ? visible : visible.filter((d) => d._id === dept)
  // undefined = everyone (super admin, all departments)
  $: people = person !== '' ? new Set([person as AccountUuid]) : owner && dept === '' ? undefined : peopleOf(scope)
  $: choosable = staff.filter((it) => owner || peopleOf(visible).has(it.personUuid as AccountUuid))

  const accountOfPerson = (personRef: Ref<Doc>): AccountUuid | undefined =>
    staff.find((it) => it._id === personRef)?.personUuid as AccountUuid | undefined
  $: bySocial = new Map(socials.map((it) => [it._id as string, accountOfPerson(it.attachedTo)]))
  $: name = (id: AccountUuid | undefined): string => {
    const p = staff.find((it) => it.personUuid === id)
    return p === undefined ? trackingText(departments.string.TrackingPageSystem) : formatName(p.name)
  }

  // Bookkeeping that is not someone's work: notifications, read marks, presence, our own records.
  const noise = [
    'notification:',
    'whatsapp:class:Message',
    'activity:',
    'preference:',
    'workbench:',
    'love:',
    'view:',
    'setting:',
    'core:class:UserStatus',
    'core:class:Collaborator',
    'core:class:MigrationState',
    'core:class:Sequence',
    'contact:class:SocialIdentity',
    'departments:class:AuditEvent',
    'departments:class:TrackingSettings',
    'chunter:class:ChatSyncInfo',
    'tracker:class:ProjectTargetPreference',
    'contact:class:Person'
  ]
  const orderKinds: Record<string, IntlString> = {
    assign: departments.string.OrderAssign,
    step: departments.string.OrderCheckStep,
    complete: departments.string.OrderCompleteStage,
    escalate: departments.string.OrderEscalate,
    return: departments.string.OrderReturn,
    insert: departments.string.OrderInsert,
    reorder: departments.string.OrderReorder,
    approve: departments.string.OrderApprove,
    reject: departments.string.OrderReject
  }
  /** Plain text of a rich-text message (comments are stored as a document tree). */
  function plainText (markup: string): string {
    try {
      const parts: string[] = []
      const walk = (node: any): void => {
        if (typeof node?.text === 'string') parts.push(node.text)
        if (Array.isArray(node?.content)) node.content.forEach(walk)
      }
      walk(JSON.parse(markup))
      return parts.join(' ')
    } catch {
      return markup
    }
  }
  const fieldLabels = new Map<string, string>()
  async function fieldLabel (_class: Ref<Class<Doc>>, key: string): Promise<string> {
    const id = `${_class}.${key}`
    const cached = fieldLabels.get(id)
    if (cached !== undefined) return cached
    let text = key
    try {
      const label = hierarchy.findAttribute(_class, key)?.label
      if (label !== undefined) text = await translate(label, {}, $languageStore)
    } catch {}
    fieldLabels.set(id, text)
    return text
  }
  const comments = ['chunter:class:ChatMessage', 'chunter:class:ThreadMessage']
  const auditText: Record<string, IntlString> = { login: departments.string.TrackingPageLogin, view: departments.string.TrackingPageOpen, export: departments.string.TrackingPageExport, search: departments.string.TrackingPageSearch, alert: departments.string.TrackingPageAlert, whatsapp: departments.string.TrackingPageWhatsapp }
  const labels = new Map<string, string>()
  async function classLabel (_class: Ref<Class<Doc>>): Promise<string> {
    const cached = labels.get(_class)
    if (cached !== undefined) return cached
    let text: string = _class.split(':').pop() ?? _class
    try {
      const label = hierarchy.getClass(_class).label
      if (label !== undefined) text = await translate(label, {}, $languageStore)
    } catch {}
    labels.set(_class, text)
    return text
  }
  const short = (value: unknown): string => {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text === undefined ? '' : text.length > 60 ? text.slice(0, 60) + '…' : text
  }
  const titleOf = (doc: Record<string, unknown> | undefined): string => {
    for (const key of ['identifier', 'title', 'name', 'number', 'code']) {
      if (typeof doc?.[key] === 'string' && doc[key] !== '') return doc[key] as string
    }
    return ''
  }

  async function load (): Promise<void> {
    await translateTracking(departments.string.TrackingPageActivity, {}, $languageStore)
    loading = true
    error = ''
    try {
      const start = dayStart(from)
      const end = dayStart(to) + 86400000
      const socialIds =
        people === undefined
          ? undefined
          : socials.filter((it) => people?.has(accountOfPerson(it.attachedTo) as AccountUuid)).map((it) => it._id as PersonId)
      const txes = await client.findAll(
        core.class.TxCUD,
        {
          modifiedOn: { $gte: start, $lt: end },
          ...(socialIds !== undefined ? { modifiedBy: { $in: socialIds } } : {})
        },
        { sort: { modifiedOn: SortingOrder.Descending }, limit: 1000 }
      )
      const events = await client.findAll(
        departments.class.AuditEvent,
        {
          lastOn: { $gte: start },
          firstOn: { $lt: end },
          ...(people !== undefined ? { actor: { $in: [...people] } } : {})
        },
        { sort: { lastOn: SortingOrder.Descending }, limit: 1000 }
      )
      const work = (txes as Array<TxCUD<Doc>>).filter(
        (tx) => !noise.some((prefix) => tx.objectClass.startsWith(prefix)) && tx.modifiedBy !== core.account.System
      )
      // Titles of the changed documents, looked up per class.
      const titles = new Map<string, string>()
      const byClass = new Map<Ref<Class<Doc>>, Set<Ref<Doc>>>()
      for (const tx of work) {
        if (tx._class === core.class.TxCreateDoc) {
          const title = titleOf((tx as TxCreateDoc<Doc>).attributes as unknown as Record<string, unknown>)
          if (title !== '') titles.set(tx.objectId, title)
        }
        if (!titles.has(tx.objectId)) byClass.set(tx.objectClass, (byClass.get(tx.objectClass) ?? new Set()).add(tx.objectId))
      }
      for (const [_class, ids] of byClass) {
        try {
          const docs = await client.findAll(_class, { _id: { $in: [...ids] } })
          for (const it of docs) titles.set(it._id, titleOf(it as unknown as Record<string, unknown>))
        } catch {}
      }
      const next: Row[] = []
      for (const tx of work) {
        const cls = tx.objectClass === departments.class.OrderAction ? trackingText(departments.string.TrackingPageOrderAction) : await classLabel(tx.objectClass)
        const isComment = comments.includes(tx.objectClass)
        const k =
          tx._class === core.class.TxCreateDoc
            ? isComment
              ? trackingText(departments.string.TrackingPageComment)
              : trackingText(departments.string.TrackingPageCreate)
            : tx._class === core.class.TxRemoveDoc
              ? trackingText(departments.string.TrackingPageRemove)
              : trackingText(departments.string.TrackingPageUpdate)
        let detail = ''
        if (tx._class === core.class.TxUpdateDoc || tx._class === core.class.TxMixin) {
          const ops =
            tx._class === core.class.TxUpdateDoc
              ? (tx as TxUpdateDoc<Doc>).operations
              : (tx as TxMixin<Doc, Doc>).attributes
          const parts: string[] = []
          for (const [key, value] of Object.entries(ops as Record<string, unknown>)) {
            parts.push(key.startsWith('$') ? `${key}: ${short(value)}` : `${await fieldLabel(tx.objectClass, key)}：${short(value)}`)
          }
          detail = parts.join('；')
        } else if (isComment) {
          const message = ((tx as TxCreateDoc<Doc>).attributes as unknown as { message?: string }).message ?? ''
          detail = short(plainText(message))
        } else if (tx.objectClass === departments.class.OrderAction && tx._class === core.class.TxCreateDoc) {
          const a = (tx as TxCreateDoc<Doc>).attributes as unknown as { kind: string, reason?: string }
          detail = `${orderKinds[a.kind] === undefined ? a.kind : trackingText(orderKinds[a.kind])}${a.reason !== undefined && a.reason !== '' ? '：' + a.reason : ''}`
        }
        next.push({
          at: tx.modifiedOn,
          who: bySocial.get(tx.modifiedBy),
          kind: tx.objectClass === departments.class.OrderAction ? trackingText(departments.string.TrackingPageOrderAction) : k,
          what: `${cls}${titles.get(tx.objectId) !== undefined && titles.get(tx.objectId) !== '' ? '：' + titles.get(tx.objectId) : ''}`,
          detail
        })
      }
      for (const ev of events as AuditEvent[]) {
        next.push({
          at: ev.lastOn,
          who: ev.actor,
          kind: auditText[ev.kind] === undefined ? ev.kind : trackingText(auditText[ev.kind]),
          what: ev.label,
          detail: ev.count > 1 ? trackingText(departments.string.TrackingPageRepeat, { count: ev.count, first: new Date(ev.firstOn).toLocaleTimeString() }) : ''
        })
      }
      rows = next.sort((a, b) => b.at - a.at)
    } catch (e) {
      error = trackingText(departments.string.TrackingPageLoadFailed)
    } finally {
      loading = false
    }
  }
  // Search in the loaded records: person, action, object and details.
  let search = ''
  $: needle = search.trim().toLowerCase()
  $: shown = rows.filter((it) => (kind === '' || it.kind === kind) &&
    (needle === '' || [name(it.who), it.kind, it.what, it.detail].some((text) => text.toLowerCase().includes(needle))))

  function exportExcel (): void {
    const sheet = [
      [trackingText(departments.string.TrackingPageWhen), trackingText(departments.string.TrackingPageWho), trackingText(departments.string.TrackingPageAction), trackingText(departments.string.TrackingPageObject), trackingText(departments.string.TrackingPageChanges)],
      ...shown.map((it) => [new Date(it.at).toLocaleString(), name(it.who), it.kind, it.what, it.detail])
    ]
    downloadWorkbook(createWorkbook([{ name: trackingText(departments.string.TrackingPageActivity), rows: sheet }]), `操作记录_${from}_${to}.xlsx`)
    void recordAudit('export', trackingText(departments.string.TrackingPageExportActivity, { count: shown.length }))
  }
  function trackingText (id: IntlString, params: Record<string, string | number> = {}): string {
    let result: string = id
    translateCB(id, params, $languageStore, (value) => { result = value })
    return result
  }
</script>

<section class="log">
  <Header adaptive="disabled"><Breadcrumb label={departments.string.TrackingPageActivity} size="large" isCurrent /></Header>
  {#if !owner && visible.length === 0}
    <p class="hint"><Label label={departments.string.TrackingPageNoAccess} /></p>
  {:else}
    <div class="filters">
      <label><Label label={departments.string.TrackingPageDepartment} /><select bind:value={dept}>
          <option value="">{owner ? trackingText(departments.string.TrackingPageAll) : trackingText(departments.string.TrackingPageAllVisible)}</option>
          {#each visible as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
        </select></label>
      <label><Label label={departments.string.TrackingPagePerson} /><select bind:value={person}>
          <option value=""><Label label={departments.string.TrackingPageAll} /></option>
          {#each choosable as p (p._id)}<option value={p.personUuid}>{formatName(p.name)}</option>{/each}
        </select></label>
      <label><Label label={departments.string.TrackingPageFrom} /><input type="date" bind:value={from} /></label>
      <label><Label label={departments.string.TrackingPageTo} /><input type="date" bind:value={to} /></label>
      <label><Label label={departments.string.TrackingPageType} /><select bind:value={kind}>
          <option value=""><Label label={departments.string.TrackingPageAll} /></option>
          {#each [trackingText(departments.string.TrackingPageCreate), trackingText(departments.string.TrackingPageUpdate), trackingText(departments.string.TrackingPageRemove), trackingText(departments.string.TrackingPageComment), trackingText(departments.string.TrackingPageOrderAction), trackingText(departments.string.TrackingPageLogin), trackingText(departments.string.TrackingPageOpen), trackingText(departments.string.TrackingPageExport), trackingText(departments.string.TrackingPageAlert)] as k}<option value={k}>{k}</option>{/each}
        </select></label>
      <label><Label label={departments.string.TrackingPageSearch} /><input type="search" placeholder={trackingText(departments.string.TrackingPageSearchPlaceholder)} bind:value={search} /></label>
      <button disabled={loading} on:click={load}>{loading ? trackingText(departments.string.TrackingPageLoading) : trackingText(departments.string.TrackingPageQuery)}</button>
      <button disabled={shown.length === 0} on:click={exportExcel}><Label label={departments.string.TrackingPageExportExcel} /></button>
    </div>
    {#if error}<p class="err">{error}</p>{/if}
    <p class="hint"><Label label={departments.string.TrackingPageResultCount} params={{ count: shown.length }} />{rows.length >= 1000 ? trackingText(departments.string.TrackingPageLimitHint) : ''}</p>
    <div class="table">
      <table>
        <thead><tr><th><Label label={departments.string.TrackingPageWhen} /></th><th><Label label={departments.string.TrackingPageWho} /></th><th><Label label={departments.string.TrackingPageAction} /></th><th><Label label={departments.string.TrackingPageObject} /></th><th><Label label={departments.string.TrackingPageChanges} /></th></tr></thead>
        <tbody>
          {#each shown as it, i (i)}
            <tr class:alert={it.kind === trackingText(departments.string.TrackingPageAlert)}>
              <td>{new Date(it.at).toLocaleString()}</td>
              <td>{name(it.who)}</td>
              <td>{it.kind}</td>
              <td>{it.what}</td>
              <td class="detail">{it.detail}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>

<style>
  .log { display: flex; flex-direction: column; gap: 0.6rem; padding: 1rem 1.25rem; height: 100%; overflow: auto; }
  h2 { margin: 0; }
  .filters { display: flex; gap: 0.6rem; flex-wrap: wrap; align-items: flex-end; }
  label { display: flex; flex-direction: column; gap: 0.2rem; font-size: 0.85rem; }
  input, select, button {
    color: var(--theme-content-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    padding: 0.35rem 0.5rem;
    border-radius: 0.3rem;
    font: inherit;
  }
  button { cursor: pointer; }
  button:disabled { opacity: 0.45; cursor: default; }
  .table { overflow: auto; scrollbar-width: auto; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: 0.35rem 0.5rem; border-bottom: 1px solid var(--theme-divider-color); white-space: nowrap; }
  td.detail { white-space: normal; max-width: 32rem; overflow-wrap: anywhere; color: var(--theme-dark-color); }
  tr.alert td { color: var(--theme-error-color); }
  .hint { color: var(--theme-dark-color); margin: 0; }
  .err { color: var(--theme-error-color); margin: 0; }
</style>
