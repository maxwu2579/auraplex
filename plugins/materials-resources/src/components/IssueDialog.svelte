<!-- Copyright © 2026 Auraplex. Licensed under EPL-2.0. -->
<script lang="ts">
  import { t } from '../trStore'
  import { Label } from '@hcengineering/ui'

  import { generateId } from '@hcengineering/core'
  import materials, {
    formatQuantity,
    planIssue,
    type CalculationProduct,
    type Material,
    type ShortageRow,
    type StockMovement
  } from '@hcengineering/materials'
  import { getClient } from '@hcengineering/presentation'
  import { createEventDispatcher } from 'svelte'

  export let rows: ShortageRow[]
  export let stock: Material[]
  export let products: CalculationProduct[]
  export let stale: boolean = false

  const dispatch = createEventDispatcher()
  const client = getClient()
  const plan = planIssue(rows, stock)
  const purpose = `领料：${products.map((product) => `${product.name} ×${product.count}`).join('，')}`
  let busy = false
  let completed = false
  let locked = false
  let error = ''
  const changed = $t('库存已变化，请关闭后重新计算')
  function close (): void {
    if (!busy) dispatch('close')
  }
  async function submit (): Promise<void> {
    if (busy || completed || locked || plan.blocked.length > 0 || plan.items.length === 0) return
    busy = true
    error = ''
    try {
      if (stale) {
        error = changed
        locked = true
        return
      }
      const latest = await client.findAll(
        materials.class.Material,
        { _id: { $in: plan.items.map((item) => item.material._id) } },
        { limit: plan.items.length }
      )
      const byId = new Map(latest.map((item) => [item._id, item]))
      if (stale || plan.items.some((item) => byId.get(item.material._id)?.stock !== item.material.stock)) {
        error = changed
        locked = true
        return
      }
      const ops = client.apply('materials-stock')
      for (const item of plan.items) {
        const material = byId.get(item.material._id)
        if (material === undefined) throw new Error('Material missing')
        ops.match(materials.class.Material, { _id: material._id, stock: material.stock })
        await ops.addCollection(
          materials.class.StockMovement,
          material.space,
          material._id,
          material._class,
          'movements',
          {
            kind: 'out',
            quantity: item.quantity,
            delta: item.delta,
            balance: item.balance,
            purpose
          },
          generateId<StockMovement>()
        )
        await ops.update(material, { stock: item.balance, lastMovementOn: Date.now() })
      }
      if (stale) {
        error = changed
        locked = true
        return
      }
      if (!(await ops.commit()).result) {
        error = changed
        locked = true
        return
      }
      completed = true
    } catch {
      error = $t('出库结果无法确认，请关闭窗口后检查库存和流水，再重新计算。')
      locked = true
    } finally {
      busy = false
    }
  }
</script>

<div class="overlay" role="presentation">
  <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="issue-title">
    <div class="head">
      <h2 id="issue-title"><Label label={materials.string.PageIssue} /></h2>
      <button on:click={close} disabled={busy} aria-label={$t('关闭')}>×</button>
    </div>
    {#if completed}
      <p role="status">已出库 {plan.items.length} 项</p>
    {:else}
      <p>用途：{purpose}</p>
      {#if plan.blocked.length > 0}
        <div class="error" role="alert">
          <strong><Label label={materials.string.PageCantIssue} /></strong>
          {#each plan.blocked as row}<p>
              {row.code}：需要 {row.required ?? $t('未知')}，库存 {row.stock ?? $t('未知')}，缺 {row.shortage ?? $t('未知')}
            </p>{/each}
        </div>
      {/if}
      <h3><Label label={materials.string.PageWillIssue} /></h3>
      {#if plan.items.length === 0}<p><Label label={materials.string.PageNoIssue} /></p>{:else}
        <div class="table-wrap">
          <table>
            <thead
              ><tr><th><Label label={materials.string.PageCode} /></th><th><Label label={materials.string.PageName} /></th><th><Label label={materials.string.PageShortLocation} /></th><th><Label label={materials.string.PageIssueQuantity} /></th><th><Label label={materials.string.PageCurrentStock} /></th><th><Label label={materials.string.PageStockAfter} /></th></tr
              ></thead
            ><tbody>
              {#each plan.items as item}<tr
                  ><td>{item.row.code}</td><td>{item.material.name}</td><td
                    >{[item.material.rack, item.material.level].filter(Boolean).join(' / ') !== ''
                      ? [item.material.rack, item.material.level].filter(Boolean).join(' / ')
                      : '—'}</td
                  ><td>{formatQuantity(item.quantity)}</td><td>{formatQuantity(item.material.stock)}</td><td
                    >{formatQuantity(item.balance)}</td
                  ></tr
                >{/each}
            </tbody>
          </table>
        </div>
      {/if}
      {#if plan.skipped.length > 0}<h3><Label label={materials.string.PageSkipped} /></h3>
        <ul>
          {#each plan.skipped as item}<li>
              {item.row.code !== '' ? item.row.code : $t('无编号')} · {item.row.name}：{item.reasons.join('；')}
            </li>{/each}
        </ul>{/if}
      {#if error !== ''}<p class="error" role="alert">{error}</p>{/if}
    {/if}
    <div class="actions">
      <button on:click={close} disabled={busy}><Label label={materials.string.PageClose} /></button>{#if !completed}<button
          class="primary"
          on:click={submit}
          disabled={busy || locked || plan.blocked.length > 0 || plan.items.length === 0}
          >{busy ? $t('正在出库…') : $t('确认出库')}</button
        >{/if}
    </div>
  </section>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    background: var(--popup-bg-color, #24252a);
    color: var(--theme-content-color);
    width: min(70rem, 95vw);
    max-height: 85vh;
    overflow: auto;
    scrollbar-width: auto;
    border-radius: 0.7rem;
    padding: 1.25rem;
    box-shadow: var(--popup-shadow);
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  h2 {
    font-size: 1.15rem;
    margin: 0;
  }
  h3 {
    margin: 0.8rem 0 0.4rem;
  }
  /* Do not let the list be squeezed to one line on short windows; the whole dialog scrolls instead. */
  .table-wrap {
    flex-shrink: 0;
    overflow-x: auto;
    scrollbar-width: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    text-align: left;
  }
  th,
  td {
    padding: 0.5rem;
    border-bottom: 1px solid var(--theme-divider-color);
    white-space: nowrap;
  }
  button {
    color: var(--theme-content-color);
    font: inherit;
    border: 1px solid var(--theme-button-border);
    background: var(--theme-button-default);
    border-radius: 0.4rem;
    padding: 0.5rem 0.8rem;
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .primary {
    background: #3b5bdb;
    border-color: #3b5bdb;
    color: #fff;
  }
  .error {
    color: var(--theme-error-color, #fa7777);
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.7rem;
    margin-top: 1rem;
  }
</style>
