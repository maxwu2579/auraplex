<!--
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
-->
<script lang="ts">
  import { type Doc } from '@hcengineering/core'
  import { type IntlString } from '@hcengineering/platform'
  import { Card } from '@hcengineering/presentation'
  import { Button, CheckBox, Label, Loading } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'

  import share from '../plugin'
  import { buildShareContent, buildShareText, fileBaseName, type ShareContent } from '../content'
  import { canvasToBlob, canvasToPdf, downloadBlob, renderShareCard } from '../render'
  import { canCopyImage, canSystemShare, copyImage, copyText, isAbort, openWhatsApp, systemShare } from '../send'

  export let object: Doc

  const dispatch = createEventDispatcher()

  let content: ShareContent | undefined
  let loading = true
  let selected = new Set<string>()
  let mode: 'text' | 'image' = 'text'
  let busy = false

  let message: { label: IntlString, params?: Record<string, any>, error?: boolean } | undefined
  let messageTimer: any

  const imageClipboard = canCopyImage()
  const sheet = canSystemShare()

  onMount(async () => {
    try {
      content = await buildShareContent(object)
      selected = new Set(content?.fields.filter((f) => f.defaultOn).map((f) => f.id) ?? [])
    } catch (err: any) {
      say(share.string.Failed, { error: err?.message ?? String(err) }, true)
    } finally {
      loading = false
    }
  })

  function say (label: IntlString, params?: Record<string, any>, error = false): void {
    message = { label, params, error }
    clearTimeout(messageTimer)
    if (!error) {
      messageTimer = setTimeout(() => {
        message = undefined
      }, 4000)
    }
  }

  function toggle (id: string, on: boolean): void {
    if (on) selected.add(id)
    else selected.delete(id)
    selected = selected
  }

  $: text = content !== undefined ? buildShareText(content, selected) : ''
  $: canvas = content !== undefined && mode === 'image' ? renderShareCard(content, selected) : undefined

  let imageUrl: string | undefined
  $: void updateImageUrl(canvas)
  async function updateImageUrl (c: HTMLCanvasElement | undefined): Promise<void> {
    if (c === undefined) return
    const blob = await canvasToBlob(c)
    if (imageUrl !== undefined) URL.revokeObjectURL(imageUrl)
    imageUrl = URL.createObjectURL(blob)
  }
  onDestroy(() => {
    if (imageUrl !== undefined) URL.revokeObjectURL(imageUrl)
    clearTimeout(messageTimer)
  })

  async function png (): Promise<Blob> {
    if (content === undefined) throw new Error('nothing to share')
    return await canvasToBlob(canvas ?? renderShareCard(content, selected))
  }
  $: baseName = content !== undefined ? fileBaseName(content, selected) : 'share'

  async function run (fn: () => Promise<void>): Promise<void> {
    if (busy) return
    busy = true
    try {
      await fn()
    } catch (err: any) {
      if (!isAbort(err)) say(share.string.Failed, { error: err?.message ?? String(err) }, true)
    } finally {
      busy = false
    }
  }

  // WeChat has no web share entry point: hand over through the clipboard,
  // as an image when the image preview is shown and the browser allows it.
  const toWeChat = async (): Promise<void> => {
    await run(async () => {
      if (mode === 'image' && imageClipboard) {
        await copyImage(await png())
        say(share.string.WeChatImageCopied)
      } else {
        await copyText(text)
        say(share.string.WeChatCopied)
      }
    })
  }
  const toWhatsApp = async (): Promise<void> => {
    if (content === undefined) return
    openWhatsApp(buildShareText(content, selected, 'whatsapp'))
  }
  const doCopyText = async (): Promise<void> => {
    await run(async () => {
      await copyText(text)
      say(share.string.Copied)
    })
  }
  const doCopyImage = async (): Promise<void> => {
    await run(async () => {
      await copyImage(await png())
      say(share.string.ImageCopied)
    })
  }
  const doDownloadImage = async (): Promise<void> => {
    await run(async () => {
      downloadBlob(await png(), `${baseName}.png`)
    })
  }
  const doDownloadPdf = async (): Promise<void> => {
    await run(async () => {
      if (content === undefined) return
      const c = canvas ?? renderShareCard(content, selected)
      downloadBlob(await canvasToPdf(c), `${baseName}.pdf`)
    })
  }
  const doSystemShare = async (): Promise<void> => {
    await run(async () => {
      await systemShare(baseName, text, mode === 'image' ? await png() : undefined, `${baseName}.png`)
    })
  }
</script>

<Card
  label={share.string.ShareTo}
  okAction={() => {}}
  hideFooter
  width={'large'}
  on:close={() => dispatch('close')}
  on:changeContent
>
  {#if loading}
    <div class="flex-center p-4"><Loading /></div>
  {:else if content !== undefined}
    <div class="share-layout">
      <div class="share-fields">
        <div class="share-caption"><Label label={share.string.Fields} /></div>
        {#each content.fields as field (field.id)}
          <!-- svelte-ignore a11y-click-events-have-key-events -->
          <!-- svelte-ignore a11y-no-static-element-interactions -->
          <div
            class="share-field"
            on:click={() => {
              toggle(field.id, !selected.has(field.id))
            }}
          >
            <CheckBox
              checked={selected.has(field.id)}
              on:value={(e) => {
                toggle(field.id, e.detail === true)
              }}
            />
            <span class="share-field__label">{field.label}</span>
            <span class="share-field__value">{field.value.split('\n')[0]}</span>
          </div>
        {/each}
      </div>

      <div class="share-preview">
        <div class="share-tabs">
          <Button
            label={share.string.PreviewText}
            kind={'ghost'}
            size={'small'}
            selected={mode === 'text'}
            on:click={() => (mode = 'text')}
          />
          <Button
            label={share.string.PreviewImage}
            kind={'ghost'}
            size={'small'}
            selected={mode === 'image'}
            on:click={() => (mode = 'image')}
          />
        </div>
        <div class="share-preview__body">
          {#if mode === 'text'}
            <pre class="share-text">{text}</pre>
          {:else if imageUrl !== undefined}
            <img class="share-image" src={imageUrl} alt="" />
          {/if}
        </div>
      </div>
    </div>

    <div class="share-note">
      <Label label={share.string.Snapshot} />
      {#if mode === 'image' && !imageClipboard}
        <br /><Label label={share.string.SecureContextHint} />
      {/if}
    </div>

    <div class="share-actions">
      <Button
        icon={share.icon.WeChat}
        label={share.string.WeChat}
        kind={'primary'}
        disabled={busy}
        on:click={toWeChat}
      />
      <Button
        icon={share.icon.WhatsApp}
        label={share.string.WhatsApp}
        kind={'primary'}
        disabled={busy}
        on:click={toWhatsApp}
      />
      <Button label={share.string.CopyText} disabled={busy} on:click={doCopyText} />
      {#if imageClipboard}
        <Button label={share.string.CopyImage} disabled={busy} on:click={doCopyImage} />
      {/if}
      <Button label={share.string.DownloadImage} disabled={busy} on:click={doDownloadImage} />
      <Button label={share.string.DownloadPDF} disabled={busy} on:click={doDownloadPdf} />
      {#if sheet}
        <Button icon={share.icon.Share} label={share.string.SystemShare} disabled={busy} on:click={doSystemShare} />
      {/if}
    </div>
  {/if}

  {#if message !== undefined}
    <div class="share-message" class:error={message.error}>
      <Label label={message.label} params={message.params ?? {}} />
    </div>
  {/if}
</Card>

<style lang="scss">
  .share-layout {
    display: grid;
    grid-template-columns: minmax(12rem, 16rem) minmax(0, 1fr);
    gap: 1rem;
    min-height: 20rem;
  }
  @media (max-width: 640px) {
    .share-layout {
      grid-template-columns: 1fr;
    }
  }
  .share-caption {
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: var(--theme-caption-color);
  }
  .share-fields {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    min-width: 0;
  }
  .share-field {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr);
    align-items: center;
    gap: 0.5rem;
    padding: 0.375rem 0.5rem;
    border-radius: var(--small-BorderRadius);
    cursor: pointer;

    &:hover {
      background-color: var(--theme-button-default);
    }
    &__label {
      color: var(--theme-caption-color);
      white-space: nowrap;
    }
    &__value {
      color: var(--theme-dark-color);
      font-size: 0.75rem;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
  }
  .share-preview {
    display: flex;
    flex-direction: column;
    min-width: 0;
    border: 1px solid var(--theme-divider-color);
    border-radius: var(--medium-BorderRadius);
    overflow: hidden;
  }
  .share-tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.375rem;
    border-bottom: 1px solid var(--theme-divider-color);
  }
  .share-preview__body {
    flex: 1;
    max-height: 26rem;
    overflow: auto;
    padding: 0.75rem;
  }
  .share-text {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    font-family: inherit;
    font-size: 0.875rem;
    line-height: 1.5;
    color: var(--theme-content-color);
  }
  .share-image {
    display: block;
    width: 100%;
    max-width: 375px;
    margin: 0 auto;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  }
  .share-note {
    margin-top: 0.75rem;
    font-size: 0.75rem;
    color: var(--theme-dark-color);
  }
  .share-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .share-message {
    margin-top: 0.75rem;
    font-size: 0.875rem;
    color: var(--theme-caption-color);

    &.error {
      color: var(--theme-error-color, #d33);
    }
  }
</style>
