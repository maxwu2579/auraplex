<!--
// Copyright © 2026 Auraplex
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
  import card, { type MasterTag } from '@hcengineering/card'
  import core, { type AnyAttribute, type Ref } from '@hcengineering/core'
  import { AttributeBarEditor, getClient, type KeyedAttribute } from '@hcengineering/presentation'
  import { isEmptyMarkup } from '@hcengineering/text'

  // Shows the type's required fields in the create dialog, so a new card
  // starts with them filled in (processes may rely on them right away).
  export let type: Ref<MasterTag> | null
  export let data: Record<string, any>
  export let filled: boolean = true

  const hierarchy = getClient().getHierarchy()
  const skip = new Set(['title', 'content', 'parent'])

  function requiredKeys (_type: Ref<MasterTag> | null): KeyedAttribute[] {
    if (_type == null) return []
    return [...hierarchy.getAllAttributes(_type, card.class.Card).entries()]
      .filter(([key, attr]) => attr.required === true && attr.hidden !== true && attr.readonly !== true && !skip.has(key))
      .map(([key, attr]) => ({ key, attr }))
  }

  function isFilled (value: any, attr: AnyAttribute): boolean {
    if (attr.type?._class === core.class.TypeMarkup) return !isEmptyMarkup(value)
    if (Array.isArray(value)) return value.length > 0
    return value !== undefined && value !== null && value !== ''
  }

  $: keys = requiredKeys(type)
  $: filled = keys.every((k) => isFilled(data[k.key], k.attr))
</script>

{#if type != null && keys.length > 0}
  <div class="required-fields">
    {#each keys as key (key.key)}
      <AttributeBarEditor
        {key}
        _class={type}
        object={data}
        draft
        kind="regular"
        size="medium"
        on:update={() => {
          data = data
        }}
      />
    {/each}
  </div>
{/if}

<style lang="scss">
  .required-fields {
    display: grid;
    grid-template-columns: minmax(6rem, auto) 1fr;
    align-items: center;
    gap: 0.5rem 1rem;
    margin-top: 0.75rem;
  }
</style>
