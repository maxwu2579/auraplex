<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<!-- Automation rules: "when → if → do" for orders and applications, with a dry run and a run log.
     Super admins and company admins manage all rules; department admins only rules limited to their departments. -->
<script lang="ts">
  import card, { type Card } from '@hcengineering/card'
  import contact, { formatName, type Employee } from '@hcengineering/contact'
  import core, { getCurrentAccount, isOwnerOrMaintainer, SortingOrder, type AccountUuid, type Ref } from '@hcengineering/core'
  import departments, {
    applicationRuleEvent, applicationTargets, defaultOrderStages, memberDepartments, orderRuleEvent, orderTargets,
    ruleActionKinds, ruleApplies, ruleDepartments, ruleRecipients, ruleText, ruleTriggerKinds, validRule,
    type DepartmentAccess, type Order, type OrderFlow, type OrderFlowStage, type OrderRule, type RuleAction,
    type RuleActionKind, type RuleCondition, type RuleRun, type RuleTarget, type RuleTrigger, type RuleTriggerKind
  } from '@hcengineering/departments'
  import hr, { type Department } from '@hcengineering/hr'
  import { translate } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { languageStore } from '@hcengineering/ui'

  const client = getClient()
  const hierarchy = client.getHierarchy()
  const me = getCurrentAccount().uuid
  const owner = isOwnerOrMaintainer()
  $: zh = $languageStore === 'zh'
  $: L = (zhText: string, enText: string): string => (zh ? zhText : enText)

  let rules: OrderRule[] = []
  let teams: DepartmentAccess[] = []
  let staff: Employee[] = []
  let flow: OrderFlowStage[] = defaultOrderStages
  let orders: Order[] = []
  createQuery().query(departments.class.OrderRule, {}, (docs) => { rules = docs }, { sort: { createdOn: SortingOrder.Ascending } })
  createQuery().query(contact.mixin.Employee, { active: true }, (docs) => { staff = docs })
  createQuery().query(departments.class.OrderFlow, { _id: departments.ids.OrderFlow }, (docs) => {
    flow = docs[0]?.stages !== undefined && docs[0].stages.length > 0 ? (docs[0] as OrderFlow).stages : defaultOrderStages
  })
  createQuery().query(departments.class.Order, { state: { $in: ['active', 'pending', 'done'] } }, (docs) => { orders = docs },
    { sort: { modifiedOn: SortingOrder.Descending }, limit: 100 })
  createQuery().query(hr.class.Department, {}, (docs) => {
    teams = docs.filter((doc) => hierarchy.hasMixin(doc, departments.mixin.DepartmentAccess))
      .map((doc) => hierarchy.as(doc, departments.mixin.DepartmentAccess)).filter((doc) => !doc.archived)
  })

  // Application types: the form types departments manage.
  $: appTypeIds = [...new Set(teams.flatMap((team) => team.applicationTypes ?? []))] as string[]
  let appTypeNames = new Map<string, string>()
  async function loadTypeNames (ids: string[], language: string): Promise<void> {
    const pairs = await Promise.all(ids.map(async (id) => {
      const label = hierarchy.findClass(id as Ref<any>)?.label
      return [id, label === undefined ? id : await translate(label, {}, language)] as const
    }))
    appTypeNames = new Map(pairs)
  }
  $: void loadTypeNames(appTypeIds, $languageStore)
  let cards: Card[] = []
  const cardQuery = createQuery()
  $: if (appTypeIds.length > 0) {
    cardQuery.query(card.class.Card, { _class: { $in: appTypeIds as any } }, (docs) => { cards = docs },
      { sort: { modifiedOn: SortingOrder.Descending }, limit: 50 })
  }

  $: adminOf = new Set<string>(teams.filter((team) => team.administrators.includes(me)).map((team) => team._id))
  $: canManage = owner || adminOf.size > 0
  $: mayEdit = (rule: Pick<OrderRule, 'condition' | 'action'>): boolean => {
    if (owner) return true
    const limited = ruleDepartments(rule)
    return limited.length > 0 && limited.every((id) => adminOf.has(id))
  }

  $: triggerNames = {
    stageDone: L('订单某段完成', 'An order stage is done'),
    stageStart: L('订单某段开始', 'An order stage starts'),
    paid: L('订单已付款', 'An order is paid'),
    stageOverdue: L('订单某段过期', 'An order stage is overdue'),
    appApproved: L('申请审批通过', 'An application is approved'),
    appRejected: L('申请被拒绝', 'An application is rejected')
  } satisfies Record<RuleTriggerKind, string>
  $: targetNames = {
    deptLeads: L('部门的管理员和主管', 'Department admins and supervisors'),
    deptAdmins: L('部门的管理员', 'Department admins'),
    deptSupervisors: L('部门的主管', 'Department supervisors'),
    stageAssignee: L('这一段的负责人', 'Person in charge of the stage'),
    salesOwner: L('接单销售', 'Sales owner'),
    applicant: L('申请人', 'Applicant'),
    person: L('指定的人', 'A chosen person')
  } satisfies Record<RuleTarget, string>
  $: actionNames = {
    todo: L('建待办', 'create a to-do'),
    notify: L('发系统通知', 'send a notification'),
    mail: L('发邮件', 'send an email')
  } satisfies Record<RuleActionKind, string>

  $: deptName = (id: string | undefined): string => teams.find((team) => team._id === id)?.name ?? '?'
  $: personName = (id: AccountUuid | undefined): string => {
    const found = id === undefined ? undefined : staff.find((it) => it.personUuid === id)
    return found === undefined ? '?' : formatName(found.name)
  }
  const isApp = (kind: RuleTriggerKind): boolean => kind === 'appApproved' || kind === 'appRejected'
  $: stageName = (id: string | undefined): string => flow.find((stage) => stage.id === id)?.name ?? id ?? ''

  /** Reads the rule back as one sentence. */
  $: sentence = (rule: Pick<OrderRule, 'trigger' | 'condition' | 'action'>): string => {
    const { trigger, condition, action } = rule
    const when = isApp(trigger.kind)
      ? `${trigger.appType ? (appTypeNames.get(trigger.appType) ?? trigger.appType) + L('：', ': ') : ''}${triggerNames[trigger.kind]}`
      : trigger.kind === 'paid' ? triggerNames.paid
        : `${trigger.stage ? stageName(trigger.stage) : L('任何一段', 'any stage')}${trigger.kind === 'stageDone' ? L('完成', ' done') : trigger.kind === 'stageStart' ? L('开始', ' starts') : L('过期', ' overdue')}`
    const ifs = [
      condition.department !== undefined ? L(`部门是 ${deptName(condition.department)}`, `department is ${deptName(condition.department)}`) : '',
      condition.customer ? L(`客户含「${condition.customer}」`, `customer contains "${condition.customer}"`) : '',
      condition.title ? L(`名称含「${condition.title}」`, `name contains "${condition.title}"`) : ''
    ].filter(Boolean).join(L('，', ', '))
    const who = action.target === 'person' ? personName(action.person)
      : action.target.startsWith('dept') ? `${action.department !== undefined ? deptName(action.department) : L('该部门', 'that department')}${L('的', ' ')}${targetNames[action.target].replace(/^部门的|^Department /, '')}`
        : targetNames[action.target]
    const due = action.kind === 'todo' ? L(`，${action.dueDays ?? 1} 个工作日内`, `, within ${action.dueDays ?? 1} working day(s)`) : ''
    return `${when}${ifs ? L('，并且', ', if ') + ifs : ''} → ${L('给', 'for ')}${who}${actionNames[action.kind]}「${action.title}」${due}`
  }

  // ---------- Editing ----------
  interface Draft { _id?: Ref<OrderRule>, name: string, enabled: boolean, trigger: RuleTrigger, condition: RuleCondition, action: RuleAction }
  let draft: Draft | undefined
  let error = ''
  function blank (): Draft {
    const mine = [...adminOf][0] as Ref<Department> | undefined
    return {
      name: '', enabled: true,
      trigger: { kind: 'stageDone', stage: '' },
      condition: owner ? {} : { department: mine },
      action: { kind: 'todo', target: 'deptLeads', title: '{订单号} {订单名}：{阶段}', dueDays: 1 }
    }
  }
  function edit (rule?: OrderRule): void {
    error = ''
    draft = rule === undefined ? blank() : JSON.parse(JSON.stringify({ _id: rule._id, name: rule.name, enabled: rule.enabled, trigger: rule.trigger, condition: rule.condition, action: rule.action }))
  }
  // Keep the target valid for the chosen trigger.
  $: if (draft !== undefined) {
    const allowed = isApp(draft.trigger.kind) ? applicationTargets : orderTargets
    if (!allowed.includes(draft.action.target)) draft.action.target = allowed[0]
  }
  function clean (value: Draft): Omit<OrderRule, keyof import('@hcengineering/core').Doc> {
    const trigger: RuleTrigger = { kind: value.trigger.kind }
    if (!isApp(value.trigger.kind) && value.trigger.kind !== 'paid' && value.trigger.stage) trigger.stage = value.trigger.stage
    if (isApp(value.trigger.kind) && value.trigger.appType) trigger.appType = value.trigger.appType
    const condition: RuleCondition = {}
    if (value.condition.department) condition.department = value.condition.department
    if (value.condition.customer?.trim()) condition.customer = value.condition.customer.trim()
    if (value.condition.title?.trim()) condition.title = value.condition.title.trim()
    const action: RuleAction = { kind: value.action.kind, target: value.action.target, title: value.action.title.trim() }
    if (value.action.target.startsWith('dept') && value.action.department) action.department = value.action.department
    if (value.action.target === 'person' && value.action.person) action.person = value.action.person
    if (value.action.kind === 'todo') action.dueDays = Math.max(0, Math.min(60, Math.round(Number(value.action.dueDays ?? 1))))
    return { name: value.name.trim(), enabled: value.enabled, trigger, condition, action }
  }
  async function save (): Promise<void> {
    if (draft === undefined) return
    const data = clean(draft)
    if (!validRule(data)) {
      error = L('请填写名字和待办 / 通知内容；选"指定的人"时要选一个人。', 'Fill in the name and the text; pick a person for "A chosen person".')
      return
    }
    if (!mayEdit(data)) {
      error = L('部门管理员只能建限定在自己部门的规则：请在"条件"或"给谁"里选你管理的部门。', 'Department admins may only manage rules limited to their own departments.')
      return
    }
    try {
      if (draft._id === undefined) await client.createDoc(departments.class.OrderRule, core.space.Workspace, data)
      else {
        const old = rules.find((rule) => rule._id === draft?._id)
        if (old !== undefined) await client.update(old, data)
      }
      draft = undefined
    } catch {
      error = L('保存失败，可能没有权限。', 'Could not save; you may not have permission.')
    }
  }
  async function toggle (rule: OrderRule): Promise<void> {
    try { await client.update(rule, { enabled: !rule.enabled }) } catch { error = L('没有权限。', 'No permission.') }
  }
  async function remove (rule: OrderRule): Promise<void> {
    if (!window.confirm(L(`删除规则「${rule.name}」？`, `Delete rule "${rule.name}"?`))) return
    try { await client.remove(rule) } catch { error = L('没有权限。', 'No permission.') }
  }
  async function addSamples (): Promise<void> {
    const engineering = flow.find((stage) => stage.id === 'engineering')
    const production = flow.find((stage) => stage.id === 'production')
    const samples = [
      {
        name: L('示例：生产完成 → 给工程部主管建交接待办', 'Example: production done → hand-over to-do for engineering'),
        enabled: false,
        trigger: { kind: 'stageDone', ...(production !== undefined ? { stage: production.id } : {}) },
        condition: {},
        action: { kind: 'todo', target: 'deptLeads', ...(engineering?.department !== undefined ? { department: engineering.department } : {}), title: '交接：{订单号} {订单名}', dueDays: 2 }
      },
      {
        name: L('示例：订单某段过期 → 给接单销售发邮件', 'Example: stage overdue → email the sales owner'),
        enabled: false,
        trigger: { kind: 'stageOverdue' },
        condition: {},
        action: { kind: 'mail', target: 'salesOwner', title: '订单 {订单号} {订单名} 的「{阶段}」已过期' }
      }
    ] as Array<Omit<OrderRule, keyof import('@hcengineering/core').Doc>>
    for (const sample of samples) await client.createDoc(departments.class.OrderRule, core.space.Workspace, sample)
  }

  // ---------- Dry run ----------
  let dryRule: OrderRule | undefined
  let dryTarget = ''
  let dryResult: string[] = []
  $: leadsOf = (id: string): { administrators: AccountUuid[], supervisors: AccountUuid[] } | undefined =>
    teams.find((team) => team._id === id)
  async function runDry (): Promise<void> {
    const rule = dryRule
    if (rule === undefined) return
    dryResult = []
    let event
    if (isApp(rule.trigger.kind)) {
      const found = cards.find((it) => it._id === dryTarget)
      if (found === undefined) { dryResult = [L('请选一个申请。', 'Pick an application.')]; return }
      const identity = found.createdBy === undefined ? undefined
        : await client.findOne(contact.class.SocialIdentity, { _id: found.createdBy as any })
      const applicant = staff.find((it) => it._id === identity?.attachedTo)?.personUuid
      event = applicationRuleEvent(rule.trigger.kind as 'appApproved' | 'appRejected', found, applicant, memberDepartments(teams, applicant), 'dry-run')
    } else {
      const found = orders.find((it) => it._id === dryTarget)
      if (found === undefined) { dryResult = [L('请选一张订单。', 'Pick an order.')]; return }
      const index = rule.trigger.stage ? found.stages.findIndex((stage) => stage.id === rule.trigger.stage) : found.current
      if (index < 0) { dryResult = [L('这张订单没有规则选的那一段，所以不会执行。', 'This order has no such stage, so nothing would happen.')]; return }
      event = orderRuleEvent(rule.trigger.kind, found, index, 'dry-run')
    }
    const check = ruleApplies(rule, event)
    if (!check.ok) { dryResult = [L(`不会执行：${check.reason}`, `Would not run: ${check.reason}`)]; return }
    const people = ruleRecipients(rule.action, event, leadsOf)
    if (people.length === 0) { dryResult = [L('不会执行：找不到要通知的人（部门没有管理员 / 主管，或这段没有负责人）。', 'Would not run: nobody to send to.')]; return }
    const text = ruleText(rule.action.title, event)
    dryResult = [
      L(`会${actionNames[rule.action.kind]}：「${text}」`, `Would ${actionNames[rule.action.kind]}: "${text}"`),
      L(`给：${people.map(personName).join('、')}`, `To: ${people.map(personName).join(', ')}`),
      L('（试跑只是预览，没有真的建待办或发通知）', '(Dry run only; nothing was created or sent)')
    ]
  }

  // ---------- Run log ----------
  let logRule: Ref<OrderRule> | undefined
  let runs: RuleRun[] = []
  const runQuery = createQuery()
  $: if (logRule !== undefined) {
    runQuery.query(departments.class.RuleRun, { rule: logRule }, (docs) => { runs = docs }, { sort: { at: SortingOrder.Descending }, limit: 30 })
  } else runs = []
  $: resultNames = { done: L('成功', 'Done'), skipped: L('跳过', 'Skipped'), failed: L('失败', 'Failed') }
  const when = (at: number): string => new Date(at).toLocaleString()
</script>

<div class="page">
  <header>
    <h1>{L('自动化规则', 'Automation rules')}</h1>
    {#if canManage}<button class="primary" on:click={() => { edit() }}>{L('+ 新规则', '+ New rule')}</button>{/if}
  </header>
  <p class="hint">{L('设定"什么时候 → 满足什么 → 做什么"。每日清单、过期提醒、付款后交给设计这三样是系统固定的，不在这里。', 'Set "when → if → do". The daily list, overdue reminders and payment hand-over are built in and not listed here.')}</p>
  {#if error}<p role="alert" class="error">{error}</p>{/if}

  {#if draft !== undefined}
    <section class="editor">
      <label>{L('规则名字', 'Rule name')}<input bind:value={draft.name} maxlength="200" /></label>
      <fieldset>
        <legend>{L('什么时候', 'When')}</legend>
        <select bind:value={draft.trigger.kind}>{#each ruleTriggerKinds as kind}<option value={kind}>{triggerNames[kind]}</option>{/each}</select>
        {#if !isApp(draft.trigger.kind) && draft.trigger.kind !== 'paid'}
          <select bind:value={draft.trigger.stage}>
            <option value="">{L('任何一段', 'Any stage')}</option>
            {#each flow as stage}<option value={stage.id}>{stage.name}</option>{/each}
          </select>
        {/if}
        {#if isApp(draft.trigger.kind)}
          <select bind:value={draft.trigger.appType}>
            <option value="">{L('任何申请类型', 'Any type')}</option>
            {#each appTypeIds as id}<option value={id}>{appTypeNames.get(id) ?? id}</option>{/each}
          </select>
        {/if}
      </fieldset>
      <fieldset>
        <legend>{L('满足什么（可不填）', 'If (optional)')}</legend>
        <label>{isApp(draft.trigger.kind) ? L('申请人的部门', "Applicant's department") : L('这一段的部门', "Stage's department")}
          <select bind:value={draft.condition.department}>
            <option value={undefined}>{L('不限', 'Any')}</option>
            {#each teams as team}<option value={team._id}>{team.name}</option>{/each}
          </select>
        </label>
        {#if !isApp(draft.trigger.kind)}
          <label>{L('客户名包含', 'Customer contains')}<input bind:value={draft.condition.customer} maxlength="200" /></label>
        {/if}
        <label>{isApp(draft.trigger.kind) ? L('申请标题包含', 'Title contains') : L('订单名包含', 'Order name contains')}<input bind:value={draft.condition.title} maxlength="200" /></label>
      </fieldset>
      <fieldset>
        <legend>{L('做什么', 'Do')}</legend>
        <select bind:value={draft.action.kind}>{#each ruleActionKinds as kind}<option value={kind}>{actionNames[kind]}</option>{/each}</select>
        <label>{L('给谁', 'For')}
          <select bind:value={draft.action.target}>
            {#each isApp(draft.trigger.kind) ? applicationTargets : orderTargets as target}<option value={target}>{targetNames[target]}</option>{/each}
          </select>
        </label>
        {#if draft.action.target.startsWith('dept')}
          <label>{L('哪个部门', 'Which department')}
            <select bind:value={draft.action.department}>
              <option value={undefined}>{isApp(draft.trigger.kind) ? L('申请人的部门', "Applicant's department") : L('这一段的部门', "The stage's department")}</option>
              {#each teams as team}<option value={team._id}>{team.name}</option>{/each}
            </select>
          </label>
        {/if}
        {#if draft.action.target === 'person'}
          <label>{L('哪个人', 'Who')}
            <select bind:value={draft.action.person}>
              <option value={undefined}>—</option>
              {#each staff as person}{#if person.personUuid}<option value={person.personUuid}>{formatName(person.name)}</option>{/if}{/each}
            </select>
          </label>
        {/if}
        <label class="wide">{draft.action.kind === 'todo' ? L('待办标题', 'To-do title') : L('内容', 'Text')}
          <input bind:value={draft.action.title} maxlength="500" />
        </label>
        <span class="hint">{L('可用：{订单号} {订单名} {客户} {阶段} {申请标题}', 'You can use: {订单号} {订单名} {客户} {阶段} {申请标题}')}</span>
        {#if draft.action.kind === 'todo'}
          <label>{L('几个工作日内完成', 'Due in working days')}<input type="number" min="0" max="60" bind:value={draft.action.dueDays} /></label>
        {/if}
      </fieldset>
      <label class="check"><input type="checkbox" bind:checked={draft.enabled} /> {L('启用', 'Enabled')}</label>
      <p class="sentence">{sentence(clean(draft))}</p>
      <div class="buttons">
        <button class="primary" on:click={save}>{L('保存', 'Save')}</button>
        <button on:click={() => { draft = undefined; error = '' }}>{L('取消', 'Cancel')}</button>
      </div>
    </section>
  {/if}

  {#each rules as rule (rule._id)}
    <article class:off={!rule.enabled}>
      <div class="row">
        <b>{rule.name}</b>
        <span class="tag">{rule.enabled ? L('启用', 'On') : L('停用', 'Off')}</span>
      </div>
      <p>{sentence(rule)}</p>
      <div class="buttons">
        {#if mayEdit(rule)}
          <button on:click={() => toggle(rule)}>{rule.enabled ? L('停用', 'Turn off') : L('启用', 'Turn on')}</button>
          <button on:click={() => { edit(rule) }}>{L('修改', 'Edit')}</button>
          <button on:click={() => remove(rule)}>{L('删除', 'Delete')}</button>
        {/if}
        <button on:click={() => { dryRule = dryRule?._id === rule._id ? undefined : rule; dryTarget = ''; dryResult = [] }}>{L('试跑', 'Dry run')}</button>
        <button on:click={() => { logRule = logRule === rule._id ? undefined : rule._id }}>{L('运行记录', 'Run log')}</button>
      </div>
      {#if dryRule?._id === rule._id}
        <div class="panel">
          {#if isApp(rule.trigger.kind)}
            <select bind:value={dryTarget}>
              <option value="">{L('选一个申请…', 'Pick an application…')}</option>
              {#each cards as item}<option value={item._id}>{appTypeNames.get(item._class) ?? ''} {item.title}</option>{/each}
            </select>
          {:else}
            <select bind:value={dryTarget}>
              <option value="">{L('选一张订单…', 'Pick an order…')}</option>
              {#each orders as item}<option value={item._id}>{item.number} {item.title}</option>{/each}
            </select>
          {/if}
          <button on:click={runDry}>{L('试跑', 'Run')}</button>
          {#each dryResult as line}<p>{line}</p>{/each}
        </div>
      {/if}
      {#if logRule === rule._id}
        <div class="panel">
          {#each runs as run (run._id)}
            <p class={run.result}>{when(run.at)} · {run.label} · {resultNames[run.result]}{run.reason ? ' · ' + run.reason : ''}{run.mailState === 'pending' ? L(' · 邮件待发', ' · mail pending') : run.mailState === 'failed' ? L(' · 邮件没发出', ' · mail failed') : ''}</p>
          {:else}
            <p class="hint">{L('还没有运行过。', 'Has not run yet.')}</p>
          {/each}
        </div>
      {/if}
    </article>
  {:else}
    <p class="hint">{L('还没有规则。', 'No rules yet.')}</p>
    {#if owner}<button on:click={addSamples}>{L('加两条示例规则（默认停用）', 'Add two example rules (off)')}</button>{/if}
  {/each}
</div>

<style>
  .page { padding: 1.5rem; overflow: auto; min-width: 0; color: var(--theme-content-color); max-width: 60rem; }
  header { display: flex; gap: 0.8rem; align-items: center; }
  header h1 { flex: 1; margin: 0; font-size: 1.2rem; }
  .hint { opacity: 0.65; }
  .error, .failed { color: var(--theme-error-color); }
  .skipped { opacity: 0.65; }
  section.editor, article { border: 1px solid var(--theme-divider-color); border-radius: 0.5rem; padding: 0.8rem; margin: 0.8rem 0; }
  article.off { opacity: 0.7; }
  fieldset { border: 1px solid var(--theme-divider-color); border-radius: 0.4rem; margin: 0.6rem 0; display: flex; flex-wrap: wrap; gap: 0.6rem; align-items: center; }
  legend { padding: 0 0.3rem; font-weight: 600; }
  label { display: flex; gap: 0.4rem; align-items: center; flex-wrap: wrap; }
  label.wide { flex: 1 1 100%; }
  label.wide input { flex: 1; min-width: 12rem; }
  .row, .buttons { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
  .sentence { background: var(--theme-bg-accent-color, rgba(127, 127, 127, 0.08)); padding: 0.5rem; border-radius: 0.4rem; }
  .panel { margin-top: 0.6rem; padding: 0.6rem; border-top: 1px dashed var(--theme-divider-color); }
  .panel p { margin: 0.3rem 0; }
  .tag { border: 1px solid var(--theme-divider-color); border-radius: 0.4rem; padding: 0 0.4rem; font-size: 0.85rem; }
  input, select, button { color: var(--theme-content-color); background: var(--theme-button-default); border: 1px solid var(--theme-button-border); padding: 0.35rem 0.5rem; border-radius: 0.3rem; }
  select option { background: var(--theme-popup-color); color: var(--theme-content-color); }
  button { cursor: pointer; }
  button.primary { background: var(--theme-button-primary, #2f6fde); color: #fff; border-color: transparent; }
</style>
