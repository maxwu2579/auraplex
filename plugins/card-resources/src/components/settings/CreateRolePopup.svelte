<!--
// Copyright © 2025 Hardcore Engineering Inc.
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
  import { MasterTag, Tag } from '@hcengineering/card'
  import core, { AccountRole, getCurrentAccount } from '@hcengineering/core'
  import { Card, getClient } from '@hcengineering/presentation'
  import { EditBox, Label } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import card from '../../plugin'

  export let masterTag: MasterTag | Tag

  let value: string = ''

  const dispatch = createEventDispatcher()
  const client = getClient()
  const canEditRoles = getCurrentAccount().role === AccountRole.Owner

  async function handleSave (): Promise<void> {
    if (!canEditRoles) return
    const _id = await client.addCollection(
      card.class.Role,
      core.space.Model,
      card.spaceType.SpaceType,
      core.class.SpaceType,
      'roles',
      {
        name: value,
        types: [masterTag._id],
        permissions: []
      }
    )
    dispatch('close', _id)
  }
</script>

<Card okAction={handleSave} label={core.string.Role} on:close width={'menu'} canSave={canEditRoles && value.trim().length > 0}>
  {#if !canEditRoles}<div><Label label={card.string.OnlyOwnerCanEditRoles} /></div>{/if}
  <EditBox bind:value placeholder={core.string.Role} />
</Card>
