<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
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
    return p === undefined ? '系统' : formatName(p.name)
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
  const orderKinds: Record<string, string> = {
    assign: '指定负责人',
    step: '勾选步骤',
    complete: '本段完成',
    escalate: '上报主管',
    return: '退回',
    insert: '插入一段',
    reorder: '调整顺序',
    approve: '批准',
    reject: '拒绝'
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
      if (label !== undefined) text = await translate(label, {}, 'zh')
    } catch {}
    fieldLabels.set(id, text)
    return text
  }
  const comments = ['chunter:class:ChatMessage', 'chunter:class:ThreadMessage']
  const auditText: Record<string, string> = { login: '登录', view: '打开', export: '导出', search: '搜索', alert: '异常提醒', whatsapp: 'WhatsApp 往来' }
  const labels = new Map<string, string>()
  async function classLabel (_class: Ref<Class<Doc>>): Promise<string> {
    const cached = labels.get(_class)
    if (cached !== undefined) return cached
    let text: string = _class.split(':').pop() ?? _class
    try {
      const label = hierarchy.getClass(_class).label
      if (label !== undefined) text = await translate(label, {}, 'zh')
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
        const cls = tx.objectClass === departments.class.OrderAction ? '订单操作' : await classLabel(tx.objectClass)
        const isComment = comments.includes(tx.objectClass)
        const k =
          tx._class === core.class.TxCreateDoc
            ? isComment
              ? '评论'
              : '新建'
            : tx._class === core.class.TxRemoveDoc
              ? '删除'
              : '修改'
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
          detail = `${orderKinds[a.kind] ?? a.kind}${a.reason !== undefined && a.reason !== '' ? '：' + a.reason : ''}`
        }
        next.push({
          at: tx.modifiedOn,
          who: bySocial.get(tx.modifiedBy),
          kind: tx.objectClass === departments.class.OrderAction ? '订单操作' : k,
          what: `${cls}${titles.get(tx.objectId) !== undefined && titles.get(tx.objectId) !== '' ? '：' + titles.get(tx.objectId) : ''}`,
          detail
        })
      }
      for (const ev of events as AuditEvent[]) {
        next.push({
          at: ev.lastOn,
          who: ev.actor,
          kind: auditText[ev.kind] ?? ev.kind,
          what: ev.label,
          detail: ev.count > 1 ? `${ev.count} 次（${new Date(ev.firstOn).toLocaleTimeString()} 起）` : ''
        })
      }
      rows = next.sort((a, b) => b.at - a.at)
    } catch (e) {
      error = '读取失败，请缩小日期范围后再试。'
    } finally {
      loading = false
    }
  }
  $: shown = rows.filter((it) => kind === '' || it.kind === kind)

  function exportExcel (): void {
    const sheet = [
      ['时间', '谁', '做了什么', '对象', '改动内容'],
      ...shown.map((it) => [new Date(it.at).toLocaleString(), name(it.who), it.kind, it.what, it.detail])
    ]
    downloadWorkbook(createWorkbook([{ name: '操作记录', rows: sheet }]), `操作记录_${from}_${to}.xlsx`)
    void recordAudit('export', `导出操作记录（${shown.length} 条）`)
  }
</script>

<section class="log">
  <h2>操作记录</h2>
  {#if !owner && visible.length === 0}
    <p class="hint">你没有看追踪的权限。部门管理员可以看本部门；主管要超级管理员开，员工要部门管理员开。</p>
  {:else}
    <div class="filters">
      <label>部门<select bind:value={dept}>
          <option value="">{owner ? '全部' : '我能看的全部'}</option>
          {#each visible as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
        </select></label>
      <label>人<select bind:value={person}>
          <option value="">全部</option>
          {#each choosable as p (p._id)}<option value={p.personUuid}>{formatName(p.name)}</option>{/each}
        </select></label>
      <label>从<input type="date" bind:value={from} /></label>
      <label>到<input type="date" bind:value={to} /></label>
      <label>类型<select bind:value={kind}>
          <option value="">全部</option>
          {#each ['新建', '修改', '删除', '评论', '订单操作', '登录', '打开', '导出', '异常提醒'] as k}<option value={k}>{k}</option>{/each}
        </select></label>
      <button disabled={loading} on:click={load}>{loading ? '正在读取…' : '查询'}</button>
      <button disabled={shown.length === 0} on:click={exportExcel}>导出 Excel</button>
    </div>
    {#if error}<p class="err">{error}</p>{/if}
    <p class="hint">共 {shown.length} 条{rows.length >= 1000 ? '（太多了，只显示最近的，请缩小范围）' : ''}</p>
    <div class="table">
      <table>
        <thead><tr><th>时间</th><th>谁</th><th>做了什么</th><th>对象</th><th>改动内容</th></tr></thead>
        <tbody>
          {#each shown as it, i (i)}
            <tr class:alert={it.kind === '异常提醒'}>
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
