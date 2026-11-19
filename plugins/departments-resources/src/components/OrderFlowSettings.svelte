<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { Breadcrumb, Button, Header, Label, languageStore } from '@hcengineering/ui'
  import { translate } from '@hcengineering/platform'
  import { departmentModuleLevel } from '@hcengineering/presentation'
  $: moduleCanEdit = $departmentModuleLevel('orders') === 'edit'
  import contact, { formatName, type Employee } from '@hcengineering/contact'
  import OrderFlowChart from './OrderFlowChart.svelte'
  import core, { AccountRole, generateId, getCurrentAccount, type Ref, type AccountUuid } from '@hcengineering/core'
  import departments, { defaultOrderStages, type DepartmentAccess, type OrderFlow, type OrderFlowStage } from '@hcengineering/departments'
  import hr, { type Department } from '@hcengineering/hr'
  import { createQuery, getClient } from '@hcengineering/presentation'

  /**
   * The order flow every new order copies. Super admins change the stages (add, rename, reorder,
   * which department); a department admin only adds sub-steps to their own department's stage.
   * Orders already running keep the flow they started with.
   */
  const client = getClient()
  const hierarchy = client.getHierarchy()
  const me = getCurrentAccount()
  const owner = me.role === AccountRole.Owner

  let flow: OrderFlow | undefined
  let loaded = false
  let stages: OrderFlowStage[] = []
  let depts: DepartmentAccess[] = []
  let busy = false
  let error = ''
  let notice = ''
  let openStage = ''
  let staff: Employee[] = []
  createQuery().query(contact.mixin.Employee, { active: true }, (items) => { staff = items })

  function dropDepartment (id: string, position: number): void {
    const dept = depts.find((item) => item._id === id)
    if (!owner || dept === undefined) return
    const stage = { id: generateId(), name: dept.name, department: dept._id, steps: [] }
    const next = [...stages]
    next.splice(position, 0, stage)
    stages = next
    openStage = stage.id
  }

  function dropStage (id: string, position: number): void {
    const from = stages.findIndex((item) => item.id === id)
    if (!owner || from < 0) return
    const next = [...stages]
    const [stage] = next.splice(from, 1)
    next.splice(position - Number(from < position), 0, stage)
    stages = next
  }

  function chooseApprover (stage: OrderFlowStage, value: string): void {
    stage.approval = value === '' ? undefined : value === 'admins' ? { by: 'deptAdmins' } : { by: 'person', person: value as AccountUuid }
    stages = [...stages]
  }

  const copy = (list: OrderFlowStage[]): OrderFlowStage[] => list.map((it) => ({ ...it, steps: [...it.steps] }))
  createQuery().query(departments.class.OrderFlow, { _id: departments.ids.OrderFlow }, (res) => {
    flow = res[0]
    if (!loaded || !busy) stages = copy(flow?.stages ?? defaultOrderStages)
    loaded = true
  })
  createQuery().query(hr.class.Department, {}, (res) => {
    depts = res.flatMap((it) => hierarchy.asIf(it, departments.mixin.DepartmentAccess) ?? []).filter((it) => !it.archived)
  })

  const adminOf = (department: Ref<Department> | undefined): boolean =>
    owner || (depts.find((it) => it._id === department)?.administrators.includes(me.uuid) ?? false)

  function move (i: number, by: number): void {
    const j = i + by
    if (j < 0 || j >= stages.length) return
    const next = [...stages]
    ;[next[i], next[j]] = [next[j], next[i]]
    stages = next
  }
  function remove (i: number): void {
    stages = stages.filter((_, k) => k !== i)
  }
  async function addStage (): Promise<void> {
    const stage = { id: generateId(), name: await translate(departments.string.FlowNewStage, {}, $languageStore), steps: [] }
    stages = [...stages, stage]
    openStage = stage.id
  }
  function addStep (i: number): void {
    stages[i].steps = [...stages[i].steps, '']
  }
  function removeStep (i: number, j: number): void {
    stages[i].steps = stages[i].steps.filter((_, k) => k !== j)
  }

  async function save (): Promise<void> {
    if (busy || !moduleCanEdit) return
    busy = true
    error = ''
    notice = ''
    const clean = stages.map((it) => ({
      ...it,
      name: it.name.trim(),
      steps: it.steps.map((s) => s.trim()).filter((s) => s !== '')
    }))
    try {
      if (clean.some((it) => it.name === '')) throw new Error('stage-name')
      const ops = client.apply('edit-order-flow')
      if (flow === undefined) {
        ops.notMatch(departments.class.OrderFlow, { _id: departments.ids.OrderFlow })
        await ops.createDoc(departments.class.OrderFlow, core.space.Workspace, { stages: clean }, departments.ids.OrderFlow)
      } else {
        ops.match(departments.class.OrderFlow, { _id: flow._id, modifiedOn: flow.modifiedOn })
        await ops.update(flow, { stages: clean })
      }
      if (!(await ops.commit()).result) throw new Error('Could not save order flow')
      notice = await translate(departments.string.FlowSaved, {}, $languageStore)
    } catch (e) {
      error = await translate(e instanceof Error && e.message === 'stage-name' ? departments.string.FlowStageNameRequired : departments.string.FlowSaveFailed, {}, $languageStore)
    } finally {
      busy = false
    }
  }
</script>

<section class="flow">
  <Header adaptive="disabled"><Breadcrumb label={departments.string.OrderFlow} size="large" isCurrent /></Header>
  <p class="hint">
    <Label label={owner ? departments.string.FlowOwnerHint : departments.string.FlowAdminHint} />
    <Label label={departments.string.FlowNewOrdersOnly} />
  </p>
  <OrderFlowChart
    cards={stages.map((item) => ({ ...item, department: depts.find((dept) => dept._id === item.department)?.name ?? '' }))}
    departments={depts.map((dept) => ({ id: dept._id, name: dept.name }))}
    editable={owner && !busy && moduleCanEdit}
    selected={openStage}
    on:select={(event) => { openStage = openStage === event.detail ? '' : event.detail }}
    on:dropDepartment={(event) => dropDepartment(event.detail.id, event.detail.position)}
    on:dropStage={(event) => dropStage(event.detail.id, event.detail.position)}
  />
  {#each stages as stage, i (stage.id)}
    {#if stage.id === openStage}
    <div class="stage">
      <div class="row">
        <b>{i + 1}.</b>
        {#if owner && moduleCanEdit}
          <input bind:value={stage.name} maxlength="40" />
          <select bind:value={stage.department}>
            <option value={undefined}><Label label={departments.string.OrderUnassignedDepartment} /></option>
            {#each depts as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
          <button disabled={i === 0} on:click={() => move(i, -1)}>↑</button>
          <button disabled={i === stages.length - 1} on:click={() => move(i, 1)}>↓</button>
          <Button kind="regular" label={departments.string.FlowDeleteStage} disabled={stages.length <= 1} on:click={() => remove(i)} />
        {:else}
          <span>{stage.name}</span>
          <span class="hint">（{depts.find((d) => d._id === stage.department)?.name ?? ''}）</span>
        {/if}
      </div>
      {#if owner && moduleCanEdit}
        <label><Label label={departments.string.FlowTimeLimit} /> <input type="number" min="1" step="1" bind:value={stage.limitDays} /></label>
        <label><Label label={departments.string.FlowApprover} />
          <select value={stage.approval?.by === 'person' ? stage.approval.person : stage.approval ? 'admins' : ''}
            on:change={(event) => chooseApprover(stage, event.currentTarget.value)}>
            <option value=""><Label label={departments.string.FlowNoApproval} /></option>
            <option value="admins"><Label label={departments.string.FlowDepartmentAdmins} /></option>
            {#each staff as person (person._id)}
              {#if person.personUuid}<option value={person.personUuid}>{formatName(person.name)}</option>{/if}
            {/each}
          </select>
        </label>
      {/if}
      <div class="steps">
        {#each stage.steps as _, j (j)}
          <div class="row">
            <span class="hint"><Label label={departments.string.FlowStep} /></span>
            <input bind:value={stage.steps[j]} maxlength="60" disabled={!moduleCanEdit || !adminOf(stage.department)} />
            {#if moduleCanEdit && adminOf(stage.department)}<button on:click={() => removeStep(i, j)}>×</button>{/if}
          </div>
        {/each}
        {#if moduleCanEdit && adminOf(stage.department)}<Button kind="regular" label={departments.string.FlowAddStep} on:click={() => addStep(i)} />{/if}
      </div>
    </div>
    {/if}
  {/each}
  <div class="row">
    {#if owner && moduleCanEdit}<Button kind="regular" label={departments.string.FlowAddStage} on:click={addStage} />{/if}
    <Button kind="primary" disabled={busy || !moduleCanEdit} on:click={save} label={busy ? departments.string.FlowSaving : departments.string.OrderPage15} />
  </div>
  {#if error}<p class="err" role="alert">{error}</p>{/if}{#if notice}<p class="ok">{notice}</p>{/if}
</section>

<style>
  .flow { display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem 1.25rem; overflow: auto; height: 100%; }
  h2 { margin: 0; }
  .stage { display: flex; flex-direction: column; gap: 0.4rem; padding: 0.6rem; border: 1px solid var(--theme-divider-color); border-radius: 0.4rem; }
  .steps { display: flex; flex-direction: column; gap: 0.3rem; padding-left: 1.5rem; }
  .row { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; }
  input, select, button {
    color: var(--theme-content-color);
    background: var(--theme-button-default);
    border: 1px solid var(--theme-button-border);
    padding: 0.35rem 0.6rem;
    border-radius: 0.3rem;
    font: inherit;
  }
  button { cursor: pointer; }
  button:disabled { opacity: 0.45; cursor: default; }
  button.small { align-self: flex-start; }
  button.primary { border-color: var(--theme-caption-color); }
  .hint { color: var(--theme-dark-color); margin: 0; }
  .err { color: var(--theme-error-color); margin: 0; }
  .ok { color: var(--theme-won-color, #3a9b5d); margin: 0; }
</style>
