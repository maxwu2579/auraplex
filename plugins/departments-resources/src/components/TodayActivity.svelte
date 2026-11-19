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
    type TxCreateDoc
  } from '@hcengineering/core'
  import departments, { type AuditEvent, type DepartmentAccess } from '@hcengineering/departments'
  import hr from '@hcengineering/hr'
  import { translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { navigate, getCurrentLocation } from '@hcengineering/ui'
  import { onDestroy } from 'svelte'
  import { peopleOf, visibleDepartments } from '../trackingScope'

  /** 今天动态: a small button showing what happened today in the current module. */
  export let app: string | undefined = undefined
  export let panelDoc: { _id: Ref<Doc>, _class: Ref<Class<Doc>> } | undefined = undefined

  interface Row { id: string, at: number, who?: AccountUuid, kind: string, what: string, objectId?: string }

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const me = getCurrentAccount()
  const owner = me.role === AccountRole.Owner
  const LIMIT = 100

  let all: DepartmentAccess[] = []
  let staff: Employee[] = []
  let socials: SocialIdentity[] = []
  let rows: Row[] = []
  let open = false
  let onlyThis = false
  let timer: ReturnType<typeof setInterval> | undefined

  createQuery().query(hr.class.Department, {}, (res) => {
    all = res.flatMap((it) => hierarchy.asIf(it, departments.mixin.DepartmentAccess) ?? [])
  })
  createQuery().query(contact.mixin.Employee, {}, (res) => { staff = res.filter((it) => it.personUuid != null) })
  createQuery().query(contact.class.SocialIdentity, {}, (res) => { socials = res })

  $: visible = visibleDepartments(all, me.uuid, owner)
  $: allowed = owner || visible.length > 0
  // undefined = everyone (super admins)
  $: people = owner ? undefined : peopleOf(visible)
  $: shownApp = app !== undefined && app !== 'tracking' && app !== 'setting' ? app : undefined
  $: bySocial = new Map(socials.map((it) => [it._id as string, staff.find((p) => p._id === it.attachedTo)?.personUuid as AccountUuid | undefined]))
  $: name = (id: AccountUuid | undefined): string => {
    const p = staff.find((it) => it.personUuid === id)
    return p === undefined ? '系统' : formatName(p.name)
  }

  // Which documents belong to a module, by class name prefix.
  const prefixes: Record<string, string[]> = {
    orders: ['departments:class:Order'],
    departments: ['hr:class:Department'],
    contact: ['contact:class:Person', 'contact:class:Organization', 'contact:class:Channel'],
    time: ['time:class:ToDo', 'time:class:WorkSlot']
  }
  const inModule = (alias: string, _class: string): boolean =>
    (prefixes[alias] ?? [alias + ':']).some((prefix) => _class.startsWith(prefix))
  const noise = ['notification:', 'activity:', 'preference:', 'view:', 'core:class:', 'contact:class:SocialIdentity', 'chunter:class:ChatSyncInfo']
  const auditText: Record<string, string> = { view: '打开', export: '导出', search: '搜索', whatsapp: 'WhatsApp 往来' }
  const orderKinds: Record<string, string> = {
    assign: '指定负责人', step: '勾选步骤', complete: '本段完成', escalate: '上报主管', return: '退回',
    insert: '插入一段', reorder: '调整顺序', approve: '批准', reject: '拒绝'
  }
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
  const titleOf = (doc: Record<string, unknown> | undefined): string => {
    for (const key of ['identifier', 'title', 'name', 'number', 'code']) {
      if (typeof doc?.[key] === 'string' && doc[key] !== '') return doc[key] as string
    }
    return ''
  }

  async function load (): Promise<void> {
    if (!allowed || shownApp === undefined) { rows = []; return }
    const alias = shownApp
    const start = new Date(new Date().setHours(0, 0, 0, 0)).getTime()
    const socialIds = people === undefined
      ? undefined
      : socials.filter((it) => people?.has(bySocial.get(it._id) as AccountUuid)).map((it) => it._id as PersonId)
    try {
      const [txes, events] = await Promise.all([
        client.findAll(core.class.TxCUD, {
          modifiedOn: { $gte: start },
          ...(socialIds !== undefined ? { modifiedBy: { $in: socialIds } } : {})
        }, { sort: { modifiedOn: SortingOrder.Descending }, limit: 1000 }),
        client.findAll(departments.class.AuditEvent, {
          lastOn: { $gte: start },
          ...(people !== undefined ? { actor: { $in: [...people] } } : {})
        }, { sort: { lastOn: SortingOrder.Descending }, limit: 500 })
      ])
      const work = (txes as Array<TxCUD<Doc>>).filter((tx) => tx.modifiedBy !== core.account.System &&
        !noise.some((prefix) => tx.objectClass.startsWith(prefix)) && inModule(alias, tx.objectClass))
      const titles = new Map<string, string>()
      const byClass = new Map<Ref<Class<Doc>>, Set<Ref<Doc>>>()
      for (const tx of work) {
        if (tx._class === core.class.TxCreateDoc) {
          const title = titleOf((tx as TxCreateDoc<Doc>).attributes as unknown as Record<string, unknown>)
          if (title !== '') titles.set(tx.objectId, title)
        }
        if (tx.objectClass === departments.class.OrderAction && tx._class === core.class.TxCreateDoc) {
          // Show the order itself (ORD-0001 …) rather than the action record.
          const order = ((tx as TxCreateDoc<Doc>).attributes as unknown as { order: Ref<Doc> }).order
          byClass.set(departments.class.Order, (byClass.get(departments.class.Order) ?? new Set()).add(order))
        } else if (!titles.has(tx.objectId)) byClass.set(tx.objectClass, (byClass.get(tx.objectClass) ?? new Set()).add(tx.objectId))
      }
      for (const [_class, ids] of byClass) {
        try {
          const docs = await client.findAll(_class, { _id: { $in: [...ids] } })
          for (const it of docs) {
            const doc = it as unknown as Record<string, unknown>
            titles.set(it._id, _class === departments.class.Order ? `${doc.number as string} ${doc.title as string}` : titleOf(doc))
          }
        } catch {}
      }
      const next: Row[] = []
      for (const tx of work) {
        const isOrderAction = tx.objectClass === departments.class.OrderAction
        const attrs = tx._class === core.class.TxCreateDoc ? (tx as TxCreateDoc<Doc>).attributes as unknown as Record<string, unknown> : {}
        const kind = isOrderAction
          ? orderKinds[attrs.kind as string] ?? '订单操作'
          : tx._class === core.class.TxCreateDoc ? '新建' : tx._class === core.class.TxRemoveDoc ? '删除' : '修改'
        const target = isOrderAction ? attrs.order as string : tx.objectId
        const title = titles.get(target) ?? titles.get(tx.objectId) ?? ''
        next.push({
          id: tx._id,
          at: tx.modifiedOn,
          who: bySocial.get(tx.modifiedBy),
          kind,
          what: isOrderAction ? (title !== '' ? title : '订单') : `${await classLabel(tx.objectClass)}${title !== '' ? '：' + title : ''}`,
          objectId: target
        })
      }
      for (const ev of events as AuditEvent[]) {
        if (ev.objectClass === undefined || !inModule(alias, ev.objectClass) || auditText[ev.kind] === undefined) continue
        next.push({
          id: ev._id,
          at: ev.lastOn,
          who: ev.actor,
          kind: auditText[ev.kind],
          what: ev.count > 1 ? `${ev.label}（${ev.count} 次）` : ev.label,
          objectId: ev.objectId
        })
      }
      rows = next.sort((a, b) => b.at - a.at)
    } catch {
      rows = []
    }
  }

  // Count once when the module changes; refresh every 30 seconds only while the panel is open.
  $: if (allowed && shownApp !== undefined) void load()
  $: if (open) {
    if (timer === undefined) timer = setInterval(() => { void load() }, 30000)
  } else if (timer !== undefined) {
    clearInterval(timer)
    timer = undefined
  }
  onDestroy(() => { if (timer !== undefined) clearInterval(timer) })

  $: filtered = onlyThis && panelDoc !== undefined ? rows.filter((it) => it.objectId === panelDoc?._id) : rows
  $: if (panelDoc === undefined) onlyThis = false
  const time = (t: number): string => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  function openTracking (): void {
    const loc = getCurrentLocation()
    open = false
    navigate({ path: [loc.path[0], loc.path[1], 'tracking'] })
  }
</script>

{#if allowed && shownApp !== undefined}
  <button class="today-ball" type="button" title="今天动态" aria-label="今天动态" on:click={() => { open = !open; if (open) void load() }}>
    {rows.length > 0 ? (rows.length > 99 ? '99+' : rows.length) : '今'}
  </button>
  {#if open}
    <aside class="today-panel" aria-label="今天动态">
      <header>
        <strong>今天 · 动态</strong>
        {#if panelDoc !== undefined}
          <label><input type="checkbox" bind:checked={onlyThis} /> 只看这一个</label>
        {/if}
        <button type="button" class="close" on:click={() => { open = false }}>关闭</button>
      </header>
      <ul>
        {#each filtered.slice(0, LIMIT) as row (row.id)}
          <li><span class="at">{time(row.at)}</span><b>{name(row.who)}</b><span class="kind">{row.kind}</span><span class="what">{row.what}</span></li>
        {/each}
        {#if filtered.length === 0}<li class="hint">今天还没有记录。</li>{/if}
      </ul>
      {#if filtered.length > LIMIT}<p class="hint">还有 {filtered.length - LIMIT} 条，请到追踪页查看。</p>{/if}
      <button type="button" class="more" on:click={openTracking}>在追踪页看全部 →</button>
    </aside>
  {/if}
{/if}

<style>
  .today-ball {
    position: fixed; right: 1rem; bottom: 4.5rem; z-index: 20;
    min-width: 2.25rem; height: 2.25rem; padding: 0 0.5rem; border-radius: 1.125rem;
    border: 1px solid var(--theme-divider-color); background: var(--theme-button-default);
    color: var(--theme-caption-color); font-size: 0.8rem; font-weight: 600; cursor: pointer;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }
  .today-ball:hover { background: var(--theme-button-hovered); }
  .today-panel {
    position: fixed; right: 1rem; bottom: 7.25rem; z-index: 21; width: min(26rem, calc(100vw - 2rem));
    max-height: 60vh; display: flex; flex-direction: column; gap: 0.5rem; padding: 0.75rem;
    border: 1px solid var(--theme-divider-color); border-radius: 0.5rem;
    background: var(--theme-popup-color, var(--theme-bg-color)); color: var(--theme-content-color);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
  }
  header { display: flex; align-items: center; gap: 0.75rem; }
  header strong { color: var(--theme-caption-color); flex: 1; }
  header label { display: flex; align-items: center; gap: 0.25rem; font-size: 0.8rem; }
  ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 0.35rem; }
  li { display: flex; gap: 0.5rem; font-size: 0.8rem; align-items: baseline; }
  .at { color: var(--theme-dark-color); flex-shrink: 0; }
  b { color: var(--theme-caption-color); flex-shrink: 0; }
  .kind { flex-shrink: 0; }
  .what { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hint { color: var(--theme-dark-color); font-size: 0.8rem; margin: 0; }
  button.close, button.more {
    border: 1px solid var(--theme-divider-color); background: transparent; color: var(--theme-content-color);
    border-radius: 0.25rem; padding: 0.15rem 0.5rem; cursor: pointer; font-size: 0.8rem;
  }
  button.more { align-self: flex-end; }
</style>
