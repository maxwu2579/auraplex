<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import core, { AccountRole, generateId, getCurrentAccount, type Ref } from '@hcengineering/core'
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
  function addStage (): void {
    stages = [...stages, { id: generateId(), name: '新阶段', steps: [] }]
  }
  function addStep (i: number): void {
    stages[i].steps = [...stages[i].steps, '']
  }
  function removeStep (i: number, j: number): void {
    stages[i].steps = stages[i].steps.filter((_, k) => k !== j)
  }

  async function save (): Promise<void> {
    if (busy) return
    busy = true
    error = ''
    notice = ''
    const clean = stages.map((it) => ({
      ...it,
      name: it.name.trim(),
      steps: it.steps.map((s) => s.trim()).filter((s) => s !== '')
    }))
    try {
      if (clean.some((it) => it.name === '')) throw new Error('每个阶段都要有名字。')
      if (flow === undefined) {
        await client.createDoc(departments.class.OrderFlow, core.space.Workspace, { stages: clean }, departments.ids.OrderFlow)
      } else {
        await client.update(flow, { stages: clean })
      }
      notice = '已保存。以后新建的订单按这个流程走，正在进行的订单不变。'
    } catch (e) {
      error = e instanceof Error && e.message.startsWith('每个') ? e.message : '保存失败：没有权限改这里，或者流程已被别人改过，请刷新。'
    } finally {
      busy = false
    }
  }
</script>

<section class="flow">
  <h2>订单流程</h2>
  <p class="hint">
    {owner ? '你可以调整阶段：改名、换顺序、加减阶段、指定由哪个部门负责。' : '你可以给自己部门负责的阶段加小步骤。'}
    改动只影响以后新建的订单。
  </p>
  {#each stages as stage, i (stage.id)}
    <div class="stage">
      <div class="row">
        <b>{i + 1}.</b>
        {#if owner}
          <input bind:value={stage.name} maxlength="40" />
          <select bind:value={stage.department}>
            <option value={undefined}>（未指定部门）</option>
            {#each depts as d (d._id)}<option value={d._id}>{d.name}</option>{/each}
          </select>
          <button disabled={i === 0} on:click={() => move(i, -1)}>↑</button>
          <button disabled={i === stages.length - 1} on:click={() => move(i, 1)}>↓</button>
          <button disabled={stages.length <= 1} on:click={() => remove(i)}>删除阶段</button>
        {:else}
          <span>{stage.name}</span>
          <span class="hint">（{depts.find((d) => d._id === stage.department)?.name ?? '未指定部门'}）</span>
        {/if}
      </div>
      <div class="steps">
        {#each stage.steps as _, j (j)}
          <div class="row">
            <span class="hint">小步骤</span>
            <input bind:value={stage.steps[j]} maxlength="60" disabled={!adminOf(stage.department)} />
            {#if adminOf(stage.department)}<button on:click={() => removeStep(i, j)}>×</button>{/if}
          </div>
        {/each}
        {#if adminOf(stage.department)}<button class="small" on:click={() => addStep(i)}>+ 加小步骤</button>{/if}
      </div>
    </div>
  {/each}
  <div class="row">
    {#if owner}<button on:click={addStage}>+ 加阶段</button>{/if}
    <button class="primary" disabled={busy} on:click={save}>{busy ? '正在保存…' : '保存'}</button>
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
