<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { departmentModuleLevel } from '@hcengineering/presentation'
  $: moduleCanEdit = $departmentModuleLevel('orders') === 'edit'
  import chunter from '@hcengineering/chunter'
  import contact, { formatName, type Channel, type Employee } from '@hcengineering/contact'
  import core, { AccountRole, SortingOrder, generateId, getCurrentAccount, type AccountUuid, type Ref } from '@hcengineering/core'
  import departments, {
    type DepartmentAccess,
    type Order,
    type OrderAction,
    type OrderActionKind,
    type OrderStage
  } from '@hcengineering/departments'
  import hr, { type Department } from '@hcengineering/hr'
  import { getResource } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import OrderFlowChart from './OrderFlowChart.svelte'
  import { recordAudit } from '../audit'

  /** Orders: one per customer order, moving 销售 → 设计 → 生产 → 工程 → 培训. The server checks every button. */
  const client = getClient()
  const hierarchy = client.getHierarchy()
  const me = getCurrentAccount()
  const owner = me.role === AccountRole.Owner
  type Role = 'admin' | 'supervisor' | 'employee' | 'reader'

  let orders: Order[] = []
  let staff: Employee[] = []
  let depts: DepartmentAccess[] = []
  let phones = new Map<string, string>()
  let actions: OrderAction[] = []
  let selectedId: Ref<Order> | undefined
  let filter: 'mine' | 'all' = 'mine'
  let title = ''
  let customer = ''
  let note = ''
  let reason = ''
  let returnTarget = ''
  let returnPerson = ''
  let openStage = ''
  let adjusting = false
  let showAllHistory = false
  $: history = actions.filter((item) => item.kind !== 'step')
  let busy = false
  let error = ''
  let notice = ''

  createQuery().query(departments.class.Order, {}, (res) => {
    orders = res
  }, { sort: { modifiedOn: SortingOrder.Descending } })
  createQuery().query(contact.mixin.Employee, { active: true }, (res) => {
    staff = res.filter((it) => it.personUuid != null)
  })
  createQuery().query(hr.class.Department, {}, (res) => {
    depts = res.flatMap((it) => hierarchy.asIf(it, departments.mixin.DepartmentAccess) ?? [])
  })
  createQuery().query(contact.class.Channel, { provider: contact.channelProvider.Whatsapp }, (res: Channel[]) => {
    phones = new Map(res.map((it) => [it.attachedTo as string, it.value]))
  })
  const actionQuery = createQuery()
  $: if (selectedId !== undefined) {
    actionQuery.query(departments.class.OrderAction, { order: selectedId }, (res) => {
      actions = res
    }, {
      sort: { createdOn: SortingOrder.Descending }
    })
  }

  $: selected = orders.find((it) => it._id === selectedId)
  $: stage = selected?.stages[selected.current]

  // These helpers are reactive so every place using them updates when people or departments load.
  $: person = (id: AccountUuid | undefined): Employee | undefined =>
    id === undefined ? undefined : staff.find((it) => it.personUuid === id)
  $: name = (id: AccountUuid | undefined): string => {
    const p = person(id)
    return p === undefined ? '—' : formatName(p.name)
  }
  $: roleOf = (department: Ref<Department> | undefined, who: AccountUuid): Role | undefined => {
    const d = depts.find((it) => it._id === department)
    if (d === undefined || d.archived) return undefined
    if (d.administrators.includes(who)) return 'admin'
    if (d.supervisors.includes(who)) return 'supervisor'
    if (d.employees.includes(who)) return 'employee'
    if (d.readers.includes(who)) return 'reader'
    return undefined
  }
  $: deptName = (id: Ref<Department> | undefined): string => depts.find((it) => it._id === id)?.name ?? '未指定部门'
  $: workers = (department: Ref<Department> | undefined): Employee[] =>
    owner && department === undefined
      ? staff
      : staff.filter((it) => {
        const r = roleOf(department, it.personUuid as AccountUuid)
        return r !== undefined && r !== 'reader'
      })

  $: role = stage === undefined ? undefined : roleOf(stage.department, me.uuid)
  $: lead = owner || role === 'admin' || role === 'supervisor'
  $: canApprove = stage?.status === 'approval' && (owner ||
    (stage.approval?.by === 'person' ? stage.approval.person === me.uuid : role === 'admin'))
  $: inCharge = stage?.assignee === me.uuid
  $: canWork = lead || inCharge || (role !== undefined && role !== 'reader')
  $: active = selected?.state === 'active'
  // Department admins and super admins may add a stage to one order mid-way.
  $: canInsert = owner || depts.some((d) => !d.archived && d.administrators.includes(me.uuid))
  $: liveDepts = depts.filter((d) => !d.archived)
  $: shown = orders.filter(
    (it) =>
      filter === 'all' ||
      it.salesOwner === me.uuid ||
      it.stages.some((s) => s.assignee === me.uuid || roleOf(s.department, me.uuid) !== undefined)
  )

  const days = (from: number | undefined): string =>
    from === undefined ? '' : `${Math.max(0, Math.floor((Date.now() - from) / 86400000))} 天`
  const time = (t: number): string => new Date(t).toLocaleString()
  const dayMs = 86400000
  // Countdown for a stage with a time limit: 还剩 N 天 / 不到 1 天 / 超时 N 天.
  const countdown = (s: { startedOn?: number, limitDays?: number } | undefined): { text: string, late: boolean } | undefined => {
    if (s?.startedOn === undefined || s.limitDays === undefined || s.limitDays <= 0) return undefined
    const left = s.startedOn + s.limitDays * dayMs - Date.now()
    if (left < 0) return { text: `超时 ${Math.ceil(-left / dayMs)} 天`, late: true }
    return { text: left < dayMs ? '不到 1 天' : `还剩 ${Math.floor(left / dayMs)} 天`, late: false }
  }
  const kindText: Record<OrderActionKind, string> = {
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

  function open (it: Order): void {
    if (selectedId !== it._id) {
      actions = []
      showAllHistory = false
    }
    selectedId = it._id
    adjusting = false
    openStage = ''
    void recordAudit('view', `${it.number} ${it.title}`, it)
  }

  async function createOrder (): Promise<void> {
    if (busy || title.trim() === '' || customer.trim() === '') return
    busy = true
    error = ''
    try {
      const id = generateId<Order>()
      const ops = client.apply(undefined, 'order-create')
      await ops.createDoc(departments.class.Order, core.space.Workspace, {
        number: '',
        title: title.trim(),
        customer: customer.trim(),
        note: note.trim(),
        salesOwner: me.uuid,
        stages: [],
        current: 0,
        state: 'active'
      }, id)
      if (!(await ops.commit()).result) throw new Error('refused')
      title = ''
      customer = ''
      note = ''
      selectedId = id
    } catch {
      error = '没有新建订单的权限（要先加入一个部门）。'
    } finally {
      busy = false
    }
  }

  async function act (kind: OrderActionKind, extra: Partial<OrderAction> = {}): Promise<void> {
    if (busy || selected === undefined || stage === undefined) return
    busy = true
    error = ''
    notice = ''
    try {
      const ops = client.apply(undefined, 'order-action')
      await ops.createDoc(departments.class.OrderAction, core.space.Workspace, {
        order: selected._id,
        kind,
        stage: extra.stage ?? stage.id,
        actor: me.uuid,
        ...extra
      })
      // The server checks who may do this; a refusal must show as an error, not as success.
      if (!(await ops.commit()).result) throw new Error('refused')
      if (kind !== 'step') notice = kind === 'complete' && stage.approval ? '已提交审批。' : `已${kindText[kind]}。`
      reason = ''
      returnTarget = ''
      returnPerson = ''
    } catch {
      error = '没有权限做这个操作，或者订单已经变化，请刷新后再看。'
    } finally {
      busy = false
    }
  }

  async function assignTo (value: string, stageId?: string): Promise<void> {
    if (value !== '') await act('assign', { assignee: value as AccountUuid, ...(stageId === undefined ? {} : { stage: stageId }) })
  }
  async function sendReturn (): Promise<void> {
    await act('return', {
      target: returnTarget,
      reason,
      ...(returnPerson !== '' ? { assignee: returnPerson as AccountUuid } : {})
    })
  }

  async function insertDepartment (id: string, position: number): Promise<void> {
    const dept = liveDepts.find((item) => item._id === id)
    if (dept === undefined || !canInsert || selected === undefined || position <= selected.current) return
    await act('insert', { name: dept.name.slice(0, 50), department: dept._id, position })
  }

  async function reorder (id: string, position: number): Promise<void> {
    if (selected === undefined || !canInsert || position <= selected.current) return
    const from = selected.stages.findIndex((item) => item.id === id)
    if (from <= selected.current || selected.stages[from].status !== 'waiting') return
    const waiting = selected.stages.slice(selected.current + 1).map((item) => item.id)
    waiting.splice(from - selected.current - 1, 1)
    waiting.splice(position - selected.current - 1 - Number(from < position), 0, id)
    await act('reorder', { stageOrder: waiting })
  }

  $: if (!active || !canInsert) adjusting = false
  $: inspected = adjusting ? selected?.stages.find((item) => item.id === openStage) : stage
  $: returned = stage !== undefined && actions.find((item) =>
    item.kind === 'return' || item.kind === 'complete' || item.kind === 'approve')?.target === stage.id

  $: inspectedRole = inspected === undefined ? undefined : roleOf(inspected.department, me.uuid)

  async function chat (id: AccountUuid | undefined): Promise<void> {
    if (id === undefined || id === me.uuid) return
    const dms = await client.findAll(chunter.class.DirectMessage, {})
    const dm = dms.find((it) => it.members.length === 2 && it.members.includes(me.uuid) && it.members.includes(id))
    const dmId =
      dm?._id ??
      (await client.createDoc(chunter.class.DirectMessage, core.space.Space, {
        name: '',
        description: '',
        private: true,
        archived: false,
        members: [me.uuid, id]
      }))
    const open = await getResource(chunter.function.OpenChannelInSidebar)
    await open(dmId, chunter.class.DirectMessage)
  }
  $: whatsapp = (id: AccountUuid | undefined): string | undefined => {
    const p = person(id)
    const value = p === undefined ? undefined : phones.get(p._id)
    const digits = value?.replace(/\D/g, '') ?? ''
    return digits === '' ? undefined : `https://wa.me/${digits}`
  }
  const contacts = (it: Order): Array<{ stage: OrderStage, who: AccountUuid }> => [
    ...it.stages.flatMap((s) => (s.assignee !== undefined ? [{ stage: s, who: s.assignee }] : []))
  ]
</script>

<section class="orders">
  <div class="head">
    <h2>订单</h2>
    <div class="tabs">
      <button class:on={filter === 'mine'} on:click={() => (filter = 'mine')}>和我有关</button>
      <button class:on={filter === 'all'} on:click={() => (filter = 'all')}>全部订单</button>
    </div>
  </div>

  {#if moduleCanEdit}<div class="create">
    <input placeholder="订单名称，例如：贴标机 ×2" bind:value={title} maxlength="120" />
    <input placeholder="客户" bind:value={customer} maxlength="120" />
    <input placeholder="备注（可不填）" bind:value={note} maxlength="500" />
    <button disabled={busy || title.trim() === '' || customer.trim() === ''} on:click={createOrder}>新建订单</button>
  </div>{/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}{#if notice}<p class="ok">{notice}</p>{/if}

  <div class="body">
    <table>
      <thead><tr><th>编号</th><th>订单</th><th>客户</th><th>当前阶段</th><th>负责人</th><th>剩余 / 已用</th><th>接单销售</th></tr></thead>
      <tbody>
        {#each shown as it (it._id)}
          {@const cur = it.stages[it.current]}
          {@const left = it.state === 'done' ? undefined : countdown(cur)}
          <tr class:sel={it._id === selectedId} on:click={() => open(it)}>
            <td>{it.number}</td>
            <td>{it.title}</td>
            <td>{it.customer}</td>
            <td>{it.state === 'done' ? '✅ 已完成' : cur?.name ?? ''}</td>
            <td>{name(cur?.assignee)}</td>
            <td class:late={left?.late === true}>{it.state === 'done' ? '' : left?.text ?? `已用 ${days(cur?.startedOn)}`}</td>
            <td>{name(it.salesOwner)}</td>
          </tr>
        {/each}
        {#if shown.length === 0}<tr><td colspan="7" class="hint">还没有订单。</td></tr>{/if}
      </tbody>
    </table>

    {#if selected !== undefined}
      <div class="detail">
        <h3>{selected.number} {selected.title}</h3>
        <p class="hint">客户：{selected.customer}　接单销售：{name(selected.salesOwner)}{selected.note ? `　备注：${selected.note}` : ''}</p>
        <div class="progress-header">
          {#if !adjusting}
            <div class="order-progress">
              <progress aria-label="订单进度" max={Math.max(1, selected.stages.length)}
                value={selected.stages.filter((item) => item.status === 'done').length}></progress>
              {#if stage}
                <div>第 {selected.current + 1}/{selected.stages.length} 段 · {stage.name} · 负责人 {name(stage.assignee)}
                  {#if stage.startedOn !== undefined} · 已用 {days(stage.startedOn)}{/if}
                  {#if countdown(stage) !== undefined}{@const left = countdown(stage)}
                    · <span class:late={left?.late === true}>{left?.text}</span>{/if}
                  {#if stage.status === 'approval'} · 等待审批{:else} · 进行中{/if}
                  {#if returned} · 已退回{/if}
                </div>
              {:else if selected.state === 'done'}
                <div>全部 {selected.stages.length} 段已完成</div>
              {/if}
            </div>
          {/if}
          {#if active && canInsert}
            <button type="button" on:click={() => {
              adjusting = !adjusting
              openStage = ''
            }}>{adjusting ? '完成调整' : '调整流程'}</button>
          {/if}
        </div>
        {#if adjusting}
        <OrderFlowChart
          cards={selected.stages.map((item) => ({ ...item, department: deptName(item.department), assignee: name(item.assignee) }))}
          departments={liveDepts.map((dept) => ({ id: dept._id, name: dept.name }))}
          editable={active && canInsert && !busy}
          firstEditable={selected.current + 1}
          selected={openStage}
          on:select={(event) => { openStage = openStage === event.detail ? '' : event.detail }}
          on:dropDepartment={(event) => insertDepartment(event.detail.id, event.detail.position)}
          on:dropStage={(event) => reorder(event.detail.id, event.detail.position)}
        />

        {:else}
          <ul class="progress-stages">
            {#each selected.stages.slice(0, selected.current) as item (item.id)}
              <li>✓ {item.name} · {deptName(item.department)} · {name(item.assignee)}
                {#if item.doneOn !== undefined} · {new Date(item.doneOn).toLocaleDateString()}{/if}
              </li>
            {/each}
          </ul>
        {/if}
        {#if active && inspected !== undefined}
          <div class="card">
            <div><b>{inspected.name}</b>（{deptName(inspected.department)}）　已用 {days(inspected.startedOn)}</div>
            <label>负责人
              {#if (owner || inspectedRole === 'admin' || inspectedRole === 'supervisor') && inspected.status !== 'done'}
                <select value={inspected.assignee ?? ''} disabled={busy}
                  on:change={(event) => assignTo(event.currentTarget.value, inspected?.id)}>
                  <option value="">（未指定）</option>
                  {#each workers(inspected.department) as w (w._id)}<option value={w.personUuid}>{formatName(w.name)}</option>{/each}
                </select>
              {:else}<span>{name(inspected.assignee)}</span>{/if}
            </label>
            {#if stage !== undefined && inspected.id === stage.id && stage.status === 'approval'}
              <p>等待审批</p>
              {#if canApprove}
                <div class="row">
                  <button disabled={busy} on:click={() => act('approve')}>批准</button>
                  <input placeholder="拒绝原因" bind:value={reason} maxlength="500" />
                  <button disabled={busy || reason.trim() === ''} on:click={() => act('reject', { reason })}>拒绝</button>
                </div>
              {/if}
            {:else if stage !== undefined && inspected.id === stage.id && stage.status === 'active'}
            {#if stage.steps.length > 0}
              <div class="steps">
                {#each stage.steps as step, i (i)}
                  <label class="step"
                    ><input
                      type="checkbox"
                      checked={step.done}
                      disabled={busy || !(lead || inCharge)}
                      on:change={() => act('step', { step: i })}
                    />{step.name}</label
                  >
                {/each}
              </div>
            {/if}
            <div class="row">
              <button disabled={busy || !(lead || inCharge)} on:click={() => act('complete')}>{stage.approval ? '本段完成 → 提交审批' : '本段完成 → 交给下一段'}</button>
            </div>
            <div class="row">
              <input placeholder="遇到问题？写下原因" bind:value={reason} maxlength="500" />
              <button disabled={busy || !canWork || reason.trim() === ''} on:click={() => act('escalate', { reason })}
                >上报主管</button
              >
            </div>
            {#if lead && selected.current > 0}
              <div class="row">
                <select bind:value={returnTarget}>
                  <option value="">退回到…</option>
                  {#each selected.stages.slice(0, selected.current) as s (s.id)}<option value={s.id}>{s.name}</option>{/each}
                </select>
                <select bind:value={returnPerson}>
                  <option value="">（负责人不变）</option>
                  {#each workers(selected.stages.find((s) => s.id === returnTarget)?.department) as w (w._id)}
                    <option value={w.personUuid}>{formatName(w.name)}</option>
                  {/each}
                </select>
                <button
                  disabled={busy || returnTarget === '' || reason.trim() === ''}
                  on:click={sendReturn}>退回（用上面写的原因）</button
                >
              </div>
            {/if}
            {/if}
          </div>
        {:else if selected.state === 'done'}
          <p class="ok">这个订单已经全部完成。</p>
        {/if}

        {#if !adjusting && active}
          <ul class="progress-stages waiting-stages">
            {#each selected.stages.slice(selected.current + 1) as item (item.id)}
              <li>{item.name} · {deptName(item.department)} · {name(item.assignee)}</li>
            {/each}
          </ul>
        {/if}
        <h4>联系相关的人</h4>
        <ul class="people">
          {#each contacts(selected) as c (c.stage.id)}
            {@const wa = whatsapp(c.who)}
            <li>
              <span>{c.stage.name}：{name(c.who)}</span>
              {#if c.who !== me.uuid}<button on:click={() => chat(c.who)}>💬 私信</button>{/if}
              {#if wa !== undefined}<a href={wa} target="_blank" rel="noopener">🟢 WhatsApp</a>{/if}
            </li>
          {/each}
        </ul>

        <h4>经过记录</h4>
        <ul class="history">
          {#each (showAllHistory ? history : history.slice(0, 3)) as a (a._id)}
            <li>
              <span class="hint">{time(a.createdOn ?? a.modifiedOn)}</span>
              {name(a.actor)}：{a.kind === 'complete' && selected.stages.find((item) => item.id === a.stage)?.approval ? '提交审批' : kindText[a.kind]}（{selected.stages.find((s) => s.id === a.stage)?.name ?? ''}{a.kind === 'return'
                ? ` → ${selected.stages.find((s) => s.id === a.target)?.name ?? ''}`
                : ''}{a.kind === 'assign' ? ` → ${name(a.assignee)}` : ''}{a.kind === 'insert' ? ` → ${a.name ?? ''}` : ''}）{a.reason ? `：${a.reason}` : ''}
            </li>
          {/each}
          {#if history.length === 0}<li class="hint">还没有记录。</li>{/if}
        </ul>
        {#if history.length > 3}
          <div><button type="button" aria-expanded={showAllHistory} on:click={() => { showAllHistory = !showAllHistory }}>
            {showAllHistory ? '收起' : `显示全部（${history.length}）`}
          </button></div>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .late { color: var(--theme-error-color); font-weight: 500; }
  .orders { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem 1.25rem; overflow: auto; height: 100%; }
  .progress-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
  .progress-header button { margin-inline-start: auto; white-space: nowrap; }
  .order-progress { flex: 1; min-width: 0; color: var(--theme-caption-color); }
  .order-progress progress { width: 100%; accent-color: var(--theme-link-color); }
  .progress-stages { display: grid; gap: 0.4rem; margin: 0; padding: 0; list-style: none; color: var(--theme-content-color); }
  .waiting-stages { color: var(--theme-dark-color); }
  .head { display: flex; justify-content: space-between; align-items: center; }
  h2, h3, h4 { margin: 0; }
  .tabs { display: flex; gap: 0.25rem; }
  .create, .row { display: flex; gap: 0.5rem; flex-wrap: wrap; align-items: center; }
  .create input { flex: 1 1 10rem; }
  .row input { flex: 1 1 14rem; }
  input, select, button {
    color: var(--theme-content-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    padding: 0.4rem 0.6rem;
    border-radius: 0.3rem;
    font: inherit;
  }
  button { cursor: pointer; }
  button:disabled { opacity: 0.45; cursor: default; }
  .tabs button.on { border-color: var(--theme-caption-color); }
  .body { display: flex; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
  table { border-collapse: collapse; flex: 1 1 28rem; min-width: 0; }
  th, td { text-align: left; padding: 0.4rem 0.5rem; border-bottom: 1px solid var(--theme-divider-color); white-space: nowrap; }
  tbody tr { cursor: pointer; }
  tbody tr.sel { background: var(--theme-button-hovered); }
  .detail { flex: 1 1 26rem; min-width: 0; display: flex; flex-direction: column; gap: 0.6rem; border: 1px solid var(--theme-divider-color); border-radius: 0.5rem; padding: 0.8rem; }
  .progress { display: flex; flex-wrap: wrap; gap: 0.3rem; align-items: center; }
  .chip { padding: 0.15rem 0.5rem; border-radius: 1rem; border: 1px solid var(--theme-divider-color); }
  .chip.current { border-color: #3b82f6; }
  .sep { color: var(--theme-dark-color); }
  .card { display: flex; flex-direction: column; gap: 0.5rem; padding: 0.6rem; border-radius: 0.4rem; background: var(--theme-button-default); }
  .card label { display: flex; gap: 0.5rem; align-items: center; }
  .steps { display: flex; flex-direction: column; gap: 0.2rem; }
  .people, .history { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.35rem; }
  .people li { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  .people a { color: var(--theme-link-color, #3b82f6); }
  .hint { color: var(--theme-dark-color); margin: 0; }
  .err { color: var(--theme-error-color); margin: 0; }
  .ok { color: var(--theme-won-color, #3a9b5d); margin: 0; }
</style>
