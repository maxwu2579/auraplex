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
  // Withdraw (nobody approved yet) or cancel (already approved, reason required) an application.
  // The server closes the open steps and tells the approvers.
  import { getEmbeddedLabel } from '@hcengineering/platform'
  import { Card, getClient } from '@hcengineering/presentation'
  import { type Execution } from '@hcengineering/process'
  import { languageStore } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'

  export let execution: Execution
  export let title: string
  export let approved: boolean = false

  const client = getClient()
  const dispatch = createEventDispatcher()
  $: L = (zh: string, en: string): string => ($languageStore === 'zh' ? zh : en)

  let reason = ''
  let error = ''

  async function save (): Promise<void> {
    error = ''
    try {
      await client.update(execution, { status: 'cancelled', cancelReason: reason.trim() } as any)
      dispatch('close', true)
    } catch {
      error = L('没成功，请刷新页面再试。', 'That did not work, please reload and try again.')
    }
  }
</script>

<Card
  label={getEmbeddedLabel(approved ? L('申请取消', 'Cancel application') : L('撤回申请', 'Withdraw application'))}
  okLabel={getEmbeddedLabel(approved ? L('确认取消', 'Cancel it') : L('确认撤回', 'Withdraw'))}
  okAction={save}
  canSave={!approved || reason.trim() !== ''}
  on:close={() => dispatch('close')}
  on:changeContent
>
  <div class="stop">
    <div class="what">「{title}」</div>
    <div>
      {approved
        ? L('这张单已经批准过。取消后审批过的人会收到通知，单子保留，状态变成"已取消"。', 'It was already approved. Approvers are told, the form is kept as "Cancelled".')
        : L('还没人审批。撤回后审批人的待办会消失，单子保留，状态变成"已撤回"。', 'Nobody approved it yet. Their to-dos go away, the form is kept as "Withdrawn".')}
    </div>
    <textarea
      class="reason"
      rows="3"
      bind:value={reason}
      placeholder={approved ? L('原因（必填），比如：不用请假了', 'Reason (required)') : L('原因（可以不填）', 'Reason (optional)')}
    />
    {#if error !== ''}<div class="error">{error}</div>{/if}
  </div>
</Card>

<style lang="scss">
  .stop {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    min-width: min(28rem, 90vw);
    color: var(--theme-content-color);
  }
  .what {
    font-weight: 600;
    color: var(--theme-caption-color);
  }
  .reason {
    padding: 0.5rem 0.625rem;
    border: 1px solid var(--theme-divider-color);
    border-radius: 0.375rem;
    background: var(--theme-bg-color);
    color: var(--theme-caption-color);
    resize: vertical;
  }
  .error {
    color: var(--theme-error-color, #eb5757);
  }
</style>
