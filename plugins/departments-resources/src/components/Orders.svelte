<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { Breadcrumb, Button, Component, DropdownLabels, EditBox, Header, Label, Toggle, languageStore, type AnyComponent } from '@hcengineering/ui'
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
  import { getResource, translate, translateCB, type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import OrderFlowChart from './OrderFlowChart.svelte'
  import StatusTag from './StatusTag.svelte'
  import { recordAudit } from '../audit'

  function localizer (language: string) {
    return (id: IntlString, params: Record<string, string | number> = {}): string => {
      let value = ''
      translateCB(id, params, language, (text) => { value = text })
      return value
    }
  }
  let local = localizer('en')
  async function updateLanguage (language: string): Promise<void> {
    await translate(departments.string.OrderWaitingOnMe, {}, language)
    if (language === $languageStore) local = localizer(language)
  }
  $: void updateLanguage($languageStore)

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
  // Files on an order (drawings, contracts, photos); loaded by id so this plugin does not depend on attachments.
  const attachmentsComponent = 'attachment:component:Attachments' as AnyComponent
  /** Opened from the inbox or a link: show just this order. */
  export let focusId: Ref<Order> | undefined = undefined
  let selectedId: Ref<Order> | undefined = focusId
  type OrderFilter = 'todo' | 'mine' | 'late' | 'all'
  const filterKey = 'auraplex.orders.filter'
  let filter: OrderFilter = 'mine'
  try {
    const saved = localStorage.getItem(filterKey)
    if (saved === 'todo' || saved === 'mine' || saved === 'late' || saved === 'all') filter = saved
  } catch {}
  function setFilter (value: OrderFilter): void {
    filter = value
    try { localStorage.setItem(filterKey, value) } catch {}
  }
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
  $: deptName = (id: Ref<Department> | undefined): string => depts.find((it) => it._id === id)?.name ?? local(departments.string.OrderUnassignedDepartment)
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
  $: related = (it: Order): boolean => it.salesOwner === me.uuid ||
    it.stages.some((s) => s.assignee === me.uuid || roleOf(s.department, me.uuid) !== undefined)
  // Waiting on me: the current stage is mine, or it waits for my approval.
  $: waitingOnMe = (it: Order): boolean => {
    const cur = it.stages[it.current]
    if (it.state !== 'active' || cur === undefined) return false
    if (cur.status === 'active') return cur.assignee === me.uuid
    if (cur.status !== 'approval') return false
    return cur.approval?.by === 'person' ? cur.approval.person === me.uuid : roleOf(cur.department, me.uuid) === 'admin'
  }
  $: isLate = (it: Order): boolean => it.state === 'active' && countdown(it.stages[it.current])?.late === true
  $: todoCount = orders.filter(waitingOnMe).length
  $: shown = focusId !== undefined ? orders.filter((it) => it._id === focusId) : orders.filter((it) =>
    filter === 'all' ? true : filter === 'todo' ? waitingOnMe(it) : filter === 'late' ? isLate(it) && (owner || related(it)) : related(it))

  $: days = (from: number | undefined): string =>
    from === undefined ? '' : local(departments.string.OrderDays, { count: Math.max(0, Math.floor((Date.now() - from) / 86400000)) })
  const time = (t: number): string => new Date(t).toLocaleString()
  const dayMs = 86400000
  // Countdown for a stage with a time limit: 还剩 N 天 / 不到 1 天 / 超时 N 天.
  $: countdown = (s: { startedOn?: number, limitDays?: number } | undefined): { text: string, late: boolean } | undefined => {
    if (s?.startedOn === undefined || s.limitDays === undefined || s.limitDays <= 0) return undefined
    const left = s.startedOn + s.limitDays * dayMs - Date.now()
    if (left < 0) return { text: local(departments.string.OrderOverdueDays, { count: Math.ceil(-left / dayMs) }), late: true }
    return { text: left < dayMs ? local(departments.string.OrderUnderOneDay) : local(departments.string.OrderRemainingDays, { count: Math.floor(left / dayMs) }), late: false }
  }
  $: kindText = {
    assign: local(departments.string.OrderAssign),
    step: local(departments.string.OrderCheckStep),
    complete: local(departments.string.OrderCompleteStage),
    escalate: local(departments.string.OrderEscalate),
    return: local(departments.string.OrderReturn),
    insert: local(departments.string.OrderInsert),
    reorder: local(departments.string.OrderReorder),
    approve: local(departments.string.OrderApprove),
    reject: local(departments.string.OrderReject)
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
      error = local(departments.string.OrderCreateDenied)
    } finally {
      busy = false
    }
  }

  // Name, customer and note: the salesperson who took the order and super admins may change them.
  let editing = false
  let editTitle = ''
  let editCustomer = ''
  let editNote = ''
  $: canEditInfo = selected !== undefined && moduleCanEdit && (owner || selected.salesOwner === me.uuid)
  $: if (selected?._id !== editingId) editing = false
  let editingId: Ref<Order> | undefined
  function startEdit (): void {
    if (selected === undefined) return
    editTitle = selected.title
    editCustomer = selected.customer
    editNote = selected.note ?? ''
    editingId = selected._id
    editing = true
  }
  async function saveInfo (): Promise<void> {
    if (busy || selected === undefined || editTitle.trim() === '' || editCustomer.trim() === '') return
    busy = true
    error = ''
    try {
      const ops = client.apply(undefined, 'order-edit')
      await ops.update(selected, { title: editTitle.trim(), customer: editCustomer.trim(), note: editNote.trim() })
      if (!(await ops.commit()).result) throw new Error('refused')
      editing = false
      notice = local(departments.string.OrderSaved)
    } catch {
      error = local(departments.string.OrderEditDenied)
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
      if (kind !== 'step') notice = kind === 'complete' && stage.approval ? local(departments.string.OrderSubmitted) : local(departments.string.OrderActionDone)
      reason = ''
      returnTarget = ''
      returnPerson = ''
    } catch {
      error = local(departments.string.OrderActionDenied)
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
    <Header adaptive="disabled"><Breadcrumb label={departments.string.OrderPage1} size="large" isCurrent /></Header>
    {#if focusId === undefined}<div class="tabs">
      <button class:on={filter === 'todo'} on:click={() => setFilter('todo')}><Label label={departments.string.OrderWaitingOnMe} />{todoCount > 0 ? ` (${todoCount})` : ''}</button>
      <Button selected={filter === 'mine'} kind="regular" label={departments.string.OrderPage2} on:click={() => setFilter('mine')} />
      <Button selected={filter === 'late'} kind="regular" label={departments.string.OrderPage3} on:click={() => setFilter('late')} />
      <Button selected={filter === 'all'} kind="regular" label={departments.string.OrderPage4} on:click={() => setFilter('all')} />
    </div>{/if}
  </div>

  {#if moduleCanEdit && focusId === undefined}<div class="create">
    <EditBox placeholder={departments.string.OrderOrderTitle} bind:value={title} />
    <EditBox placeholder={departments.string.OrderCustomer} bind:value={customer} />
    <EditBox placeholder={departments.string.OrderOptionalNote} bind:value={note} />
    <Button kind="primary" label={departments.string.OrderPage5} disabled={busy || title.trim() === '' || customer.trim() === ''} on:click={createOrder} />
  </div>{/if}
  {#if error}<p class="err" role="alert">{error}</p>{/if}{#if notice}<p class="ok">{notice}</p>{/if}

  <div class="body">
    <table>
      <thead><tr><th><Label label={departments.string.OrderPage6} /></th><th><Label label={departments.string.OrderPage1} /></th><th><Label label={departments.string.OrderPage7} /></th><th><Label label={departments.string.OrderPage8} /></th><th><Label label={departments.string.OrderPage9} /></th><th><Label label={departments.string.OrderPage10} /></th><th><Label label={departments.string.OrderPage11} /></th></tr></thead>
      <tbody>
        {#each shown as it (it._id)}
          {@const cur = it.stages[it.current]}
          {@const left = it.state === 'done' ? undefined : countdown(cur)}
          <tr class:sel={it._id === selectedId} on:click={() => open(it)}>
            <td>{it.number}</td>
            <td>{it.title}</td>
            <td>{it.customer}</td>
            <td>{#if it.state === 'done'}<StatusTag status="done" label={departments.string.OrderCompleted} />{:else}{cur?.name ?? ''}{#if cur?.status === 'approval'} <StatusTag status="approval" label={departments.string.OrderAwaitingApproval} />{/if}{/if}</td>
            <td>{name(cur?.assignee)}</td>
            <td>{#if it.state !== 'done'}{#if left !== undefined}<StatusTag status={left.late ? 'late' : 'active'} text={left.text} />{:else}{local(departments.string.OrderElapsed, { duration: days(cur?.startedOn) })}{/if}{/if}</td>
            <td>{name(it.salesOwner)}</td>
          </tr>
        {/each}
        {#if shown.length === 0}<tr><td colspan="7" class="hint"><Label label={departments.string.OrderPage12} /></td></tr>{/if}
      </tbody>
    </table>

    {#if selected !== undefined}
      <div class="detail">
        {#if editing}
          <div class="edit-info">
            <label><Label label={departments.string.OrderPage13} /> <EditBox bind:value={editTitle} placeholder={departments.string.OrderPage13} /></label>
            <label><Label label={departments.string.OrderPage7} /> <EditBox bind:value={editCustomer} placeholder={departments.string.OrderPage7} /></label>
            <label><Label label={departments.string.OrderPage14} /> <EditBox bind:value={editNote} placeholder={departments.string.OrderPage14} /></label>
            <div>
              <Button kind="primary" label={departments.string.OrderPage15} disabled={busy || editTitle.trim() === '' || editCustomer.trim() === ''} on:click={saveInfo} />
              <button disabled={busy} on:click={() => { editing = false }}><Label label={departments.string.OrderPage16} /></button>
            </div>
          </div>
        {:else}
          <h3>{selected.number} {selected.title}{#if canEditInfo}<Button kind="regular" label={departments.string.OrderPage17} on:click={startEdit} />{/if}</h3>
          <p class="hint"><Label label={departments.string.OrderOrderInfo} params={{ customer: selected.customer, owner: name(selected.salesOwner) }} />{#if selected.note} · {selected.note}{/if}</p>
        {/if}
        <div class="progress-header">
          {#if !adjusting}
            <div class="order-progress">
              <progress aria-label={local(departments.string.OrderProgress)} max={Math.max(1, selected.stages.length)}
                value={selected.stages.filter((item) => item.status === 'done').length}></progress>
              {#if stage}
                <div><Label label={departments.string.OrderStageProgress} params={{ current: selected.current + 1, total: selected.stages.length, stage: stage.name, assignee: name(stage.assignee) }} />
                  {#if stage.startedOn !== undefined} · <Label label={departments.string.OrderElapsed} params={{ duration: days(stage.startedOn) }} />{/if}
                  {#if countdown(stage) !== undefined}{@const left = countdown(stage)}
                    · <StatusTag status={left?.late === true ? 'late' : 'active'} text={left?.text} />{/if}
                  {#if stage.status === 'approval'} · <StatusTag status="approval" label={departments.string.OrderAwaitingApproval} />{:else} · <StatusTag status="active" label={departments.string.OrderInProgress} />{/if}
                  {#if returned} · <Label label={departments.string.OrderReturned} />{/if}
                </div>
              {:else if selected.state === 'done'}
                <div><Label label={departments.string.OrderAllStagesDone} params={{ count: selected.stages.length }} /></div>
              {/if}
            </div>
          {/if}
          {#if active && canInsert}
            <button type="button" on:click={() => {
              adjusting = !adjusting
              openStage = ''
            }}>{adjusting ? local(departments.string.OrderFinishAdjustment) : local(departments.string.OrderAdjustFlow)}</button>
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
            <div><b>{inspected.name}</b>（{deptName(inspected.department)}）　<Label label={departments.string.OrderElapsed} params={{ duration: days(inspected.startedOn) }} /></div>
            <label><Label label={departments.string.OrderPage9} />
              {#if (owner || inspectedRole === 'admin' || inspectedRole === 'supervisor') && inspected.status !== 'done'}
                <DropdownLabels selected={inspected.assignee ?? ''} autoSelect={false} disabled={busy}
                  items={[{ id: '', label: local(departments.string.OrderUnassigned) },
                    ...workers(inspected.department).flatMap((worker) => worker.personUuid == null ? [] :
                      [{ id: worker.personUuid, label: formatName(worker.name) }])]}
                  on:selected={(event) => assignTo(event.detail, inspected?.id)} />
              {:else}<span>{name(inspected.assignee)}</span>{/if}
            </label>
            {#if stage !== undefined && inspected.id === stage.id && stage.status === 'approval'}
              <p><Label label={departments.string.OrderPage19} /></p>
              {#if canApprove}
                <div class="row">
                  <Button kind="regular" label={departments.string.OrderPage21} disabled={busy} on:click={() => act('approve')} />
                  <EditBox placeholder={departments.string.OrderRejectionReason} bind:value={reason} />
                  <Button kind="regular" label={departments.string.OrderPage22} disabled={busy || reason.trim() === ''} on:click={() => act('reject', { reason })} />
                </div>
              {/if}
            {:else if stage !== undefined && inspected.id === stage.id && stage.status === 'active'}
            {#if stage.steps.length > 0}
              <div class="steps">
                {#each stage.steps as step, i (i)}
                  <label class="step"
                    ><Toggle
                      on={step.done}
                      disabled={busy || !(lead || inCharge)}
                      on:change={() => act('step', { step: i })}
                    />{step.name}</label
                  >
                {/each}
              </div>
            {/if}
            <div class="row">
              <button disabled={busy || !(lead || inCharge)} on:click={() => act('complete')}>{stage.approval ? local(departments.string.OrderSubmitApproval) : local(departments.string.OrderHandOff)}</button>
            </div>
            <div class="row">
              <EditBox placeholder={departments.string.OrderExplainIssue} bind:value={reason} />
              <button disabled={busy || !canWork || reason.trim() === ''} on:click={() => act('escalate', { reason })}
                ><Label label={departments.string.OrderPage23} /></button
              >
            </div>
            {#if lead && selected.current > 0}
              <div class="row">
                <DropdownLabels selected={returnTarget} autoSelect={false} disabled={busy}
                  items={[{ id: '', label: local(departments.string.OrderReturnTo) },
                    ...selected.stages.slice(0, selected.current).map((item) => ({ id: item.id, label: item.name }))]}
                  on:selected={(event) => { returnTarget = event.detail; returnPerson = '' }} />
                <DropdownLabels selected={returnPerson} autoSelect={false} disabled={busy}
                  items={[{ id: '', label: local(departments.string.OrderKeepAssignee) },
                    ...workers(selected.stages.find((item) => item.id === returnTarget)?.department).flatMap(
                      (worker) => worker.personUuid == null ? [] : [{ id: worker.personUuid, label: formatName(worker.name) }])]}
                  on:selected={(event) => { returnPerson = event.detail }} />
                <button
                  disabled={busy || returnTarget === '' || reason.trim() === ''}
                  on:click={sendReturn}><Label label={departments.string.OrderPage29} /></button
                >
              </div>
            {/if}
            {/if}
          </div>
        {:else if selected.state === 'done'}
          <p class="ok"><Label label={departments.string.OrderPage27} /></p>
        {/if}

        {#if !adjusting && active}
          <ul class="progress-stages waiting-stages">
            {#each selected.stages.slice(selected.current + 1) as item (item.id)}
              <li>{item.name} · {deptName(item.department)} · {name(item.assignee)}</li>
            {/each}
          </ul>
        {/if}
        <h4><Label label={departments.string.OrderPage24} /></h4>
        <ul class="people">
          {#each contacts(selected) as c (c.stage.id)}
            {@const wa = whatsapp(c.who)}
            <li>
              <span>{c.stage.name}：{name(c.who)}</span>
              {#if c.who !== me.uuid}<Button kind="regular" label={departments.string.OrderPage28} on:click={() => chat(c.who)} />{/if}
              {#if wa !== undefined}<a href={wa} target="_blank" rel="noopener">🟢 WhatsApp</a>{/if}
            </li>
          {/each}
        </ul>

        <div class="order-files">
          {#key selected._id}
            <Component is={attachmentsComponent} props={{ objectId: selected._id, _class: departments.class.Order, space: selected.space, readonly: !moduleCanEdit }} />
          {/key}
        </div>

        <h4><Label label={departments.string.OrderPage25} /></h4>
        <ul class="history">
          {#each (showAllHistory ? history : history.slice(0, 3)) as a (a._id)}
            <li>
              <span class="hint">{time(a.createdOn ?? a.modifiedOn)}</span>
              {a.auto === true ? local(departments.string.OrderAutomatic) : name(a.actor)}：{a.kind === 'complete' && selected.stages.find((item) => item.id === a.stage)?.approval ? local(departments.string.OrderApprovalSubmitted) : kindText[a.kind]}（{selected.stages.find((s) => s.id === a.stage)?.name ?? ''}{a.kind === 'return'
                ? ` → ${selected.stages.find((s) => s.id === a.target)?.name ?? ''}`
                : ''}{a.kind === 'assign' ? ` → ${name(a.assignee)}` : ''}{a.kind === 'insert' ? ` → ${a.name ?? ''}` : ''}）{a.reason ? `：${a.reason}` : ''}
            </li>
          {/each}
          {#if history.length === 0}<li class="hint"><Label label={departments.string.OrderPage26} /></li>{/if}
        </ul>
        {#if history.length > 3}
          <div><button type="button" aria-expanded={showAllHistory} on:click={() => { showAllHistory = !showAllHistory }}>
            {showAllHistory ? local(departments.string.OrderCollapse) : local(departments.string.OrderShowAll, { count: history.length })}
          </button></div>
        {/if}
      </div>
    {/if}
  </div>
</section>

<style>
  .order-files { margin: 0.75rem 0; }
  .edit-btn { margin-left: 0.75rem; font-size: 0.75rem; font-weight: 400; }
  .edit-info { display: flex; flex-direction: column; gap: 0.5rem; margin-bottom: 0.75rem; }
  .edit-info label { display: flex; gap: 0.5rem; align-items: center; }
  .edit-info input { flex: 1; }
  .edit-info div { display: flex; gap: 0.5rem; }
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
