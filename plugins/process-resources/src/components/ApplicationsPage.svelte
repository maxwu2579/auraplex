<!--
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
-->
<script lang="ts">
  // Applications: one simple page for card types that have an approval process.
  // Staff pick a form, fill it in and follow it; approvers see what waits for them.
  import card, { type Card, type CardSpace, type MasterTag } from '@hcengineering/card'
  import contact, { formatName, getCurrentEmployee, type Employee, type Person } from '@hcengineering/contact'
  import { AccountRole, SortingOrder, applicationFormTypes, getCurrentAccount, type AccountUuid, type Class, type Doc, type Mixin, type Ref } from '@hcengineering/core'
  import { AttributeBarEditor, createQuery, getClient } from '@hcengineering/presentation'
  import { type ApproveRequest, type Execution, type Process, type State } from '@hcengineering/process'
  import { Button, DropdownLabelsIntl, Header, Icon, Label, Scroller, eventToHTMLElement, languageStore, showPopup, type AnyComponent } from '@hcengineering/ui'
  import { PersonIdPresenter, openDoc } from '@hcengineering/view-resources'
  import { UserBox } from '@hcengineering/contact-resources'
  import { getEmbeddedLabel, type IntlString } from '@hcengineering/platform'
  import SignatureDialog from './SignatureDialog.svelte'
  import NewFormWizard from './NewFormWizard.svelte'
  import EditApplicationPopup from './EditApplicationPopup.svelte'
  import StopApplicationPopup from './StopApplicationPopup.svelte'
  import plugin from '../plugin'

  const client = getClient()
  const h = client.getHierarchy()
  const me = getCurrentAccount()
  const myPerson = getCurrentEmployee()
  const isOwner = me.role === AccountRole.Owner
  const canBuildForms = isOwner || me.role === AccountRole.Maintainer
  const createCard = 'card:component:CreateCard' as AnyComponent

  $: L = (zh: string, en: string): string => ($languageStore === 'zh' ? zh : en)

  let tab: 'mine' | 'todo' | 'department' = 'mine'

  // Which forms: card types that have a process people can run.
  let processes: Process[] = []
  const processQuery = createQuery()
  processQuery.query(plugin.class.Process, {}, (res) => {
    processes = res
  })
  // Auraplex: use the same form eligibility rule as the department settings and server.
  $: forms = applicationFormTypes(h, processes).map((tag) => h.getClass(tag) as MasterTag)
  $: formIds = forms.map((it) => it._id)


  // Auraplex: read department responsibilities without a dependency on the department UI.
  interface ResponsibleDepartment extends Doc {
    name: string
    archived?: boolean
    administrators?: AccountUuid[]
    supervisors?: AccountUuid[]
    applicationTypes?: Array<Ref<Doc>>
  }
  const departmentClass = 'hr:class:Department' as Ref<Class<ResponsibleDepartment>>
  const departmentAccess = 'departments:mixin:DepartmentAccess' as Ref<Mixin<ResponsibleDepartment>>
  let departments: ResponsibleDepartment[] = []

  if (h.hasClass(departmentClass) && h.hasClass(departmentAccess)) {
    createQuery().query(departmentClass, {}, (docs) => {
      departments = docs.flatMap((doc) => h.asIf(doc, departmentAccess) ?? [])
    })
  }
  $: responsibleTypes = new Set(departments.flatMap((department) =>
    !department.archived && (department.administrators?.includes(me.uuid) === true || department.supervisors?.includes(me.uuid) === true)
      ? department.applicationTypes ?? []
      : []))
  $: departmentForms = forms.filter((form) => responsibleTypes.has(form._id))
  $: if (departmentForms.length === 0 && tab === 'department') tab = 'mine'
  $: departmentClasses = [...new Set(departmentForms.flatMap((form) =>
    [form._id, ...h.getDescendants(form._id)]))] as Array<Ref<Class<Card>>>

  let departmentCards: Card[] = []
  const departmentCardQuery = createQuery()
  $: if (departmentClasses.length === 0) {
    departmentCardQuery.unsubscribe()
    departmentCards = []
  } else {
    departmentCardQuery.query(card.class.Card, { _class: { $in: departmentClasses } },
      (docs) => { departmentCards = docs }, { sort: { createdOn: SortingOrder.Descending } })
  }
  let departmentExecutions: Execution[] = []
  const departmentExecutionQuery = createQuery()
  $: if (departmentCards.length === 0) {
    departmentExecutionQuery.unsubscribe()
    departmentExecutions = []
  } else {
    departmentExecutionQuery.query(plugin.class.Execution, { card: { $in: departmentCards.map((doc) => doc._id) } },
      (docs) => { departmentExecutions = docs })
  }

  type DepartmentStatus = 'all' | 'active' | 'done' | 'cancelled'
  let departmentStatus: DepartmentStatus = 'all'
  function selectDepartmentStatus (value: string): void {
    if (value === 'all' || value === 'active' || value === 'done' || value === 'cancelled') departmentStatus = value
  }
  const departmentStatuses = {
    all: plugin.string.DepartmentApplicationsAll,
    active: plugin.string.DepartmentApplicationsActive,
    done: plugin.string.DepartmentApplicationsDone,
    cancelled: plugin.string.DepartmentApplicationsCancelled
  }
  const departmentStatusOptions = Object.entries(departmentStatuses).map(([id, label]) => ({ id, label }))
  $: departmentExecutionByCard = new Map([...departmentExecutions]
    .sort((a, b) => (a.createdOn ?? a.modifiedOn) - (b.createdOn ?? b.modifiedOn))
    .map((execution) => [execution.card, execution]))
  function departmentStatusOf (execution: Execution | undefined): Exclude<DepartmentStatus, 'all'> {
    if (execution?.status === 'done') return 'done'
    if (execution?.status === 'cancelled') return 'cancelled'
    return 'active'
  }

  $: filteredDepartmentCards = departmentCards.map((doc) => ({
    doc,
    status: departmentStatusOf(departmentExecutionByCard.get(doc._id))
  })).filter(({ status }) => departmentStatus === 'all' || departmentStatus === status)

  let spaces: CardSpace[] = []
  const spaceQuery = createQuery()
  spaceQuery.query(card.class.CardSpace, { archived: false, members: me.uuid }, (res) => {
    spaces = res
  })

  function rootType (type: Ref<MasterTag>): Ref<MasterTag> {
    const ancestors = h.getAncestors(type)
    const idx = ancestors.indexOf(card.class.Card)
    return idx > 0 ? (ancestors[idx - 1] as Ref<MasterTag>) : type
  }

  function spaceFor (type: Ref<MasterTag>, list: CardSpace[]): CardSpace | undefined {
    const root = rootType(type)
    const allowed = list.filter((s) => s.types.includes(root))
    return allowed.find((s) => s._id === card.space.Default) ?? allowed[0]
  }

  function adminSpace (list: CardSpace[]): CardSpace | undefined {
    return list.find((s) => s._id === card.space.Default) ?? list[0]
  }

  function apply (type: MasterTag): void {
    const space = spaceFor(type._id, spaces)
    if (space === undefined) return
    showPopup(createCard, { type: type._id, space: space._id, allowChangeSpace: false }, 'top', (res) => {
      if (typeof res === 'string') tab = 'mine'
    })
  }

  async function openForm (type: MasterTag): Promise<void> {
    const space = adminSpace(spaces)
    if (space === undefined) return
    await client.update(space, { types: [...space.types, rootType(type._id)] })
  }

  // My applications
  let mine: Card[] = []
  const mineQuery = createQuery()
  $: if (formIds.length > 0) {
    mineQuery.query(
      card.class.Card,
      { _class: { $in: formIds }, createdBy: { $in: me.socialIds } },
      (res) => {
        mine = res
      },
      { sort: { createdOn: SortingOrder.Descending }, limit: 100 }
    )
  } else {
    mineQuery.unsubscribe()
    mine = []
  }

  let executions: Execution[] = []
  const executionQuery = createQuery()
  $: executionQuery.query(plugin.class.Execution, { card: { $in: mine.map((it) => it._id) } }, (res) => {
    executions = res
  })

  let requests: ApproveRequest[] = []
  const requestQuery = createQuery()
  $: requestQuery.query(plugin.class.ApproveRequest, { card: { $in: mine.map((it) => it._id) } }, (res) => {
    requests = res
  })

  // Waiting for me
  let todo: ApproveRequest[] = []
  const todoQuery = createQuery()
  todoQuery.query(plugin.class.ApproveRequest, { user: myPerson, doneOn: null }, (res) => {
    todo = res
  })

  // One entry per card: a person in several departments can get the same step twice.
  $: todoGroups = [...new Set(todo.map((it) => it.card))].map((cardId) => todo.filter((it) => it.card === cardId))

  let todoCards: Card[] = []
  const todoCardQuery = createQuery()
  $: todoCardQuery.query(card.class.Card, { _id: { $in: todo.map((it) => it.card) } }, (res) => {
    todoCards = res
  })

  let states: State[] = []
  const stateQuery = createQuery()
  $: stateQuery.query(plugin.class.State, { _id: { $in: executions.map((it) => it.currentState) } }, (res) => {
    states = res
  })

  let persons: Person[] = []
  const personQuery = createQuery()
  $: personQuery.query(contact.class.Person, { _id: { $in: requests.map((it) => it.user) } }, (res) => {
    persons = res
  })

  function personName (id: Ref<Person>, list: Person[]): string {
    const person = list.find((it) => it._id === id)
    return person !== undefined ? formatName(person.name) : '?'
  }

  interface Status {
    text: string
    tone: 'done' | 'wait' | 'bad' | 'none'
    note?: string
  }

  function statusOf (
    doc: Card,
    execs: Execution[],
    reqs: ApproveRequest[],
    stateList: State[],
    people: Person[],
    lang: string
  ): Status {
    const zh = lang === 'zh'
    const exec = execs
      .filter((it) => it.card === doc._id)
      .sort((a, b) => (b.createdOn ?? b.modifiedOn) - (a.createdOn ?? a.modifiedOn))[0]
    if (exec === undefined) return { text: zh ? '未开始' : 'Not started', tone: 'none' }
    const state = stateList.find((it) => it._id === exec.currentState)?.title ?? ''
    const rejected = reqs.find((it) => it.card === doc._id && it.execution === exec._id && it.approved === false)
    const note = rejected?.reason !== undefined && rejected.reason !== '' ? rejected.reason : undefined
    if (exec.error != null && exec.error.length > 0) return { text: zh ? '出错，请联系管理员' : 'Error, ask an admin', tone: 'bad' }
    if (exec.status === 'cancelled') {
      const wasApproved = reqs.some((it) => it.execution === exec._id && it.approved === true)
      const why = (exec as any).cancelReason
      return {
        text: wasApproved ? (zh ? '已取消' : 'Cancelled') : zh ? '已撤回' : 'Withdrawn',
        tone: 'none',
        note: typeof why === 'string' && why !== '' ? why : undefined
      }
    }
    if (exec.status === 'done') return { text: state, tone: rejected !== undefined ? 'bad' : 'done', note }
    const waiting = reqs.filter((it) => it.card === doc._id && it.execution === exec._id && it.doneOn == null)
    if (waiting.length > 0) {
      if (waiting.every((it) => it.user === myPerson)) {
        return { text: state, tone: 'wait', note: zh ? '等你处理：去「等我审批」' : 'Your turn: see "Waiting for me"' }
      }
      const names = [...new Set(waiting.map((it) => personName(it.user, people)))].join('、')
      return { text: state, tone: 'wait', note: zh ? `等 ${names} 审批` : `Waiting for ${names}` }
    }
    return { text: state, tone: rejected !== undefined ? 'bad' : 'wait', note }
  }

  function latestExecution (doc: Card, execs: Execution[]): Execution | undefined {
    return execs
      .filter((it) => it.card === doc._id)
      .sort((a, b) => (b.createdOn ?? b.modifiedOn) - (a.createdOn ?? a.modifiedOn))[0]
  }

  // Before anybody decided: change or withdraw. After an approval: ask to cancel.
  function actionsOf (doc: Card, execs: Execution[], reqs: ApproveRequest[]): 'open' | 'approved' | 'none' {
    const exec = latestExecution(doc, execs)
    if (exec === undefined || exec.status === 'cancelled') return 'none'
    const mine = reqs.filter((it) => it.execution === exec._id)
    if (mine.some((it) => it.approved === false)) return 'none'
    if (mine.some((it) => it.approved === true)) return 'approved'
    return exec.status === 'active' ? 'open' : 'none'
  }

  function change (doc: Card): void {
    showPopup(EditApplicationPopup, { value: doc }, 'top')
  }

  function stop (doc: Card, approved: boolean): void {
    const exec = latestExecution(doc, executions)
    if (exec === undefined) return
    showPopup(StopApplicationPopup, { execution: exec, title: doc.title, approved }, 'top')
  }

  function newForm (): void {
    showPopup(NewFormWizard, { space: adminSpace(spaces) }, 'top')
  }

  // A step that came back to the applicant (an admin's own application, or nobody else fits):
  // pass it directly (the record keeps who did it) or hand it to someone else.
  function isOwn (doc: Card): boolean {
    return doc.createdBy !== undefined && me.socialIds.includes(doc.createdBy)
  }

  async function passDirectly (reqs: ApproveRequest[]): Promise<void> {
    const reason = $languageStore === 'zh' ? '无需审批，直接通过' : 'No approval needed'
    for (const req of reqs) {
      await client.update(req, { doneOn: Date.now(), approved: true, reason })
    }
  }

  async function handTo (reqs: ApproveRequest[], person: Ref<Employee> | null): Promise<void> {
    if (person == null) return
    for (const req of reqs) {
      if (person !== req.user) await client.update(req, { user: person })
    }
  }

  // Same signature dialog as Huly's own buttons, applied to every request of this card at once.
  function decide (ev: MouseEvent, reqs: ApproveRequest[], isRejection: boolean): void {
    showPopup(SignatureDialog, { isRejection }, eventToHTMLElement(ev), async (res) => {
      if (res == null || res === false) return
      const { rejectionNote } = res
      if (isRejection && rejectionNote == null) return
      for (const req of reqs) {
        await client.update(req, {
          doneOn: Date.now(),
          approved: !isRejection,
          reason: isRejection ? rejectionNote : undefined
        })
      }
    })
  }

  function typeLabel (doc: Card): IntlString {
    return h.getClass(doc._class).label
  }

  function shownKeys (doc: Card): string[] {
    return [...h.getAllAttributes(doc._class, card.class.Card).entries()]
      .filter(([key, attr]) => attr.hidden !== true && !['title', 'content', 'parent'].includes(key))
      .filter(([key]) => {
        const value = (doc as any)[key]
        return value !== undefined && value !== null && value !== '' && !(Array.isArray(value) && value.length === 0)
      })
      .map(([key]) => key)
      .slice(0, 6)
  }

  function when (doc: Card): string {
    return new Date(doc.createdOn ?? doc.modifiedOn).toLocaleString($languageStore === 'zh' ? 'zh-CN' : 'en-US', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  }
</script>

<div class="hulyComponent apps">
  <Header>
    <span class="title">{L('申请', 'Applications')}</span>
  </Header>
  <Scroller>
    <div class="body">
      <div class="section-head">
        <div class="section-title">{L('我要申请', 'New application')}</div>
        {#if canBuildForms}
          <button class="new-form" on:click={newForm}>+ {L('新建申请表', 'New form')}</button>
        {/if}
      </div>
      {#if forms.length === 0}
        <div class="hint">
          {L(
            '还没有可以用的申请表。管理员可以在 设置 → 类型 里建一种卡片，再给它加一个过程（审批流程）。',
            'No forms yet. An admin can create a card type in Settings → Types and add a process to it.'
          )}
        </div>
      {/if}
      <div class="forms">
        {#each forms as form (form._id)}
          {@const space = spaceFor(form._id, spaces)}
          <div class="form" class:off={space === undefined}>
            <button class="form-main" disabled={space === undefined} on:click={() => { apply(form) }}>
              <span class="form-icon"><Icon icon={form.icon ?? card.icon.MasterTag} size="medium" /></span>
              <span class="form-name"><Label label={form.label} /></span>
            </button>
            {#if space === undefined}
              <div class="form-off">
                {#if isOwner && adminSpace(spaces) !== undefined}
                  <button class="link" on:click={() => openForm(form)}>{L('一键开放给大家', 'Open to everyone')}</button>
                {:else}
                  {L('还没开放，请联系管理员', 'Not open yet, ask an admin')}
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>

      <div class="tabs">
        <button class:selected={tab === 'mine'} on:click={() => (tab = 'mine')}>
          {L('我的申请', 'My applications')} ({mine.length})
        </button>
        <button class:selected={tab === 'todo'} on:click={() => (tab = 'todo')}>
          {L('等我审批', 'Waiting for me')}
          {#if todoGroups.length > 0}<span class="badge">{todoGroups.length}</span>{/if}
        </button>
        {#if departmentForms.length > 0}
          <Button label={plugin.string.DepartmentApplications} selected={tab === 'department'}
            on:click={() => { tab = 'department' }} />
        {/if}
      </div>

      {#if tab === 'department'}
        <div class="section-head">
          <DropdownLabelsIntl label={plugin.string.DepartmentApplicationsStatus}
            items={departmentStatusOptions} selected={departmentStatus}
            on:selected={(event) => { selectDepartmentStatus(event.detail) }} />
        </div>
        {#each departmentForms as form (form._id)}
          <div class="section-title"><Label label={form.label} /></div>
          {#each filteredDepartmentCards.filter(({ doc }) => h.isDerived(doc._class, form._id)) as { doc, status } (doc._id)}
            <div class="row">
              <span class="row-title">{doc.title}</span>
              <PersonIdPresenter value={doc.createdBy} />
              <span class="status" class:done={status === 'done'} class:bad={status === 'cancelled'} class:wait={status === 'active'}>
                <Label label={departmentStatuses[status]} />
              </span>
              <span class="row-when">{when(doc)}</span>
            </div>
          {:else}
            <p class="hint"><Label label={plugin.string.DepartmentApplicationsEmpty} /></p>
          {/each}
        {/each}
      {:else if tab === 'mine'}
        {#if mine.length === 0}
          <div class="hint">{L('还没有申请。点上面的按钮开始。', 'Nothing yet. Pick a form above to start.')}</div>
        {/if}
        {#each mine as doc (doc._id)}
          {@const st = statusOf(doc, executions, requests, states, persons, $languageStore)}
          {@const can = actionsOf(doc, executions, requests)}
          <div class="row">
            <button class="row-open" on:click={() => openDoc(h, doc)}>
              <span class="row-type"><Label label={typeLabel(doc)} /></span>
              <span class="row-title">{doc.title}</span>
              <span class="row-when">{when(doc)}</span>
              <span class="status {st.tone}">{st.text === '' ? '—' : st.text}</span>
              <span class="row-note">{st.note ?? ''}</span>
            </button>
            <span class="row-actions">
              {#if can === 'open'}
                <button class="small" on:click={() => { change(doc) }}>{L('修改', 'Change')}</button>
                <button class="small" on:click={() => { stop(doc, false) }}>{L('撤回', 'Withdraw')}</button>
              {:else if can === 'approved'}
                <button class="small" on:click={() => { stop(doc, true) }}>{L('申请取消', 'Cancel')}</button>
              {/if}
            </span>
          </div>
        {/each}
      {:else}
        {#if todoGroups.length === 0}
          <div class="hint">{L('没有等你审批的申请。', 'Nothing is waiting for you.')}</div>
        {/if}
        {#each todoGroups as reqs (reqs[0]._id)}
          {@const req = reqs[0]}
          {@const doc = todoCards.find((it) => it._id === req.card)}
          {#if doc !== undefined}
            <div class="todo">
              <div class="todo-head">
                <span class="row-type"><Label label={typeLabel(doc)} /></span>
                <button class="todo-title" on:click={() => openDoc(h, doc)}>{doc.title}</button>
                <span class="row-when">{when(doc)}</span>
                <PersonIdPresenter value={doc.createdBy} />
              </div>
              {#if shownKeys(doc).length > 0}
                <div class="fields">
                  {#each shownKeys(doc) as key (key)}
                    <AttributeBarEditor {key} _class={doc._class} object={doc} readonly kind="no-border" size="small" />
                  {/each}
                </div>
              {/if}
              <div class="todo-actions">
                {#if isOwn(doc)}
                  <span class="own-hint">{L('这是你自己的申请：', 'This is your own application:')}</span>
                  <button class="pass" on:click={() => passDirectly(reqs)}>{L('无需审批，直接通过', 'No approval needed')}</button>
                  <UserBox
                    _class={contact.mixin.Employee}
                    label={getEmbeddedLabel(L('换人审批', 'Hand to someone'))}
                    placeholder={getEmbeddedLabel(L('选一个人', 'Pick a person'))}
                    value={null}
                    excluded={[req.user]}
                    kind="regular"
                    size="medium"
                    showNavigate={false}
                    on:change={(e) => handTo(reqs, e.detail)}
                  />
                {:else}
                  <Button
                    label={req.actionType === 'review' ? plugin.string.Review : plugin.string.Approve}
                    kind="positive"
                    on:click={(ev) => { decide(ev, reqs, false) }}
                  />
                  <Button label={plugin.string.Reject} kind="negative" on:click={(ev) => { decide(ev, reqs, true) }} />
                {/if}
              </div>
            </div>
          {/if}
        {/each}
      {/if}
    </div>
  </Scroller>
</div>

<style lang="scss">
  .apps .title {
    font-weight: 600;
    font-size: 1rem;
    color: var(--theme-caption-color);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1.25rem 1.5rem 2rem;
    max-width: 60rem;
  }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .new-form {
    padding: 0.375rem 0.75rem;
    border-radius: 0.375rem;
    background: var(--primary-button-default);
    color: #fff;
    font-weight: 500;
  }
  .row-open {
    display: contents;
    text-align: left;
    color: inherit;
  }
  .row-actions {
    display: flex;
    gap: 0.375rem;
    justify-content: flex-end;
  }
  .small {
    padding: 0.25rem 0.625rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    font-size: 0.75rem;
    color: var(--theme-content-color);
    white-space: nowrap;
    &:hover {
      background: var(--theme-button-hovered);
    }
  }
  .section-title {
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .hint {
    color: var(--theme-dark-color);
    padding: 0.5rem 0;
  }
  .forms {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    gap: 0.75rem;
  }
  .form {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.75rem;
    background: var(--theme-button-default);
    overflow: hidden;
    &.off {
      opacity: 0.75;
    }
  }
  .form-main {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1.25rem 0.5rem;
    color: var(--theme-caption-color);
    font-size: 1rem;
    font-weight: 500;
    &:not(:disabled):hover {
      background: var(--theme-button-hovered);
    }
    &:disabled {
      cursor: default;
    }
  }
  .form-icon {
    display: flex;
    color: var(--theme-primary-default, var(--primary-button-default));
  }
  .form-off {
    padding: 0.375rem 0.5rem;
    font-size: 0.75rem;
    text-align: center;
    color: var(--theme-dark-color);
    border-top: 1px solid var(--theme-divider-color);
  }
  .link {
    color: var(--theme-link-color, var(--primary-button-default));
    text-decoration: underline;
  }
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
    border-bottom: 1px solid var(--theme-divider-color);
    button {
      padding: 0.5rem 0.75rem;
      color: var(--theme-dark-color);
      border-bottom: 2px solid transparent;
      &.selected {
        color: var(--theme-caption-color);
        border-bottom-color: var(--primary-button-default);
        font-weight: 600;
      }
    }
  }
  .badge {
    display: inline-block;
    min-width: 1.25rem;
    margin-left: 0.25rem;
    padding: 0 0.375rem;
    border-radius: 0.625rem;
    background: var(--theme-error-color, #eb5757);
    color: #fff;
    font-size: 0.75rem;
  }
  .row {
    display: grid;
    grid-template-columns: 5rem minmax(8rem, 1fr) 7rem auto minmax(6rem, 14rem) auto;
    align-items: center;
    gap: 0.75rem;
    padding: 0.625rem 0.75rem;
    text-align: left;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
    color: var(--theme-content-color);
    &:hover {
      background: var(--theme-button-hovered);
    }
  }
  .row-type {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .row-title {
    color: var(--theme-caption-color);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-when {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .row-note {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status {
    padding: 0.125rem 0.5rem;
    border-radius: 0.625rem;
    font-size: 0.75rem;
    white-space: nowrap;
    &.done {
      background: rgba(39, 174, 96, 0.15);
      color: #27ae60;
    }
    &.wait {
      background: rgba(242, 153, 74, 0.15);
      color: #f2994a;
    }
    &.bad {
      background: rgba(235, 87, 87, 0.15);
      color: #eb5757;
    }
    &.none {
      background: var(--theme-button-default);
      color: var(--theme-dark-color);
    }
  }
  .todo {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.75rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
  }
  .todo-head {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }
  .todo-title {
    color: var(--theme-caption-color);
    font-weight: 600;
    text-decoration: underline;
  }
  .fields {
    display: grid;
    grid-template-columns: minmax(5rem, auto) 1fr;
    align-items: center;
    gap: 0.25rem 1rem;
  }
  .todo-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    justify-content: flex-end;
  }
  .own-hint {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .pass {
    padding: 0.375rem 0.875rem;
    border-radius: 0.375rem;
    background: var(--theme-positive-color, #27ae60);
    color: #fff;
    font-weight: 500;
  }
  @media (max-width: 640px) {
    .body {
      padding: 1rem;
    }
    .row {
      grid-template-columns: 1fr auto;
    }
    .row-type,
    .row-when {
      display: none;
    }
    .row-note,
    .row-actions {
      grid-column: 1 / -1;
    }
  }
</style>
