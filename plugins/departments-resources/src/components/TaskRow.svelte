<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import departments, { singaporeZone, taskDayMs, type ScheduledTask } from '@hcengineering/departments'
  import core, { getCurrentAccount } from '@hcengineering/core'
  import { departmentModuleLevel, getClient } from '@hcengineering/presentation'
  import type { ToDo } from '@hcengineering/time'
  import { Label, languageStore } from '@hcengineering/ui'

  export let item: ScheduledTask
  export let now: number
  export let overdue: boolean
  export let actions = false
  const s = departments.string
  const client = getClient()
  const me = getCurrentAccount().uuid
  let busy = false
  let failed = false

  async function finish (): Promise<void> {
    if (busy) return
    busy = true
    failed = false
    try {
      if (item.kind === 'todo') await client.update(item.source as ToDo, { doneOn: Date.now() })
      if (item.order !== undefined) {
        const { doc, stage } = item.order
        const ops = client.apply(doc._id, 'today-task-complete')
        await ops.createDoc(departments.class.OrderAction, core.space.Workspace, {
          order: doc._id, kind: 'complete', stage: stage.id, actor: me
        })
        if (!(await ops.commit()).result) throw new Error('Order action refused')
      }
    } catch {
      failed = true
    } finally {
      busy = false
    }
  }

  $: due = item.due === undefined ? '' : new Intl.DateTimeFormat($languageStore, {
    dateStyle: 'medium', timeStyle: 'short', timeZone: singaporeZone
  }).format(item.due)
  $: typeLabel = item.kind === 'order' ? s.TaskTypeOrder : item.kind === 'issue' ? s.TaskTypeIssue
    : item.kind === 'approval' ? s.TaskTypeApproval : s.TaskTypeTodo
</script>

<li class:overdue>
  <a href={item.href}>{item.title}</a>
  <span class="tag"><Label label={typeLabel} /></span>
  {#if due}<time datetime={new Date(item.due ?? 0).toISOString()}>{due}</time>{/if}
  {#if overdue && item.due !== undefined}
    <span><Label label={s.OrderOverdueDays} params={{ count: Math.ceil((now - item.due) / taskDayMs) }} /></span>
  {/if}
  {#if actions && item.kind === 'todo' && item.assignee === me}
    <label><input type="checkbox" checked={false} disabled={busy} on:change={(event) => {
      event.currentTarget.checked = false
      void finish()
    }} /> <Label label={s.TaskFinishTodo} /></label>
  {:else if actions && item.order?.stage.status === 'active' && item.assignee === me && $departmentModuleLevel('orders') !== 'none'}
    <button disabled={busy} on:click={finish}><Label label={s.OrderCompleteStage} /></button>
  {/if}
  {#if failed}<span role="alert"><Label label={s.OrderActionDenied} /></span>{/if}
</li>

<style>
  li { list-style: none; display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; padding: 0.6rem 0; }
  a { color: var(--theme-link-color); overflow-wrap: anywhere; }
  .tag { border: 1px solid var(--theme-divider-color); padding: 0.1rem 0.4rem; border-radius: 0.4rem; }
  .overdue, .overdue a { color: var(--theme-error-color); }
  button { padding: 0.4rem 0.6rem; color: var(--theme-caption-color); }
</style>
