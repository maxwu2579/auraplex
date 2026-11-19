<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import core, {
    AccountRole, companyModuleDefault, companyModuleRole, type CompanyModuleDefaults, type AccountUuid, type Class, type Doc, type Ref,
    type DepartmentModuleDefaults, type DepartmentModuleException, type ModuleExtra, type ModuleLevel,
    canChangeDepartmentModuleException, departmentModuleGrantClass, departmentModuleSettingsClass,
    departmentModuleSettingsId, effectiveDepartmentModules, normalizeModuleExtra, getCurrentAccount
  } from '@hcengineering/core'
  import { translate, type IntlString } from '@hcengineering/platform'
  import setting from '../plugin'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Button, Label, languageStore, Toggle } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  export let person: AccountUuid
  export let name: string
  export let role: AccountRole
  export let departments: Array<DepartmentModuleDefaults & { name: string }>

  type Grant = Doc & { person: AccountUuid, extra: ModuleExtra, blocked: string[] }
  type Settings = Doc & { enabled: boolean, companyDefaults?: CompanyModuleDefaults }
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
  let defaults: CompanyModuleDefaults | undefined
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
      defaults = rows[0]?.companyDefaults
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
  $: final = effectiveDepartmentModules(person, role === AccountRole.Owner, enabled, departments, { extra, blocked }, companyModuleDefault(defaults, role))
  $: ceiling = effectiveDepartmentModules(actor.uuid, owner, true, departments, actorGrant, companyModuleDefault(defaults, actor.role))
  const roleOptions = [
    { key: 'admin', label: setting.string.MemberPageAdministrator }, { key: 'supervisor', label: setting.string.MemberPageSupervisor },
    { key: 'employee', label: setting.string.MemberPageStaff }, { key: 'reader', label: setting.string.MemberPageGuest }
  ] as const
  const finalLevels: Array<{ level: ModuleLevel, label: string }> = [
    { level: 'edit', label: setting.string.MemberPageCanEdit }, { level: 'view', label: setting.string.MemberPageViewOnly }, { level: 'none', label: setting.string.MemberPageUnavailable }
  ]
  $: exceptionCount = new Set([...Object.keys(extra), ...blocked]).size
  $: sources = selectedDepartments.map((dept) => ({
    name: dept.name,
    roles: roleOptions.filter(({ key }) => dept.members[key].includes(person)).map(({ label }) => label),
    access: effectiveDepartmentModules(person, false, true, [dept])
  }))

  function levelText (alias: string, level: ModuleLevel): IntlString {
    if (level === 'none') return setting.string.MemberPageUnavailable
    if (!ownedModules.has(alias)) return setting.string.MemberPageAvailable
    return level === 'edit' ? setting.string.MemberPageCanEdit : setting.string.MemberPageViewOnly
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
      error = await translate(setting.string.MemberPageGrantScope, {}, $languageStore)
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
      error = await translate(setting.string.MemberPageGrantFailed, {}, $languageStore)
    } finally {
      busy = false
    }
  }
</script>

<aside aria-labelledby="member-permission-title" class="permission-panel">
  <header>
    <h3 id="member-permission-title">{name} · <Label label={setting.string.MemberPagePermissions} /></h3>
    <Button kind="regular" on:click={() => dispatch('close')}><span slot="content"><Label label={setting.string.MemberPageClose} /></span></Button>
  </header>
  <small><Label label={enabled ? setting.string.MemberPageControlEnabled : setting.string.MemberPageControlDisabled} /></small>
  <section  class="result">
    {#each finalLevels as { level, label }}
      <div class="result-row">
        <strong><Label {label} /></strong>
        <div class="tags">
          {#each apps.filter(({ alias }) => final(alias) === level) as app (app.alias)}
            <span class="tag"><Label label={app.label} /></span>
          {:else}—{/each}
        </div>
      </div>
    {/each}
  </section>
  <details>
    <summary><Label label={setting.string.MemberPageFromDepartments} /></summary>
    {#each sources as source}
      <details class="department-source">
        <summary>{source.name}（{#each source.roles as role, index}{index > 0 ? ' / ' : ''}<Label label={role} />{/each}）</summary>
        <ul>
          {#each apps.filter(({ alias }) => source.access(alias) !== 'none') as app (app.alias)}
            <li><Label label={app.label} /> · <Label label={levelText(app.alias, source.access(app.alias))} /></li>
          {:else}<li><Label label={setting.string.MemberPageNoModules} /></li>{/each}
        </ul>
      </details>
    {:else}<p><Label label={companyModuleDefault(defaults, role) === undefined ? setting.string.MemberPageNoDepartment :
      companyModuleRole(role) === 'maintainer' ? setting.string.MemberPageCompanyAdminDefault : setting.string.MemberPageCompanyStaffDefault} /></p>{/each}
  </details>
  <details>
    <summary><Label label={setting.string.MemberPageExceptions} params={{ count: exceptionCount }} /></summary>
  {#if isConfigured && loaded}
    <table>
      <thead><tr><th><Label label={setting.string.MemberPageModule} /></th><th><Label label={setting.string.MemberPageExtra} /></th><th><Label label={setting.string.MemberPageBlock} /></th></tr></thead>
      <tbody>
        {#each apps as app (app.alias)}
          <tr>
            <th><Label label={app.label} /></th>
            <td><select aria-label={app.alias} value={extra[app.alias] ?? ''} disabled={!editable || busy}
              on:change={(event) => changeExtra(app.alias, event.currentTarget.value)}>
              <option value=""><Label label={setting.string.MemberPageNoExtra} /></option>
              {#if ownedModules.has(app.alias) || extra[app.alias] === 'view'}
                <option value="view" disabled={ceiling(app.alias) === 'none'}><Label label={setting.string.MemberPageViewOnly} /></option>
              {/if}
              <option value="edit" disabled={ceiling(app.alias) !== 'edit'}><Label label={ownedModules.has(app.alias) ? setting.string.MemberPageCanEdit : setting.string.MemberPageAvailable} /></option>
            </select></td>
            <td><Toggle on={blocked.includes(app.alias)} disabled={!editable || busy}
              on:change={(event) => { blocked = event.detail ? [...new Set([...blocked, app.alias])] : blocked.filter((alias) => alias !== app.alias) }} /></td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if editable}
      <Button kind="regular" disabled={busy} on:click={save}><span slot="content"><Label label={setting.string.MemberPageSaveExceptions} /></span></Button>
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
