<script lang="ts">
  import contact, { formatName, type Employee } from '@hcengineering/contact'
  import core, { isOwnerOrMaintainer, type AccountUuid } from '@hcengineering/core'
  import materials from '@hcengineering/materials'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { createEventDispatcher, onMount } from 'svelte'

  const dispatch = createEventDispatcher()
  const client = getClient()
  const query = createQuery()
  let employees: Employee[] = []
  let selected: AccountUuid[] = []
  let busy = true
  let loaded = false
  let error = ''
  query.query(contact.mixin.Employee, { active: true }, (items) => {
    employees = items.filter((item) => item.personUuid != null)
  })
  onMount(async () => {
    try {
      const settings = await client.findOne(materials.class.LowStockSettings, { _id: materials.ids.LowStockSettings })
      selected = settings?.recipients ?? []
      loaded = true
    } catch {
      error = '读取设置失败，请重试。'
    } finally {
      busy = false
    }
  })
  async function save (): Promise<void> {
    if (!isOwnerOrMaintainer() || busy || !loaded) return
    busy = true
    error = ''
    try {
      const settings = await client.findOne(materials.class.LowStockSettings, { _id: materials.ids.LowStockSettings })
      if (settings === undefined) {
        await client.createDoc(
          materials.class.LowStockSettings,
          core.space.Workspace,
          { recipients: selected },
          materials.ids.LowStockSettings
        )
      } else {
        await client.update(settings, { recipients: selected })
      }
      dispatch('close')
    } catch {
      error = '保存失败，请检查权限后重试。'
    } finally {
      busy = false
    }
  }
</script>

<div class="overlay" role="presentation">
  <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="recipients-title">
    <h2 id="recipients-title">低库存提醒接收人</h2>
    <p>可以选择多个人。不选择时，提醒发给工作区所有者。</p>
    <div class="members">
      {#each employees as employee (employee._id)}
        {#if employee.personUuid != null}
          <label
            ><input type="checkbox" value={employee.personUuid} bind:group={selected} disabled={busy} />
            {formatName(employee.name)}</label
          >
        {/if}
      {/each}
    </div>
    {#if error}<p class="error">{error}</p>{/if}
    <div class="actions">
      <button on:click={() => dispatch('close')} disabled={busy}>取消</button><button
        class="primary"
        on:click={save}
        disabled={busy || !loaded}>保存</button
      >
    </div>
  </section>
</div>

<style lang="scss">
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: #0008;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .dialog {
    background: var(--theme-popup-color);
    color: var(--theme-content-color);
    padding: 1.5rem;
    border-radius: 0.7rem;
    max-width: 32rem;
    width: 90%;
  }
  .members {
    display: grid;
    gap: 0.5rem;
    max-height: 50vh;
    overflow: auto;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.7rem;
    margin-top: 1rem;
  }
  .actions button {
    color: var(--theme-content-color);
    font: inherit;
    border: 1px solid var(--theme-button-border);
    background: var(--theme-button-default);
    border-radius: 0.4rem;
    padding: 0.5rem 1rem;
    cursor: pointer;
  }
  .actions button.primary {
    background: var(--primary-button-default, #4b68ed);
    color: white;
  }
  .actions button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .error {
    color: var(--theme-error-color);
  }
</style>
