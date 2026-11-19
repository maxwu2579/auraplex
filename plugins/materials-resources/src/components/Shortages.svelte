<!-- Copyright © 2026 Auraplex. Licensed under EPL-2.0: https://www.eclipse.org/legal/epl-2.0 -->
<script lang="ts">
  import { Label } from '@hcengineering/ui'

  import materials, {
    calculateShortages,
    normalizeCode,
    type Product,
    type BomLine,
    type Material,
    type CalculationProduct,
    type ShortageRow,
    type ShortageStatus
  } from '@hcengineering/materials'
  import { createQuery } from '@hcengineering/presentation'
  import { createShortageWorkbook, shortageFilename } from '../shortageExport'
  import { downloadWorkbook } from '../xlsx'
  import PhotoDialog from './PhotoDialog.svelte'
  import IssueDialog from './IssueDialog.svelte'

  const productQuery = createQuery()
  const materialQuery = createQuery()
  const lineQuery = createQuery()
  let products: Product[] = []
  let materialsList: Material[] = []
  let lines: BomLine[] = []
  let productsReady = false
  let materialsReady = false
  let linesReady = false
  // Products added for calculation, in the order they were added.
  let selected: string[] = []
  let productSearch = ''
  let pickerOpen = false
  let counts: Record<string, string> = {}
  let revision = 0
  let calculatedRevision = -1
  let results: ShortageRow[] | undefined
  let calculatedProducts: CalculationProduct[] = []
  let calculatedStock: Material[] = []
  // Products ticked for export; the ticked ones are added together into one file.
  let exportChoice = new Set<string>()
  let filter: 'all' | ShortageStatus = 'all'
  let error = ''
  let photoTarget: Material | undefined
  let issuing = false
  productQuery.query(materials.class.Product, {}, (items) => {
    products = items
    productsReady = true
    revision++
  })
  materialQuery.query(materials.class.Material, {}, (items) => {
    materialsList = items
    materialsReady = true
    revision++
  })
  lineQuery.query(materials.class.BomLine, {}, (items) => {
    lines = items
    linesReady = true
    revision++
  })
  $: ready = productsReady && materialsReady && linesReady
  $: stale = results !== undefined && calculatedRevision !== revision
  $: visible = results?.filter((row) => filter === 'all' || row.status === filter) ?? []
  const label: Record<ShortageStatus, string> = { shortage: '缺料', problem: '有问题', enough: '够用' }
  $: byId = new Map(products.map((p) => [p._id as string, p]))
  // Material by code, for the "查看" photo button (first one wins if a code is in stock twice).
  $: byCode = materialsList.reduce((map, m) => {
    const code = normalizeCode(m.normalizedCode)
    if (!map.has(code)) map.set(code, m)
    return map
  }, new Map<string, Material>())
  $: chosenProducts = selected.map((id) => byId.get(id)).filter((p): p is Product => p !== undefined)
  $: keyword = productSearch.normalize('NFKC').trim().toLocaleLowerCase()
  $: matches = products
    .filter((p) => !selected.includes(p._id) && p.name.normalize('NFKC').toLocaleLowerCase().includes(keyword))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  function add (id: string): void {
    if (selected.includes(id)) return
    selected = [...selected, id]
    productSearch = ''
    revision++
  }
  function remove (id: string): void {
    selected = selected.filter((item) => item !== id)
    revision++
  }
  function searchKey (e: KeyboardEvent): void {
    if (e.key === 'Enter' && matches.length > 0) {
      e.preventDefault()
      add(matches[0]._id)
    } else if (e.key === 'Escape') pickerOpen = false
    else pickerOpen = true
  }
  function updateCount (id: string, value: string): void {
    counts = { ...counts, [id]: value }
    revision++
  }
  function calculate (): void {
    error = ''
    try {
      if (!ready) throw new Error('数据仍在加载，请稍候。')
      const chosen = chosenProducts
      if (chosen.length === 0 || chosen.length !== selected.length) throw new Error('请选择有效的产品。')
      const snapshot: CalculationProduct[] = chosen.map((p) => {
        const raw = (counts[p._id] ?? '1').trim()
        if (!/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
          throw new Error(`产品 ${p.name} 的台数必须是大于 0 的整数。`)
        }
        return {
          id: p._id,
          name: p.name,
          count: Number(raw),
          lines: lines
            .filter((l) => l.attachedTo === p._id)
            .map((l) => ({
              code: l.code,
              description: l.description,
              quantity: l.quantity,
              quantityProblem: l.quantityProblem,
              codeProblem: l.codeProblem,
              section: l.section,
              sourceRow: l.sourceRow
            }))
        }
      })
      const stockCopy = materialsList.map((m) => ({ ...m }))
      results = calculateShortages(snapshot, stockCopy)
      calculatedProducts = snapshot
      exportChoice = new Set(snapshot.map((p) => p.id))
      calculatedStock = stockCopy
      calculatedRevision = revision
    } catch (e) {
      results = undefined
      error = e instanceof Error ? e.message : '计算失败。'
    }
  }
  function chooseExport (id: string, checked: boolean): void {
    if (checked) exportChoice.add(id)
    else exportChoice.delete(id)
    exportChoice = new Set(exportChoice)
  }
  $: exportProducts = calculatedProducts.filter((p) => exportChoice.has(p.id))
  function download (): void {
    if (results === undefined || stale || exportProducts.length === 0) return
    try {
      downloadWorkbook(
        createShortageWorkbook(exportProducts, calculatedStock),
        shortageFilename(exportProducts, new Date())
      )
    } catch (e) {
      error = e instanceof Error ? e.message : '导出失败。'
    }
  }
</script>

<div class="page">
  <h1><Label label={materials.string.PageShortages} /></h1>
  <p><Label label={materials.string.PageSearchProductsHint} /></p>
  {#if !ready}<p><Label label={materials.string.PageLoadingProducts} /></p>{:else if products.length === 0}<p><Label label={materials.string.PageNoBomProducts} /></p>{/if}
  <div class="picker">
    <input
      class="search"
      placeholder="添加产品：输入关键词搜索，点击结果添加（回车添加第一个）"
      aria-label="搜索产品"
      bind:value={productSearch}
      disabled={!ready || products.length === 0}
      on:focus={() => (pickerOpen = true)}
      on:click={() => (pickerOpen = true)}
      on:blur={() => (pickerOpen = false)}
      on:keydown={searchKey}
    />
    {#if pickerOpen}
      <div class="dropdown" role="listbox">
        {#each matches as p (p._id)}
          <button
            role="option"
            aria-selected="false"
            on:mousedown|preventDefault={() => {
              add(p._id)
            }}>{p.name}<span class="hint">{p.lines ?? 0} 行 BOM</span></button
          >
        {:else}
          <div class="none">{keyword === '' ? '所有产品都已添加' : '没有匹配的产品'}</div>
        {/each}
      </div>
    {/if}
  </div>
  {#if chosenProducts.length > 0}
    <div class="chosen">
      {#each chosenProducts as p (p._id)}
        <div class="chosen-row">
          <span class="chosen-name" title={p.name}>{p.name}</span>
          <span><Label label={materials.string.PageQuantity} /></span><input
            aria-label={`${p.name} 台数`}
            inputmode="numeric"
            value={counts[p._id] ?? '1'}
            on:input={(e) => {
              updateCount(p._id, e.currentTarget.value)
            }}
          /><button
            class="remove"
            title="移除"
            on:click={() => {
              remove(p._id)
            }}><Label label={materials.string.PageRemove} /></button
          >
        </div>
      {/each}
    </div>
  {/if}
  <div class="actions">
    <button disabled={!ready || selected.length === 0} on:click={calculate}
      >{results === undefined ? '计算' : '重新计算'}</button
    >
    <button disabled={results === undefined || stale} on:click={() => (issuing = true)}><Label label={materials.string.PageIssue} /></button>
    <button disabled={results === undefined || stale || exportProducts.length === 0} on:click={download}
      >{calculatedProducts.length > 1 && results !== undefined && !stale
        ? `导出选中的 ${exportProducts.length} 个产品`
        : '导出 Excel'}</button
    >
    <label
      >状态筛选 <select bind:value={filter}
        ><option value="all"><Label label={materials.string.PageAll} /></option><option value="shortage"><Label label={materials.string.PageShortage} /></option><option value="problem"><Label label={materials.string.PageProblem} /></option
        ><option value="enough"><Label label={materials.string.PageEnough} /></option></select
      ></label
    >
  </div>
  {#if results !== undefined && !stale && calculatedProducts.length > 1}
    <div class="export-choice">
      <span>导出哪些产品（选中的会合并成一份，用量相加）：</span>
      {#each calculatedProducts as p (p.id)}
        <label
          ><input
            type="checkbox"
            checked={exportChoice.has(p.id)}
            on:change={(e) => {
              chooseExport(p.id, e.currentTarget.checked)
            }}
          />{p.name} × {p.count}</label
        >
      {/each}
    </div>
  {/if}
  {#if error !== ''}<p role="alert" class="error">{error}</p>{/if}
  {#if stale}<p role="status" class="error">产品、BOM、库存或选择已改变，请点击“重新计算”后查看和导出最新结果。</p>{/if}
  {#if results !== undefined && !stale}
    <p>
      缺料 {results.filter((r) => r.status === 'shortage').length} 项 · 有问题 {results.filter(
        (r) => r.status === 'problem'
      ).length} 项 · 够用 {results.filter((r) => r.status === 'enough').length} 项
    </p>
    <div class="table">
      <table>
        <thead
          ><tr
            ><th><Label label={materials.string.PageStatus} /></th><th><Label label={materials.string.PageCode} /></th><th><Label label={materials.string.PageName} /></th><th><Label label={materials.string.PageRequired} /></th><th><Label label={materials.string.PageStock} /></th><th><Label label={materials.string.PageMissing} /></th><th><Label label={materials.string.PageLocation} /></th
            ><th><Label label={materials.string.PageUsedBy} /></th><th><Label label={materials.string.PageIssueColumn} /></th><th><Label label={materials.string.PagePhotos} /></th></tr
          ></thead
        ><tbody>
          {#each visible as row, index (`${row.code}-${index}`)}<tr
              class:shortage={row.status === 'shortage'}
              class:problem={row.status === 'problem'}
              class:enough={row.status === 'enough'}
            >
              <td>{label[row.status]}</td><td>{row.code !== '' ? row.code : '—'}</td><td
                >{row.name !== '' ? row.name : '—'}</td
              ><td>{row.required ?? '未知'}</td><td>{row.assumedZero ? '未知（按 0 估算）' : (row.stock ?? '未知')}</td
              ><td>{row.shortage ?? '未知'}</td>
              <td
                >{[row.rack, row.level].filter(Boolean).join(' / ') !== ''
                  ? [row.rack, row.level].filter(Boolean).join(' / ')
                  : '—'}</td
              ><td
                >{#each row.uses as use}<div>
                    {use.product} × {use.count} / {use.section !== '' ? use.section : '未指定装配段'}：{use.required ??
                      '未知'}
                  </div>{/each}</td
              ><td>{row.issues.join('；')}</td>
              <td
                >{#if byCode.get(normalizeCode(row.code)) !== undefined}<button
                    class="view"
                    on:click={() => (photoTarget = byCode.get(normalizeCode(row.code)))}><Label label={materials.string.PageView} /></button
                  >{:else}—{/if}</td
              >
            </tr>{:else}<tr><td colspan="10"><Label label={materials.string.PageNoResults} /></td></tr>{/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if photoTarget !== undefined}
  <PhotoDialog material={photoTarget} on:close={() => (photoTarget = undefined)} />
{/if}
{#if issuing && results !== undefined}
  <IssueDialog
    rows={results}
    stock={calculatedStock}
    products={calculatedProducts}
    {stale}
    on:close={() => (issuing = false)}
  />
{/if}

<style>
  /* Rows have light red / yellow / white backgrounds, so the button is solid blue to stay readable on all of them. */
  td .view {
    padding: 0.25rem 0.7rem;
    font-size: 0.85rem;
    white-space: nowrap;
    background: #3b5bdb;
    border-color: #3b5bdb;
    color: #fff;
  }
  td .view:hover {
    background: #2f4ac0;
  }
  .page {
    padding: 1.5rem;
    min-width: 0;
    width: 100%;
    height: 100%;
    overflow: auto;
    box-sizing: border-box;
    color: var(--theme-content-color);
  }
  h1 {
    font-size: 1.4rem;
  }
  .picker {
    position: relative;
    max-width: 40rem;
  }
  .picker .search {
    width: 100%;
    box-sizing: border-box;
  }
  .dropdown {
    position: absolute;
    z-index: 10;
    left: 0;
    right: 0;
    max-height: 18rem;
    overflow: auto;
    margin-top: 0.2rem;
    background: var(--theme-popup-color, #24252a);
    border: 1px solid var(--theme-button-border);
    border-radius: 0.4rem;
    box-shadow: 0 0.4rem 1rem #0006;
  }
  .dropdown button {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    width: 100%;
    border: none;
    border-radius: 0;
    background: none;
    text-align: left;
  }
  .dropdown button:hover {
    background: var(--theme-button-hovered, #ffffff1a);
  }
  .hint {
    color: var(--theme-caption-color);
    font-size: 0.85em;
  }
  .none {
    padding: 0.6rem;
    color: var(--theme-caption-color);
  }
  .chosen {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-top: 0.7rem;
    max-width: 40rem;
  }
  .chosen-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }
  .chosen-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chosen-row input {
    width: 5rem;
  }
  /* Dropdown options follow the dark theme instead of white on white. */
  select option {
    background: var(--theme-popup-color, #24252a);
    color: var(--theme-content-color);
  }
  input,
  select,
  button {
    color: var(--theme-content-color);
    font: inherit;
    border: 1px solid var(--theme-button-border);
    background: var(--theme-button-default);
    border-radius: 0.4rem;
    padding: 0.45rem;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
    margin: 1rem 0;
  }
  .export-choice {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.4rem 1rem;
    margin: -0.3rem 0 1rem;
  }
  .export-choice label {
    display: flex;
    align-items: center;
    gap: 0.3rem;
  }
  .table {
    /* Huly hides every scrollbar site-wide; show this one so wide tables can be scrolled sideways. */
    scrollbar-width: auto;
    scrollbar-color: rgba(128, 128, 128, 0.7) transparent;
    width: 100%;
    overflow: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    padding: 0.5rem;
    border: 1px solid #9a9a9a;
    text-align: left;
  }
  .shortage {
    background: #ffe1e1;
    color: #651c1c;
  }
  .problem {
    background: #fff2c3;
    color: #513d00;
  }
  .enough {
    background: #fff;
    color: #222;
  }
  .error {
    color: var(--theme-error-color, #fa7777);
  }
</style>
