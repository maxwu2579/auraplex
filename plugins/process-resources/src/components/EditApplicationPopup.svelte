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
  // Change an application before anybody approved it (the server refuses afterwards).
  import card, { type Card as CardDoc } from '@hcengineering/card'
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { AttributeBarEditor, Card, createQuery, getClient, type KeyedAttribute } from '@hcengineering/presentation'
  import { languageStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  export let value: CardDoc

  const client = getClient()
  const h = client.getHierarchy()
  const dispatch = createEventDispatcher()
  $: L = (zh: string, en: string): string => ($languageStore === 'zh' ? zh : en)

  let doc: CardDoc = value
  const query = createQuery()
  query.query(card.class.Card, { _id: value._id }, (res) => {
    if (res[0] !== undefined) doc = res[0]
  })

  let title = value.title
  let error = ''

  $: keys = [...h.getAllAttributes(doc._class, card.class.Card).entries()]
    .filter(([key, attr]) => attr.hidden !== true && attr.readonly !== true && !['title', 'content', 'parent'].includes(key))
    .map(([key, attr]): KeyedAttribute => ({ key, attr }))

  async function save (): Promise<void> {
    error = ''
    const next = title.trim()
    if (next !== '' && next !== doc.title) {
      try {
        await client.update(doc, { title: next })
      } catch {
        error = L('已经有人审批过了，不能再修改。', 'Somebody already approved it, it can no longer be changed.')
        return
      }
    }
    dispatch('close')
  }
</script>

<Card
  label={getEmbeddedLabel(L('修改申请', 'Change application'))}
  okLabel={getEmbeddedLabel(L('完成', 'Done'))}
  okAction={save}
  canSave={title.trim() !== ''}
  on:close={() => dispatch('close')}
  on:changeContent
>
  <div class="edit">
    <input class="input" bind:value={title} />
    <div class="fields">
      {#each keys as key (key.key)}
        <AttributeBarEditor {key} _class={doc._class} object={doc} kind="regular" size="medium" />
      {/each}
    </div>
    <div class="hint">{L('字段改了马上保存。审批人看到的是改好以后的内容。', 'Fields are saved right away; approvers see the new content.')}</div>
    {#if error !== ''}<div class="error">{error}</div>{/if}
  </div>
</Card>

<style lang="scss">
  .edit {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: min(30rem, 90vw);
  }
  .input {
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background: var(--theme-bg-color);
    color: var(--theme-caption-color);
    font-weight: 500;
  }
  .fields {
    display: grid;
    grid-template-columns: minmax(6rem, auto) 1fr;
    align-items: center;
    gap: 0.5rem 1rem;
  }
  .hint {
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .error {
    color: var(--theme-error-color, #eb5757);
  }
</style>
