<!--
// Copyright © 2022 Hardcore Engineering Inc.
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
  import { getCurrentAccount, hasAccountRole, type Class, type Doc, type Ref } from '@hcengineering/core'
  import { createQuery, getClient, isAdminUser, isDisabled } from '@hcengineering/presentation'
  import setting, { SettingsCategory } from '@hcengineering/setting'
  import {
    Component,
    Location,
    NavItem,
    getCurrentResolvedLocation,
    navigate,
    resolvedLocationStore,
    deviceOptionsStore as deviceInfo
  } from '@hcengineering/ui'
  import { onDestroy, onMount } from 'svelte'
  import { clearSettingsStore } from '../store'

  export let kind: 'navigation' | 'content' | undefined
  export let categoryName: string

  let category: SettingsCategory | undefined
  let categoryId: string = ''

  let availableCategories: SettingsCategory[] = []
  let departmentAdmin = false
  const account = getCurrentAccount()
  const admin = isAdminUser()

  const departmentClass = 'hr:class:Department' as Ref<Class<Doc>>
  const client = getClient()
  if (client.getHierarchy().hasClass(departmentClass)) {
    createQuery().query(departmentClass, {}, (docs) => {
      departmentAdmin = docs.some((doc) => {
        const row = doc as unknown as { 'departments:mixin:DepartmentAccess'?: { administrators: string[] } }
        return row['departments:mixin:DepartmentAccess']?.administrators.includes(account.uuid) === true
      })
    })
  }

  $: categories = availableCategories.filter((item) =>
    (hasAccountRole(account, item.role) || (item.name === 'owners' && departmentAdmin)) &&
    !isDisabled(item.feature ?? '') && (admin || !(item.adminOnly ?? false)))
  $: category = categories.find((item) => item.name === categoryId)
  const settingsQuery = createQuery()
  settingsQuery.query(
    setting.class.WorkspaceSettingCategory,
    {},
    (res) => {
      availableCategories = res
    },
    { sort: { order: 1 } }
  )

  onDestroy(
    resolvedLocationStore.subscribe((loc) => {
      void (async (loc: Location): Promise<void> => {
        categoryId = loc.path[4]
      })(loc)
    })
  )
  onMount(() => {
    setTimeout(() => {
      if (kind === 'content' && category === undefined) $deviceInfo.navigator.visible = true
    }, 500)
  })

  function selectCategory (id: string): void {
    clearSettingsStore()
    const loc = getCurrentResolvedLocation()
    loc.path[3] = categoryName
    if (loc.path[4] === id) {
      loc.path.length = 4
    } else {
      loc.path[4] = id
      loc.path.length = 5
    }
    navigate(loc)
  }
</script>

{#if kind === 'navigation'}
  {#each categories as category}
    <NavItem
      icon={category.icon}
      label={category.label}
      selected={category.name === categoryId}
      on:click={() => {
        selectCategory(category.name)
      }}
    />
    {#if category.name === categoryId && category.extraComponents?.navigation}
      <Component is={category.extraComponents?.navigation} props={{ kind: 'navigation', categoryName: categoryId }} />
    {/if}
  {/each}
{:else if kind === 'content' && category === undefined}
  <div class="hulyComponent" />
{:else if category}
  <Component is={category.component} props={{ kind: 'content', ...category.props }} on:change />
{/if}
