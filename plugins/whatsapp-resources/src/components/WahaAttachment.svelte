<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { Button, Label } from '@hcengineering/ui'
  import whatsapp from '@hcengineering/whatsapp'
  import { readWahaAttachment } from '../api'

  export let mediaId: string
  export let deferred = false
  export let scope: { employee: string, channel: string } | undefined = undefined
  let container: HTMLDivElement
  let url: string | undefined
  let mime = ''
  let name = ''
  let size = 0
  let error = false
  let gone = false
  let loading = false

  async function load (): Promise<void> {
    if (loading || url !== undefined) return
    loading = true
    error = false
    try {
      const attachment = await readWahaAttachment(mediaId, scope)
      if (gone) return
      url = URL.createObjectURL(attachment.blob)
      mime = attachment.mime
      name = attachment.name
      size = attachment.blob.size
    } catch {
      error = true
    } finally {
      loading = false
    }
  }

  onMount(() => {
    if (deferred) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect()
        void load()
      }
    })
    observer.observe(container)
    return () => observer.disconnect()
  })

  onDestroy(() => {
    gone = true
    if (url !== undefined) URL.revokeObjectURL(url)
  })
</script>

<div bind:this={container} class="attachment">
  {#if url !== undefined}
    {#if ['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(mime)}
      <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={name} /></a>
    {:else if mime.startsWith('video/')}
      <!-- svelte-ignore a11y-media-has-caption -->
      <video controls preload="metadata" src={url} />
    {:else if mime.startsWith('audio/')}
      <audio controls preload="metadata" src={url} />
    {/if}
    <div><a href={url} download={name}>{name || '—'}</a> · {Math.ceil(size / 1024)} KB</div>
    <a href={url} download={name}><Label label={whatsapp.string.WahaAttachment} /></a>
  {:else if error || deferred}
    <Button label={whatsapp.string.WahaAttachment} on:click={load} />
  {/if}
</div>

<style>
  img, video, audio { max-width: min(100%, 24rem); }
  img { max-height: 16rem; object-fit: contain; }
  .attachment { overflow-wrap: anywhere; }
  a { color: var(--theme-link-color); }
</style>
