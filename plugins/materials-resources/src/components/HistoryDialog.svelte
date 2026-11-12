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
  import { getName } from '@hcengineering/contact'
  import { getPersonByPersonId } from '@hcengineering/contact-resources'
  import { SortingOrder } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import materials, {
    formatQuantity,
    type Material,
    type MovementKind,
    type StockMovement
  } from '@hcengineering/materials'
  import { createEventDispatcher } from 'svelte'

  export let material: Material

  const dispatch = createEventDispatcher()
  const hierarchy = getClient().getHierarchy()
  const kinds: Record<MovementKind, IntlString> = {
    opening: materials.string.Opening,
    in: materials.string.StockIn,
    out: materials.string.StockOut,
    adjust: materials.string.Adjust
  }
  const query = createQuery()
  let movements: StockMovement[] = []
  let loaded = false
  let people: Record<string, string> = {}

  $: query.query(
    materials.class.StockMovement,
    { attachedTo: material._id },
    (result) => {
      movements = result
      loaded = true
      void resolvePeople(result)
    },
    { sort: { createdOn: SortingOrder.Descending }, limit: 1000 }
  )

  async function resolvePeople (list: StockMovement[]): Promise<void> {
    for (const movement of list) {
      const id = movement.createdBy ?? movement.modifiedBy
      if (id === undefined || people[id] !== undefined) continue
      people[id] = ''
      const person = await getPersonByPersonId(id)
      people = { ...people, [id]: person !== null ? getName(hierarchy, person) : '' }
    }
  }

  function time (movement: StockMovement): string {
    return new Date(movement.createdOn ?? movement.modifiedOn).toLocaleString()
  }
</script>

<div class="overlay" role="presentation">
  <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="materials-history-title">
    <div class="head">
      <h2 id="materials-history-title"><Label label={materials.string.History} /></h2>
      <button on:click={() => dispatch('close')} aria-label="Close">×</button>
    </div>
    <p class="material">
      <strong>{material.code}</strong> · {material.name} ·
      <Label label={materials.string.CurrentStock} />: <strong>{formatQuantity(material.stock)}</strong>
    </p>
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th><Label label={materials.string.Time} /></th>
            <th><Label label={materials.string.Type} /></th>
            <th class="number"><Label label={materials.string.Change} /></th>
            <th class="number"><Label label={materials.string.Balance} /></th>
            <th><Label label={materials.string.Purpose} /> / <Label label={materials.string.Reason} /></th>
            <th><Label label={materials.string.By} /></th>
          </tr>
        </thead>
        <tbody>
          {#each movements as movement (movement._id)}
            <tr>
              <td>{time(movement)}</td>
              <td><Label label={kinds[movement.kind]} /></td>
              <td class="number" class:plus={movement.delta > 0} class:minus={movement.delta < 0}>
                {movement.delta > 0 ? '+' : ''}{formatQuantity(movement.delta)}
              </td>
              <td class="number">{formatQuantity(movement.balance)}</td>
              <td class="text">{movement.reason ?? movement.purpose ?? ''}</td>
              <td>{people[movement.createdBy ?? movement.modifiedBy] ?? ''}</td>
            </tr>
          {:else}
            <tr>
              <td colspan="6" class="empty">
                {#if loaded}<Label label={materials.string.NoMovements} />{/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
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
    width: min(60rem, 95vw);
    max-height: 85vh;
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
    margin: 0.8rem 0;
    overflow-wrap: anywhere;
  }
  button {
    color: var(--theme-content-color);
    font: inherit;
    border: 1px solid var(--theme-button-border);
    background: var(--theme-button-default);
    border-radius: 0.4rem;
    padding: 0.4rem 0.7rem;
    cursor: pointer;
  }
  .table-wrap {
    overflow: auto;
    min-height: 0;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    text-align: left;
  }
  th,
  td {
    padding: 0.6rem 0.7rem;
    border-bottom: 1px solid var(--theme-divider-color);
    white-space: nowrap;
  }
  th {
    position: sticky;
    top: 0;
    background: var(--popup-bg-color, #24252a);
    color: var(--theme-caption-color);
    font-size: 0.78rem;
  }
  .number {
    text-align: right;
  }
  .text {
    white-space: normal;
    min-width: 12rem;
    overflow-wrap: anywhere;
  }
  .plus {
    color: var(--theme-won-color, #3fb950);
  }
  .minus {
    color: var(--theme-error-color);
  }
  .empty {
    text-align: center;
    padding: 2rem;
    color: var(--theme-caption-color);
  }
</style>
