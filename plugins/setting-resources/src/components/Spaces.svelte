<!--
// Copyright © 2024 Hardcore Engineering Inc.
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
  import contact from '@hcengineering/contact'
  import { openDoc } from '@hcengineering/view-resources'
  import {
    Breadcrumb,
    Button,
    DropdownLabelsIntl,
    Header,
    Label,
    Loading,
    Scroller,
    SearchInput,
    Toggle
  } from '@hcengineering/ui'
  import { IntlString } from '@hcengineering/platform'
  import core, {
    AccountUuid,
    Class,
    Doc,
    Ref,
    Role,
    RolesAssignment,
    Space,
    SpaceType,
    TypedSpace,
    WithLookup
  } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { AccountArrayEditor } from '@hcengineering/contact-resources'

  import setting from '../plugin'

  const client = getClient()
  const hierarchy = client.getHierarchy()

  // Auraplex: keep the global administrator editor and show a read-only directory of workspace spaces.
  const systemSpaceIds = Object.values(core.space)
  let spaces: Space[] = []
  let loading = true
  let search: string | undefined = undefined
  let selectedType = ''
  let showArchived = false

  createQuery().query(core.class.Space, { _id: { $nin: systemSpaceIds } }, (res) => {
    spaces = res
      .filter(
        ({ _class, name }) =>
          // Auraplex: unnamed spaces are private chats, not workspace spaces.
          name.trim() !== '' &&
          !hierarchy.isDerived(_class, core.class.SystemSpace) &&
          !hierarchy.isDerived(_class, contact.class.PersonSpace)
      )
      .sort((a, b) => a.name.localeCompare(b.name))
    loading = false
  })

  // Auraplex: some space classes have no label of their own; use the closest parent that has one.
  function classLabel (_class: Ref<Class<Space>>): IntlString {
    let current: Class<Doc> | undefined = hierarchy.getClass(_class)
    while (current !== undefined) {
      if (current.label !== undefined) return current.label
      current = current.extends !== undefined ? hierarchy.getClass(current.extends) : undefined
    }
    return core.string.Space
  }

  $: types = [
    { id: '', label: setting.string.SpaceDirectoryAllTypes },
    ...Array.from(new Set(spaces.map(({ _class }) => _class)), (id) => ({
      id,
      label: classLabel(id)
    }))
  ]
  $: if (!types.some(({ id }) => id === selectedType)) selectedType = ''
  $: query = search?.trim().toLocaleLowerCase() ?? ''
  $: visibleSpaces = spaces.filter(
    (item) =>
      (showArchived || !item.archived) &&
      (selectedType === '' || item._class === selectedType) &&
      item.name.toLocaleLowerCase().includes(query)
  )

  // Auraplex: group the directory by department; spaces that come with the system go last, folded.
  const departmentClass = 'hr:class:Department' as Ref<Class<Doc>>
  const departmentAccess = 'departments:mixin:DepartmentAccess' as Ref<Class<Doc>>
  let departmentSpaces: Array<{ name: string, ids: Array<Ref<Space>> }> = []
  if (hierarchy.hasClass(departmentClass) && hierarchy.hasClass(departmentAccess)) {
    createQuery().query(departmentClass, {}, (res) => {
      departmentSpaces = res
        .filter((doc) => hierarchy.hasMixin(doc, departmentAccess as any))
        .map((doc) => {
          const access = hierarchy.as(doc, departmentAccess as any) as any
          const ids = [access.projectSpace, access.documentSpace, access.driveSpace].filter((id) => id != null)
          return { name: (doc as any).name as string, ids }
        })
        .sort((a, b) => a.name.localeCompare(b.name))
    })
  }
  // Spaces defined by the system have readable ids such as "tracker:project:DefaultProject".
  const isBuiltIn = (item: Space): boolean => item._id.includes(':')
  $: groups = [
    ...departmentSpaces.map(({ name, ids }) => ({
      key: 'dep:' + name,
      name,
      items: visibleSpaces.filter((item) => ids.includes(item._id))
    })),
    {
      key: 'other',
      name: undefined,
      items: visibleSpaces.filter(
        (item) => !isBuiltIn(item) && !departmentSpaces.some(({ ids }) => ids.includes(item._id))
      )
    }
  ].filter(({ items }) => items.length > 0)
  $: builtIn = visibleSpaces.filter(
    (item) => isBuiltIn(item) && !departmentSpaces.some(({ ids }) => ids.includes(item._id))
  )

  let space: TypedSpace
  let spaceType: WithLookup<SpaceType>

  const spaceQuery = createQuery()
  spaceQuery.query(
    core.class.TypedSpace,
    {
      _id: core.space.Space
    },
    (res) => {
      space = res[0]
    }
  )

  const typeQuery = createQuery()
  $: if (space?.type !== undefined) {
    typeQuery.query(
      core.class.SpaceType,
      {
        _id: core.spaceType.SpacesType
      },
      (res) => {
        spaceType = res[0]
      },
      {
        lookup: {
          _id: { roles: core.class.Role }
        }
      }
    )
  }
  $: roles = (spaceType?.$lookup?.roles ?? []) as Role[]

  let rolesAssignment: RolesAssignment = {}
  $: {
    if (space !== undefined && spaceType?.targetClass !== undefined) {
      const asMixin = hierarchy.as(space, spaceType?.targetClass)

      rolesAssignment = roles.reduce<RolesAssignment>((prev, { _id }) => {
        prev[_id] = (asMixin as any)[_id] ?? []

        return prev
      }, {})
    }
  }

  async function handleRoleAssignmentChanged (roleId: Ref<Role>, newMembers: AccountUuid[]): Promise<void> {
    await client.updateMixin(space._id, space._class, core.space.Space, spaceType.targetClass, {
      [roleId]: newMembers
    })
  }
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={setting.icon.Views} label={setting.string.Spaces} size="large" isCurrent />
  </Header>
  <div class="hulyComponent-content__column">
    <Scroller padding="var(--spacing-3)" bottomPadding="var(--spacing-3)">
      <div class="content">
        <section class="admin-card">
          <h2><Label label={setting.string.SpaceDirectoryAdmins} /></h2>
          <p><Label label={setting.string.SpaceDirectoryAdminDescription} /></p>
          {#each roles as role (role._id)}
            <div class="antiGrid-row">
              <div class="antiGrid-row__header">
                {#if role._id === core.role.Admin}
                  <Label label={setting.string.SpaceDirectoryAdminRole} />
                {:else}
                  {role.name}
                {/if}
              </div>
              <AccountArrayEditor
                value={rolesAssignment?.[role._id] ?? []}
                label={core.string.Members}
                onChange={(refs) => {
                  void handleRoleAssignmentChanged(role._id, refs)
                }}
                kind="regular"
                size="large"
              />
            </div>
          {/each}
        </section>

        <section class="directory">
          <h2><Label label={setting.string.SpaceDirectoryTitle} /></h2>
          <div class="toolbar">
            <SearchInput bind:value={search} placeholder={setting.string.SpaceDirectorySearch} />
            <DropdownLabelsIntl
              label={setting.string.SpaceDirectoryType}
              items={types}
              selected={selectedType}
              on:selected={(event) => {
                selectedType = event.detail
              }}
            />
            <div class="archive-filter">
              <Toggle
                id="show-archived-spaces"
                bind:on={showArchived}
                showTooltip={{ label: setting.string.SpaceDirectoryShowArchived }}
              />
              <Label label={setting.string.SpaceDirectoryShowArchived} />
            </div>
          </div>

          {#if loading}
            <Loading />
          {:else if visibleSpaces.length === 0}
            <p class="empty"><Label label={setting.string.SpaceDirectoryEmpty} /></p>
          {:else}
            {#each [...groups.map((group) => ({ ...group, folded: false })), ...(builtIn.length > 0 ? [{ key: 'builtin', name: undefined, items: builtIn, folded: true }] : [])] as section (section.key)}
            <details class="space-group" open={!section.folded}>
              <summary>
                {#if section.key === 'builtin'}
                  <Label label={setting.string.SpaceDirectoryBuiltInGroup} params={{ count: section.items.length }} />
                {:else if section.name !== undefined}
                  <Label label={setting.string.SpaceDirectoryDepartmentGroup} params={{ name: section.name }} />
                {:else}
                  <Label label={setting.string.SpaceDirectoryOtherGroup} />
                {/if}
              </summary>
              {#if section.key === 'builtin'}<p><Label label={setting.string.SpaceDirectoryBuiltInHint} /></p>{/if}
            <div class="space-grid">
              {#each section.items as item (item._id)}
                {@const spaceClass = hierarchy.getClass(item._class)}
                <Button
                  icon={spaceClass.icon ?? setting.icon.Views}
                  justify="left"
                  width="100%"
                  height="auto"
                  padding="0.875rem"
                  title={item.name}
                  on:click={() => {
                    void openDoc(hierarchy, item)
                  }}
                >
                  <span slot="content" class="space-details">
                    <span class="space-name">{item.name}</span>
                    <span class="space-type"><Label label={classLabel(item._class)} /></span>
                    <span class="space-metadata">
                      <span
                        ><Label
                          label={setting.string.SpaceDirectoryMembers}
                          params={{ count: item.members?.length ?? 0 }}
                        /></span
                      >
                      <span
                        ><Label
                          label={item.private ? core.string.Private : setting.string.SpaceDirectoryPublic}
                        /></span
                      >
                      <span
                        ><Label
                          label={item.archived
                            ? setting.string.SpaceDirectoryArchived
                            : setting.string.SpaceDirectoryActive}
                        /></span
                      >
                    </span>
                  </span>
                </Button>
              {/each}
            </div>
            </details>
            {/each}
          {/if}
        </section>
      </div>
    </Scroller>
  </div>
</div>

<style lang="scss">
  .content,
  .directory {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: 0;
  }

  .content {
    gap: 1.5rem;
    color: var(--theme-content-color);
  }

  .admin-card {
    padding: 1rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.5rem;
  }

  h2,
  p {
    margin: 0;
  }

  p {
    margin: 0.5rem 0;
    color: var(--theme-caption-color);
  }

  .toolbar,
  .archive-filter,
  .space-metadata {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.75rem;
  }

  .space-group summary {
    cursor: pointer;
    margin-bottom: 0.5rem;
    color: var(--theme-caption-color);
    font-weight: 600;
  }

  .space-group + .space-group {
    margin-top: 0.75rem;
  }

  .space-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(100%, 20rem), 1fr));
    gap: 0.75rem;
  }

  .space-details {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.25rem;
    min-width: 0;
    text-align: left;
    white-space: normal;
  }

  .space-name {
    max-width: 100%;
    overflow-wrap: anywhere;
    font-weight: 600;
  }

  .space-type,
  .space-metadata {
    color: var(--theme-caption-color);
  }
</style>
