<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import chunter from '@hcengineering/chunter'
  import { getResource, type Asset, type IntlString } from '@hcengineering/platform'
  import contact, { formatName, type Channel, type Employee } from '@hcengineering/contact'
  import core, { AccountRole, departmentModuleSettingsId, departmentAutoJoinClasses, type Space, defaultModuleLevel, moduleRoles, normalizeModuleExtra, type ModuleAccess, type ModuleExtra, type ModuleLevel, type ModuleRole, generateId, getCurrentAccount, type AccountUuid, type Class, type Doc, type Ref } from '@hcengineering/core'
  import departments, { type DepartmentAccess, type DepartmentPermission, type ModuleGrant, type ModuleSettings } from '@hcengineering/departments'
  import hr, { type Department } from '@hcengineering/hr'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { AvailableSpacesInput, Breadcrumb, Button, Header, Icon, Label, getCurrentLocation, location, navigate, SearchInput, showPopup, Toggle } from '@hcengineering/ui'

  type RoleField = 'administrators' | 'supervisors' | 'employees' | 'readers'
  type PermissionField = 'adminPermissions' | 'supervisorPermissions' | 'employeePermissions' | 'readerPermissions'
  type Draft = Pick<DepartmentAccess, RoleField | PermissionField | 'archived' | 'supervisorsSeeTracking' | 'employeesSeeTracking' | 'contactVisibility' | 'modules' | 'moduleAccess' | 'autoJoin'>
  const client = getClient()
  const hierarchy = client.getHierarchy()
  interface ModuleApplication extends Doc {
    alias: string
    label: IntlString
    icon: Asset
    hidden: boolean
  }
  const applications = client.getModel().findAllSync(
    'workbench:class:Application' as Ref<Class<ModuleApplication>>, { hidden: false }
  ).filter((app) => app.alias !== '')
  applications.push({
    alias: 'whatsapp',
    label: 'whatsapp:string:Whatsapp' as IntlString,
    icon: contact.icon.Whatsapp
  } as ModuleApplication)
  const selectSpacesLabel = 'setting:string:GuestSelectSpaces' as IntlString
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
  let memberSearch = ''
  let expandedModules = new Set<string>()
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
      ...(access.autoJoin !== undefined ? { autoJoin: access.autoJoin } : {}),
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
    memberSearch = ''
    expandedModules = new Set()
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
  function canAssignRole (field: RoleField): boolean {
    if (draft === undefined || busy || !canEdit) return false
    if (owner) return true
    const own = actorPermissions()
    const role = roles.find((item) => item.field === field)
    return field !== 'administrators' && own.has('manageMembers') &&
      role !== undefined && draft[role.permissions].every((permission) => own.has(permission))
  }

  function canMoveMember (current: Draft, person: AccountUuid): boolean {
    return canEdit && !busy && roles.filter(({ field }) => current[field].includes(person))
      .every(({ field }) => canAssignRole(field))
  }

  function setMemberRole (person: AccountUuid, field?: RoleField): void {
    if (draft === undefined || !canMoveMember(draft, person) || (field !== undefined && !canAssignRole(field))) return
    const next = { ...draft }
    for (const role of roles) next[role.field] = draft[role.field].filter((id) => id !== person)
    if (field !== undefined) next[field].push(person)
    draft = next
    if (field === undefined && grantPerson === person) grantPerson = undefined
  }

  function openAddMembers (): void {
    if (selected === undefined || draft === undefined || !canAssignRole('employees')) return
    const id = selected._id
    const current = [...new Set(roles.flatMap(({ field }) => draft?.[field] ?? []))]
    showPopup(contact.component.AddMembersPopup, { value: { name: selected.name, members: current } }, undefined,
      (people: AccountUuid[] | undefined) => {
        if (!Array.isArray(people) || selected?._id !== id || draft === undefined || !canAssignRole('employees')) return
        const existing = new Set(roles.flatMap(({ field }) => draft?.[field] ?? []))
        const added = [...new Set(people)].filter((person) => !existing.has(person))
        draft = { ...draft, employees: [...draft.employees, ...added] }
      })
  }

  function memberRole (current: Draft, person: AccountUuid): RoleField | undefined {
    return roles.find(({ field }) => current[field].includes(person))?.field
  }

  function matchesMember (name: string, search: string): boolean {
    return name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
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
        alias === 'whatsapp' ? 'edit' :
          access?.moduleAccess !== undefined ? 'none' :
          access !== undefined ? defaultModuleLevel(alias, role, access.modules) :
          alias === 'materials' ? (role === 'reader' ? 'none' : 'view') :
          alias === 'tracking' ? (role === 'admin' ? 'view' : 'none') : defaultModuleLevel(alias, role)
      ]))
    ])) as ModuleAccess
  }

  let joinableSpaces: Record<string, Space[]> = {}
  for (const [alias, id] of Object.entries(departmentAutoJoinClasses)) {
    const cls = id as Ref<Class<Space>>
    if (!hierarchy.hasClass(cls)) continue
    createQuery().query(cls, { archived: false }, (items) => {
      joinableSpaces = { ...joinableSpaces, [alias]: items }
    })
  }
  $: spaceOptions = (alias: string): Space[] => (joinableSpaces[alias] ?? [])
    .filter((space) => owner || space.owners?.includes(me.uuid) || draft?.autoJoin?.[alias]?.includes(space._id))

  function spaceItems (spaces: Space[], selected: Ref<Space>[]) {
    return [
      ...spaces.map((space) => ({ id: space._id, label: space.name })).sort((a, b) => a.label.localeCompare(b.label)),
      ...selected.filter((id) => !spaces.some((space) => space._id === id)).map((id) => ({ id, label: '已配置的空间' }))
    ]
  }

  function setAutoJoin (alias: string, ids: string[]): void {
    if (!canEdit || draft === undefined) return
    draft = { ...draft, autoJoin: { ...draft.autoJoin, [alias]: ids as Ref<Space>[] } }
  }

  function returnToList (): void {
    selected = undefined
    draft = undefined
    grantPerson = undefined
    const loc = getCurrentLocation()
    if (loc.query?.department !== undefined) {
      const { department, ...query } = loc.query
      navigate({ ...loc, query })
    }
  }

  function toggleModuleDetails (alias: string): void {
    const next = new Set(expandedModules)
    if (next.has(alias)) next.delete(alias)
    else next.add(alias)
    expandedModules = next
  }

  function moduleSummary (alias: string, row: ModuleAccess[string] | undefined): string {
    if (row === undefined) return '不能用'
    return moduleRoles.map((role) => {
      const level = row[role]
      const text = level === 'none' ? '不能用' : !ownModules.has(alias) ? '能用' : level === 'edit' ? '编辑' : '只能看'
      return roleLabels[role] + ' ' + text
    }).join(' · ')
  }

  function toggleCard (alias: string, enabled: boolean): void {
    if (!owner || draft === undefined) return
    const matrix = { ...initialMatrix(selected), ...draft.moduleAccess }
    const row = Object.fromEntries(moduleRoles.map((role) => [role,
      enabled ? defaultModuleLevel(alias, role) : 'none'
    ])) as ModuleAccess[string]
    draft = { ...draft, moduleAccess: { ...matrix, [alias]: row } }
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
      const current = await client.findOne(hr.class.Department, { _id: selected._id })
      const access = current === undefined ? undefined : hierarchy.asIf(current, departments.mixin.DepartmentAccess)
      if (access !== undefined) {
        selected = access
        draft = clone(access)
        name = access.name
      }
      saved = true
    } catch {
      error = true
    } finally {
      busy = false
    }
  }
</script>

<section class="departments">
  <Header adaptive="disabled">
    <Breadcrumb label={departments.string.Departments} size="large" isCurrent={live === undefined} on:click={returnToList} />
    {#if live}
      <span class="breadcrumb-separator" aria-hidden="true">›</span>
      <Breadcrumb title={live.name} size="large" isCurrent />
    {/if}
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
    <Button kind="regular" label={departments.string.CreateDepartment} on:click={() => { showCreate = !showCreate }} />
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
      <Button kind="regular" label={departments.string.CreateDepartment} on:click={create}
        disabled={busy || newName.trim() === '' || newAdmin === ''} />
    </div>
  {/if}
  {#if error}<p class="error"><Label label={departments.string.SaveError} /></p>{/if}
  {#if saved}<p><Label label={departments.string.Saved} /></p>{/if}
  <div class="layout">
    {#if selected === undefined}
      <nav aria-label="部门">
        {#each orderedRows as row (row._id)}
          <button class="department-card" class:archived={row.archived} on:click={() => choose(row)}>
            <span class="department-icon" aria-hidden="true"><Icon icon={hr.icon.Department} size="medium" /></span>
            <span class="department-summary">
              <strong>{row.name}</strong>
              <span>管理员 {names(row.administrators) || '—'}</span>
              <span>{new Set(roles.flatMap((role) => row[role.field])).size} 人{row.archived ? ' · 已归档' : ''}</span>
            </span>
          </button>
        {/each}
      </nav>
    {:else if live !== undefined && draft !== undefined}
      <div class="editor">
        <div class="tabs">
          <button aria-pressed={tab === 'members'} on:click={() => { tab = 'members' }}>成员</button>
          <button aria-pressed={tab === 'modules'} on:click={() => { tab = 'modules' }}>模块权限</button>
          {#if canEdit}<button aria-pressed={tab === 'settings'} on:click={() => { tab = 'settings' }}>设置</button>{/if}
        </div>
        {#if tab === 'members'}
          <div class="member-toolbar">
            <SearchInput bind:value={memberSearch} />
            {#if canEdit}
              <Button kind="regular" disabled={!canAssignRole('employees')} on:click={openAddMembers}>
                <span slot="content">添加成员</span>
              </Button>
            {/if}
          </div>
          {#each roles as role (role.field)}
            {@const people = members(draft[role.field]).filter((person) => person.personUuid != null &&
              memberRole(draft, person.personUuid) === role.field && matchesMember(formatName(person.name), memberSearch))}
            {#if people.length > 0}
              <section>
                <h4><Label label={role.label} /></h4>
                {#each people as person (person._id)}
                  {@const account = person.personUuid}
                  {#if account != null}
                    <div class="member">
                      <strong>{formatName(person.name)}</strong>
                      <span>{live.administrators.includes(account) || canSeeContacts ? details(person) || '—' : '（不公开）'}</span>
                      <select aria-label="部门角色" value={role.field} disabled={!canMoveMember(draft, account)}
                        on:change={(event) => {
                          const field = roles.find((item) => item.field === event.currentTarget.value)?.field
                          if (field !== undefined) setMemberRole(account, field)
                        }}>
                        {#each roles as option (option.field)}
                          <option value={option.field} disabled={option.field !== role.field && !canAssignRole(option.field)}>
                            <Label label={option.label} />
                          </option>
                        {/each}
                      </select>
                      {#if canEdit}
                        <button disabled={busy || !roles.some(({ field }) => live?.[field].includes(account))}
                          on:click={() => editGrant(account)}>模块例外</button>
                      {/if}
                      {#if account !== me.uuid}<button on:click={() => chat(account)}>私信</button>{/if}
                      {#if canEdit}
                        <button disabled={!canMoveMember(draft, account)} on:click={() => setMemberRole(account)}>移出</button>
                      {/if}
                    </div>
                  {/if}
                {/each}
              </section>
            {/if}
          {/each}
        {#if canEdit && grantPerson !== undefined}
          <fieldset>
            <legend>{names([grantPerson])} 的模块例外</legend>
            <div class="member">
              <fieldset><legend>额外给</legend>
                {#each applications as app (app.alias)}
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
                {#each applications as app (app.alias)}
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
          <div class="module-cards">
            {#each applications as app (app.alias)}
              {@const row = draft.moduleAccess?.[app.alias] ??
                (draft.moduleAccess === undefined || app.alias === 'whatsapp' ? initialMatrix(selected)[app.alias] : undefined)}
              {@const enabled = row !== undefined && moduleRoles.some((role) => row[role] !== 'none')}
              {@const hasSpaces = departmentAutoJoinClasses[app.alias] !== undefined}
              {@const expanded = expandedModules.has(app.alias)}
              <section class="permissionModuleCard">
                <div class="permissionModuleCard-header" class:hasRows={expanded}>
                  <button type="button" class="permissionModuleCard-headerMain" aria-expanded={expanded}
                    on:click={() => toggleModuleDetails(app.alias)}>
                    <span class="module-icon"><Icon icon={app.icon} size="small" /></span>
                    <span class="module-heading">
                      <Label label={app.label} />
                      <small class="module-summary" title={moduleSummary(app.alias, row)}>{moduleSummary(app.alias, row)}</small>
                    </span>
                  </button>
                  <Toggle on={enabled} disabled={!owner || busy} on:change={(event) => toggleCard(app.alias, event.detail)} />
                </div>
                {#if expanded}
                  <div class="permissionRows">
                    {#if enabled && ownModules.has(app.alias)}
                      {#each moduleRoles as role}
                        <label class="permissionRow">
                          <span>{roleLabels[role]}</span>
                          <select value={row?.[role] ?? 'none'} disabled={!owner || busy}
                            on:change={(event) => changeModule(app.alias, role, event.currentTarget.value)}>
                            {#if row?.[role] === 'none'}<option value="none" disabled>不能用</option>{/if}
                            <option value="view">只能看</option>
                            <option value="edit">能编辑</option>
                          </select>
                        </label>
                      {/each}
                    {:else if app.alias === 'whatsapp'}
                      <div class="permissionRow"><small>{enabled ? '能用' : '不能用'}</small></div>
                    {:else}
                      <div class="permissionRow"><small>{enabled ? '由部门空间权限决定' : '不能用'}</small></div>
                    {/if}
                    {#if hasSpaces}
                      {@const selectedSpaces = draft.autoJoin?.[app.alias] ?? []}
                      <div class="permissionRow">
                        <span>自动加入空间</span>
                        <AvailableSpacesInput
                          items={spaceItems(spaceOptions(app.alias), selectedSpaces)}
                          selected={selectedSpaces}
                          label={selectSpacesLabel}
                          disabled={!canEdit || busy}
                          on:selected={(event) => setAutoJoin(app.alias, event.detail)}
                        />
                      </div>
                    {/if}
                  </div>
                {/if}
              </section>
            {/each}
          </div>
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
    color: var(--theme-content-color);
  }
  .department-card strong { color: var(--theme-caption-color); }
  button.department-card { grid-template-columns: auto minmax(0, 1fr); align-items: start; gap: 0.75rem; }
  .department-icon { display: flex; color: var(--theme-caption-color); }
  .department-summary { display: grid; gap: 0.35rem; }
  .module-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); align-items: start; gap: 1.25rem; width: 100%; padding-top: 0.5rem; }
  .permissionModuleCard {
    display: flex; flex-direction: column; width: 100%; overflow: hidden;
    border: 1px solid var(--theme-navpanel-divider); border-radius: var(--small-focus-BorderRadius);
    background-color: var(--theme-panel-color); box-shadow: var(--theme-popup-shadow);
  }
  .permissionModuleCard-header {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; column-gap: 0.75rem;
    align-items: center; padding: 0.75rem 1rem; background-color: var(--theme-comp-header-color);
    color: var(--theme-content-color); font-weight: 500; font-size: 0.9375rem;
  }
  .permissionModuleCard-header.hasRows { border-bottom: 1px solid var(--theme-divider-color); }
  .departments button.permissionModuleCard-headerMain {
    display: flex; align-items: center; gap: 0.75rem; min-width: 0; text-align: start;
    border: 0; background: transparent; padding: 0; cursor: pointer;
  }
  .module-heading { display: grid; gap: 0.25rem; min-width: 0; }
  .module-summary { color: var(--theme-content-color); overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
  .module-icon {
    display: grid; place-items: center; width: 2rem; height: 2rem; flex-shrink: 0;
    color: var(--theme-caption-color); background-color: var(--theme-button-default);
    border-radius: var(--small-focus-BorderRadius);
  }
  .permissionRows { display: flex; flex-direction: column; padding: 0.25rem 1rem 0.75rem; }
  .permissionRow {
    display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 0.75rem;
    padding: 0.625rem 0 0.625rem 0.25rem; min-height: 2.5rem; color: var(--theme-content-color);
  }
  .permissionRow + .permissionRow { border-top: 1px solid var(--theme-navpanel-divider); }
  .breadcrumb-separator { color: var(--theme-content-color); padding-inline: 0.35rem; }
  .departments { color: var(--theme-content-color); }
  .departments button:not(.department-card), .departments select, .departments input:not([type='checkbox']) {
    color: var(--theme-caption-color); background-color: var(--theme-bg-color);
    border: 1px solid var(--theme-button-border); border-radius: 0.375rem; padding: 0.35rem 0.65rem;
  }
  .departments button:not(:disabled):hover { border-color: var(--theme-caption-color); }
  .departments button:disabled { opacity: 0.65; }
  .tabs { display: flex; gap: 0.5rem; }
  .tabs button {
    color: var(--theme-content-color);
    background: var(--theme-bg-color);
    border: 1px solid var(--theme-button-border);
    border-radius: 0.375rem;
    padding: 0.375rem 0.75rem;
  }
  .tabs button:hover,
  .tabs button[aria-pressed='true'] { color: var(--theme-caption-color); }
  .tabs button[aria-pressed='true'] { border-color: var(--theme-caption-color); font-weight: 600; }
  .archived { border-style: dashed; }
  .archived strong, .archived .department-icon { color: var(--theme-content-color); }
  .member-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; }
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
