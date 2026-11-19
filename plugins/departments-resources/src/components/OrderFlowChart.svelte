<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import departmentPlugin from '@hcengineering/departments'
  import { Label, languageStore } from '@hcengineering/ui'
  import StatusTag from './StatusTag.svelte'
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
  const statuses: Record<string, typeof departmentPlugin.string.FlowDone> = {
    done: departmentPlugin.string.FlowDone, active: departmentPlugin.string.FlowActive,
    waiting: departmentPlugin.string.FlowWaiting, approval: departmentPlugin.string.FlowApproval
  }
  let dragging: { kind: 'stage' | 'department', id: string } | undefined
  let target: number | undefined

  function canDrop (position: number): boolean {
    const status = cards[position]?.status
    return editable && position >= firstEditable &&
      (status === undefined || status === 'waiting') && (dragging?.id !== cards[position]?.id)
  }

  function beginDrag (event: DragEvent, kind: 'stage' | 'department', id: string, position?: number): void {
    if (!editable || (position !== undefined && !canDrop(position)) || event.dataTransfer === null) {
      event.preventDefault()
      return
    }
    dragging = { kind, id }
    event.dataTransfer.effectAllowed = kind === 'stage' ? 'move' : 'copy'
    event.dataTransfer.setData('application/x-auraplex-' + kind, id)
  }

  function finishDrag (): void {
    dragging = undefined
    target = undefined
  }

  function dragOver (event: DragEvent, position: number): void {
    if (dragging === undefined || !canDrop(position)) {
      target = undefined
      return
    }
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = dragging.kind === 'stage' ? 'move' : 'copy'
    target = position
  }

  function drop (event: DragEvent, position: number): void {
    if (dragging === undefined || !canDrop(position)) return
    event.preventDefault()
    const { kind, id } = dragging
    finishDrag()
    if (kind === 'stage') dispatch('dropStage', { id, position })
    else dispatch('dropDepartment', { id, position })
  }
</script>

{#if editable}
  <div class="palette">
    {#each departments as department (department.id)}
      <button draggable="true"
        on:dragstart={(event) => beginDrag(event, 'department', department.id)}
        on:dragend={finishDrag}
        on:click={() => dispatch('dropDepartment', { id: department.id, position: cards.length })}>{department.name}</button>
    {/each}
  </div>
{/if}
<div class="chart">
  {#each cards as card, index (card.id)}
    {#if index > 0 || editable}
      <span class="gap" role="presentation" on:dragover={(event) => dragOver(event, index)}
        on:drop={(event) => drop(event, index)}>{index > 0 ? '→' : '+'}</span>
    {/if}
    <button class="card {card.status ?? ''}" class:selected={selected === card.id}
      draggable={editable && index >= firstEditable && (card.status === undefined || card.status === 'waiting')}
      class:drop-allowed={dragging !== undefined && canDrop(index)}
      class:drop-target={target === index}
      class:drop-blocked={dragging !== undefined && !canDrop(index)}
      on:dragstart={(event) => beginDrag(event, 'stage', card.id, index)}
      on:dragend={finishDrag}
      on:dragover={(event) => dragOver(event, index)}
      on:drop={(event) => drop(event, index)}
      on:click={() => dispatch('select', card.id)}>
      <strong>{card.name}</strong>
      <span>{card.department}</span>
      {#if card.assignee !== undefined}<span><Label label={departmentPlugin.string.FlowAssignee} params={{ name: card.assignee }} /></span>{/if}
      {#if card.status}<span class="stage-status"><StatusTag status={card.status === 'done' || card.status === 'active' || card.status === 'approval' ? card.status : 'waiting'} label={statuses[card.status]} /></span>{/if}
      {#if card.status === 'active' && card.startedOn !== undefined}
        <span><Label label={departmentPlugin.string.FlowElapsed} params={{ count: Math.max(0, Math.floor((Date.now() - card.startedOn) / 86400000)) }} /></span>
      {/if}
      {#if card.approval}<span><Label label={departmentPlugin.string.FlowNeedsApproval} /></span>{/if}
      {#if card.limitDays}<span>{$languageStore === 'zh' ? `限时 ${card.limitDays} 天` : `Limit ${card.limitDays} d`}</span>{/if}
    </button>
  {/each}
  {#if editable}
    <span class="gap" role="presentation" class:drop-target={target === cards.length}
      class:drop-allowed={dragging !== undefined && canDrop(cards.length)}
      on:dragover={(event) => dragOver(event, cards.length)}
      on:drop={(event) => drop(event, cards.length)}>＋</span>
  {/if}
</div>

<style>
  .chart, .palette { display: flex; gap: 0.4rem; flex-wrap: wrap; align-items: center; }
  .palette { margin-bottom: 0.75rem; }
  .palette button, .card {
    color: var(--theme-content-color);
    background: var(--theme-panel-color);
    border: 2px solid var(--theme-button-border);
    border-radius: 0.5rem;
  }
  .palette button { padding: 0.65rem 1rem; min-height: 2.75rem; min-width: 7rem; cursor: grab; color: var(--theme-caption-color); }
  .card {
    box-sizing: border-box; display: flex; flex-direction: column; align-items: flex-start;
    gap: 0.2rem; text-align: start; padding: 0.6rem; width: 10rem; max-width: 100%;
    height: 10.5rem; line-height: 1.2; overflow: auto;
  }
  .card strong, .stage-status { color: var(--theme-caption-color); }
  .stage-status { font-weight: 600; }
  .selected { outline: 2px solid var(--theme-content-color); }
  .done { border-color: var(--theme-won-color); }
  .active { border-color: var(--theme-link-color); }
  .approval { border-color: var(--theme-warning-color); }
  .waiting { border-style: dashed; }
  .card[draggable='true'] { cursor: grab; }
  .drop-allowed { outline: 2px dashed var(--theme-link-color); }
  .drop-allowed.drop-target { outline: 3px solid var(--theme-link-color); background: var(--theme-button-hovered); }
  .drop-blocked { opacity: 0.5; filter: grayscale(1); cursor: not-allowed; }
  .gap { padding: 0.65rem 0.2rem; color: var(--theme-caption-color); }
</style>
