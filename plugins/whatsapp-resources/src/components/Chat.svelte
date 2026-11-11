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
  import whatsapp, {
    REPLY_WINDOW_MS,
    isReplyWindowOpen,
    isValidTemplateParameter,
    lastIncomingAt,
    renderTemplate,
    type WhatsappMessage,
    type WhatsappTemplate
  } from '@hcengineering/whatsapp'

  import { getConnection, getTemplates, ConnectionError, type ConnectionState } from '../api'
  import type { IntlString } from '@hcengineering/platform'

  export let channel: Channel
  export let embedded = false
  let messages: WhatsappMessage[] = []
  let loaded = false
  let now = Date.now()
  let templates: WhatsappTemplate[] | undefined
  let templatesError: IntlString | undefined
  let loadingTemplates = false
  let templateKey = ''
  let parameters: string[] = []
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
    // Re-check the 24 hour window while the chat stays open.
    const timer = setInterval(() => {
      now = Date.now()
    }, 30000)
    void getConnection()
      .then((value) => {
        connection = value
      })
      .catch((err) => {
        error = err instanceof ConnectionError ? err.label : whatsapp.string.Unavailable
      })
    return () => {
      clearInterval(timer)
    }
  })

  const keyOf = (t: WhatsappTemplate): string => t.name + '|' + t.language

  $: lastIncoming = lastIncomingAt(messages)
  $: windowOpen = isReplyWindowOpen(lastIncoming, now, connection?.replyWindowMs ?? REPLY_WINDOW_MS)
  $: selected = templates?.find((t) => keyOf(t) === templateKey)
  $: if (selected !== undefined && parameters.length !== selected.parameterCount) {
    parameters = Array.from({ length: selected.parameterCount }, (_, i) => parameters[i] ?? '')
  }
  $: preview = selected !== undefined ? renderTemplate(selected.body, parameters) : ''
  $: templateReady = selected !== undefined && parameters.every((value) => isValidTemplateParameter(value))
  $: if (
    loaded &&
    !windowOpen &&
    connection?.connected === true &&
    templates === undefined &&
    !loadingTemplates &&
    templatesError === undefined
  ) {
    void loadTemplates()
  }

  async function loadTemplates (): Promise<void> {
    loadingTemplates = true
    try {
      templates = await getTemplates()
      if (templates.length > 0 && templateKey === '') templateKey = keyOf(templates[0])
    } catch (err) {
      templatesError = err instanceof ConnectionError ? err.label : whatsapp.string.TemplatesFailed
    } finally {
      loadingTemplates = false
    }
  }

  function retryTemplates (): void {
    templatesError = undefined
    templates = undefined
  }

  async function send (): Promise<void> {
    if (busy) return
    // Outside the 24 hour window Meta only accepts approved templates.
    const template = windowOpen ? undefined : selected
    if (template === undefined) {
      if (!windowOpen || draft.trim() === '' || draft.length > 4096) return
    } else if (!templateReady) {
      error = whatsapp.string.InvalidTemplateParameter
      return
    }
    busy = true
    error = undefined
    const values = parameters.map((value) => value.trim())
    const text = template !== undefined ? renderTemplate(template.body, values) : draft
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
          sendOn: Date.now(),
          ...(template !== undefined
            ? { templateName: template.name, templateLanguage: template.language, templateParameters: values }
            : {})
        },
        id
      )
      if (!(await ops.commit()).result) throw new Error('Message was not saved')
      if (template !== undefined) {
        parameters = parameters.map(() => '')
      } else if (channel._id === target._id && draft === text) draft = ''
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
      loaded = true
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
          {#if message.templateName !== undefined}
            <div class="tag"><Label label={whatsapp.string.Template} /> · {message.templateName}</div>
          {/if}
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
    {#if !loaded}
      <!-- Wait for the messages so the 24 hour check does not flash the wrong mode. -->
    {:else if windowOpen}
      <label for="whatsapp-reply"><Label label={whatsapp.string.Reply} /></label>
      <textarea
        id="whatsapp-reply"
        bind:value={draft}
        maxlength={4096}
        rows={3}
        disabled={busy || connection?.connected !== true}
      />
    {:else}
      <p class="notice" role="status">
        <Label label={lastIncoming === undefined ? whatsapp.string.NeverWrote : whatsapp.string.WindowClosed} />
      </p>
      {#if connection?.connected === true}
        {#if templatesError !== undefined}
          <p class="error" role="alert"><Label label={templatesError} /></p>
          <Button label={whatsapp.string.ChooseTemplate} kind="regular" on:click={retryTemplates} />
        {:else if templates === undefined}
          <p><Label label={whatsapp.string.LoadingTemplates} /></p>
        {:else if templates.length === 0}
          <p><Label label={whatsapp.string.NoTemplates} /></p>
        {:else}
          <label for="whatsapp-template"><Label label={whatsapp.string.ChooseTemplate} /></label>
          <select id="whatsapp-template" bind:value={templateKey} disabled={busy}>
            {#each templates as template (keyOf(template))}
              <option value={keyOf(template)}>{template.name} ({template.language})</option>
            {/each}
          </select>
          {#each parameters as value, i (i)}
            <label for={'whatsapp-param-' + i}>
              <Label label={whatsapp.string.TemplateParameter} params={{ n: i + 1 }} />
            </label>
            <input
              id={'whatsapp-param-' + i}
              class:invalid={value !== '' && !isValidTemplateParameter(value)}
              bind:value={parameters[i]}
              maxlength={1024}
              disabled={busy}
            />
          {/each}
          {#if selected !== undefined}
            <div class="preview">
              <span><Label label={whatsapp.string.TemplatePreview} /></span>
              <p>{preview}</p>
            </div>
          {/if}
        {/if}
      {/if}
    {/if}
    {#if connection !== undefined && !connection.connected}<p>
        <Label label={whatsapp.string.ConnectionRequired} />
      </p>{/if}
    {#if error !== undefined}<p class="error" role="alert"><Label label={error} /></p>{/if}
    <div class="actions">
      <Button
        label={whatsapp.string.Send}
        kind="primary"
        loading={busy}
        disabled={busy ||
          !loaded ||
          connection?.connected !== true ||
          (windowOpen ? draft.trim() === '' || draft.length > 4096 : !templateReady)}
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
  input.invalid {
    border-color: var(--theme-error-color);
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
  .tag {
    font-size: 0.75rem;
    color: var(--theme-caption-color);
    margin-bottom: 0.3rem;
  }
  .notice {
    margin: 0 0 0.5rem;
    color: var(--theme-content-color);
  }
  select,
  input {
    width: 100%;
    margin: 0.4rem 0 0.6rem;
    padding: 0.55rem;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.4rem;
    background: var(--theme-button-default);
    color: var(--theme-content-color);
    font: inherit;
  }
  .preview {
    padding: 0.6rem 0.8rem;
    border-left: 3px solid var(--theme-button-border);
    background: var(--theme-button-default);
    border-radius: 0.3rem;
  }
  .preview p {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0.3rem 0 0;
    color: var(--theme-content-color);
  }
  .composer {
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--theme-divider-color);
    color: var(--theme-caption-color);
  }
</style>
