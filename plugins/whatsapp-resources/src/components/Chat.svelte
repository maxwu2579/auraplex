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
  import { SortingOrder, generateId } from '@hcengineering/core'
  import { createQuery, getClient } from '@hcengineering/presentation'
  import { InboxNotificationsClientImpl } from '@hcengineering/notification-resources'
  import { Button, Dialog, Label, Scroller } from '@hcengineering/ui'
  import { createEventDispatcher, onMount } from 'svelte'
  import whatsapp, { type WhatsappMessage } from '@hcengineering/whatsapp'

  import { getConnection, ConnectionError, type ConnectionState } from '../api'
  import type { IntlString } from '@hcengineering/platform'

  export let channel: Channel
  export let embedded = false
  let messages: WhatsappMessage[] = []
  let draft = ''
  let busy = false
  let connection: ConnectionState | undefined
  let error: IntlString | undefined
  const client = getClient()
  const statusLabels = {
    pending: whatsapp.string.Pending,
    sending: whatsapp.string.Sending,
    sent: whatsapp.string.Sent,
    delivered: whatsapp.string.Delivered,
    read: whatsapp.string.Read,
    failed: whatsapp.string.SendFailed,
    received: whatsapp.string.Incoming
  }
  onMount(() => {
    void getConnection()
      .then((value) => {
        connection = value
      })
      .catch((err) => {
        error = err instanceof ConnectionError ? err.label : whatsapp.string.Unavailable
      })
  })

  async function send (): Promise<void> {
    if (busy || draft.trim() === '' || draft.length > 4096) return
    busy = true
    error = undefined
    const text = draft
    const target = channel
    try {
      connection = await getConnection()
      if (!connection.connected || connection.phoneNumberId === undefined) {
        error = whatsapp.string.ConnectionRequired
        return
      }
      const id = generateId<WhatsappMessage>()
      const ops = client.apply('whatsapp-outgoing')
      ops.notMatch(whatsapp.class.Message, { _id: id })
      await ops.addCollection(
        whatsapp.class.Message,
        target.space,
        target._id,
        target._class,
        'items',
        {
          content: text,
          direction: 'outgoing',
          status: 'pending',
          phone: target.value.replace(/[^0-9]/g, ''),
          phoneNumberId: connection.phoneNumberId,
          sendOn: Date.now()
        },
        id
      )
      if (!(await ops.commit()).result) throw new Error('Message was not saved')
      if (channel._id === target._id && draft === text) draft = ''
    } catch {
      error = whatsapp.string.SaveMessageFailed
    } finally {
      busy = false
    }
  }

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

<Dialog isFullSize on:fullsize on:close={() => dispatch('close')}>
  <svelte:fragment slot="title"
    ><span><Label label={whatsapp.string.Messages} /> · {channel.value}</span></svelte:fragment
  >
  <Scroller bottomStart autoscroll>
    <div class="messages" class:embedded>
      {#each messages as message (message._id)}
        <article class:outgoing={message.direction === 'outgoing'} class:failed={message.status === 'failed'}>
          <p>{message.content}</p>
          {#if message.direction === 'outgoing'}
            <div class="status" aria-live="polite"><Label label={statusLabels[message.status]} /></div>
            {#if message.errorMessage}
              <div class="error">
                {message.errorMessage}{message.errorCode !== undefined && message.errorCode !== ''
                  ? ' (' + message.errorCode + ')'
                  : ''}
              </div>
            {/if}
          {/if}
          <time datetime={new Date(message.sendOn).toISOString()}>{new Date(message.sendOn).toLocaleString()}</time>
        </article>
      {:else}
        <p class="empty"><Label label={whatsapp.string.NoMessages} /></p>
      {/each}
    </div>
  </Scroller>
  <form class="composer" on:submit|preventDefault={send}>
    <label for="whatsapp-reply"><Label label={whatsapp.string.Reply} /></label>
    <textarea
      id="whatsapp-reply"
      bind:value={draft}
      maxlength={4096}
      rows={3}
      disabled={busy || connection?.connected !== true}
    />
    {#if connection !== undefined && !connection.connected}<p>
        <Label label={whatsapp.string.ConnectionRequired} />
      </p>{/if}
    {#if error !== undefined}<p class="error" role="alert"><Label label={error} /></p>{/if}
    <div class="actions">
      <Button
        label={whatsapp.string.Send}
        kind="primary"
        loading={busy}
        disabled={busy || connection?.connected !== true || draft.trim() === '' || draft.length > 4096}
        on:click={send}
      />
    </div>
  </form>
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
  .status {
    font-size: 0.8rem;
    margin-bottom: 0.3rem;
  }
  .error {
    color: var(--theme-error-color);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .failed {
    border-color: var(--theme-error-color);
  }
  textarea {
    width: 100%;
    resize: vertical;
    min-height: 4.5rem;
    margin-top: 0.5rem;
    padding: 0.65rem;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.4rem;
    background: var(--theme-button-default);
    color: var(--theme-content-color);
    font: inherit;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }
  .composer {
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--theme-divider-color);
    color: var(--theme-caption-color);
  }
</style>
