<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import chunter from '@hcengineering/chunter'
  import core, { getCurrentAccount, SortingOrder, type AccountUuid, type Doc, type Ref, type Space } from '@hcengineering/core'
  import departments, { type DepartmentAccess, type Order } from '@hcengineering/departments'
  import document from '@hcengineering/document'
  import drive, { createFolder } from '@hcengineering/drive'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { makeRank } from '@hcengineering/rank'
  import task from '@hcengineering/task'
  import tracker from '@hcengineering/tracker'
  import { getCurrentLocation, languageStore, navigate } from '@hcengineering/ui'

  /** Chat, tasks, document and folder for one order: created on first click, opened afterwards. */
  export let order: Order
  export let depts: DepartmentAccess[] = []

  type Kind = 'channel' | 'component' | 'document' | 'folder'
  const client = getClient()
  const me = getCurrentAccount()
  let busy: Kind | undefined
  let error = ''
  let issues = { total: 0, done: 0 }
  $: L = (zhText: string, enText: string): string => ($languageStore === 'zh' ? zhText : enText)
  $: title = `${order.number} ${order.title}`

  // Task progress of the linked tracker component.
  const issueQuery = createQuery()
  $: if (order.component !== undefined) {
    issueQuery.query(tracker.class.Issue, { component: order.component as any }, (res) => {
      issues = { total: res.length, done: res.filter((it) => it.status !== undefined && doneStatuses.has(it.status)).length }
    })
  } else issueQuery.unsubscribe()
  let doneStatuses = new Set<string>()
  void client.findAll(core.class.Status, { category: task.statusCategory.Won }).then((res) => {
    doneStatuses = new Set(res.map((it) => it._id))
  }).catch(() => {})

  // People working on the order, for the chat channel.
  $: people = [...new Set([order.salesOwner, me.uuid, ...order.stages.flatMap((s) => (s.assignee !== undefined ? [s.assignee] : []))])] as AccountUuid[]

  /** The department space to use: the current stage's department if I'm in it, else any department of mine on this order. */
  function departmentFor (field: 'projectSpace' | 'documentSpace' | 'driveSpace'): Ref<Space> | undefined {
    const mine = (d: DepartmentAccess): boolean => !d.archived &&
      [...d.administrators, ...d.supervisors, ...d.employees].includes(me.uuid) && d[field] !== undefined
    const current = order.stages[order.current]?.department
    const candidates = [
      depts.find((d) => d._id === current && mine(d)),
      ...order.stages.map((s) => depts.find((d) => d._id === s.department && mine(d))),
      depts.find(mine)
    ]
    return candidates.find((d) => d !== undefined)?.[field] as Ref<Space> | undefined
  }

  function go (path: string[]): void {
    const loc = getCurrentLocation()
    navigate({ path: [loc.path[0], loc.path[1], ...path] })
  }

  function openLink (kind: Kind): void {
    const id = order[kind] as string
    const space = order.linkSpaces?.[kind]
    if (kind === 'channel') go(['chunter', `${id}|${chunter.class.Channel}`])
    else if (kind === 'document') go(['document', `order-${id}`])
    else if (kind === 'folder') go(['drive', 'folder', id])
    else if (space !== undefined) go(['tracker', space, 'components'])
  }

  async function create (kind: Kind): Promise<void> {
    if (kind === 'channel') {
      return await client.createDoc(chunter.class.Channel, core.space.Space, {
        name: title, description: '', topic: order.customer, private: true, archived: false,
        members: people, owners: [me.uuid], autoJoin: false
      } as any) as any
    }
    const field = kind === 'component' ? 'projectSpace' : kind === 'document' ? 'documentSpace' : 'driveSpace'
    const space = departmentFor(field)
    if (space === undefined) throw new Error('no-space')
    let id: Ref<Doc>
    if (kind === 'component') {
      id = await client.createDoc(tracker.class.Component, space as any, { label: title, description: '', lead: null, comments: 0, attachments: 0 })
    } else if (kind === 'document') {
      const first = await client.findOne(document.class.Document, { space: space as any, parent: document.ids.NoParent }, { sort: { rank: SortingOrder.Ascending } })
      id = await client.createDoc(document.class.Document, space as any, {
        title, content: null, attachments: 0, embeddings: 0, labels: 0, comments: 0, references: 0,
        rank: makeRank(undefined, first?.rank), parent: document.ids.NoParent
      } as any)
    } else {
      id = await createFolder(client, space as any, { title, parent: drive.ids.Root } as any)
    }
    await client.update(order, { linkSpaces: { ...(order.linkSpaces ?? {}), [kind]: space } })
    return id as any
  }

  async function use (kind: Kind): Promise<void> {
    if (busy !== undefined) return
    error = ''
    if (order[kind] !== undefined) { openLink(kind); return }
    busy = kind
    try {
      const id = await create(kind) as unknown as Ref<Doc>
      await client.update(order, { [kind]: id })
      order = { ...order, [kind]: id }
      openLink(kind)
    } catch (e) {
      error = e instanceof Error && e.message === 'no-space'
        ? L('你所在的部门没有对应的空间，请联系管理员。', 'Your department has no space for this. Please ask an admin.')
        : L('创建失败：可能没有权限。', 'Could not create it; you may not have permission.')
    } finally {
      busy = undefined
    }
  }

  const items: Array<{ kind: Kind, icon: string, zh: string, en: string }> = [
    { kind: 'channel', icon: '💬', zh: '讨论', en: 'Chat' },
    { kind: 'component', icon: '✅', zh: '任务', en: 'Tasks' },
    { kind: 'document', icon: '📄', zh: '文档', en: 'Document' },
    { kind: 'folder', icon: '📁', zh: '文件夹', en: 'Folder' }
  ]
</script>

<div class="links">
  {#each items as item (item.kind)}
    <button type="button" disabled={busy !== undefined} on:click={() => use(item.kind)} title={order[item.kind] === undefined ? L('点一下就新建', 'Click to create') : L('打开', 'Open')}>
      {item.icon} {L(item.zh, item.en)}{#if item.kind === 'component' && order.component !== undefined && issues.total > 0} ({issues.done}/{issues.total}){/if}{#if order[item.kind] === undefined}<span class="new">+</span>{/if}
    </button>
  {/each}
</div>
{#if error}<p class="err" role="alert">{error}</p>{/if}

<style>
  .links { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 0.5rem 0; }
  button {
    display: inline-flex; align-items: center; gap: 0.25rem; padding: 0.35rem 0.8rem; border-radius: 0.375rem;
    border: 1px solid var(--theme-divider-color); background: var(--theme-button-default); color: var(--theme-caption-color);
    cursor: pointer; font-size: 0.85rem; white-space: nowrap;
  }
  button:hover { background: var(--theme-button-hovered); }
  .new { color: var(--theme-dark-color); font-size: 0.75rem; }
  .err { color: var(--theme-error-color); margin: 0; font-size: 0.8rem; }
  @media (max-width: 720px) { button { flex: 1 1 40%; justify-content: center; padding: 0.6rem; } }
</style>
