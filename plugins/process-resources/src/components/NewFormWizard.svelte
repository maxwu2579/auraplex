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
  // New form in one go: name, fields and who approves. Builds the card type, its fields and an
  // approval process (department admin, then optionally the department supervisor) and opens it.
  import card, { type CardSpace, type MasterTag } from '@hcengineering/card'
  import core, { ClassifierKind, generateId, type Class, type Doc, type Mixin, type AnyAttribute, type Data, type Ref, type Type } from '@hcengineering/core'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { Card, createQuery, getClient } from '@hcengineering/presentation'
  import { type ApproveRequest, type Process, type State, type Transition } from '@hcengineering/process'
  import { makeRank } from '@hcengineering/rank'
  import { Label, ModernCheckbox, getColorNumberByText, languageStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import plugin from '../plugin'
  import { addHrCalendarFields } from '../hrCalendarFields'

  export let space: CardSpace | undefined = undefined

  const client = getClient()

  // Auraplex: read department responsibilities without a dependency on the department UI.
  interface Department extends Doc {
    name: string
  }
  interface ResponsibleDepartment extends Department {
    archived?: boolean
    applicationTypes?: Array<Ref<Doc>>
  }
  const departmentClass = 'hr:class:Department' as Ref<Class<Department>>
  const departmentAccess = 'departments:mixin:DepartmentAccess' as Ref<Mixin<ResponsibleDepartment>>
  let departments: ResponsibleDepartment[] = []

  const hierarchy = client.getHierarchy()
  let responsibleIds = new Set<Ref<Doc>>()
  if (hierarchy.hasClass(departmentClass) && hierarchy.hasClass(departmentAccess)) {
    createQuery().query(departmentClass, {}, (docs) => {
      departments = docs.flatMap((doc) => hierarchy.asIf(doc, departmentAccess) ?? [])
        .filter((department) => !department.archived)
    })
  }

  function selectDepartment (id: Ref<Doc>, checked: boolean): void {
    const updated = new Set(responsibleIds)
    if (checked) updated.add(id)
    else updated.delete(id)
    responsibleIds = updated
  }

  const dispatch = createEventDispatcher()
  $: L = (zh: string, en: string): string => ($languageStore === 'zh' ? zh : en)

  type Kind = 'text' | 'number' | 'date' | 'yesno'
  interface Field {
    name: string
    kind: Kind
    required: boolean
  }

  let name = ''
  let fields: Field[] = [{ name: '', kind: 'text', required: true }]
  let twoSteps = true
  let recordLeave = false
  let saving = false
  let error = ''

  const kinds: Array<{ id: Kind, zh: string, en: string }> = [
    { id: 'text', zh: '文字', en: 'Text' },
    { id: 'number', zh: '数字', en: 'Number' },
    { id: 'date', zh: '日期', en: 'Date' },
    { id: 'yesno', zh: '是 / 否', en: 'Yes / No' }
  ]

  function typeOf (kind: Kind): Type<any> {
    switch (kind) {
      case 'number':
        return { _class: core.class.TypeNumber, label: core.string.Number, icon: core.icon.TypeNumber }
      case 'date':
        return { _class: core.class.TypeDate, label: core.string.Date, icon: core.icon.TypeDate, mode: 'date', withShift: true } as any
      case 'yesno':
        return { _class: core.class.TypeBoolean, label: core.string.Boolean, icon: core.icon.TypeBoolean }
      default:
        return { _class: core.class.TypeString, label: core.string.String, icon: core.icon.TypeString }
    }
  }

  $: filled = fields.filter((it) => it.name.trim() !== '')
  $: canSave = !saving && name.trim() !== '' && (recordLeave || filled.length > 0)

  async function save (): Promise<void> {
    if (!canSave) return
    saving = true
    error = ''
    try {
      const title = name.trim()
      const ops = client.apply('auraplex-new-form')
      const tag = generateId<MasterTag>()
      await ops.createDoc(
        card.class.MasterTag,
        core.space.Model,
        {
          extends: card.class.Card,
          label: getEmbeddedLabel(title),
          kind: ClassifierKind.CLASS,
          icon: card.icon.MasterTag,
          background: getColorNumberByText(title)
        } as unknown as Data<MasterTag>,
        tag
      )
      for (const field of filled) {
        await ops.createDoc(core.class.Attribute, core.space.Model, {
          attributeOf: tag,
          name: 'custom' + generateId(),
          label: getEmbeddedLabel(field.name.trim()),
          isCustom: true,
          type: typeOf(field.kind),
          readonly: false,
          automationOnly: false,
          required: field.required
        } as unknown as Data<AnyAttribute>)
      }

      const hrCalendar = recordLeave ? await addHrCalendarFields(ops, tag, $languageStore === 'zh') : undefined

      // The approval process.
      const proc = generateId<Process>()
      const st = {
        admin: generateId<State>(),
        supervisor: generateId<State>(),
        done: generateId<State>(),
        back: generateId<State>()
      }
      const ctx1 = generateId()
      const ctx2 = generateId()
      const act1 = generateId()
      const act2 = generateId()
      const tStart = generateId<Transition>()
      const tNext = generateId<Transition>()
      const request = (action: string, ctx: string, fn: string): any => ({
        _id: action,
        context: { _class: plugin.class.ApproveRequest, _id: ctx },
        methodId: plugin.method.RequestApproval,
        params: { user: `\${=>${fn}()}` }
      })
      const ctxEntry = (ctx: string, action: string, index: number, producer: string): any => ({
        _class: plugin.class.ApproveRequest,
        action,
        index,
        name: '',
        producer,
        value: { id: ctx, key: '', type: 'context' }
      })
      const context: Record<string, any> = { [ctx1]: ctxEntry(ctx1, act1, 1, tStart) }
      if (twoSteps) context[ctx2] = ctxEntry(ctx2, act2, 2, tNext)
      await ops.createDoc(
        plugin.class.Process,
        core.space.Model,
        {
          masterTag: tag,
          name: title + L('审批', ' approval'),
          description: '',
          autoStart: true,
          parallelExecutionForbidden: true,
          context,
          ...(hrCalendar !== undefined ? { hrCalendar } : {})
        } as unknown as Data<Process>,
        proc
      )
      const states: Array<[Ref<State>, string]> = twoSteps
        ? [
            [st.admin, L('待管理员审批', 'Waiting for admin')],
            [st.supervisor, L('待主管处理', 'Waiting for supervisor')],
            [st.done, L('已完成', 'Done')],
            [st.back, L('已退回', 'Returned')]
          ]
        : [
            [st.admin, L('待管理员审批', 'Waiting for admin')],
            [st.done, L('已批准', 'Approved')],
            [st.back, L('已退回', 'Returned')]
          ]
      let rank = makeRank(undefined, undefined)
      for (const [id, stateTitle] of states) {
        await ops.createDoc(plugin.class.State, core.space.Model, { process: proc, title: stateTitle, rank } as unknown as Data<State>, id)
        rank = makeRank(rank, undefined)
      }
      const approved = 'process:trigger:OnApproveRequestApproved'
      const rejected = 'process:trigger:OnApproveRequestRejected'
      const transitions: Array<[Ref<Transition> | undefined, Ref<State> | null, Ref<State>, string, Record<string, any>, any[]]> = [
        [tStart, null, st.admin, 'process:trigger:OnExecutionStart', {}, [request(act1, ctx1, 'InitiatorDepartmentAdmin')]]
      ]
      if (twoSteps) {
        transitions.push(
          [tNext, st.admin, st.supervisor, approved, { _id: `\${$context(${ctx1})}` }, [request(act2, ctx2, 'InitiatorDepartmentSupervisor')]],
          [undefined, st.supervisor, st.done, approved, { _id: `\${$context(${ctx2})}` }, []],
          [undefined, st.admin, st.back, rejected, { _id: `\${$context(${ctx1})}` }, []],
          [undefined, st.supervisor, st.back, rejected, { _id: `\${$context(${ctx2})}` }, []]
        )
      } else {
        transitions.push(
          [undefined, st.admin, st.done, approved, { _id: `\${$context(${ctx1})}` }, []],
          [undefined, st.admin, st.back, rejected, { _id: `\${$context(${ctx1})}` }, []]
        )
      }
      rank = makeRank(undefined, undefined)
      for (const [id, from, to, trigger, triggerParams, actions] of transitions) {
        await ops.createDoc(
          plugin.class.Transition,
          core.space.Model,
          { process: proc, from, to, trigger, triggerParams, actions, rank } as unknown as Data<Transition>,
          id ?? generateId<Transition>()
        )
        rank = makeRank(rank, undefined)
      }
      for (const department of departments) {
        if (!responsibleIds.has(department._id)) continue
        ops.match(departmentClass, { _id: department._id, modifiedOn: department.modifiedOn })
        await ops.updateMixin(department._id, departmentClass, department.space, departmentAccess, {
          applicationTypes: [...new Set([...(department.applicationTypes ?? []), tag])]
        })
      }
      if (!(await ops.commit()).result) throw new Error('Application form data changed before saving')


      // Open it to everyone right away.
      if (space !== undefined && !space.types.includes(tag)) {
        await client.update(space, { types: [...space.types, tag] })
      }
      dispatch('close', tag)
    } catch (err: any) {
      console.error(err)
      error = L('没建成，请稍后再试或联系管理员。', 'Could not create it, please try again.')
    } finally {
      saving = false
    }
  }

  function addField (): void {
    fields = [...fields, { name: '', kind: 'text', required: true }]
  }

  function removeField (index: number): void {
    fields = fields.filter((_, i) => i !== index)
  }
</script>

<Card
  label={getEmbeddedLabel(L('新建申请表', 'New form'))}
  okLabel={getEmbeddedLabel(L('完成', 'Create'))}
  okAction={save}
  {canSave}
  on:close={() => dispatch('close')}
  on:changeContent
>
  <div class="wizard">
    <div class="step">
      <div class="step-title">1. {L('叫什么名字', 'Name')}</div>
      <input class="input" bind:value={name} placeholder={L('比如：出差、领用物品', 'e.g. Business trip')} />
    </div>

    <div class="step">
      <div class="step-title">2. {L('要填哪些内容', 'What to fill in')}</div>
      <div class="hint">{L('标题每张单都有，不用加。', 'Every form already has a title.')}</div>
      {#each fields as field, i}
        <div class="field">
          <input class="input" bind:value={field.name} placeholder={L('名称，比如：目的地', 'Name, e.g. Destination')} />
          <select class="select" bind:value={field.kind}>
            {#each kinds as k}
              <option value={k.id}>{L(k.zh, k.en)}</option>
            {/each}
          </select>
          <label class="check"><input type="checkbox" bind:checked={field.required} /> {L('必填', 'Required')}</label>
          <button class="remove" title={L('删掉', 'Remove')} on:click={() => { removeField(i) }}>✕</button>
        </div>
      {/each}
      <button class="add" on:click={addField}>+ {L('再加一项', 'Add a field')}</button>
      <label class="check">
        <input type="checkbox" bind:checked={recordLeave} />
        {L('批准后记入人事日历（请假用）', 'Add to the HR calendar after approval')}
      </label>
      {#if recordLeave}
        <div class="hint">{L('自动添加必填的开始日期、结束日期和假期类型。', 'Start date, end date, and leave type will be required.')}</div>
      {/if}
    </div>

    <div class="step">
      <div class="step-title">3. {L('谁来审批', 'Who approves')}</div>
      <label class="radio">
        <input type="radio" bind:group={twoSteps} value={true} />
        {L('部门管理员审批 → 部门主管处理（比如财务记录、去办）', 'Department admin approves, then the supervisor handles it')}
      </label>
      <label class="radio">
        <input type="radio" bind:group={twoSteps} value={false} />
        {L('只要部门管理员审批', 'Only the department admin approves')}
      </label>
      <div class="hint">
        {L(
          '管理员自己提交时会交回给自己，可以"直接通过"或"换人审批"。建好以后马上出现在申请页面，以后想细调可以去 设置 → 类型。',
          'Admins get their own step back to pass or hand on. The form shows up right away; fine-tune it later in Settings → Types.'
        )}
      </div>
    </div>
    <div class="step">
      <div class="step-title">4. <Label label={plugin.string.DepartmentApplicationsWizard} /></div>
      <p class="hint"><Label label={plugin.string.DepartmentApplicationsWizardHint} /></p>
      {#each departments as department (department._id)}
        <ModernCheckbox label={department.name} checked={responsibleIds.has(department._id)} disabled={saving}
          on:change={() => { selectDepartment(department._id, !responsibleIds.has(department._id)) }} />
      {/each}
    </div>
    {#if error !== ''}<div class="error">{error}</div>{/if}
  </div>
</Card>

<style lang="scss">
  .wizard {
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
    min-width: min(36rem, 90vw);
  }
  .step {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .step-title {
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .hint {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .input,
  .select {
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background: var(--theme-bg-color);
    color: var(--theme-caption-color);
  }
  .select option {
    background: var(--theme-bg-color);
    color: var(--theme-caption-color);
  }
  .field {
    display: grid;
    grid-template-columns: 1fr 7rem auto auto;
    gap: 0.5rem;
    align-items: center;
  }
  .check,
  .radio {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    color: var(--theme-content-color);
  }
  .remove {
    padding: 0.25rem 0.5rem;
    color: var(--theme-dark-color);
  }
  .add {
    align-self: flex-start;
    color: var(--theme-link-color, var(--primary-button-default));
  }
  .error {
    color: var(--theme-error-color, #eb5757);
  }
  @media (max-width: 640px) {
    .field {
      grid-template-columns: 1fr 1fr;
    }
    /* Auraplex: phones - fit the dialog so long hints wrap instead of being cut off. */
    .wizard {
      min-width: 0;
    }
    .radio {
      align-items: flex-start;
    }
  }
</style>
