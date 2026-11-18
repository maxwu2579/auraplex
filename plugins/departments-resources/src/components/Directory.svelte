<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import chunter from '@hcengineering/chunter'
  import { getResource, type IntlString } from '@hcengineering/platform'
  import contact, { formatName, type Channel, type Employee } from '@hcengineering/contact'
  import core, { AccountRole, departmentModuleSettingsId, defaultModuleLevel, moduleRoles, normalizeModuleExtra, type ModuleAccess, type ModuleExtra, type ModuleLevel, type ModuleRole, generateId, getCurrentAccount, type AccountUuid, type Class, type Doc, type Ref } from '@hcengineering/core'
  import departments, { type DepartmentAccess, type DepartmentPermission, type ModuleGrant, type ModuleSettings } from '@hcengineering/departments'
  import hr, { type Department } from '@hcengineering/hr'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Breadcrumb, Header, Label, location } from '@hcengineering/ui'

  type RoleField = 'administrators' | 'supervisors' | 'employees' | 'readers'
  type PermissionField = 'adminPermissions' | 'supervisorPermissions' | 'employeePermissions' | 'readerPermissions'
  type Draft = Pick<DepartmentAccess, RoleField | PermissionField | 'archived' | 'supervisorsSeeTracking' | 'employeesSeeTracking' | 'contactVisibility' | 'modules' | 'moduleAccess'>
  const client = getClient()
  const hierarchy = client.getHierarchy()
  interface ModuleApplication extends Doc {
    alias: string
    label: IntlString
    hidden: boolean
  }
  const applications = client.getModel().findAllSync(
    'workbench:class:Application' as Ref<Class<ModuleApplication>>, { hidden: false }
  ).filter((app) => app.alias !== '')
  const moduleByAlias = new Map(applications.map((app) => [app.alias, app]))
  const me = getCurrentAccount()
  const owner = me.role === AccountRole.Owner
  const rosterQuery = createQuery()
  const departmentQuery = createQuery()
  let channels: Channel[] = []
  createQuery().query(contact.class.Channel, {
    provider: { $in: [contact.channelProvider.Phone, contact.channelProvider.Email, contact.channelProvider.Whatsapp] }
  }, (items) => { channels = items })
  let staff: Employee[] = []
  let rows: DepartmentAccess[] = []
  let selected: DepartmentAccess | undefined
  let draft: Draft | undefined
  let name = ''
  let newName = ''
  let showCreate = false
  let tab: 'members' | 'modules' | 'settings' = 'members'
  let newAdmin = ''
  let busy = false
  let error = false
  let saved = false
  const roles: Array<{
    field: RoleField
    permissions: PermissionField
    label: typeof departments.string.Administrators
  }> = [
    { field: 'administrators', permissions: 'adminPermissions', label: departments.string.Administrators },
    { field: 'supervisors', permissions: 'supervisorPermissions', label: departments.string.Supervisors },
    { field: 'employees', permissions: 'employeePermissions', label: departments.string.Employees },
    { field: 'readers', permissions: 'readerPermissions', label: departments.string.Readers }
  ]
  const permissions: Array<{ value: DepartmentPermission, label: typeof departments.string.CreatePermission }> = [
    { value: 'create', label: departments.string.CreatePermission },
    { value: 'update', label: departments.string.UpdatePermission },
    { value: 'delete', label: departments.string.DeletePermission },
    { value: 'comment', label: departments.string.CommentPermission },
    { value: 'invite', label: departments.string.InvitePermission },
    { value: 'manageMembers', label: departments.string.ManageMembersPermission }
  ]
  rosterQuery.query(contact.mixin.Employee, { active: true }, (items) => {
    staff = items.filter((item) => item.personUuid != null)
  })
  departmentQuery.query(hr.class.Department, {}, (items) => {
    rows = items.flatMap((item) => {
      const access = hierarchy.asIf(item, departments.mixin.DepartmentAccess)
      if (access === undefined) return []
      return [access]
    })
    if (owner) void joinAsOwner(rows)
  })
  const settingsId = departmentModuleSettingsId as Ref<ModuleSettings>
  let moduleSettings: ModuleSettings | undefined
  let grantPerson: AccountUuid | undefined
  let grant: ModuleGrant | undefined
  let extra: ModuleExtra = {}
  let blocked: string[] = []
  createQuery().query(departments.class.ModuleSettings, { _id: settingsId }, (items) => {
    moduleSettings = items[0]
  })

  const grantId = (person: AccountUuid): Ref<ModuleGrant> => ('departments:module-grant:' + person) as Ref<ModuleGrant>

  async function toggleModuleSettings (enabled: boolean): Promise<void> {
    if (!owner || busy) return
    busy = true
    error = false
    try {
      const ops = client.apply('department-module-settings')
      if (moduleSettings === undefined) {
        ops.notMatch(departments.class.ModuleSettings, { _id: settingsId })
        await ops.createDoc(departments.class.ModuleSettings, core.space.Workspace, { enabled }, settingsId)
      } else {
        await ops.update(moduleSettings, { enabled })
      }
      if (!(await ops.commit()).result) throw new Error('Could not save module settings')
    } catch {
      error = true
    } finally {
      busy = false
    }
  }

  async function editGrant (person: AccountUuid | undefined): Promise<void> {
    if (person === undefined || !canEdit || busy) return
    busy = true
    error = false
    try {
      grant = await client.findOne(departments.class.ModuleGrant, { _id: grantId(person) })
      extra = { ...normalizeModuleExtra(grant?.extra ?? {}) }
      blocked = [...(grant?.blocked ?? [])]
      grantPerson = person
    } catch {
      error = true
    } finally {
      busy = false
    }
  }

  async function saveGrant (): Promise<void> {
    if (grantPerson === undefined || !canEdit || busy) return
    busy = true
    error = false
    try {
      const ops = client.apply('department-module-grant')
      if (grant === undefined) {
        const id = grantId(grantPerson)
        ops.notMatch(departments.class.ModuleGrant, { _id: id })
        await ops.createDoc(departments.class.ModuleGrant, core.space.Workspace, { person: grantPerson, extra, blocked }, id)
      } else {
        ops.match(departments.class.ModuleGrant, { _id: grant._id, modifiedOn: grant.modifiedOn })
        await ops.update(grant, { extra, blocked })
      }
      if (!(await ops.commit()).result) throw new Error('Could not save module grants')
      grantPerson = undefined
    } catch {
      error = true
    } finally {
      busy = false
    }
  }

  const checked = new Set<string>()
  /**
   * A super admin added after a department was set up is not yet a member of its private spaces.
   * Re-saving the unchanged access makes the server sync them in (and creates spaces never created).
   */
  async function joinAsOwner (items: DepartmentAccess[]): Promise<void> {
    for (const access of items) {
      if (checked.has(access._id)) continue
      checked.add(access._id)
      const ids = [access.projectSpace, access.documentSpace, access.driveSpace]
      const spaces = await client.findAll(
        core.class.Space,
        { _id: { $in: ids.filter((it) => it !== undefined) } },
        { showArchived: true }
      )
      const missing = ids.some((it) => it === undefined) || spaces.length < 3
      if (!missing && spaces.every((space) => space.members.includes(me.uuid))) continue
      try {
        await client.updateMixin(access._id, hr.class.Department, access.space, departments.mixin.DepartmentAccess, {
          archived: access.archived
        })
      } catch {
        checked.delete(access._id)
      }
    }
  }
  let openedByLink: string | undefined
  $: {
    const requested = $location.query?.department ?? undefined
    if (requested === undefined) openedByLink = undefined
    else if (requested !== openedByLink) {
      const row = rows.find((item) => item._id === requested)
      if (row !== undefined) {
        openedByLink = requested
        choose(row)
      }
    }
  }
  function clone (access: DepartmentAccess): Draft {
    return {
      administrators: [...access.administrators],
      supervisors: [...access.supervisors],
      employees: [...access.employees],
      readers: [...access.readers],
      adminPermissions: [...access.adminPermissions],
      supervisorPermissions: [...access.supervisorPermissions],
      employeePermissions: [...access.employeePermissions],
      readerPermissions: [...access.readerPermissions],
      archived: access.archived,
      ...(access.moduleAccess !== undefined ? { moduleAccess: access.moduleAccess } : {}),
      contactVisibility: access.contactVisibility ?? 'company',
      ...(access.modules !== undefined ? { modules: [...access.modules] } : {}),
      supervisorsSeeTracking: access.supervisorsSeeTracking === true,
      employeesSeeTracking: access.employeesSeeTracking === true
    }
  }
  $: orderedRows = [...rows].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name))
  $: live = rows.find((row) => row._id === selected?._id)
  $: canEdit = owner || live?.administrators.includes(me.uuid) === true
  $: canSeeContacts = canEdit || live?.contactVisibility === undefined || live.contactVisibility === 'company' ||
    (live.contactVisibility === 'department' && roles.some((role) => live?.[role.field].includes(me.uuid)))
  $: names = (ids: AccountUuid[]): string => staff.filter((person) => ids.includes(person.personUuid as AccountUuid))
    .map((person) => formatName(person.name)).join('、')
  $: members = (ids: AccountUuid[]): Employee[] => staff.filter((person) => ids.includes(person.personUuid as AccountUuid))
  $: details = (person: Employee): string => channels.filter((channel) => channel.attachedTo === person._id)
    .map((channel) => channel.value).join(' · ')

  async function chat (id: AccountUuid | undefined): Promise<void> {
    if (id === undefined || id === me.uuid) return
    try {
      const dms = await client.findAll(chunter.class.DirectMessage, {})
      let dmId = dms.find((it) => it.members.length === 2 && it.members.includes(me.uuid) && it.members.includes(id))?._id
      if (dmId === undefined) {
        const ops = client.apply('department-direct-message')
        dmId = await ops.createDoc(chunter.class.DirectMessage, core.space.Space, {
          name: '', description: '', private: true, archived: false, members: [me.uuid, id]
        })
        if (!(await ops.commit()).result) throw new Error('Could not create direct message')
      }
      const open = await getResource(chunter.function.OpenChannelInSidebar)
      await open(dmId, chunter.class.DirectMessage)
    } catch {
      error = true
    }
  }

  function choose (value: DepartmentAccess): void {
    grantPerson = undefined
    tab = 'members'
    selected = value
    draft = clone(value)
    name = value.name
    error = false
    saved = false
  }
  function actorPermissions (): Set<DepartmentPermission> {
    const result = new Set<DepartmentPermission>()
    if (selected === undefined) return result
    for (const role of roles) {
      if (selected[role.field].includes(me.uuid)) {
        for (const permission of selected[role.permissions]) result.add(permission)
        if (role.field === 'administrators') {
          for (const permission of selected.supervisorPermissions) result.add(permission)
        }
      }
    }
    return result
  }
  function canToggleRole (role: (typeof roles)[number], person: AccountUuid): boolean {
    if (draft === undefined || busy) return false
    if (owner) return true
    const own = actorPermissions()
    if (role.field === 'administrators') return false
    if (own.has('manageMembers')) return draft[role.permissions].every((permission) => own.has(permission))
    return (
      role.field === 'readers' &&
      own.has('invite') &&
      !draft.readers.includes(person) &&
      draft.readerPermissions.every((permission) => own.has(permission))
    )
  }
  function toggleRole (role: RoleField, person: AccountUuid): void {
    if (draft === undefined) return
    const list = draft[role]
    draft = { ...draft, [role]: list.includes(person) ? list.filter((id) => id !== person) : [...list, person] }
  }
  function canTogglePermission (role: (typeof roles)[number], permission: DepartmentPermission): boolean {
    if (busy) return false
    if (owner) return true
    const own = actorPermissions()
    return role.field !== 'administrators' && own.has('manageMembers') && own.has(permission)
  }
  function togglePermission (role: PermissionField, permission: DepartmentPermission): void {
    if (draft === undefined) return
    const list = draft[role]
    draft = {
      ...draft,
      [role]: list.includes(permission) ? list.filter((item) => item !== permission) : [...list, permission]
    }
  }
  const ownModules = new Set(['orders', 'tracking', 'materials', 'prospects'])
  const roleLabels: Record<ModuleRole, string> = { admin: '管理员', supervisor: '主管', employee: '员工', reader: '访客' }

  function initialMatrix (access?: DepartmentAccess): ModuleAccess {
    return Object.fromEntries(applications.map(({ alias }) => [alias,
      access?.moduleAccess?.[alias] ?? Object.fromEntries(moduleRoles.map((role) => [role,
        access?.moduleAccess !== undefined ? 'none' :
          access !== undefined ? defaultModuleLevel(alias, role, access.modules) :
          alias === 'materials' ? (role === 'reader' ? 'none' : 'view') :
          alias === 'tracking' ? (role === 'admin' ? 'view' : 'none') : defaultModuleLevel(alias, role)
      ]))
    ])) as ModuleAccess
  }

  function changeModule (alias: string, role: ModuleRole, level: string): void {
    if (draft === undefined || !owner) return
    const matrix = { ...initialMatrix(selected), ...draft.moduleAccess }
    draft = { ...draft, moduleAccess: { ...matrix, [alias]: { ...matrix[alias], [role]: level as ModuleLevel } } }
  }
  function changeExtra (alias: string, level: string): void {
    extra = { ...extra }
    if (level === 'view' || level === 'edit') extra[alias] = level
    else delete extra[alias]
  }
  async function create (): Promise<void> {
    if (!owner || busy || newName.trim() === '' || newAdmin === '') return
    busy = true
    error = false
    try {
      const id = generateId<Department>()
      const ops = client.apply('department-management')
      await ops.createDoc(
        hr.class.Department,
        core.space.Workspace,
        {
          name: newName.trim(),
          description: '',
          parent: hr.ids.Head,
          teamLead: null,
          members: [],
          managers: []
        },
        id
      )
      await ops.createMixin(id, hr.class.Department, core.space.Workspace, departments.mixin.DepartmentAccess, {
        administrators: [newAdmin as AccountUuid],
        supervisors: [],
        employees: [],
        readers: [],
        adminPermissions: ['create', 'update', 'delete', 'comment', 'invite', 'manageMembers'],
        supervisorPermissions: ['create', 'update', 'comment', 'invite'],
        employeePermissions: ['create', 'update', 'comment'],
        readerPermissions: ['comment'],
        archived: false,
        moduleAccess: initialMatrix()
      })
      if (!(await ops.commit()).result) throw new Error('conflict')
      newName = ''
      newAdmin = ''
    } catch {
      error = true
    } finally {
      busy = false
    }
  }
  async function save (): Promise<void> {
    if (selected === undefined || draft === undefined || busy || !canEdit) return
    busy = true
    error = false
    saved = false
    try {
      const ops = client.apply('department-management')
      ops.match(hr.class.Department, { _id: selected._id, modifiedOn: selected.modifiedOn })
      if (owner && name.trim() !== selected.name) await ops.update(selected, { name: name.trim() })
      await ops.updateMixin(
        selected._id,
        hr.class.Department,
        selected.space,
        departments.mixin.DepartmentAccess,
        draft
      )
      if (!(await ops.commit()).result) throw new Error('conflict')
      saved = true
      selected = undefined
      draft = undefined
    } catch {
      error = true
    } finally {
      busy = false
    }
  }
</script>

<section class="departments">
  <Header adaptive="disabled">
    <Breadcrumb label={departments.string.Departments} size="large" isCurrent />
    <svelte:fragment slot="extra">
  {#if owner && selected === undefined}
    <label>
      <input type="checkbox" checked={moduleSettings?.enabled === true} disabled={busy}
        on:change={(event) => {
          const enabled = event.currentTarget.checked
          event.currentTarget.checked = moduleSettings?.enabled === true
          void toggleModuleSettings(enabled)
        }} />
      按部门控制模块
      <small>启用后按部门角色和个人例外分配模块。</small>
    </label>
    <button on:click={() => { showCreate = !showCreate }}><Label label={departments.string.CreateDepartment} /></button>
  {/if}
    </svelte:fragment>
  </Header>
  {#if owner && selected === undefined && showCreate}
    <div class="create">
      <input bind:value={newName} aria-label="Department name" />
      <label
        ><Label label={departments.string.ChooseAdministrator} /><select
          bind:value={newAdmin}
          aria-label="Department administrator"
        >
          <option value="">—</option>
          {#each staff as person (person._id)}{#if person.personUuid}<option value={person.personUuid}
                >{formatName(person.name)}</option
              >{/if}{/each}
        </select></label
      >
      <button on:click={create} disabled={busy || newName.trim() === '' || newAdmin === ''}
        ><Label label={departments.string.CreateDepartment} /></button
      >
    </div>
  {/if}
  {#if error}<p class="error"><Label label={departments.string.SaveError} /></p>{/if}
  {#if saved}<p><Label label={departments.string.Saved} /></p>{/if}
  <div class="layout">
    {#if selected === undefined}
      <nav aria-label="部门">
        {#each orderedRows as row (row._id)}
          <button class="department-card" class:archived={row.archived} on:click={() => choose(row)}>
            <strong>{row.name}</strong>
            <span>管理员 {names(row.administrators) || '—'}</span>
            <span>{new Set(roles.flatMap((role) => row[role.field])).size} 人{row.archived ? ' · 已归档' : ''}</span>
          </button>
        {/each}
      </nav>
    {:else if live !== undefined && draft !== undefined}
      <div class="editor">
        <div><button on:click={() => { selected = undefined; draft = undefined }}>返回</button></div>
        <h3>{live.name}</h3>
        <div class="tabs">
          <button aria-pressed={tab === 'members'} on:click={() => { tab = 'members' }}>成员</button>
          <button aria-pressed={tab === 'modules'} on:click={() => { tab = 'modules' }}>模块权限</button>
          {#if canEdit}<button aria-pressed={tab === 'settings'} on:click={() => { tab = 'settings' }}>设置</button>{/if}
        </div>
        {#if tab === 'members'}
        {#each roles as role (role.field)}
          <section>
            <h4><Label label={role.label} /></h4>
            {#each members(live[role.field]) as person (person._id)}
              <div class="member">
                <strong>{formatName(person.name)}</strong>
                <span>{role.field === 'administrators' || canSeeContacts ? details(person) || '—' : '（不公开）'}</span>
                {#if canEdit && person.personUuid !== undefined}
                  <button disabled={busy} on:click={() => editGrant(person.personUuid)}>模块例外</button>
                {/if}
                {#if role.field === 'administrators' && person.personUuid !== me.uuid}
                  <button on:click={() => chat(person.personUuid)}>私信</button>
                {/if}
              </div>
            {/each}
          </section>
        {/each}
        {#if canEdit && grantPerson !== undefined}
          <fieldset>
            <legend>{names([grantPerson])} 的模块例外</legend>
            <div class="member">
              <fieldset><legend>额外给</legend>
                {#each applications as app (app._id)}
                  <label><Label label={app.label} />
                    <select value={extra[app.alias] ?? ''} disabled={busy}
                      on:change={(event) => changeExtra(app.alias, event.currentTarget.value)}>
                      <option value="">无额外权限</option>
                      {#if ownModules.has(app.alias)}<option value="view">只能看</option>{/if}
                      <option value="edit">{ownModules.has(app.alias) ? '能编辑' : '能用'}</option>
                    </select>
                  </label>
                {/each}
              </fieldset>
              <fieldset><legend>单独关掉</legend>
                {#each applications as app (app._id)}
                  <label><input type="checkbox" bind:group={blocked} value={app.alias} disabled={busy} />
                    <Label label={app.label} /></label>
                {/each}
              </fieldset>
            </div>
            <button disabled={busy} on:click={saveGrant}>保存例外</button>
            <button disabled={busy} on:click={() => { grantPerson = undefined }}>取消</button>
          </fieldset>
        {/if}
        {/if}
        {#if tab === 'modules'}
        <section>
          <h4>这个部门能用的模块</h4>
          {#if live.modules === undefined}
            <p>全部模块</p>
          {:else if live.modules.length === 0}
            <p>没有配置默认模块</p>
          {:else}
            <ul>
              {#each live.modules as alias (alias)}
                {@const application = moduleByAlias.get(alias)}
                <li>{#if application}<Label label={application.label} />{:else}{alias}{/if}</li>
              {/each}
            </ul>
          {/if}
        </section>
          {#if owner}
            <div class="table-wrap">
              <table>
                <thead><tr><th>模块</th>{#each moduleRoles as role}<th>{roleLabels[role]}</th>{/each}</tr></thead>
                <tbody>
                  {#each applications as app (app._id)}
                    <tr>
                      <th><Label label={app.label} />{#if !ownModules.has(app.alias)} <small>由部门空间权限决定</small>{/if}</th>
                      {#each moduleRoles as role}
                        {@const value = draft.moduleAccess?.[app.alias]?.[role] ??
                          (draft.moduleAccess === undefined ? defaultModuleLevel(app.alias, role, draft.modules) : 'none')}
                        <td><select aria-label={app.alias + ' ' + roleLabels[role]} disabled={busy}
                          value={ownModules.has(app.alias) || value === 'none' ? value : 'edit'}
                          on:change={(event) => changeModule(app.alias, role, event.currentTarget.value)}>
                          <option value="none">不能用</option>
                          {#if ownModules.has(app.alias)}<option value="view">只能看</option>{/if}
                          <option value="edit">{ownModules.has(app.alias) ? '能编辑' : '能用'}</option>
                        </select></td>
                      {/each}
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        {/if}
        {#if canEdit && tab === 'settings'}
          <label>成员联系方式给谁看
            <select bind:value={draft.contactVisibility} disabled={busy}>
              <option value="company">全公司</option>
              <option value="department">只给本部门</option>
              <option value="admins">只给管理员</option>
            </select>
            <small>只控制部门页里显示与否</small>
          </label>

        <label
          ><Label label={departments.string.DepartmentName} /><input
            bind:value={name}
            disabled={!owner || busy}
          /></label
        >
        {#if owner}<label
            ><input type="checkbox" bind:checked={draft.archived} disabled={busy} /><Label
              label={departments.string.Archived}
            /></label
          >{/if}
        <label
          ><input type="checkbox" bind:checked={draft.supervisorsSeeTracking} disabled={busy || !owner} /><Label
            label={departments.string.SupervisorsSeeTracking}
          /></label
        >
        <label
          ><input
            type="checkbox"
            bind:checked={draft.employeesSeeTracking}
            disabled={busy || !(owner || selected?.administrators.includes(me.uuid))}
          /><Label label={departments.string.EmployeesSeeTracking} /></label
        >
        {/if}
        {#if canEdit && tab === 'members'}
        <p><Label label={departments.string.InviteHelp} /></p>
        <div class="table-wrap">
          <table>
            <thead
              ><tr
                ><th><Label label={departments.string.Member} /></th>{#each roles as role}<th
                    ><Label label={role.label} /></th
                  >{/each}</tr
              ></thead
            >
            <tbody
              >{#each staff as person (person._id)}{#if person.personUuid != null}<tr
                    ><td>{formatName(person.name)}</td>{#each roles as role}<td
                        ><input
                          type="checkbox"
                          checked={draft[role.field].includes(person.personUuid)}
                          disabled={!canToggleRole(role, person.personUuid)}
                          on:change={() => {
                            if (person.personUuid != null) toggleRole(role.field, person.personUuid)
                          }}
                        /></td
                      >{/each}</tr
                  >{/if}{/each}</tbody
            >
          </table>
        </div>
        <div class="table-wrap">
          <table>
            <thead
              ><tr
                ><th></th>{#each permissions as permission}<th><Label label={permission.label} /></th>{/each}</tr
              ></thead
            >
            <tbody
              >{#each roles as role}<tr
                  ><th><Label label={role.label} /></th>{#each permissions as permission}<td
                      ><input
                        type="checkbox"
                        checked={draft[role.permissions].includes(permission.value)}
                        disabled={!canTogglePermission(role, permission.value)}
                        on:change={() => {
                          togglePermission(role.permissions, permission.value)
                        }}
                      /></td
                    >{/each}</tr
                >{/each}</tbody
            >
          </table>
        </div>
        {/if}
        {#if canEdit}
        {#if !owner}<p><Label label={departments.string.NoPermission} /></p>{/if}
        <button
          on:click={save}
          disabled={busy ||
            (owner && name.trim() === '')}
          ><Label label={busy ? departments.string.Processing : departments.string.Save} /></button
        >
        {/if}
      </div>
    {/if}
  </div>
</section>

<style lang="scss">
  .departments {
    padding: 1.25rem;
    overflow: auto;
  }
  .create,
  .layout {
    display: flex;
    gap: 1rem;
    margin: 1rem 0;
  }
  nav {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(19rem, 1fr));
    gap: 1.5rem;
    width: 100%;
  }
  .department-card {
    display: grid;
    text-align: start;
    gap: 0.5rem;
    padding: 1rem;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.75rem;
    background: var(--theme-bg-color);
  }
  .tabs { display: flex; gap: 0.5rem; }
  .tabs button[aria-pressed='true'] { font-weight: 600; }
  .archived { opacity: 0.55; }
  .member {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
    padding: 0.25rem 0;
  }
  .editor {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 1rem;
  }
  .table-wrap {
    overflow: auto;
    scrollbar-width: auto;
  }
  table {
    border-collapse: collapse;
    min-width: 38rem;
  }
  th,
  td {
    padding: 0.5rem;
    border-bottom: 1px solid var(--theme-divider-color);
    text-align: left;
  }
  .error {
    color: var(--theme-error-color);
  }
</style>
