<!-- Copyright © 2026 Auraplex. Licensed under EPL-2.0: https://www.eclipse.org/legal/epl-2.0 -->
<script lang="ts">
  import core, { generateId, isOwnerOrMaintainer, type Ref } from '@hcengineering/core'
  import materials, { type Material, type Product, type BomLine } from '@hcengineering/materials'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { tick } from 'svelte'
  import { readBomWorkbook, type BomImportProduct } from '../bomWorkbook'
  import { bomDiff } from '../bomDiff'
  const client = getClient()
  const productQuery = createQuery()
  const materialQuery = createQuery()
  const lineQuery = createQuery()
  let products: Product[] = []
  let snapshotProducts: Product[] = []
  let materialsList: Material[] = []
  let lines: BomLine[] = []
  let selected: Product | undefined
  let importing = false
  let busy = false
  let error = ''
  let message = ''
  let progress = ''
  let candidates: BomImportProduct[] = []
  let previous: BomLine[] = []
  let checked = new Set<string>()
  productQuery.query(materials.class.Product, {}, (items) => {
    products = items
  })
  materialQuery.query(materials.class.Material, {}, (items) => {
    materialsList = items
  })
  $: stock = new Map(materialsList.map((item) => [item.normalizedCode, item]))
  $: productIndex = new Map(snapshotProducts.map((item) => [item.normalizedName, item]))
  function openProduct (item: Product): void {
    selected = item
    lineQuery.query(materials.class.BomLine, { attachedTo: item._id }, (items) => {
      lines = items.slice().sort((a, b) => a.sourceRow - b.sourceRow)
    })
  }
  function back (): void {
    selected = undefined
    lines = []
    lineQuery.unsubscribe()
  }
  function existingFor (item: BomImportProduct): Product | undefined {
    return productIndex.get(item.normalizedName)
  }
  function oldLines (item: BomImportProduct): BomLine[] {
    const old = existingFor(item)
    return old === undefined
      ? []
      : previous.filter((line) => line.attachedTo === old._id).sort((a, b) => a.sourceRow - b.sourceRow)
  }
  function missing (item: BomImportProduct): number {
    return new Set(item.lines.filter((line) => !line.codeProblem && !stock.has(line.code)).map((line) => line.code))
      .size
  }
  async function choose (event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (file === undefined) return
    busy = true
    error = ''
    message = ''
    progress = '正在读取 BOM，请稍候……'
    candidates = []
    await tick()
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const parsed = readBomWorkbook(data)
      // Freeze the product and line snapshots used by the preview and commit guards.
      snapshotProducts = await client.findAll(materials.class.Product, {})
      previous = await client.findAll(materials.class.BomLine, {})
      candidates = parsed
      checked = new Set(parsed.map((item) => item.normalizedName))
    } catch (e) {
      error = e instanceof Error ? e.message : '读取失败'
    } finally {
      busy = false
      progress = ''
      input.value = ''
    }
  }
  function toggle (name: string, on: boolean): void {
    if (on) checked.add(name)
    else checked.delete(name)
    checked = new Set(checked)
  }
  async function submit (): Promise<void> {
    if (busy || !isOwnerOrMaintainer()) return
    busy = true
    error = ''
    message = ''
    let done = 0
    const chosen = candidates.filter((item) => checked.has(item.normalizedName))
    try {
      for (const item of chosen) {
        progress = `正在保存产品 ${done + 1} / ${chosen.length}`
        await tick()
        const old = existingFor(item)
        const oldItems = oldLines(item)
        const ops = client.apply('materials-bom')
        const id: Ref<Product> = old?._id ?? generateId<Product>()
        if (old === undefined) {
          ops.notMatch(materials.class.Product, { normalizedName: item.normalizedName })
          await ops.createDoc(
            materials.class.Product,
            core.space.Workspace,
            { name: item.name, normalizedName: item.normalizedName, description: '', lines: 0 },
            id
          )
        } else {
          ops.match(materials.class.Product, { _id: id, modifiedOn: old.modifiedOn })
          for (const line of oldItems) {
            await ops.removeCollection(
              materials.class.BomLine,
              line.space,
              line._id,
              id,
              materials.class.Product,
              'lines'
            )
          }
        }
        for (const line of item.lines) {
          await ops.addCollection(
            materials.class.BomLine,
            core.space.Workspace,
            id,
            materials.class.Product,
            'lines',
            { ...line },
            generateId<BomLine>()
          )
        }
        if (!(await ops.commit()).result) throw new Error(`产品 ${item.name} 已变化，请重新预览。`)
        done++
      }
      message = `已保存 ${done} 个产品。`
      candidates = []
    } catch (e) {
      error = `已保存 ${done} 个产品。${e instanceof Error ? e.message : '保存失败'} 其余产品未处理，请重新预览。`
      candidates = []
    } finally {
      busy = false
      progress = ''
    }
  }
</script>

<div class="page">
  <header>
    <h1>产品 / BOM</h1>
    {#if isOwnerOrMaintainer()}<button
        on:click={() => {
          importing = true
          error = ''
          message = ''
        }}>导入 BOM Excel</button
      >{/if}
  </header>
  {#if selected === undefined}
    <p>点击产品查看 BOM，每台数量为生产一台产品的用量。</p>
    {#each products as product (product._id)}<p>
        <button
          on:click={() => {
            openProduct(product)
          }}>{product.name}</button
        >
        {product.description}
      </p>{:else}<p>还没有产品，请由管理员导入 BOM。</p>{/each}
  {:else}
    <p><button on:click={back}>返回产品列表</button> <strong>{selected.name}</strong></p>
    <div class="table">
      <table>
        <thead><tr><th>编号</th><th>描述</th><th>每台数量</th><th>装配段</th><th>当前库存</th><th>来源</th></tr></thead
        ><tbody>
          {#each lines as line (line._id)}<tr
              ><td>{line.code !== '' ? line.code : '—'}</td><td>{line.description}</td><td
                class:problem={line.quantityProblem}
                >{line.quantityRaw !== '' ? line.quantityRaw : '—'}{line.quantityProblem ? '（有问题）' : ''}</td
              ><td>{line.section}</td><td
                >{line.codeProblem ? '编号有问题' : (stock.get(line.code)?.stock ?? '库存中找不到')}</td
              ><td>{line.sourceSheet} / {line.sourceRow}</td></tr
            >{:else}<tr><td colspan="6">没有 BOM 明细</td></tr>{/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>
{#if importing}
  <div class="overlay" role="presentation">
    <section class="dialog" role="dialog" aria-modal="true" aria-label="导入 BOM">
      <header>
        <h2>导入 BOM Excel</h2>
        <button
          disabled={busy}
          on:click={() => {
            importing = false
            candidates = []
          }}>关闭</button
        >
      </header>
      <p>
        先预览，再确认。每张工作表是一个产品；再次导入会替换该产品全部
        BOM，不会新建库存物料。变化按编号和装配段比较，重复行按顺序匹配。
      </p>
      <input type="file" accept=".xlsx,.xlsm" on:change={choose} disabled={busy} aria-label="选择 BOM Excel" />
      {#if busy}<p role="status">{progress}</p>{/if}
      {#if error !== ''}<p class="problem" role="alert">{error}</p>{/if}{#if message !== ''}<p>{message}</p>{/if}
      {#if candidates.length > 0}
        <div class="table">
          <table>
            <thead
              ><tr
                ><th>导入</th><th>产品</th><th>行数</th><th>库存找不到的不同编号</th><th>数量为零或无效</th><th
                  >新增 / 删除 / 数量变化</th
                ></tr
              ></thead
            ><tbody>
              {#each candidates as item (item.normalizedName)}
                <tr
                  ><td
                    ><input
                      type="checkbox"
                      checked={checked.has(item.normalizedName)}
                      disabled={busy}
                      on:change={(e) => {
                        toggle(item.normalizedName, e.currentTarget.checked)
                      }}
                    /></td
                  ><td>{item.name}</td><td>{item.lines.length}</td><td>{missing(item)}</td><td
                    >{item.lines.filter((line) => line.quantityProblem).length}</td
                  ><td
                    >+{bomDiff(oldLines(item), item.lines).added} / −{bomDiff(oldLines(item), item.lines).removed} / {bomDiff(
                      oldLines(item),
                      item.lines
                    ).quantityChanged}</td
                  ></tr
                >
                {#each item.lines.filter((line) => line.quantityProblem || line.codeProblem || !stock.has(line.code)) as line}
                  <tr
                    ><td></td><td colspan="5"
                      >第 {line.sourceRow} 行 · {line.code !== '' ? line.code : '编号空白'} · {line.description} · 数量 {line.quantityRaw !==
                      ''
                        ? line.quantityRaw
                        : '空白'}
                      {line.quantityProblem ? '（数量有问题）' : ''}
                      {line.codeProblem ? '（编号有问题）' : !stock.has(line.code) ? '（库存中找不到）' : ''}</td
                    ></tr
                  >
                {/each}
              {/each}
            </tbody>
          </table>
        </div>
        <button disabled={busy || checked.size === 0} on:click={submit}>确认替换选中的产品 BOM</button>
      {/if}
    </section>
  </div>
{/if}

<style>
  .page {
    padding: 1.5rem;
    width: 100%;
    min-width: 0;
    overflow: auto;
    color: var(--theme-content-color);
  }
  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
  }
  button,
  input {
    color: var(--theme-content-color);
    font: inherit;
    border: 1px solid var(--theme-button-border);
    background: var(--theme-button-default);
    border-radius: 0.4rem;
    padding: 0.5rem;
  }
  button {
    cursor: pointer;
  }
  button:disabled {
    opacity: 0.5;
  }
  .table {
    overflow: auto;
    max-height: 65vh;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    padding: 0.5rem;
    border-bottom: 1px solid #777;
    text-align: left;
  }
  .problem {
    color: var(--theme-error-color, #fa7777);
  }
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    justify-content: center;
    align-items: center;
    background: #0009;
  }
  .dialog {
    width: min(75rem, 95vw);
    max-height: 90vh;
    overflow: auto;
    padding: 1.25rem;
    background: var(--popup-bg-color, #24252a);
    color: var(--theme-content-color);
    border-radius: 0.7rem;
  }
</style>
