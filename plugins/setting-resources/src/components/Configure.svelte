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
  import { PluginConfiguration, systemAccountUuid } from '@hcengineering/core'
  import {
    createQuery,
    getClient,
    pluginConfigurationStore,
    hasResource,
    isDisabled,
    PluginConfigurationCard
  } from '@hcengineering/presentation'
  import ratingPlugin, { getRaiting, type PersonRating } from '@hcengineering/rating'
  import { type IntlString } from '@hcengineering/platform'
  import { Breadcrumb, Button, Header, Label, Scroller } from '@hcengineering/ui'
  import setting from '../plugin'

  const client = getClient()

  // Auraplex: changing a module reloads the site, so collect changes and save them in one go.
  let pending = new Map<string, boolean>()
  let filter: 'all' | 'on' | 'off' = 'all'
  let saving = false
  const isOn = (config: PluginConfiguration, changes: Map<string, boolean>): boolean =>
    changes.get(config._id) ?? config.enabled ?? true
  function change (config: PluginConfiguration, value: boolean): void {
    if (value === (config.enabled ?? true)) pending.delete(config._id)
    else pending.set(config._id, value)
    pending = pending
  }
  async function save (): Promise<void> {
    if (saving || pending.size === 0) return
    saving = true
    try {
      for (const config of $pluginConfigurationStore.list) {
        const value = pending.get(config._id)
        if (value !== undefined) await client.update(config, { enabled: value })
      }
      pending = new Map()
    } finally {
      saving = false
    }
  }
  const filters: Array<{ id: 'all' | 'on' | 'off', label: IntlString }> = [
    { id: 'all', label: setting.string.MemberPageAll },
    { id: 'on', label: setting.string.MemberPageEnabled },
    { id: 'off', label: setting.string.MemberPageDisabled }
  ]

  const sysQuery = createQuery()
  let sysRating: PersonRating | undefined

  sysQuery.query(ratingPlugin.class.PersonRating, { accountId: systemAccountUuid }, (res) => {
    sysRating = res[0]
  })

  $: totalVisible = getRaiting(
    100,
    sysRating,
    $pluginConfigurationStore.list.filter((it) => it.enabled && it.hidden !== true && it.system !== true)
  )
</script>

<div class="hulyComponent">
  <Header adaptive={'disabled'}>
    <Breadcrumb icon={setting.icon.Setting} label={setting.string.Configuration} size={'large'} isCurrent />
  </Header>
  <div class="hulyComponent-content__column content">
    <div class="flex-row-center flex-wrap m-4 px-4">
      <Label label={setting.string.BetaWarning} />
    </div>
    <div class="toolbar px-4">
      {#each filters as it}
        <Button
          label={it.label}
          kind={filter === it.id ? 'primary' : 'regular'}
          on:click={() => { filter = it.id }}
        />
      {/each}
      <div class="flex-grow" />
      {#if pending.size > 0}
        <span class="hint"><Label label={setting.string.MemberPagePending} params={{ count: pending.size }} /></span>
        <Button label={setting.string.MemberPageCancel} kind={'regular'} disabled={saving} on:click={() => { pending = new Map() }} />
      {/if}
      <Button label={setting.string.MemberPageSave} kind={'primary'} disabled={saving || pending.size === 0} on:click={save} />
    </div>
    <Scroller padding={'var(--spacing-3)'} bottomPadding={'var(--spacing-3)'}>
      <div class="modules-grid">
        {#each $pluginConfigurationStore.list as config}
          {#if config.hidden !== true && config.system !== true && !isDisabled(config.pluginId) &&
            (filter === 'all' || (filter === 'on') === isOn(config, pending))}
            {@const pluginRating = getRaiting(totalVisible, sysRating, [config])}
            {@const ratingSuffix = hasResource(ratingPlugin.component.RatingRing) ? `${pluginRating}%` : undefined}
            <PluginConfigurationCard
              label={config.label}
              description={config.description}
              icon={config.icon}
              enabled={isOn(config, pending)}
              beta={config.beta}
              suffix={ratingSuffix}
              on:toggle={(e) => change(config, e.detail.enabled)}
            />
          {/if}
        {/each}
      </div>
    </Scroller>
  </div>
</div>

<style lang="scss">
  .modules-grid {
    display: grid;
    gap: 0.75rem;
    grid-template-columns: repeat(auto-fill, minmax(min(20rem, 100%), 1fr));
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .hint {
    color: var(--theme-dark-color);
  }
</style>
