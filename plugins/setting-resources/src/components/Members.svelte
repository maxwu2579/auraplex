<!--
// Copyright © 2026 Hardcore Engineering Inc.
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
  import contact, { Employee, formatName } from '@hcengineering/contact'
  import { EmployeePresenter } from '@hcengineering/contact-resources'
  import { Account, AccountRole, type AccountUuid, type Class, type Doc, type Mixin, type Ref, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Breadcrumb, Button, DropdownIntlItem, DropdownLabelsIntl, Header, Label, Scroller, SearchInput, getCurrentResolvedLocation, navigate } from '@hcengineering/ui'
  import { onMount } from 'svelte'

  import setting from '../plugin'
  import { getAccountClient } from '../utils'
  import { Analytics } from '@hcengineering/analytics'

  const query = createQuery()
  const currentAccount = getCurrentAccount()
  const client = getClient()

  type Membership = { id: string, name: string, roles: string[] }
  const roleFields = ['administrators', 'supervisors', 'employees', 'readers'] as const
  type RoleField = typeof roleFields[number]
  type DepartmentAccess = Doc & Record<RoleField, AccountUuid[]> & {
    adminPermissions: string[], supervisorPermissions: string[], employeePermissions: string[], readerPermissions: string[]
  }
  const accessMixin = 'departments:mixin:DepartmentAccess' as Ref<Mixin<DepartmentAccess>>
  const permissionFields = ['adminPermissions', 'supervisorPermissions', 'employeePermissions', 'readerPermissions'] as const
  const roleLabels = ['Administrators', 'Supervisors', 'Employees', 'Readers'] as const
  let departmentRows: Array<{ doc: Doc, name: string, access: DepartmentAccess }> = []
  let editingPerson: AccountUuid | undefined
  let selectedDepartment = ''
  let selection: RoleField | '' = ''
  let departmentBusy = false
  let departmentError = ''
  $: editableDepartments = departmentRows.filter(({ access }) =>
    currentAccount.role === AccountRole.Owner || access.administrators.includes(currentAccount.uuid))
  $: selectedRow = editableDepartments.find(({ doc }) => doc._id === selectedDepartment)

  function chooseDepartment (id: string, person: AccountUuid): void {
    selectedDepartment = id
    const row = editableDepartments.find(({ doc }) => doc._id === id)
    selection = row === undefined ? '' : roleFields.find((field) => row.access[field].includes(person)) ?? ''
    departmentError = ''
  }

  async function saveDepartment (person: AccountUuid): Promise<void> {
    if (selectedRow === undefined || departmentBusy) return
    const { doc, access } = selectedRow
    const owner = currentAccount.role === AccountRole.Owner
    const actor = currentAccount.uuid
    if (!owner && !access.administrators.includes(actor)) return
    const changes = Object.fromEntries(roleFields.map((field) => [field,
      field === selection ? [...new Set([...access[field], person])] : access[field].filter((id) => id !== person)
    ])) as Record<RoleField, AccountUuid[]>
    departmentBusy = true
    departmentError = ''
    try {
      const ops = client.apply('edit-department-membership')
      ops.match(departmentClass, { _id: doc._id, modifiedOn: doc.modifiedOn })
      await ops.updateMixin(doc._id, departmentClass, doc.space, accessMixin, changes)
      if (!(await ops.commit()).result) throw new Error('Department membership was not saved')
      editingPerson = undefined
    } catch {
      departmentError = '未能保存。请确认你有权调整该部门的成员和角色，或刷新后再试。'
    } finally {
      departmentBusy = false
    }
  }

  function roleSelectable (field: RoleField): boolean {
    if (currentAccount.role === AccountRole.Owner) return true
    if (selectedRow === undefined || field === 'administrators') return false
    const { access } = selectedRow
    const permissions = new Set([...access.adminPermissions, ...access.supervisorPermissions])
    for (const [i, role] of roleFields.entries()) {
      if (access[role].includes(currentAccount.uuid)) for (const permission of access[permissionFields[i]]) permissions.add(permission)
    }
    return (permissions.has('manageMembers') || (field === 'readers' && permissions.has('invite'))) &&
      access[permissionFields[roleFields.indexOf(field)]].every((permission) => permissions.has(permission))
  }

  let memberships = new Map<string, Membership[]>()
  const departmentClass = 'hr:class:Department' as Ref<Class<Doc>>
  if (client.getHierarchy().hasClass(departmentClass)) {
    createQuery().query(departmentClass, {}, (docs) => {
      const next = new Map<string, Membership[]>()
      const rows: typeof departmentRows = []
      for (const doc of docs) {
        const row = doc as unknown as { name: string, 'departments:mixin:DepartmentAccess'?: DepartmentAccess }
        const access = row['departments:mixin:DepartmentAccess']
        if (access === undefined) continue
        rows.push({ doc, name: row.name, access })
        const people = new Set(roleFields.flatMap((field) => access[field] ?? []))
        for (const person of people) {
          const roles = roleFields.flatMap((field, i) => access[field]?.includes(person) ? [roleLabels[i]] : [])
          const departments = next.get(person) ?? []
          departments.push({ id: doc._id, name: row.name, roles })
          next.set(person, departments)
        }
      }
      departmentRows = rows.sort((a, b) => a.name.localeCompare(b.name))
      memberships = next
    })
  }

  function openDepartment (id: string): void {
    const loc = getCurrentResolvedLocation()
    navigate({ path: [...loc.path.slice(0, 4), 'departments'], query: { department: id } })
  }

  const departmentRoleLabel = (role: string): typeof setting.string.Members =>
    ('departments:string:' + role) as typeof setting.string.Members
  const departmentLabel = 'departments:string:Departments' as typeof setting.string.Members

  const items: DropdownIntlItem[] = [
    { id: AccountRole.Guest, label: setting.string.Guest },
    { id: AccountRole.User, label: setting.string.User },
    { id: AccountRole.Maintainer, label: setting.string.Maintainer },
    { id: AccountRole.Owner, label: setting.string.Owner }
  ]

  const guestRoles = [AccountRole.ReadOnlyGuest, AccountRole.DocGuest, AccountRole.Guest]

  const accountClient = getAccountClient()
  let workspaceMembers: Record<string, AccountRole> = {}
  let employees: Employee[] = []

  onMount(async () => {
    const members = await accountClient.getWorkspaceMembers()
    workspaceMembers = members.reduce<Record<string, AccountRole>>((wm, m) => {
      wm[m.person] = m.role

      return wm
    }, {})
  })

  query.query(contact.mixin.Employee, { active: true }, (res) => {
    employees = res
      .filter((e) => e.personUuid != null)
      .sort((a, b) => formatName(a.name).localeCompare(formatName(b.name)))
  })

  async function change (personUuid: string, value: AccountRole): Promise<void> {
    if (accountClient == null) {
      return
    }

    try {
      await accountClient.updateWorkspaceRole(personUuid, value)
      workspaceMembers[personUuid] = value

      const employee = employees.find((e) => e.personUuid === personUuid)
      if (employee !== undefined) {
        const employeeRole = guestRoles.includes(value) ? 'GUEST' : 'USER'
        await client.update(employee, { role: employeeRole })
      }
    } catch (e: any) {
      Analytics.handleError(e)
    }
  }
  let search = ''

  $: ownersCount = employees.filter(
    (e) => e.personUuid != null && workspaceMembers[e.personUuid] === AccountRole.Owner
  ).length

  function getItems (role: AccountRole, currentAccount: Account): DropdownIntlItem[] {
    return items.filter((i) => i.id === role || hasAccountRole(currentAccount, i.id as AccountRole))
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={setting.icon.Members} label={setting.string.Members} size={'large'} isCurrent />
    <svelte:fragment slot="search">
      <SearchInput bind:value={search} collapsed />
    </svelte:fragment>
  </Header>
  <div class="hulyComponent-content__column content">
    <Scroller align={'center'} padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
      <div class="hulyComponent-content">
        <div class="member-columns p-2">
          <strong><Label label={setting.string.Members} /></strong>
          <strong><Label label={setting.string.Role} /></strong>
          <strong><Label label={departmentLabel} /></strong>
        </div>
        {#each employees as employee (employee._id)}
          {@const personUuid = employee.personUuid ?? undefined}
          {@const role = personUuid !== undefined ? workspaceMembers[personUuid] : undefined}
          {#if personUuid !== undefined && role !== undefined && employee.name?.includes(search)}
            <div class="member-columns p-2 flex-no-shrink" data-id="owners-member-row">
              <div class="p-1 min-w-80">
                <EmployeePresenter value={employee} disabled={false} />
              </div>
              <div class="workspace-role">
              <DropdownLabelsIntl
                label={role === AccountRole.Maintainer ? setting.string.Maintainer : guestRoles.includes(role) ? setting.string.Guest : setting.string.Role}
                disabled={!hasAccountRole(currentAccount, AccountRole.Maintainer) || !hasAccountRole(currentAccount, role) ||
                  (role === AccountRole.Owner && ownersCount === 1) ||
                  currentAccount.uuid === personUuid}
                kind={'primary'}
                size={'medium'}
                items={getItems(role, currentAccount)}
                selected={role}
                on:selected={(e) => {
                  void change(personUuid, e.detail)
                }}
              />
                <small>公司级角色。部门里的管理员/主管在'部门'列里设。</small>
              </div>
              <div class="department-links">
                {#each memberships.get(personUuid) ?? [] as department (department.id)}
                  <button class="department-link" on:click={() => openDepartment(department.id)}>
                    {department.name}·{#each department.roles as roleLabel, i}{i > 0 ? ' / ' : ''}<Label label={departmentRoleLabel(roleLabel)} />{/each}
                  </button>
                {:else}
                  —
                {/each}
                {#if editableDepartments.length > 0}
                  <Button kind="regular" size="small" on:click={() => {
                    editingPerson = editingPerson === personUuid ? undefined : personUuid
                    chooseDepartment('', personUuid)
                  }}><span slot="content">编辑部门</span></Button>
                {/if}
                {#if editingPerson === personUuid}
                  <div class="department-editor">
                    <label>部门
                      <select value={selectedDepartment} disabled={departmentBusy}
                        on:change={(event) => chooseDepartment(event.currentTarget.value, personUuid)}>
                        <option value="">选择部门</option>
                        {#each editableDepartments as row (row.doc._id)}
                          <option value={row.doc._id}>{row.name}</option>
                        {/each}
                      </select>
                    </label>
                    {#if selectedRow}
                      <label>角色
                        <select bind:value={selection} disabled={departmentBusy}>
                          <option value="">不在此部门</option>
                          {#each roleFields as field, i}
                            <option value={field} disabled={!roleSelectable(field) && field !== selection}>
                              <Label label={departmentRoleLabel(roleLabels[i])} />
                            </option>
                          {/each}
                        </select>
                      </label>
                      <Button kind="regular" size="small" disabled={departmentBusy}
                        on:click={() => saveDepartment(personUuid)}><span slot="content">保存</span></Button>
                    {/if}
                    {#if departmentError}<span role="alert">{departmentError}</span>{/if}
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        {/each}
      </div>
    </Scroller>
  </div>
</div>

<style>
  .member-columns { display: grid; grid-template-columns: minmax(12rem, 1fr) minmax(9rem, auto) minmax(12rem, 2fr); align-items: center; gap: 1rem; }
  .workspace-role { display: grid; gap: 0.25rem; color: var(--theme-content-color); }
  .department-editor { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; flex-basis: 100%; }
  .department-editor select {
    background: var(--theme-bg-color); color: var(--theme-caption-color); border: 1px solid var(--theme-button-border);
  }
  .department-links { display: flex; flex-wrap: wrap; gap: 0.35rem 0.75rem; }
  .department-link {
    background: transparent;
    color: var(--theme-caption-color);
    text-decoration: underline;
    cursor: pointer;
    text-align: start;
  }
</style>
