<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { formatName } from '@hcengineering/contact'
  import departments from '@hcengineering/departments'
  import { Label } from '@hcengineering/ui'
  import TaskFeed from './TaskFeed.svelte'
  import TaskRow from './TaskRow.svelte'

  const s = departments.string
  const sections = [s.TaskMailOverdue, s.TaskMailDueToday, s.TaskMailActiveOrders, s.TaskMailPendingApproval]
  let showTeam = false
</script>

<section class="today">
  <h2><Label label={s.TodayTasks} /></h2>
  <TaskFeed includeDepartment let:mine let:reports let:manages let:now>
    {#if manages}
      <nav>
        <button aria-pressed={!showTeam} on:click={() => { showTeam = false }}><Label label={s.TodayTasks} /></button>
        <button aria-pressed={showTeam} on:click={() => { showTeam = true }}><Label label={s.MyDepartmentTasks} /></button>
      </nav>
    {/if}
    {#if manages && showTeam}
      {#each reports as report (report.person._id)}
        <details>
          <summary>{formatName(report.person.name)} · <Label label={s.TaskOverdueCount} params={{ count: report.overdue.length }} /></summary>
          <ul>{#each report.overdue as item (item.source._id)}<TaskRow {item} {now} overdue />{/each}</ul>
        </details>
      {:else}
        <p><Label label={s.TaskEmpty} /></p>
      {/each}
    {:else if mine.length === 0}
      <p><Label label={s.TaskEmpty} /></p>
    {:else}
      {#each sections as label, section}
        {@const sectionRows = mine.filter((row) => row.section === section)}
        {#if sectionRows.length > 0}
          <h3 class:overdue={section === 0}><Label {label} /></h3>
          <ul>
            {#each sectionRows as { item } (item.source._id)}
              <TaskRow {item} {now} overdue={section === 0} actions />
            {/each}
          </ul>
        {/if}
      {/each}
    {/if}
  </TaskFeed>
</section>

<style>
  .today { overflow: auto; flex: 1; padding: clamp(0.75rem, 3vw, 2rem); color: var(--theme-caption-color); }
  nav { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  nav button { padding: 0.55rem 0.75rem; color: var(--theme-caption-color); }
  nav button[aria-pressed='true'] { color: var(--theme-link-color); }
  ul { padding: 0; margin: 0 0 1rem; }
  details { border-bottom: 1px solid var(--theme-divider-color); padding: 0.65rem 0; }
  summary { cursor: pointer; }
  .overdue { color: var(--theme-error-color); }
</style>
