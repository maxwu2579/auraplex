<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { createEventDispatcher } from 'svelte'
  export let cards: Array<{
    id: string, name: string, department: string, assignee?: string, status?: string,
    startedOn?: number, limitDays?: number, approval?: unknown
  }>
  export let departments: Array<{ id: string, name: string }> = []
  export let editable = false
  export let firstEditable = 0
  export let selected = ''
  const dispatch = createEventDispatcher<{
    select: string
    dropStage: { id: string, position: number }
    dropDepartment: { id: string, position: number }
  }>()
  const statuses: Record<string, string> = { done: '完成', active: '进行中', waiting: '等待', approval: '等审批' }
  function drop (event: DragEvent, position: number): void {
    if (!editable || position < firstEditable) return
    const stage = event.dataTransfer?.getData('application/x-auraplex-stage')
    const department = event.dataTransfer?.getData('application/x-auraplex-department')
    if (stage) dispatch('dropStage', { id: stage, position })
    else if (department) dispatch('dropDepartment', { id: department, position })
  }
</script>

{#if editable}
  <div class="palette">
    {#each departments as department (department.id)}
      <button draggable="true"
        on:dragstart={(event) => event.dataTransfer?.setData('application/x-auraplex-department', department.id)}
        on:click={() => dispatch('dropDepartment', { id: department.id, position: cards.length })}>{department.name}</button>
    {/each}
  </div>
{/if}
<div class="chart">
  {#each cards as card, index (card.id)}
    {#if index > 0 || editable}
      <span class="gap" role="presentation" on:dragover|preventDefault
        on:drop|preventDefault={(event) => drop(event, index)}>{index > 0 ? '→' : '+'}</span>
    {/if}
    <button class="card {card.status ?? ''}" class:selected={selected === card.id}
      draggable={editable && index >= firstEditable && (card.status === undefined || card.status === 'waiting')}
      on:dragstart={(event) => event.dataTransfer?.setData('application/x-auraplex-stage', card.id)}
      on:click={() => dispatch('select', card.id)}>
      <strong>{card.name}</strong>
      <span>{card.department}</span>
      {#if card.assignee !== undefined}<span>负责人 {card.assignee}</span>{/if}
      {#if card.status}<span>{statuses[card.status]}</span>{/if}
      {#if card.status === 'active' && card.startedOn !== undefined}
        <span>已用 {Math.max(0, Math.floor((Date.now() - card.startedOn) / 86400000))} 天</span>
      {/if}
      {#if card.approval}<span>要审批</span>{/if}
      {#if card.limitDays}<span>超时 {card.limitDays} 天</span>{/if}
    </button>
  {/each}
  {#if editable}
    <span class="gap" role="presentation" on:dragover|preventDefault
      on:drop|preventDefault={(event) => drop(event, cards.length)}>＋</span>
  {/if}
</div>

<style>
  .chart, .palette { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .palette { margin-bottom: 0.5rem; }
  .card { display: grid; gap: 0.25rem; text-align: start; padding: 0.6rem; min-width: 8rem; border: 2px solid var(--theme-divider-color); border-radius: 0.5rem; }
  .selected { outline: 2px solid var(--theme-content-color); }
  .done { border-color: #468c56; }
  .active { border-color: #4386d1; }
  .approval { border-color: #d68b35; }
  .waiting { opacity: 0.78; }
  .gap { padding: 0.65rem 0.2rem; }
</style>
