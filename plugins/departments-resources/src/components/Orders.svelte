<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
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
  $: inCharge = stage?.assignee === me.uuid
  $: canWork = lead || inCharge || (role !== undefined && role !== 'reader')
  $: active = selected?.state === 'active'
  $: shown = orders.filter(
    (it) =>
      filter === 'all' ||
      it.salesOwner === me.uuid ||
      it.stages.some((s) => s.assignee === me.uuid || roleOf(s.department, me.uuid) !== undefined)
  )

  const days = (from: number | undefined): string =>
    from === undefined ? '' : `${Math.max(0, Math.floor((Date.now() - from) / 86400000))} 天`
  const time = (t: number): string => new Date(t).toLocaleString()
  const kindText: Record<OrderActionKind, string> = {
    assign: '指定负责人',
    step: '勾选步骤',
    complete: '本段完成',
    escalate: '上报主管',
    return: '退回'
  }

  function open (it: Order): void {
    selectedId = it._id
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
      if (kind !== 'step') notice = `已${kindText[kind]}。`
      reason = ''
      returnTarget = ''
      returnPerson = ''
    } catch {
      error = '没有权限做这个操作，或者订单已经变化，请刷新后再看。'
    } finally {
      busy = false
    }
  }

  async function assignTo (value: string): Promise<void> {
    if (value !== '') await act('assign', { assignee: value as AccountUuid })
  }
  async function sendReturn (): Promise<void> {
    await act('return', {
      target: returnTarget,
      reason,
      ...(returnPerson !== '' ? { assignee: returnPerson as AccountUuid } : {})
    })
  }

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

  <div class="create">
    <input placeholder="订单名称，例如：贴标机 ×2" bind:value={title} maxlength="120" />
    <input placeholder="客户" bind:value={customer} maxlength="120" />
    <input placeholder="备注（可不填）" bind:value={note} maxlength="500" />
    <button disabled={busy || title.trim() === '' || customer.trim() === ''} on:click={createOrder}>新建订单</button>
  </div>
  {#if error}<p class="err" role="alert">{error}</p>{/if}{#if notice}<p class="ok">{notice}</p>{/if}

  <div class="body">
    <table>
      <thead><tr><th>编号</th><th>订单</th><th>客户</th><th>当前阶段</th><th>负责人</th><th>已用</th><th>接单销售</th></tr></thead>
      <tbody>
        {#each shown as it (it._id)}
          {@const cur = it.stages[it.current]}
          <tr class:sel={it._id === selectedId} on:click={() => open(it)}>
            <td>{it.number}</td>
            <td>{it.title}</td>
            <td>{it.customer}</td>
            <td>{it.state === 'done' ? '✅ 已完成' : cur?.name ?? ''}</td>
            <td>{name(cur?.assignee)}</td>
            <td>{it.state === 'done' ? '' : days(cur?.startedOn)}</td>
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
        <div class="progress">
          {#each selected.stages as s, i (s.id)}
            <span class="chip {s.status}" class:current={i === selected.current && active}
              >{s.status === 'done' ? '✅' : i === selected.current && active ? '🔵' : '⚪'} {s.name}</span
            >{#if i < selected.stages.length - 1}<span class="sep">→</span>{/if}
          {/each}
        </div>

        {#if active && stage !== undefined}
          <div class="card">
            <div><b>当前：{stage.name}</b>（{deptName(stage.department)}）　已用 {days(stage.startedOn)}</div>
            <label
              >负责人
              {#if lead}
                <select
                  value={stage.assignee ?? ''}
                  disabled={busy}
                  on:change={(e) => assignTo(e.currentTarget.value)}
                >
                  <option value="">（未指定）</option>
                  {#each workers(stage.department) as w (w._id)}<option value={w.personUuid}>{formatName(w.name)}</option>{/each}
                </select>
              {:else}<span>{name(stage.assignee)}</span>{/if}
            </label>
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
              <button disabled={busy || !(lead || inCharge)} on:click={() => act('complete')}>本段完成 → 交给下一段</button>
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
          </div>
        {:else if selected.state === 'done'}
          <p class="ok">这个订单已经全部完成。</p>
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
          {#each actions.filter((a) => a.kind !== 'step') as a (a._id)}
            <li>
              <span class="hint">{time(a.createdOn ?? a.modifiedOn)}</span>
              {name(a.actor)}：{kindText[a.kind]}（{selected.stages.find((s) => s.id === a.stage)?.name ?? ''}{a.kind === 'return'
                ? ` → ${selected.stages.find((s) => s.id === a.target)?.name ?? ''}`
                : ''}{a.kind === 'assign' ? ` → ${name(a.assignee)}` : ''}）{a.reason ? `：${a.reason}` : ''}
            </li>
          {/each}
          {#if actions.length === 0}<li class="hint">还没有记录。</li>{/if}
        </ul>
      </div>
    {/if}
  </div>
</section>

<style>
  .orders { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem 1.25rem; overflow: auto; height: 100%; }
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
