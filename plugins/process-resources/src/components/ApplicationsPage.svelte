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
  import contact, { formatName, getCurrentEmployee, type Person } from '@hcengineering/contact'
  import { AccountRole, SortingOrder, getCurrentAccount, type Class, type Doc, type Mixin, type Ref } from '@hcengineering/core'
  import { AttributeBarEditor, createQuery, getClient } from '@hcengineering/presentation'
  import { type ApproveRequest, type Execution, type Process, type State } from '@hcengineering/process'
  import { type IntlString } from '@hcengineering/platform'
  import { Header, Icon, Label, Scroller, languageStore, showPopup, type AnyComponent } from '@hcengineering/ui'
  import { PersonIdPresenter, openDoc } from '@hcengineering/view-resources'
  import ApproveRequestButtons from './ApproveRequestButtons.svelte'
  import plugin from '../plugin'

  const client = getClient()
  const h = client.getHierarchy()
  const me = getCurrentAccount()
  const myPerson = getCurrentEmployee()
  const isOwner = me.role === AccountRole.Owner
  const createCard = 'card:component:CreateCard' as AnyComponent
  const userMixin = 'setting:mixin:UserMixin' as Ref<Mixin<Class<Doc>>>

  $: L = (zh: string, en: string): string => ($languageStore === 'zh' ? zh : en)

  let tab: 'mine' | 'todo' = 'mine'

  // Which forms: card types that have a process people can run.
  let processes: Process[] = []
  const processQuery = createQuery()
  processQuery.query(plugin.class.Process, {}, (res) => {
    processes = res
  })
  $: forms = [...new Set(processes.filter((p) => p.automationOnly !== true).map((p) => p.masterTag))]
    .filter((tag) => h.hasClass(tag) && !h.isMixin(tag) && h.isDerived(tag, card.class.Card))
    // only types an admin made in Settings (built-in ones like user profiles have system processes)
    .filter((tag) => h.hasMixin(h.getClass(tag), userMixin))
    .map((tag) => h.getClass(tag) as MasterTag)
    .filter((tag) => tag.removed !== true)
  $: formIds = forms.map((it) => it._id)

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
    if (exec.status === 'cancelled') return { text: zh ? '已取消' : 'Cancelled', tone: 'none' }
    if (exec.status === 'done') return { text: state, tone: rejected !== undefined ? 'bad' : 'done', note }
    const waiting = reqs.filter((it) => it.card === doc._id && it.execution === exec._id && it.doneOn == null)
    if (waiting.length > 0) {
      const names = waiting.map((it) => personName(it.user, people)).join('、')
      return { text: state, tone: 'wait', note: zh ? `等 ${names} 审批` : `Waiting for ${names}` }
    }
    return { text: state, tone: rejected !== undefined ? 'bad' : 'wait', note }
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
      <div class="section-title">{L('我要申请', 'New application')}</div>
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
          {#if todo.length > 0}<span class="badge">{todo.length}</span>{/if}
        </button>
      </div>

      {#if tab === 'mine'}
        {#if mine.length === 0}
          <div class="hint">{L('还没有申请。点上面的按钮开始。', 'Nothing yet. Pick a form above to start.')}</div>
        {/if}
        {#each mine as doc (doc._id)}
          {@const st = statusOf(doc, executions, requests, states, persons, $languageStore)}
          <button class="row" on:click={() => openDoc(h, doc)}>
            <span class="row-type"><Label label={typeLabel(doc)} /></span>
            <span class="row-title">{doc.title}</span>
            <span class="row-when">{when(doc)}</span>
            <span class="status {st.tone}">{st.text === '' ? '—' : st.text}</span>
            <span class="row-note">{st.note ?? ''}</span>
          </button>
        {/each}
      {:else}
        {#if todo.length === 0}
          <div class="hint">{L('没有等你审批的申请。', 'Nothing is waiting for you.')}</div>
        {/if}
        {#each todo as req (req._id)}
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
                <ApproveRequestButtons todo={req} card={doc._id} />
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
    grid-template-columns: 5rem minmax(8rem, 1fr) 7rem auto minmax(6rem, 14rem);
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
    gap: 0.5rem;
    justify-content: flex-end;
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
    .row-note {
      grid-column: 1 / -1;
    }
  }
</style>
