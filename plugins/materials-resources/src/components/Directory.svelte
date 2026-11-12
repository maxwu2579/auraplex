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
  import attachment, { type Photo } from '@hcengineering/attachment'
  import core, { generateId } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { createQuery, getBlobRef, getClient, uploadFile } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'
  import materials, {
    formatQuantity,
    isLowStock,
    normalizeCode,
    type Material,
    type MovementKind
  } from '@hcengineering/materials'
  import HistoryDialog from './HistoryDialog.svelte'
  import StockDialog from './StockDialog.svelte'

  type Draft = Pick<
  Material,
  'code' | 'name' | 'model' | 'brand' | 'category' | 'group' | 'rack' | 'level' | 'unit' | 'notes'
  >
  function emptyDraft (): Draft {
    return {
      code: '',
      name: '',
      model: '',
      brand: '',
      category: '',
      group: '',
      rack: '',
      level: '',
      unit: '',
      notes: ''
    }
  }
  const client = getClient()
  const query = createQuery()
  const photoQuery = createQuery()
  let all: Material[] = []
  let photos: Photo[] = []
  let search = ''
  let category = ''
  let rack = ''
  let editing = false
  let selected: Material | undefined
  let draft: Draft = emptyDraft()
  let minimum = ''
  // Fields shown in the editor, as they were when it opened. Photos and stock changes do not count as edits.
  let original = ''
  function editableFields (material: Material): string {
    const keys = ['code', 'name', 'model', 'brand', 'category', 'group', 'rack', 'level', 'unit', 'notes'] as const
    return JSON.stringify([...keys.map((key) => material[key] ?? ''), material.minimumStock ?? null])
  }
  let error: IntlString | undefined
  let busy = false
  let uploading = false
  let fileInput: HTMLInputElement
  let nameFilter = ''
  let categories: string[] = []
  let racks: string[] = []
  let filtered: Material[] = []
  type SortKey = 'code' | 'name' | 'category' | 'rack' | 'stock'
  let sortKey: SortKey = 'code'
  let ascending = true
  let stockTarget: { material: Material, kind: Exclude<MovementKind, 'opening'> } | undefined
  let historyTarget: Material | undefined

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })
  function sorted (list: Material[], key: SortKey, up: boolean): Material[] {
    const compare = (a: Material, b: Material): number => {
      let result: number
      if (key === 'stock') result = a.stock - b.stock
      else if (key === 'rack') {
        result = collator.compare(a.rack ?? '', b.rack ?? '')
        if (result === 0) result = collator.compare(a.level ?? '', b.level ?? '')
      } else result = collator.compare(a[key] ?? '', b[key] ?? '')
      if (result === 0) result = collator.compare(a.code, b.code)
      return up ? result : -result
    }
    return list.sort(compare)
  }
  function sortBy (key: SortKey): void {
    if (sortKey === key) ascending = !ascending
    else {
      sortKey = key
      ascending = true
    }
  }
  function arrow (key: SortKey, current: SortKey, up: boolean): string {
    return key === current ? (up ? ' ▲' : ' ▼') : ''
  }

  query.query(materials.class.Material, {}, (result) => {
    all = result
  })
  $: categories = Array.from(new Set(all.map((item) => item.category).filter(Boolean))).sort()
  $: racks = Array.from(new Set(all.map((item) => item.rack).filter(Boolean))).sort()
  $: nameFilter = search.normalize('NFKC').trim().toLocaleLowerCase()
  $: filtered = sorted(
    all.filter((item) => {
      const text = [item.code, item.name, item.model, item.brand, item.category, item.group, item.rack, item.level]
        .join(' ')
        .normalize('NFKC')
        .toLocaleLowerCase()
      return (
        (nameFilter === '' || text.includes(nameFilter)) &&
        (category === '' || item.category === category) &&
        (rack === '' || item.rack === rack)
      )
    }),
    sortKey,
    ascending
  )

  function edit (material?: Material): void {
    selected = material
    draft =
      material === undefined
        ? emptyDraft()
        : {
            code: material.code,
            name: material.name,
            model: material.model ?? '',
            brand: material.brand ?? '',
            category: material.category ?? '',
            group: material.group ?? '',
            rack: material.rack ?? '',
            level: material.level ?? '',
            unit: material.unit ?? '',
            notes: material.notes ?? ''
          }
    minimum = material?.minimumStock === undefined ? '' : String(material.minimumStock)
    original = material === undefined ? '' : editableFields(material)
    error = undefined
    editing = true
    photos = []
    if (material !== undefined) {
      photoQuery.query(attachment.class.Photo, { attachedTo: material._id }, (result) => {
        photos = result
      })
    }
  }
  function close (): void {
    editing = false
    selected = undefined
    photos = []
    error = undefined
    photoQuery.unsubscribe()
  }

  async function save (): Promise<void> {
    if (busy) return
    const code = draft.code.trim()
    const normalizedCode = normalizeCode(code)
    if (normalizedCode === '' || draft.name.trim() === '') {
      error = materials.string.Required
      return
    }
    const minimumStock = minimum.trim() === '' ? undefined : Number(minimum)
    if (minimumStock !== undefined && (!Number.isFinite(minimumStock) || minimumStock < 0)) {
      error = materials.string.InvalidMinimum
      return
    }
    busy = true
    error = undefined
    try {
      const current = selected
      const id = current?._id ?? generateId<Material>()
      const ops = client.apply('materials-code')
      ops.notMatch(materials.class.Material, { normalizedCode, ...(current === undefined ? {} : { _id: { $ne: id } }) })
      if (current === undefined) {
        await ops.createDoc(
          materials.class.Material,
          core.space.Workspace,
          {
            ...draft,
            code,
            normalizedCode,
            name: draft.name.trim(),
            stock: 0,
            photos: 0,
            ...(minimumStock === undefined ? {} : { minimumStock })
          },
          id
        )
      } else {
        // Only a change to the edited fields by someone else is a conflict.
        const latest = await client.findOne(materials.class.Material, { _id: id })
        if (latest === undefined || editableFields(latest) !== original) {
          error = materials.string.Conflict
          return
        }
        ops.match(materials.class.Material, { _id: id, modifiedOn: latest.modifiedOn })
        await ops.update(latest, {
          ...draft,
          code,
          normalizedCode,
          name: draft.name.trim(),
          ...(minimumStock === undefined ? { $unset: { minimumStock: true } } : { minimumStock })
        })
      }
      if (!(await ops.commit()).result) {
        const existing = await client.findOne(materials.class.Material, { normalizedCode })
        error =
          existing !== undefined && existing._id !== id
            ? materials.string.Duplicate
            : current !== undefined
              ? materials.string.Conflict
              : materials.string.Duplicate
        return
      }
      close()
    } catch {
      error = materials.string.SaveFailed
    } finally {
      busy = false
    }
  }

  async function removePhoto (photo: Photo): Promise<void> {
    const item = selected
    if (item === undefined || uploading) return
    uploading = true
    error = undefined
    try {
      await client.removeCollection(photo._class, photo.space, photo._id, item._id, item._class, 'photos')
      const updated = await client.findOne(materials.class.Material, { _id: item._id })
      if (updated !== undefined && selected?._id === item._id) selected = updated
    } catch {
      error = materials.string.PhotoFailed
    } finally {
      uploading = false
    }
  }

  async function addPhoto (): Promise<void> {
    const file = fileInput.files?.item(0)
    const item = selected
    fileInput.value = ''
    if (file === undefined || file === null || item === undefined) return
    if (!file.type.startsWith('image/')) {
      error = materials.string.SelectImage
      return
    }
    uploading = true
    error = undefined
    try {
      const { uuid, metadata } = await uploadFile(file)
      const ops = client.apply('materials-photo')
      ops.match(materials.class.Material, { _id: item._id })
      await ops.addCollection(attachment.class.Photo, item.space, item._id, item._class, 'photos', {
        name: file.name,
        file: uuid,
        type: file.type,
        size: file.size,
        lastModified: file.lastModified,
        metadata
      })
      if (!(await ops.commit()).result) throw new Error('Photo not saved')
      const updated = await client.findOne(materials.class.Material, { _id: item._id })
      if (updated !== undefined && selected?._id === item._id) selected = updated
    } catch {
      error = materials.string.PhotoFailed
    } finally {
      uploading = false
    }
  }
</script>

<div class="directory">
  <header>
    <h1><Label label={materials.string.Directory} /></h1>
    <button
      class="primary"
      on:click={() => {
        edit()
      }}><Label label={materials.string.Create} /></button
    >
  </header>
  <div class="filters">
    <label><span><Label label={materials.string.Search} /></span><input bind:value={search} /></label>
    <label
      ><span><Label label={materials.string.Category} /></span><select bind:value={category}>
        <option value=""><Label label={materials.string.AllCategories} /></option>
        {#each categories as value}<option {value}>{value}</option>{/each}
      </select></label
    >
    <label
      ><span><Label label={materials.string.Rack} /></span><select bind:value={rack}>
        <option value=""><Label label={materials.string.AllRacks} /></option>
        {#each racks as value}<option {value}>{value}</option>{/each}
      </select></label
    >
  </div>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th
            ><button
              class="sort"
              on:click={() => {
                sortBy('code')
              }}><Label label={materials.string.Code} />{arrow('code', sortKey, ascending)}</button
            ></th
          >
          <th
            ><button
              class="sort"
              on:click={() => {
                sortBy('name')
              }}><Label label={materials.string.Name} />{arrow('name', sortKey, ascending)}</button
            ></th
          >
          <th><Label label={materials.string.Model} /></th>
          <th
            ><button
              class="sort"
              on:click={() => {
                sortBy('category')
              }}><Label label={materials.string.Category} />{arrow('category', sortKey, ascending)}</button
            ></th
          >
          <th
            ><button
              class="sort"
              on:click={() => {
                sortBy('rack')
              }}><Label label={materials.string.Location} />{arrow('rack', sortKey, ascending)}</button
            ></th
          >
          <th class="number"
            ><button
              class="sort"
              on:click={() => {
                sortBy('stock')
              }}><Label label={materials.string.Stock} />{arrow('stock', sortKey, ascending)}</button
            ></th
          >
          <th class="number"><Label label={materials.string.MinimumStock} /></th>
          <th class="actions-col"><Label label={materials.string.Actions} /></th>
        </tr>
      </thead>
      <tbody>
        {#each filtered as item (item._id)}
          <tr>
            <td>{item.code}</td>
            <td>{item.name}</td>
            <td>{item.model}</td>
            <td>{item.category}</td>
            <td>{[item.rack, item.level].filter((part) => part !== undefined && part !== '').join(' / ')}</td>
            <td class="number" class:low={isLowStock(item)}>
              {formatQuantity(item.stock)}
            </td>
            <td class="number"
              >{item.minimumStock !== undefined && item.minimumStock !== null
                ? formatQuantity(item.minimumStock)
                : '—'}</td
            >
            <td class="actions-col"
              ><div class="row-actions">
                <button on:click={() => (stockTarget = { material: item, kind: 'in' })}
                  ><Label label={materials.string.StockIn} /></button
                >
                <button on:click={() => (stockTarget = { material: item, kind: 'out' })}
                  ><Label label={materials.string.StockOut} /></button
                >
                <button on:click={() => (stockTarget = { material: item, kind: 'adjust' })}
                  ><Label label={materials.string.Adjust} /></button
                >
                <button on:click={() => (historyTarget = item)}><Label label={materials.string.History} /></button>
                <button
                  on:click={() => {
                    edit(item)
                  }}><Label label={materials.string.Edit} /></button
                >
              </div></td
            >
          </tr>
        {:else}
          <tr><td colspan="8" class="empty"><Label label={materials.string.NoResults} /></td></tr>
        {/each}
      </tbody>
    </table>
  </div>
</div>
{#if stockTarget !== undefined}
  <StockDialog material={stockTarget.material} kind={stockTarget.kind} on:close={() => (stockTarget = undefined)} />
{/if}
{#if historyTarget !== undefined}
  <HistoryDialog material={historyTarget} on:close={() => (historyTarget = undefined)} />
{/if}
{#if editing}
  <div class="overlay" role="presentation">
    <section class="editor" role="dialog" aria-modal="true" aria-labelledby="materials-editor-title">
      <div class="editor-head">
        <h2 id="materials-editor-title">
          <Label label={selected === undefined ? materials.string.Create : materials.string.Edit} />
        </h2>
        <button on:click={close} disabled={busy || uploading} aria-label="Close">×</button>
      </div>
      <form on:submit|preventDefault={save}>
        <div class="fields">
          <label><span><Label label={materials.string.Code} /> *</span><input bind:value={draft.code} required /></label
          >
          <label><span><Label label={materials.string.Name} /> *</span><input bind:value={draft.name} required /></label
          >
          <label><span><Label label={materials.string.Model} /></span><input bind:value={draft.model} /></label>
          <label><span><Label label={materials.string.Brand} /></span><input bind:value={draft.brand} /></label>
          <label><span><Label label={materials.string.Category} /></span><input bind:value={draft.category} /></label>
          <label><span><Label label={materials.string.Group} /></span><input bind:value={draft.group} /></label>
          <label><span><Label label={materials.string.Rack} /></span><input bind:value={draft.rack} /></label>
          <label><span><Label label={materials.string.Level} /></span><input bind:value={draft.level} /></label>
          <label
            ><span><Label label={materials.string.MinimumStock} /></span><input
              type="text"
              inputmode="decimal"
              bind:value={minimum}
            /></label
          >
          <label><span><Label label={materials.string.Unit} /></span><input bind:value={draft.unit} /></label>
          <label class="wide"
            ><span><Label label={materials.string.Notes} /></span><textarea rows="2" bind:value={draft.notes}
            ></textarea></label
          >
        </div>
        <div class="photos">
          <h3><Label label={materials.string.Photos} /></h3>
          {#if selected !== undefined}
            <div class="photo-list">
              {#each photos as photo (photo._id)}
                <div class="photo">
                  {#await getBlobRef(photo.file, photo.name) then image}<img src={image.src} alt={photo.name} />{/await}
                  <button
                    type="button"
                    class="remove"
                    on:click={() => removePhoto(photo)}
                    disabled={uploading || busy}
                    aria-label="Delete photo"
                    title="Delete photo">×</button
                  >
                </div>
              {/each}
            </div>
            <input
              type="file"
              accept="image/*"
              bind:this={fileInput}
              on:change={addPhoto}
              aria-label="Upload photo"
              disabled={uploading || busy}
            />
          {:else}<p><Label label={materials.string.EditFirst} /></p>{/if}
        </div>
        {#if error !== undefined}<p class="error" role="alert"><Label label={error} /></p>{/if}
        <div class="actions">
          <button type="button" on:click={close} disabled={busy || uploading}
            ><Label label={materials.string.Cancel} /></button
          ><button class="primary" type="submit" disabled={busy || uploading}
            ><Label label={materials.string.Save} /></button
          >
        </div>
      </form>
    </section>
  </div>
{/if}

<style>
  .directory {
    display: flex;
    flex-direction: column;
    height: 100%;
    width: 100%;
    min-height: 0;
    min-width: 0;
    box-sizing: border-box;
    overflow: hidden;
    padding: 1.5rem;
    color: var(--theme-content-color);
  }
  header,
  .editor-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  h1 {
    font-size: 1.4rem;
    margin: 0;
  }
  h2 {
    font-size: 1.15rem;
    margin: 0;
  }
  h3 {
    font-size: 1rem;
    margin: 0 0 0.5rem;
  }
  button,
  input,
  select,
  textarea {
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
  .filters {
    display: flex;
    gap: 0.75rem;
    margin: 1.2rem 0;
    flex-wrap: wrap;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    min-width: 0;
  }
  label span {
    color: var(--theme-caption-color);
    font-size: 0.82rem;
  }
  .filters label:first-child {
    flex: 1;
    min-width: 12rem;
  }
  .filters label:not(:first-child) {
    min-width: 10rem;
  }
  .table-wrap {
    overflow: auto;
    min-width: 0;
    min-height: 0;
    flex: 0 1 auto;
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
    padding: 0.7rem;
    border-bottom: 1px solid var(--theme-divider-color);
    white-space: nowrap;
  }
  th {
    color: var(--theme-caption-color);
    font-size: 0.78rem;
  }
  .empty {
    text-align: center;
    padding: 2rem;
  }
  th .sort {
    border: none;
    background: none;
    padding: 0;
    color: inherit;
    font-size: inherit;
  }
  .number {
    text-align: right;
  }
  .low {
    color: var(--theme-error-color);
    font-weight: 600;
  }
  .row-actions {
    display: flex;
    gap: 0.35rem;
  }
  /* The buttons stay visible on the right while the rest of the table scrolls sideways. */
  .actions-col {
    position: sticky;
    right: 0;
    background: var(--theme-bg-color, #1a1a1e);
    box-shadow: -1px 0 0 var(--theme-divider-color);
  }
  th {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--theme-bg-color, #1a1a1e);
  }
  th.actions-col {
    z-index: 2;
  }
  .row-actions button {
    padding: 0.3rem 0.55rem;
    font-size: 0.82rem;
  }
  .photo {
    position: relative;
  }
  .photo .remove {
    position: absolute;
    top: 0.15rem;
    right: 0.15rem;
    padding: 0 0.4rem;
    line-height: 1.4;
    background: rgba(0, 0, 0, 0.6);
    color: white;
    border: none;
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.55);
  }
  .editor {
    background: var(--popup-bg-color, #24252a);
    width: min(48rem, 95vw);
    max-height: 90vh;
    overflow: auto;
    border-radius: 0.7rem;
    padding: 1.25rem;
    box-shadow: var(--popup-shadow);
  }
  .fields {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.8rem;
    margin-top: 1.2rem;
  }
  .wide {
    grid-column: 1/-1;
  }
  textarea {
    resize: vertical;
  }
  .photos {
    margin-top: 1.1rem;
  }
  .photos p {
    color: var(--theme-caption-color);
  }
  .photo-list {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }
  .photo-list img {
    width: 5rem;
    height: 5rem;
    object-fit: cover;
    border-radius: 0.4rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.7rem;
    margin-top: 1rem;
  }
  .error {
    color: var(--theme-error-color);
  }
  @media (max-width: 600px) {
    .fields {
      grid-template-columns: 1fr;
    }
    .wide {
      grid-column: auto;
    }
    .directory {
      padding: 0.8rem;
    }
  }
</style>
