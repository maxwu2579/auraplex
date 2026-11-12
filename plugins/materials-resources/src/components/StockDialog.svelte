<!--
//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//
// See the License for the specific language governing permissions and
// limitations under the License.
//
-->
<script lang="ts">
  import { generateId } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import materials, {
    formatQuantity,
    parseQuantity,
    planMovement,
    type Material,
    type MovementKind,
    type StockMovement
  } from '@hcengineering/materials'
  import { createEventDispatcher } from 'svelte'

  export let material: Material
  export let kind: Exclude<MovementKind, 'opening'>

  const dispatch = createEventDispatcher()
  const client = getClient()
  const titles: Record<typeof kind, IntlString> = {
    in: materials.string.StockIn,
    out: materials.string.StockOut,
    adjust: materials.string.Adjust
  }

  let amount = ''
  let purpose = ''
  let reason = ''
  let busy = false
  let error: IntlString | undefined

  $: quantity = parseQuantity(amount)
  $: plan =
    quantity === undefined ? undefined : planMovement(material.stock, kind, quantity, kind === 'adjust' ? reason : '')
  $: after = plan !== undefined && 'balance' in plan ? plan.balance : undefined

  async function submit (): Promise<void> {
    if (busy) return
    error = undefined
    if (quantity === undefined) {
      error = materials.string.InvalidQuantity
      return
    }
    busy = true
    try {
      // Always plan against the stock stored right now, not the one shown when the window opened.
      const latest = await client.findOne(materials.class.Material, { _id: material._id })
      if (latest === undefined) throw new Error('Material not found')
      const result = planMovement(latest.stock, kind, quantity, kind === 'adjust' ? reason : '')
      if ('error' in result) {
        material = latest
        error = materials.string[result.error]
        return
      }
      // One transaction: if someone else changed the stock meanwhile, nothing is written.
      // The shared scope makes the server handle stock changes one at a time.
      const ops = client.apply('materials-stock')
      ops.match(materials.class.Material, { _id: latest._id, stock: latest.stock })
      await ops.addCollection(
        materials.class.StockMovement,
        latest.space,
        latest._id,
        latest._class,
        'movements',
        {
          kind,
          quantity,
          delta: result.delta,
          balance: result.balance,
          ...(kind !== 'adjust' && purpose.trim() !== '' ? { purpose: purpose.trim() } : {}),
          ...(kind === 'adjust' ? { reason: reason.trim() } : {})
        },
        generateId<StockMovement>()
      )
      await ops.update(latest, { stock: result.balance, lastMovementOn: Date.now() })
      if (!(await ops.commit()).result) {
        const fresh = await client.findOne(materials.class.Material, { _id: material._id })
        if (fresh !== undefined) material = fresh
        error = materials.string.StockChanged
        return
      }
      dispatch('close')
    } catch {
      error = materials.string.SaveFailed
    } finally {
      busy = false
    }
  }
</script>

<div class="overlay" role="presentation">
  <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="materials-stock-title">
    <div class="head">
      <h2 id="materials-stock-title"><Label label={titles[kind]} /></h2>
      <button on:click={() => dispatch('close')} disabled={busy} aria-label="Close">×</button>
    </div>
    <p class="material"><strong>{material.code}</strong> · {material.name}</p>
    <p class="current">
      <Label label={materials.string.CurrentStock} />: <strong>{formatQuantity(material.stock)}</strong>
      {#if material.unit}{material.unit}{/if}
    </p>
    <form on:submit|preventDefault={submit}>
      <label>
        <span><Label label={kind === 'adjust' ? materials.string.CountedQuantity : materials.string.Quantity} /> *</span
        >
        <!-- svelte-ignore a11y-autofocus -->
        <input bind:value={amount} inputmode="decimal" autocomplete="off" autofocus disabled={busy} />
      </label>
      {#if kind === 'adjust'}
        <label>
          <span><Label label={materials.string.Reason} /> *</span>
          <input bind:value={reason} maxlength={500} disabled={busy} />
        </label>
      {:else}
        <label>
          <span><Label label={materials.string.Purpose} /></span>
          <input bind:value={purpose} maxlength={500} disabled={busy} />
        </label>
      {/if}
      <p class="after">
        <Label label={materials.string.StockAfter} />:
        <strong>{after !== undefined ? formatQuantity(after) : '—'}</strong>
      </p>
      {#if error !== undefined}
        <p class="error" role="alert"><Label label={error} /></p>
      {:else if plan !== undefined && 'error' in plan && amount.trim() !== ''}
        <p class="error"><Label label={materials.string[plan.error]} /></p>
      {/if}
      <div class="actions">
        <button type="button" on:click={() => dispatch('close')} disabled={busy}
          ><Label label={materials.string.Cancel} /></button
        >
        <button class="primary" type="submit" disabled={busy || after === undefined}
          ><Label label={materials.string.Submit} /></button
        >
      </div>
    </form>
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
    background: var(--popup-bg-color, #24252a);
    color: var(--theme-content-color);
    width: min(26rem, 95vw);
    border-radius: 0.7rem;
    padding: 1.25rem;
    box-shadow: var(--popup-shadow);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  h2 {
    font-size: 1.15rem;
    margin: 0;
  }
  .material {
    margin: 0.8rem 0 0.3rem;
    overflow-wrap: anywhere;
  }
  .current,
  .after {
    color: var(--theme-caption-color);
    margin: 0.3rem 0;
  }
  form {
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    margin-top: 0.8rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  label span {
    color: var(--theme-caption-color);
    font-size: 0.82rem;
  }
  button,
  input {
    color: var(--theme-content-color);
    font: inherit;
    border: 1px solid var(--theme-button-border);
    background: var(--theme-button-default);
    border-radius: 0.4rem;
    padding: 0.55rem 0.7rem;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .primary {
    background: var(--primary-button-default, #4b68ed);
    color: white;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.7rem;
  }
  .error {
    color: var(--theme-error-color);
    margin: 0;
  }
</style>
