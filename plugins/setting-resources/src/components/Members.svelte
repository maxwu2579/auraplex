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
  import { Account, AccountRole, type Class, type Doc, type Ref, getCurrentAccount, hasAccountRole } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { Breadcrumb, DropdownIntlItem, DropdownLabelsIntl, Header, Label, Scroller, SearchInput, getCurrentResolvedLocation, navigate } from '@hcengineering/ui'
  import { onMount } from 'svelte'

  import setting from '../plugin'
  import { getAccountClient } from '../utils'
  import { Analytics } from '@hcengineering/analytics'

  const query = createQuery()
  const currentAccount = getCurrentAccount()
  const client = getClient()

  type Membership = { id: string, name: string, roles: string[] }
  const roleFields = ['administrators', 'supervisors', 'employees', 'readers'] as const
  const roleLabels = ['Administrators', 'Supervisors', 'Employees', 'Readers'] as const
  let memberships = new Map<string, Membership[]>()
  const departmentClass = 'hr:class:Department' as Ref<Class<Doc>>
  if (client.getHierarchy().hasClass(departmentClass)) {
    createQuery().query(departmentClass, {}, (docs) => {
      const next = new Map<string, Membership[]>()
      for (const doc of docs) {
        const row = doc as unknown as { name: string, 'departments:mixin:DepartmentAccess'?: Record<typeof roleFields[number], string[]> }
        const access = row['departments:mixin:DepartmentAccess']
        if (access === undefined) continue
        const people = new Set(roleFields.flatMap((field) => access[field] ?? []))
        for (const person of people) {
          const roles = roleFields.flatMap((field, i) => access[field]?.includes(person) ? [roleLabels[i]] : [])
          const departments = next.get(person) ?? []
          departments.push({ id: doc._id, name: row.name, roles })
          next.set(person, departments)
        }
      }
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
              <DropdownLabelsIntl
                label={role === AccountRole.Maintainer ? setting.string.Maintainer : guestRoles.includes(role) ? setting.string.Guest : setting.string.Role}
                disabled={!hasAccountRole(currentAccount, role) ||
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
              <div class="department-links">
                {#each memberships.get(personUuid) ?? [] as department (department.id)}
                  <button class="department-link" on:click={() => openDepartment(department.id)}>
                    {department.name}·{#each department.roles as roleLabel, i}{i > 0 ? ' / ' : ''}<Label label={departmentRoleLabel(roleLabel)} />{/each}
                  </button>
                {:else}
                  —
                {/each}
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
  .department-links { display: flex; flex-wrap: wrap; gap: 0.35rem 0.75rem; }
  .department-link { text-decoration: underline; cursor: pointer; text-align: start; }
</style>
