<!--
// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
-->
<script lang="ts">
  import core, { generateId, isOwnerOrMaintainer } from '@hcengineering/core'
  import materials, {
    normalizeCode,
    previewStockRows,
    type Material,
    type StockMovement,
    type StockImportRow
  } from '@hcengineering/materials'
  import { getClient } from '@hcengineering/presentation'
  import { createEventDispatcher } from 'svelte'
  import { readStockWorkbook } from '../stockWorkbook'

  const dispatch = createEventDispatcher()
  const client = getClient()
  let rows: StockImportRow[] = []
  let existing: Material[] = []
  let selected = new Set<number>()
  let error = ''
  let message = ''
  let busy = false
  let loaded = false
  let started = 0
  let elapsed = 0
  $: preview = previewStockRows(rows, existing)
  $: creates = preview.filter(
    (x) => selected.has(x.row.row) && x.issues.length === 0 && x.existing === undefined
  ).length
  $: updates = preview.filter(
    (x) => selected.has(x.row.row) && x.issues.length === 0 && x.existing !== undefined
  ).length
  const names: Record<string, string> = {
    missingCode: '缺少编号',
    invalidCode: '编号不是文本或包含公式',
    missingName: '缺少名称',
    duplicateCode: '编号重复',
    blankStock: '库存空白',
    invalidStock: '库存无效',
    invalidMinimum: '最低库存无效'
  }

  async function choose (event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file === undefined) return
    error = ''
    message = ''
    loaded = false
    busy = true
    started = Date.now()
    try {
      rows = readStockWorkbook(new Uint8Array(await file.arrayBuffer()))
      existing = await client.findAll(materials.class.Material, {})
      selected = new Set(
        previewStockRows(rows, existing)
          .filter((x) => x.issues.length === 0)
          .map((x) => x.row.row)
      )
      loaded = true
    } catch (e) {
      error = e instanceof Error ? e.message : '读取失败'
    } finally {
      elapsed = (Date.now() - started) / 1000
      busy = false
      input.value = ''
    }
  }
  function changed (row: StockImportRow, field: 'code' | 'name' | 'stock' | 'minimum', value: string): void {
    row[field] = value
    if (field === 'code') row.invalidCode = false
    if (field === 'stock') row.invalidStockCell = false
    if (field === 'minimum') {
      row.invalidMinimumCell = false
      row.minimumPresent = true
    }
    selected.delete(row.row)
    selected = new Set(selected)
    rows = [...rows]
  }
  function toggle (row: number, checked: boolean): void {
    if (checked) selected.add(row)
    else selected.delete(row)
    selected = new Set(selected)
  }
  async function submit (): Promise<void> {
    if (busy || !isOwnerOrMaintainer()) return
    busy = true
    error = ''
    message = ''
    let done = 0
    try {
      for (const entry of preview.filter((x) => selected.has(x.row.row) && x.issues.length === 0)) {
        const row = entry.row
        const code = row.code.trim()
        const normalizedCode = normalizeCode(code)
        const current = await client.findOne(materials.class.Material, { normalizedCode })
        // Re-read to detect changes after preview and require a fresh preview before overwriting.
        if (
          (current?._id ?? '') !== (entry.existing?._id ?? '') ||
          (current !== undefined && current.modifiedOn !== entry.existing?.modifiedOn)
        ) {
          throw new Error(`第 ${row.row} 行的物料已变化，请重新预览。`)
        }
        const opening = current === undefined || (current.movements ?? 0) === 0
        const stock = entry.stock
        if (stock === undefined) throw new Error(`第 ${row.row} 行库存无效。`)
        const fields = {
          code,
          normalizedCode,
          name: row.name.trim(),
          model: row.model ?? '',
          brand: row.brand ?? '',
          category: row.category ?? '',
          group: row.group ?? '',
          rack: row.rack ?? '',
          level: row.level ?? ''
        }
        const ops = client.apply(current === undefined ? 'materials-code' : 'materials-stock')
        let id = current?._id
        if (current === undefined) {
          id = generateId<Material>()
          ops.notMatch(materials.class.Material, { normalizedCode })
          await ops.createDoc(
            materials.class.Material,
            core.space.Workspace,
            {
              ...fields,
              stock,
              lastMovementOn: Date.now(),
              unit: '',
              notes: '',
              photos: 0,
              ...(entry.minimum === undefined ? {} : { minimumStock: entry.minimum })
            },
            id
          )
        } else {
          ops.match(materials.class.Material, {
            _id: current._id,
            modifiedOn: current.modifiedOn,
            stock: current.stock
          })
          await ops.update(current, {
            ...fields,
            ...(row.minimumPresent === false
              ? {}
              : entry.minimum === undefined
                ? { $unset: { minimumStock: true } }
                : { minimumStock: entry.minimum })
          })
        }
        if (id === undefined) throw new Error('物料编号无效')
        if (opening) {
          await ops.addCollection(
            materials.class.StockMovement,
            core.space.Workspace,
            id,
            materials.class.Material,
            'movements',
            { kind: 'opening', quantity: stock, delta: stock - (current?.stock ?? 0), balance: stock },
            generateId<StockMovement>()
          )
          if (current !== undefined) await ops.update(current, { stock, lastMovementOn: Date.now() })
        }
        if (!(await ops.commit()).result) throw new Error(`第 ${row.row} 行保存冲突，请重新预览。`)
        done++
      }
      message = `已导入 ${done} 行。请重新选择文件查看最新预览。`
      loaded = false
    } catch (e) {
      error = `已导入 ${done} 行。${e instanceof Error ? e.message : '保存失败'} 其余行未处理，请重新预览。`
      loaded = false
    } finally {
      busy = false
    }
  }
</script>

<div class="overlay" role="presentation">
  <section class="dialog" role="dialog" aria-modal="true" aria-label="导入库存">
    <header>
      <h2>导入库存 Excel（不含照片）</h2>
      <button disabled={busy} on:click={() => dispatch('close')}>关闭</button>
    </header>
    <p>先预览再确认。问题行默认不导入；已有流水的库存不会被覆盖。</p>
    <input type="file" accept=".xlsx,.xlsm" on:change={choose} disabled={busy} aria-label="选择库存 Excel" />
    {#if busy}<p>正在处理，请稍候……</p>{/if}
    {#if error}<p role="alert" class="error">{error}</p>{/if}
    {#if message}<p>{message}</p>{/if}
    {#if loaded}
      <p>
        读取耗时 {elapsed.toFixed(1)} 秒。将新建 {creates} 条，更新 {updates} 条；问题 {preview.filter(
          (x) => x.issues.length > 0
        ).length} 行。
      </p>
      <div class="table">
        <table>
          <thead
            ><tr
              ><th>导入</th><th>行</th><th>编号</th><th>名称</th><th>Excel 库存</th><th>现有库存</th><th>最低库存</th
              ><th>问题 / 库存差别</th></tr
            ></thead
          ><tbody>
            {#each preview as item (item.row.row)}
              <tr
                ><td
                  ><input
                    type="checkbox"
                    checked={selected.has(item.row.row)}
                    disabled={item.issues.length > 0 || busy}
                    on:change={(e) => {
                      toggle(item.row.row, e.currentTarget.checked)
                    }}
                  /></td
                >
                <td>{item.row.row}</td><td
                  ><input
                    aria-label="编号"
                    value={item.row.code}
                    on:change={(e) => {
                      changed(item.row, 'code', e.currentTarget.value)
                    }}
                  /></td
                ><td
                  ><input
                    aria-label="名称"
                    value={item.row.name}
                    on:change={(e) => {
                      changed(item.row, 'name', e.currentTarget.value)
                    }}
                  /></td
                ><td
                  ><input
                    aria-label="库存"
                    value={item.row.stock}
                    on:change={(e) => {
                      changed(item.row, 'stock', e.currentTarget.value)
                    }}
                  /></td
                ><td>{item.existing?.stock ?? '—'}</td>
                <td
                  ><input
                    aria-label="最低库存"
                    value={item.row.minimum}
                    on:change={(e) => {
                      changed(item.row, 'minimum', e.currentTarget.value)
                    }}
                  /></td
                ><td
                  >{item.issues.map((issue) => names[issue]).join('、')}{item.preserveStock
                    ? ' 已有流水，保留现有库存'
                    : ''}</td
                ></tr
              >
            {/each}
          </tbody>
        </table>
      </div>
      <button on:click={submit} disabled={busy || creates + updates === 0}>确认导入 {creates + updates} 行</button>
    {/if}
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
    background: #0009;
  }
  .dialog {
    background: var(--popup-bg-color, #24252a);
    color: var(--theme-content-color);
    width: min(70rem, 95vw);
    max-height: 90vh;
    overflow: auto;
    padding: 1.25rem;
    border-radius: 0.7rem;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .table {
    max-height: 55vh;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    padding: 0.4rem;
    border-bottom: 1px solid #777;
    text-align: left;
  }
  button,
  input {
    font: inherit;
  }
  button {
    padding: 0.5rem;
    cursor: pointer;
  }
  .error {
    color: #fa7777;
  }
</style>
