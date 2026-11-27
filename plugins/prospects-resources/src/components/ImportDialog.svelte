<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<!-- Import existing customers from Excel / CSV: check first (what will be added, skipped, reviewed),
     then add them in batches. Imported cards are old customers: no introduction mail, campaigns only. -->
<script lang="ts">
  import contact from '@hcengineering/contact'
  import core, { generateId, getCurrentAccount, type AccountUuid } from '@hcengineering/core'
  import { getClient } from '@hcengineering/presentation'
  import prospects, {
    planImport, prospectWriteScope, type ImportPlan, type Prospect, type ProspectFieldDef
  } from '@hcengineering/prospects'
  import { createEventDispatcher } from 'svelte'
  import { cardDraft } from '../cardSave'
  import { readCustomerSheet } from '../importWorkbook'
  import { chinese } from '../trStore'
  import { createWorkbook, downloadWorkbook } from '../xlsx'

  export let columns: Array<{ field: ProspectFieldDef, label: string }>
  export let all: Prospect[]

  const dispatch = createEventDispatcher<{ close: undefined }>()
  const client = getClient()
  $: L = (zh: string, en: string): string => ($chinese ? zh : en)

  let plan: ImportPlan | undefined
  let fileName = ''
  let error = ''
  let busy = false
  let done = 0
  let result = ''

  const ownerHeader = (): string => L('负责人邮箱', 'Owner email')
  function downloadTemplate (): void {
    const header = [...columns.map((column) => column.label), ownerHeader()]
    downloadWorkbook(createWorkbook([{ name: L('客户', 'Customers'), rows: [header] }]), L('名片导入模板.xlsx', 'card-import-template.xlsx'))
  }

  async function pick (files: FileList | null): Promise<void> {
    const file = files?.[0]
    if (file === undefined) return
    error = ''
    result = ''
    plan = undefined
    fileName = file.name
    try {
      const sheet = await readCustomerSheet(file)
      plan = planImport(sheet, columns.map((column) => ({ key: column.field.key, label: column.label, field: column.field })), all)
      if (!plan.matched.includes('name') && !plan.matched.includes('company')) {
        error = L('第一行要有表头，至少要有"姓名"或"公司"这一列。可以先下载导入模板。', 'The first row must be a header with at least a name or company column. Download the template first.')
        plan = undefined
      }
    } catch {
      error = L('读不了这个文件。请用 .xlsx 或 .csv（Excel 另存为）。', 'Cannot read this file. Use .xlsx or .csv.')
    }
  }

  /** Owner emails → company accounts; unknown emails fall back to the person importing. */
  async function owners (emails: string[]): Promise<Map<string, AccountUuid>> {
    const result = new Map<string, AccountUuid>()
    const wanted = [...new Set(emails.filter((email) => email !== ''))]
    if (wanted.length === 0) return result
    const ids = await client.findAll(contact.class.SocialIdentity, { type: 'email' as any, value: { $in: wanted } })
    const people = await client.findAll(contact.mixin.Employee, { _id: { $in: ids.map((id) => id.attachedTo) as any } })
    for (const id of ids) {
      const uuid = people.find((person) => person._id === id.attachedTo)?.personUuid
      if (uuid !== undefined) result.set(id.value.toLowerCase(), uuid)
    }
    return result
  }

  async function run (): Promise<void> {
    if (plan === undefined || busy) return
    busy = true
    done = 0
    let added = 0
    let failed = 0
    const me = getCurrentAccount().uuid
    const ownerOf = await owners(plan.add.map((row) => row.ownerEmail))
    const fallbackSource = L('旧客户导入', 'Imported customer')
    for (let i = 0; i < plan.add.length; i += 50) {
      const batch = plan.add.slice(i, i + 50)
      const ops = client.apply(prospectWriteScope)
      for (const row of batch) {
        if (row.normalizedEmail !== '') ops.notMatch(prospects.class.Prospect, { normalizedEmail: row.normalizedEmail })
        await ops.createDoc(prospects.class.Prospect, core.space.Workspace, {
          ...cardDraft(row.values as any),
          source: row.values.source ?? fallbackSource,
          ...(Object.keys(row.custom).length > 0 ? { custom: row.custom } : {}),
          normalizedEmail: row.normalizedEmail,
          status: 'new',
          owner: ownerOf.get(row.ownerEmail) ?? me,
          emailCount: 0,
          photos: 0,
          recognitionConfirmed: true,
          imported: true,
          ...(row.review.length > 0 ? { review: row.review } : {})
        }, generateId<Prospect>())
      }
      if ((await ops.commit()).result) added += batch.length
      else failed += batch.length
      done = Math.min(plan.add.length, i + 50)
    }
    busy = false
    result = L(`已导入 ${added} 张。`, `Imported ${added}.`) +
      (failed > 0 ? L(`${failed} 张没导入（同时有人加了同一个邮箱的名片），可以再导入一次，已有的会自动跳过。`, ` ${failed} were not imported (a card with the same email was added meanwhile); import again and existing ones are skipped.`) : '')
    plan = undefined
  }

  $: reasonText = {
    empty: L('没有姓名也没有公司', 'No name or company'),
    'existing-email': L('名片库里已有这个邮箱', 'Email already in the library'),
    'file-email': L('表里前面已有同一个邮箱', 'Same email earlier in the file'),
    'bad-email': L('邮箱格式不对', 'Invalid email')
  }
  $: review = plan?.add.filter((row) => row.review.length > 0).length ?? 0
</script>

<div class="overlay" role="presentation">
  <section class="dialog" role="dialog" aria-modal="true" aria-label={L('导入客户', 'Import customers')}>
    <header>
      <h2>{L('导入客户（Excel）', 'Import customers (Excel)')}</h2>
      <button disabled={busy} on:click={() => dispatch('close')}>✕</button>
    </header>
    <ol class="steps">
      <li>{L('下载模板，把客户填进去（第一行是表头，不要改）。也可以用自己的表，只要表头名字和名片格子一样。', 'Download the template and fill it in (keep the first row). Your own sheet works too if the headers match the card fields.')}
        <button on:click={downloadTemplate}>{L('下载导入模板', 'Download template')}</button></li>
      <li>{L('选择填好的文件（.xlsx 或 .csv）。', 'Pick the filled file (.xlsx or .csv).')}
        <label class="file">{L('选择文件', 'Choose file')}<input type="file" accept=".xlsx,.csv,.txt" disabled={busy} on:change={(e) => { void pick(e.currentTarget.files); e.currentTarget.value = '' }} /></label>
        {#if fileName}<span class="hint">{fileName}</span>{/if}</li>
      <li>{L('先看检查结果，没问题再点"开始导入"。导入的都算旧客户：不发新客户介绍信，以后的广告照常发。', 'Check the result, then import. Imported cards are old customers: no introduction mail, campaigns as usual.')}</li>
    </ol>
    {#if error}<p role="alert" class="error">{error}</p>{/if}
    {#if plan !== undefined}
      <div class="summary">
        <p><b>{L(`可以导入 ${plan.add.length} 张`, `${plan.add.length} can be imported`)}</b>{#if review > 0}{L(`（其中 ${review} 张电话和已有名片相同，会放进"待核对"）`, ` (${review} share a phone number and go to review)`)}{/if}</p>
        {#if plan.skipped.length > 0}
          <p>{L(`跳过 ${plan.skipped.length} 行：`, `${plan.skipped.length} rows skipped:`)}</p>
          <ul>{#each plan.skipped.slice(0, 30) as item}<li>{L(`第 ${item.row} 行`, `Row ${item.row}`)}：{reasonText[item.reason]}</li>{/each}
            {#if plan.skipped.length > 30}<li>…</li>{/if}</ul>
        {/if}
        {#if plan.unknownHeaders.length > 0}
          <p class="warn">{L('这些列没认出来，不会导入：', 'These columns were not recognised and are ignored: ')}{plan.unknownHeaders.join('、')}</p>
        {/if}
      </div>
      <footer>
        <button class="primary" disabled={busy || plan.add.length === 0} on:click={run}>
          {busy ? L(`正在导入 ${done} / ${plan.add.length}…`, `Importing ${done} / ${plan.add.length}…`) : L('开始导入', 'Import')}
        </button>
      </footer>
    {/if}
    {#if result}<p role="status" class="ok">{result}</p>{/if}
  </section>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; background: #0009; }
  .dialog { width: min(42rem, 95vw); max-height: 90vh; overflow: auto; background: var(--theme-popup-color); color: var(--theme-content-color); padding: 1rem; border-radius: 0.6rem; }
  header, footer { display: flex; gap: 0.7rem; align-items: center; flex-wrap: wrap; }
  header h2 { flex: 1; margin: 0; font-size: 1.1rem; }
  .steps li { margin: 0.5rem 0; }
  .steps button, .file { margin-left: 0.4rem; }
  .file input { display: none; }
  .file { display: inline-block; cursor: pointer; }
  .summary { border-top: 1px solid var(--theme-divider-color); margin-top: 0.6rem; padding-top: 0.4rem; }
  .summary ul { max-height: 12rem; overflow: auto; margin: 0.2rem 0; }
  .hint { opacity: 0.65; margin-left: 0.4rem; }
  .error { color: var(--theme-error-color); }
  .warn { color: #c58a00; }
  .ok { color: var(--theme-won-color, #2e9b50); }
  button, .file { color: var(--theme-content-color); background: var(--theme-button-default); border: 1px solid var(--theme-button-border); padding: 0.35rem 0.7rem; border-radius: 0.3rem; cursor: pointer; }
  button.primary { background: var(--theme-button-primary, #2f6fde); color: #fff; border-color: transparent; }
</style>
