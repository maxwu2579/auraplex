<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import contact, { formatName, type Employee } from '@hcengineering/contact'
  import core, { AccountRole, generateId, getCurrentAccount, type AccountUuid } from '@hcengineering/core'
  import departments, { type DepartmentAccess, type DepartmentPermission } from '@hcengineering/departments'
  import hr, { type Department } from '@hcengineering/hr'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Label } from '@hcengineering/ui'

  type RoleField = 'administrators' | 'supervisors' | 'employees' | 'readers'
  type PermissionField = 'adminPermissions' | 'supervisorPermissions' | 'employeePermissions' | 'readerPermissions'
  type Draft = Pick<DepartmentAccess, RoleField | PermissionField | 'archived'>
  const client = getClient()
  const hierarchy = client.getHierarchy()
  const me = getCurrentAccount()
  const owner = me.role === AccountRole.Owner
  const rosterQuery = createQuery()
  const departmentQuery = createQuery()
  let staff: Employee[] = []
  let rows: DepartmentAccess[] = []
  let selected: DepartmentAccess | undefined
  let draft: Draft | undefined
  let name = ''
  let newName = ''
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
      return owner || roles.some((role) => access[role.field].includes(me.uuid)) ? [access] : []
    })
    if (owner) void joinAsOwner(rows)
  })
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
      archived: access.archived
    }
  }
  function choose (value: DepartmentAccess): void {
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
        archived: false
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
    if (selected === undefined || draft === undefined || busy) return
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
  <h2><Label label={departments.string.Departments} /></h2>
  {#if owner}
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
    <nav>
      {#each rows as row (row._id)}<button
          on:click={() => {
            choose(row)
          }}>{row.name}</button
        >{/each}
    </nav>
    {#if selected !== undefined && draft !== undefined}
      <div class="editor">
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
        {#if !owner}<p><Label label={departments.string.NoPermission} /></p>{/if}
        <button
          on:click={save}
          disabled={busy ||
            (owner && name.trim() === '') ||
            (!owner && !actorPermissions().has('manageMembers') && !actorPermissions().has('invite'))}
          ><Label label={busy ? departments.string.Processing : departments.string.Save} /></button
        >
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
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 12rem;
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
