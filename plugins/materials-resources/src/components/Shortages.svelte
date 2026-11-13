<!-- Copyright © 2026 Auraplex. Licensed under EPL-2.0: https://www.eclipse.org/legal/epl-2.0 -->
<script lang="ts">
  import materials, {
    calculateShortages,
    type Product,
    type BomLine,
    type Material,
    type CalculationProduct,
    type ShortageRow,
    type ShortageStatus
  } from '@hcengineering/materials'
  import { createQuery } from '@hcengineering/presentation'
  import { createShortageWorkbook, shortageFilename } from '../shortageExport'

  const productQuery = createQuery()
  const materialQuery = createQuery()
  const lineQuery = createQuery()
  let products: Product[] = []
  let materialsList: Material[] = []
  let lines: BomLine[] = []
  let productsReady = false
  let materialsReady = false
  let linesReady = false
  let selected = new Set<string>()
  let counts: Record<string, string> = {}
  let revision = 0
  let calculatedRevision = -1
  let results: ShortageRow[] | undefined
  let calculatedProducts: CalculationProduct[] = []
  let calculatedStock: Material[] = []
  let filter: 'all' | ShortageStatus = 'all'
  let error = ''
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
  function select (id: string, checked: boolean): void {
    if (checked) selected.add(id)
    else selected.delete(id)
    selected = new Set(selected)
    revision++
  }
  function updateCount (id: string, value: string): void {
    counts = { ...counts, [id]: value }
    revision++
  }
  function calculate (): void {
    error = ''
    try {
      if (!ready) throw new Error('数据仍在加载，请稍候。')
      const chosen = products.filter((p) => selected.has(p._id))
      if (chosen.length === 0 || chosen.length !== selected.size) throw new Error('请选择有效的产品。')
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
      calculatedStock = stockCopy
      calculatedRevision = revision
    } catch (e) {
      results = undefined
      error = e instanceof Error ? e.message : '计算失败。'
    }
  }
  function download (): void {
    if (results === undefined || stale) return
    try {
      const data = createShortageWorkbook(calculatedProducts, calculatedStock)
      const copy = new Uint8Array(data.length)
      copy.set(data)
      const url = URL.createObjectURL(
        new Blob([copy.buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = shortageFilename(calculatedProducts, new Date())
      anchor.click()
      setTimeout(() => {
        URL.revokeObjectURL(url)
      }, 60000)
    } catch (e) {
      error = e instanceof Error ? e.message : '导出失败。'
    }
  }
</script>

<div class="page">
  <h1>缺料计算</h1>
  <p>选择一个或多个产品，填写要生产的台数，再点击计算。使用的库存来自当前工作区。</p>
  {#if !ready}<p>正在加载产品、BOM 和库存……</p>{:else if products.length === 0}<p>还没有产品，请先导入 BOM。</p>{/if}
  <div class="products">
    {#each products as p (p._id)}
      <label class="product"
        ><input
          type="checkbox"
          checked={selected.has(p._id)}
          on:change={(e) => {
            select(p._id, e.currentTarget.checked)
          }}
        /><span>{p.name}</span>
        <span>台数</span><input
          aria-label={`${p.name} 台数`}
          inputmode="numeric"
          value={counts[p._id] ?? '1'}
          disabled={!selected.has(p._id)}
          on:input={(e) => {
            updateCount(p._id, e.currentTarget.value)
          }}
        /></label
      >
    {/each}
  </div>
  <div class="actions">
    <button disabled={!ready || selected.size === 0} on:click={calculate}
      >{results === undefined ? '计算' : '重新计算'}</button
    >
    <button disabled={results === undefined || stale} on:click={download}>导出 Excel</button>
    <label
      >状态筛选 <select bind:value={filter}
        ><option value="all">全部</option><option value="shortage">缺料</option><option value="problem">有问题</option
        ><option value="enough">够用</option></select
      ></label
    >
  </div>
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
            ><th>状态</th><th>编号</th><th>名称</th><th>需要</th><th>库存</th><th>缺多少</th><th>位置（货架 / 层）</th
            ><th>用于产品和装配段</th><th>问题</th></tr
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
            </tr>{:else}<tr><td colspan="9">当前筛选没有结果。</td></tr>{/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
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
  .products {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
  }
  .product {
    display: flex;
    align-items: center;
    gap: 0.4rem;
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
  .product input[inputmode] {
    width: 5rem;
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
  .table {
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
