<!--
// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
-->
<script lang="ts">
  import { t } from '../trStore'
  import { Label } from '@hcengineering/ui'

  import core, { generateId, isOwnerOrMaintainer, type Ref } from '@hcengineering/core'
  import materials, {
    formatQuantity,
    normalizeCode,
    planMovement,
    importFieldChanges,
    previewStockRows,
    type Material,
    type StockMovement,
    type StockImportRow
  } from '@hcengineering/materials'
  import { getClient } from '@hcengineering/presentation'
  import { createEventDispatcher, tick } from 'svelte'
  import { readStockWorkbook } from '../stockWorkbook'
  import { guardOpening } from '../opening'
  import { indexStockPictures, type StockPicture } from '../stockPictures'
  import { saveImportedPhoto } from '../saveImportedPhoto'
  import { createWorkbook, datedFilename, downloadWorkbook, formatDateTime } from '../xlsx'

  const dispatch = createEventDispatcher()
  const client = getClient()
  let rows: StockImportRow[] = []
  let archive: Uint8Array | undefined
  let pictures: StockPicture[] = []
  let picturesByRow = new Map<number, StockPicture[]>()
  let originalCodes = new Map<number, string>()
  let progress = ''
  let existing: Material[] = []
  let selected = new Set<number>()
  let withMovements = new Set<Ref<Material>>()
  let error = ''
  let message = ''
  let busy = false
  let loaded = false
  let started = 0
  let elapsed = 0
  // Off by default: stock is kept in Huly. On during the Excel period: Excel stock wins, as a stocktake record.
  let overrideStock = false
  const OVERRIDE_REASON = $t('Excel 导入覆盖')
  interface StockDiff {
    material: Material
    excel: number
  }
  interface ImportReport {
    at: number
    created: number
    updated: number
    overridden: number
    diffs: StockDiff[]
    missing: Material[]
  }
  let report: ImportReport | undefined
  function location (m: Pick<Material, 'rack' | 'level'>): string {
    return [m.rack, m.level].filter((part) => part !== undefined && part !== '').join(' / ')
  }
  function stockNote (item: { preserveStock: boolean, existing?: Material, stock?: number }, override: boolean): string {
    if (!item.preserveStock || item.existing === undefined || item.stock === undefined) return ''
    if (item.stock === item.existing.stock) return $t(' 已有流水，库存与 Excel 相同')
    const from = formatQuantity(item.existing.stock)
    const to = formatQuantity(item.stock)
    return override
      ? ` 将用 Excel 覆盖库存：${from} → ${to}（记一条盘点）`
      : ` 已有流水，保留现有库存（系统 ${from}，Excel ${to}）`
  }
  function exportReport (): void {
    if (report === undefined) return
    const diffRows = report.diffs.map((d) => [
      d.material.code,
      d.material.name,
      location(d.material),
      d.material.stock,
      d.excel,
      Math.round((d.excel - d.material.stock) * 1000) / 1000
    ])
    const missingRows = report.missing.map((m) => [
      m.code,
      m.name,
      location(m),
      m.stock,
      formatDateTime(m.lastImportedOn) ?? $t('从未导入')
    ])
    downloadWorkbook(
      createWorkbook([
        {
          name: $t('库存不一致'),
          rows: [[$t('编号'), $t('名称'), $t('位置（货架 / 层）'), $t('系统库存'), $t('Excel 库存'), $t('差（Excel − 系统）')], ...diffRows]
        },
        {
          name: $t('这次没有更新到'),
          rows: [[$t('编号'), $t('名称'), $t('位置（货架 / 层）'), $t('当前库存'), $t('上次导入时间')], ...missingRows]
        }
      ]),
      datedFilename($t('库存核对清单'), '', new Date(report.at))
    )
  }
  $: preview = previewStockRows(rows, existing, withMovements)
  $: creates = preview.filter(
    (x) => selected.has(x.row.row) && x.issues.length === 0 && x.existing === undefined
  ).length
  $: updates = preview.filter(
    (x) => selected.has(x.row.row) && x.issues.length === 0 && x.existing !== undefined
  ).length
  const names: Record<string, string> = {
    missingCode: $t('缺少编号'),
    invalidCode: $t('编号不是文本或包含公式'),
    missingName: $t('缺少名称'),
    duplicateCode: $t('编号重复'),
    blankStock: $t('库存空白'),
    invalidStock: $t('库存无效'),
    invalidMinimum: $t('最低库存无效')
  }

  async function choose (event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file === undefined) return
    error = ''
    message = ''
    report = undefined
    loaded = false
    busy = true
    started = Date.now()
    progress = $t('正在读取 Excel 文件……')
    await tick()
    try {
      archive = new Uint8Array(await file.arrayBuffer())
      progress = $t('正在识别物料及照片，请稍候……')
      await tick()
      rows = readStockWorkbook(archive)
      progress = $t('正在核对照片关联，请稍候……')
      await tick()
      pictures = indexStockPictures(archive)
      picturesByRow = new Map()
      for (const picture of pictures) {
        const list = picturesByRow.get(picture.row) ?? []
        list.push(picture)
        picturesByRow.set(picture.row, list)
      }
      originalCodes = new Map(rows.map((row) => [row.row, row.invalidCode === true ? '' : normalizeCode(row.code)]))
      existing = await client.findAll(materials.class.Material, {})
      const codes = new Set(rows.map((row) => normalizeCode(row.code)))
      const matched = existing.filter((material) => codes.has(material.normalizedCode))
      const found = new Set<Ref<Material>>()
      for (let i = 0; i < matched.length; i += 20) {
        progress = `正在检查现有流水 ${Math.min(i + 20, matched.length)} / ${matched.length}`
        await tick()
        const batch = matched.slice(i, i + 20)
        const checks = await Promise.all(
          batch.map(
            async (item) => await client.findAll(materials.class.StockMovement, { attachedTo: item._id }, { limit: 1 })
          )
        )
        checks.forEach((items, index) => {
          if (items.length > 0) found.add(batch[index]._id)
        })
      }
      withMovements = found
      selected = new Set(
        previewStockRows(rows, existing)
          .filter((x) => x.issues.length === 0)
          .map((x) => x.row.row)
      )
      loaded = true
    } catch (e) {
      error = e instanceof Error ? e.message : $t('读取失败')
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
    if (field === 'code') {
      const matched = existing.find((item) => item.normalizedCode === normalizeCode(value))
      if (matched !== undefined) {
        void client
          .findAll(materials.class.StockMovement, { attachedTo: matched._id }, { limit: 1 })
          .then((items) => {
            if (items.length > 0) withMovements.add(matched._id)
            else withMovements.delete(matched._id)
            withMovements = new Set(withMovements)
          })
          .catch(() => {
            error = $t('无法读取物料流水，请重新选择文件预览。')
            loaded = false
          })
      }
    }
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
    let photosDone = 0
    let skippedPhotos = 0
    // Every row of this import gets the same time, so the directory can tell which materials it missed.
    const importedAt = Date.now()
    const override = overrideStock
    const saved = new Set<Ref<Material>>()
    const diffs: StockDiff[] = []
    let created = 0
    let overridden = 0
    const chosen = preview.filter((x) => selected.has(x.row.row) && x.issues.length === 0)
    try {
      if (archive === undefined) throw new Error($t('请重新选择文件'))
      for (const entry of chosen) {
        progress = `正在处理物料 ${done + 1} / ${chosen.length}，已保存 ${done} 行，新增照片 ${photosDone} 张`
        await tick()
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
        const id = current?._id ?? generateId<Material>()
        const opening = await guardOpening(client, ops, id)
        if (current === undefined) {
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
              lastImportedOn: importedAt,
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
            lastImportedOn: importedAt,
            ...(row.minimumPresent === false
              ? {}
              : entry.minimum === undefined
                ? { $unset: { minimumStock: true } }
                : { minimumStock: entry.minimum })
          })
        }
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
        let overrode = false
        if (!opening && current !== undefined && stock !== current.stock) {
          const plan = override ? planMovement(current.stock, 'adjust', stock, OVERRIDE_REASON) : undefined
          if (plan !== undefined && 'delta' in plan) {
            await ops.addCollection(
              materials.class.StockMovement,
              core.space.Workspace,
              id,
              materials.class.Material,
              'movements',
              { kind: 'adjust', quantity: stock, delta: plan.delta, balance: plan.balance, reason: OVERRIDE_REASON },
              generateId<StockMovement>()
            )
            await ops.update(current, { stock: plan.balance, lastMovementOn: Date.now() })
            overrode = true
          } else diffs.push({ material: current, excel: stock })
        }
        if (!(await ops.commit()).result) throw new Error(`第 ${row.row} 行保存冲突，请重新预览。`)
        done++
        saved.add(id)
        if (current === undefined) created++
        if (overrode) overridden++
        const attached = picturesByRow.get(row.row) ?? []
        if (originalCodes.get(row.row) !== normalizedCode || normalizedCode === '') skippedPhotos += attached.length
        else {
          for (const picture of attached) {
            if (picture.problem !== undefined || picture.media === undefined) {
              skippedPhotos++
              continue
            }
            if (await saveImportedPhoto(client, id, archive, picture.media)) photosDone++
          }
        }
      }
      message = `已保存 ${done} 行，新增照片 ${photosDone} 张，跳过问题或编号变更照片 ${skippedPhotos} 张。请重新选择文件查看最新预览。`
      report = {
        at: importedAt,
        created,
        updated: done - created,
        overridden,
        diffs,
        missing: existing.filter((m) => !saved.has(m._id))
      }
      loaded = false
    } catch (e) {
      error = `已保存 ${done} 行、新增照片 ${photosDone} 张。${e instanceof Error ? e.message : '保存失败'} 请重新选择同一文件继续。`
      loaded = false
    } finally {
      busy = false
      progress = ''
    }
  }
</script>

<div class="overlay" role="presentation">
  <section class="dialog" role="dialog" aria-modal="true" aria-label={$t('导入库存')}>
    <header>
      <h2>{$t('导入库存 Excel（含照片）')}</h2>
      <button disabled={busy} on:click={() => dispatch('close')}><Label label={materials.string.PageClose} /></button>
    </header>
    <p>{$t('先预览再确认。问题行默认不导入；已有流水的库存默认不覆盖（可在下面勾选用 Excel 覆盖）。')}</p>
    <input type="file" accept=".xlsx,.xlsm" on:change={choose} disabled={busy} aria-label={$t('选择库存 Excel')} />
    {#if busy}<p role="status">{progress}</p>{/if}
    {#if error}<p role="alert" class="error">{error}</p>{/if}
    {#if message}<p>{message}</p>{/if}
    {#if report !== undefined}
      <div class="report">
        <p>
          本次导入（{formatDateTime(report.at)}）：新建 {report.created} 条，更新 {report.updated} 条{report.overridden >
          0
            ? `，用 Excel 覆盖库存 ${report.overridden} 条`
            : ''}。
        </p>
        <p>
          {$t('库存和 Excel 不一致、没有覆盖：')}<b>{report.diffs.length}</b> {$t('条；系统里有、这次没有更新到的物料：')}<b
            >{report.missing.length}</b
          > {$t('条（Excel 里没有，或那一行有问题 / 没勾选）。物料目录里也可以用“导入情况”筛选查看。')}
        </p>
        <button disabled={report.diffs.length + report.missing.length === 0} on:click={exportReport}
          >{$t('导出核对清单 Excel')}</button
        >
      </div>
    {/if}
    {#if loaded}
      <p>
        读取耗时 {elapsed.toFixed(1)} 秒。将新建 {creates} 条，更新 {updates} 条；问题 {preview.filter(
          (x) => x.issues.length > 0
        ).length} 行。
      </p>
      <p>
        图片总数：{pictures.length}；无对应物料行或编号的图片：{pictures.filter(
          (p) => (originalCodes.get(p.row) ?? '') === ''
        ).length}；关联错误：{pictures.filter((p) => p.problem !== undefined).length}。编号修改后不会猜测照片归属。
      </p>
      {#each pictures.filter((p) => p.problem !== undefined || (originalCodes.get(p.row) ?? '') === '') as picture}
        <p>第 {picture.row} 行图片：{picture.problem ?? $t('没有对应物料编号')}</p>
      {/each}
      <label class="override"
        ><input type="checkbox" bind:checked={overrideStock} disabled={busy} />
        <span
          >用 Excel 库存覆盖系统库存（已有流水的物料也覆盖，每个变化记一条盘点记录，原因“{OVERRIDE_REASON}”）。正式改在
          Huly 里做出入库后，不要再勾选。</span
        ></label
      >
      <div class="table">
        <table>
          <thead
            ><tr
              ><th><Label label={materials.string.PageImport} /></th><th>{$t('行')}</th><th><Label label={materials.string.PageCode} /></th><th><Label label={materials.string.PageName} /></th><th>{$t('Excel 库存')}</th><th>{$t('现有库存')}</th><th>{$t('最低库存')}</th
              ><th><Label label={materials.string.PagePhotos} /></th><th>{$t('资料变化')}</th><th>{$t('问题 / 库存差别')}</th></tr
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
                    aria-label={$t('编号')}
                    disabled={busy}
                    value={item.row.code}
                    on:change={(e) => {
                      changed(item.row, 'code', e.currentTarget.value)
                    }}
                  /></td
                ><td
                  ><input
                    aria-label={$t('名称')}
                    disabled={busy}
                    value={item.row.name}
                    on:change={(e) => {
                      changed(item.row, 'name', e.currentTarget.value)
                    }}
                  /></td
                ><td
                  ><input
                    aria-label={$t('库存')}
                    disabled={busy}
                    value={item.row.stock}
                    on:change={(e) => {
                      changed(item.row, 'stock', e.currentTarget.value)
                    }}
                  /></td
                ><td>{item.existing?.stock ?? '—'}</td>
                <td
                  ><input
                    aria-label={$t('最低库存')}
                    disabled={busy}
                    value={item.row.minimum}
                    on:change={(e) => {
                      changed(item.row, 'minimum', e.currentTarget.value)
                    }}
                  /></td
                ><td
                  >{(picturesByRow.get(item.row.row) ?? []).length} 张{originalCodes.get(item.row.row) !==
                  normalizeCode(item.row.code)
                    ? $t('（编号已变，不导入）')
                    : ''}</td
                ><td>
                  {#each importFieldChanges(item.row, item.existing) as change}<div>
                      {change.label}: {change.before} → {change.after}
                    </div>{/each}
                </td><td>{item.issues.map((issue) => names[issue]).join('、')}{stockNote(item, overrideStock)}</td></tr
              >
            {/each}
          </tbody>
        </table>
      </div>
      <div class="footer">
        <button class="primary" on:click={submit} disabled={busy || creates + updates === 0}
          >确认导入 {creates + updates} 行</button
        >
      </div>
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
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
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
  /* The list shrinks to fit so the confirm button below it always stays on screen. */
  .table {
    /* Huly hides every scrollbar site-wide; show this one so wide tables can be scrolled sideways. */
    scrollbar-width: auto;
    scrollbar-color: rgba(128, 128, 128, 0.7) transparent;
    overflow: auto;
    flex: 0 1 auto;
    min-height: 8rem;
  }
  .dialog > input {
    align-self: flex-start;
  }
  .report {
    flex-shrink: 0;
    padding: 0.5rem 0.8rem;
    border: 1px solid var(--theme-divider-color, #777);
    border-radius: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .report p {
    margin: 0.3rem 0;
  }
  .override {
    display: flex;
    align-items: flex-start;
    gap: 0.5rem;
    margin: 0.3rem 0 0.6rem;
  }
  .override input {
    padding: 0;
    margin-top: 0.25rem;
  }
  .footer {
    display: flex;
    justify-content: flex-end;
    flex-shrink: 0;
    padding-top: 0.75rem;
  }
  .primary {
    background: var(--primary-button-default, #4b68ed);
    color: white;
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
    color: var(--theme-content-color);
    font: inherit;
    border: 1px solid var(--theme-button-border);
    background: var(--theme-button-default);
    border-radius: 0.4rem;
    padding: 0.55rem 0.7rem;
  }
  button {
    padding: 0.5rem;
    cursor: pointer;
  }
  .error {
    color: #fa7777;
  }
</style>
