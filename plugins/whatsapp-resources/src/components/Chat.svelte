<!--
//
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
//

-->
<script lang="ts">
  import type { Channel } from '@hcengineering/contact'
  import { SortingOrder } from '@hcengineering/core'
  import { createQuery } from '@hcengineering/presentation'
  import { InboxNotificationsClientImpl } from '@hcengineering/notification-resources'
  import { Dialog, Label, Scroller } from '@hcengineering/ui'
  import { createEventDispatcher } from 'svelte'
  import whatsapp, { type WhatsappMessage } from '@hcengineering/whatsapp'

  export let channel: Channel
  export let embedded = false
  let messages: WhatsappMessage[] = []
  const query = createQuery()
  const dispatch = createEventDispatcher()
  const inbox = InboxNotificationsClientImpl.getClient()

  $: query.query(
    whatsapp.class.Message,
    { attachedTo: channel._id },
    (result) => {
      messages = result.slice().reverse()
      void inbox.forceReadDoc(channel)
    },
    { sort: { sendOn: SortingOrder.Descending }, limit: 500 }
  )
</script>

<Dialog isFullSize on:close={() => dispatch('close')}>
  <svelte:fragment slot="title"
    ><span><Label label={whatsapp.string.Messages} /> · {channel.value}</span></svelte:fragment
  >
  <Scroller bottomStart autoscroll>
    <div class="messages" class:embedded>
      {#each messages as message (message._id)}
        <article class:outgoing={message.direction === 'outgoing'}>
          <p>{message.content}</p>
          <time datetime={new Date(message.sendOn).toISOString()}>{new Date(message.sendOn).toLocaleString()}</time>
        </article>
      {:else}
        <p class="empty"><Label label={whatsapp.string.NoMessages} /></p>
      {/each}
    </div>
  </Scroller>
  <div class="hint"><Label label={whatsapp.string.ReadOnlyHint} /></div>
</Dialog>

<style>
  .messages {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding: 1.5rem;
    min-width: 20rem;
  }
  article {
    align-self: flex-start;
    max-width: 85%;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.75rem;
    padding: 0.8rem 1rem;
    background: var(--theme-button-default);
  }
  article.outgoing {
    align-self: flex-end;
  }
  article p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0 0 0.5rem;
  }
  time {
    font-size: 0.75rem;
    color: var(--theme-caption-color);
  }
  .empty {
    padding: 2rem;
    color: var(--theme-caption-color);
  }
  .hint {
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--theme-divider-color);
    color: var(--theme-caption-color);
  }
</style>
