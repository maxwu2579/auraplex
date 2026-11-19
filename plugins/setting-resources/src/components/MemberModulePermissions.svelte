<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import core, {
    AccountRole, type AccountUuid, type Class, type Doc, type Ref,
    type DepartmentModuleDefaults, type DepartmentModuleException, type ModuleExtra, type ModuleLevel,
    canChangeDepartmentModuleException, departmentModuleGrantClass, departmentModuleSettingsClass,
    departmentModuleSettingsId, effectiveDepartmentModules, normalizeModuleExtra, getCurrentAccount
  } from '@hcengineering/core'
  import type { IntlString } from '@hcengineering/platform'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Button, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  export let person: AccountUuid
  export let name: string
  export let role: AccountRole
  export let departments: Array<DepartmentModuleDefaults & { name: string }>

  type Grant = Doc & { person: AccountUuid, extra: ModuleExtra, blocked: string[] }
  type Settings = Doc & { enabled: boolean }
  type Application = Doc & { alias: string, label: IntlString, hidden: boolean }
  const client = getClient()
  const actor = getCurrentAccount()
  const dispatch = createEventDispatcher<{ close: void }>()
  const grantClass = departmentModuleGrantClass as Ref<Class<Grant>>
  const settingsClass = departmentModuleSettingsClass as Ref<Class<Settings>>
  const idFor = (id: AccountUuid): Ref<Grant> => ('departments:module-grant:' + id) as Ref<Grant>
  const apps = client.getModel().findAllSync('workbench:class:Application' as Ref<Class<Application>>,
    { hidden: false }).map(({ alias, label }) => ({ alias, label })).filter(({ alias }) => alias !== '')
  if (!apps.some(({ alias }) => alias === 'whatsapp')) {
    apps.push({ alias: 'whatsapp', label: 'whatsapp:string:Whatsapp' as IntlString })
  }
  const ownedModules = new Set(['orders', 'tracking', 'materials', 'prospects'])
  let grant: Grant | undefined
  let actorGrant: Grant | undefined
  let extra: ModuleExtra = {}
  let blocked: string[] = []
  let enabled = false
  let loaded = false
  let busy = false
  let error = ''
  const owner = actor.role === AccountRole.Owner
  const grantId = idFor(person)
  let original: DepartmentModuleException = { extra: {}, blocked: [] }
  const isConfigured = client.getHierarchy().hasClass(grantClass)
  if (isConfigured) {
    createQuery().query(settingsClass, { _id: departmentModuleSettingsId as Ref<Settings> }, (rows) => {
      enabled = rows[0]?.enabled === true
    })
    createQuery().query(grantClass, { _id: grantId }, (rows) => {
      if (!loaded) {
        grant = rows[0]
        original = { extra: { ...normalizeModuleExtra(grant?.extra ?? {}) }, blocked: [...(grant?.blocked ?? [])] }
        extra = { ...normalizeModuleExtra(original.extra) }
        blocked = [...original.blocked]
        loaded = true
      }
    })
    if (!owner) createQuery().query(grantClass, { _id: idFor(actor.uuid) }, (rows) => { actorGrant = rows[0] })
  }

  $: selectedDepartments = departments.filter((dept) => !dept.archived &&
    Object.values(dept.members).some((members) => members.includes(person)))
  $: editable = isConfigured && (owner || selectedDepartments.some((dept) => dept.members.admin.includes(actor.uuid)))
  $: final = effectiveDepartmentModules(person, role === AccountRole.Owner, enabled, departments, { extra, blocked })
  $: ceiling = effectiveDepartmentModules(actor.uuid, owner, true, departments, actorGrant)
  const roleOptions = [
    { key: 'admin', label: '管理员' }, { key: 'supervisor', label: '主管' },
    { key: 'employee', label: '员工' }, { key: 'reader', label: '访客' }
  ] as const
  const finalLevels: Array<{ level: ModuleLevel, label: string }> = [
    { level: 'edit', label: '能编辑' }, { level: 'view', label: '只能看' }, { level: 'none', label: '不能用' }
  ]
  $: exceptionCount = new Set([...Object.keys(extra), ...blocked]).size
  $: sources = selectedDepartments.map((dept) => ({
    name: dept.name,
    roles: roleOptions.filter(({ key }) => dept.members[key].includes(person)).map(({ label }) => label),
    access: effectiveDepartmentModules(person, false, true, [dept])
  }))

  function levelText (alias: string, level: ModuleLevel): string {
    if (level === 'none') return '不能用'
    if (!ownedModules.has(alias)) return '能用'
    return level === 'edit' ? '能编辑' : '只能看'
  }

  function changeExtra (alias: string, value: string): void {
    extra = { ...extra }
    if (value === 'view' || value === 'edit') extra[alias] = value
    else delete extra[alias]
  }

  async function save (): Promise<void> {
    if (!editable || !loaded || busy) return
    error = ''
    if (!owner && !canChangeDepartmentModuleException(actor.uuid, person, departments, ceiling, original, { extra, blocked })) {
      error = '只能修改自己管理的部门成员，且不能超出可授予的模块权限。'
      return
    }
    busy = true
    try {
      const ops = client.apply('member-module-permissions')
      if (grant === undefined) {
        ops.notMatch(grantClass, { _id: grantId })
        await ops.createDoc(grantClass, core.space.Workspace, { person, extra, blocked }, grantId)
      } else {
        ops.match(grantClass, { _id: grantId, modifiedOn: grant.modifiedOn })
        await ops.update(grant, { extra, blocked })
      }
      if (!(await ops.commit()).result) throw new Error('Could not save module permissions')
      dispatch('close')
    } catch {
      error = '保存失败。请检查权限，或关闭后重新打开再试。'
    } finally {
      busy = false
    }
  }
</script>

<aside aria-label="成员模块权限" class="permission-panel">
  <header>
    <h3>{name} · 权限</h3>
    <Button kind="regular" on:click={() => dispatch('close')}><span slot="content">关闭</span></Button>
  </header>
  <small>{enabled ? '已启用按部门控制模块。' : '按部门控制模块未开启，以下配置在启用后生效。'}</small>
  <section aria-label="最终权限" class="result">
    {#each finalLevels as { level, label }}
      <div class="result-row">
        <strong>{label}</strong>
        <div class="tags">
          {#each apps.filter(({ alias }) => final(alias) === level) as app (app.alias)}
            <span class="tag"><Label label={app.label} /></span>
          {:else}—{/each}
        </div>
      </div>
    {/each}
  </section>
  <details>
    <summary>来自部门</summary>
    {#each sources as source}
      <details class="department-source">
        <summary>{source.name}（{source.roles.join(' / ')}）</summary>
        <ul>
          {#each apps.filter(({ alias }) => source.access(alias) !== 'none') as app (app.alias)}
            <li><Label label={app.label} /> · {levelText(app.alias, source.access(app.alias))}</li>
          {:else}<li>没有可用模块</li>{/each}
        </ul>
      </details>
    {:else}<p>未加入部门</p>{/each}
  </details>
  <details>
    <summary>个人额外 / 屏蔽（{exceptionCount}）</summary>
  {#if isConfigured && loaded}
    <table>
      <thead><tr><th>模块</th><th>额外给</th><th>单独关掉</th></tr></thead>
      <tbody>
        {#each apps as app (app.alias)}
          <tr>
            <th><Label label={app.label} /></th>
            <td><select aria-label={'额外给 ' + app.alias} value={extra[app.alias] ?? ''} disabled={!editable || busy}
              on:change={(event) => changeExtra(app.alias, event.currentTarget.value)}>
              <option value="">无</option>
              {#if ownedModules.has(app.alias) || extra[app.alias] === 'view'}
                <option value="view" disabled={ceiling(app.alias) === 'none'}>只能看</option>
              {/if}
              <option value="edit" disabled={ceiling(app.alias) !== 'edit'}>{ownedModules.has(app.alias) ? '能编辑' : '能用'}</option>
            </select></td>
            <td><input type="checkbox" aria-label={'单独关掉 ' + app.alias} value={app.alias} bind:group={blocked}
              disabled={!editable || busy} /></td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if editable}
      <Button kind="regular" disabled={busy} on:click={save}><span slot="content">保存个人例外</span></Button>
    {/if}
  {/if}
  {#if error}<p role="alert">{error}</p>{/if}
  </details>
</aside>

<style>
  .permission-panel {
    display: flex; flex-direction: column; overflow: auto; min-height: 0;
    flex: 0 0 min(29rem, 48%); gap: 0.55rem; padding: 1rem;
    color: var(--theme-content-color); background: var(--theme-panel-color); border-inline-start: 1px solid var(--theme-divider-color);
  }
  .result { display: grid; gap: 0.55rem; }
  .result-row { display: grid; grid-template-columns: 4rem minmax(0, 1fr); gap: 0.5rem; align-items: baseline; }
  .tags { display: flex; flex-wrap: wrap; gap: 0.3rem; }
  .tag { background: var(--theme-button-default); color: var(--theme-caption-color); border: 1px solid var(--theme-button-border); border-radius: 0.35rem; padding: 0.15rem 0.35rem; }
  details { border-top: 1px solid var(--theme-divider-color); padding-block: 0.35rem; }
  summary { color: var(--theme-caption-color); cursor: pointer; }
  .department-source { margin-inline-start: 0.85rem; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 0.5rem; }
  h3, h4, p { margin: 0; }
  h3, h4, strong { color: var(--theme-caption-color); }
  ul { margin-block: 0.25rem; padding-inline-start: 1.15rem; }
  th, td { padding: 0.3rem; text-align: start; border-bottom: 1px solid var(--theme-divider-color); }
  select { background: var(--theme-bg-color); color: var(--theme-caption-color); border: 1px solid var(--theme-button-border); }
  [role='alert'] { color: var(--theme-error-color); }
</style>
