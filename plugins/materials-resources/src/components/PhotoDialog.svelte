<!-- Copyright © 2026 Auraplex. Licensed under EPL-2.0: https://www.eclipse.org/legal/epl-2.0 -->
<script lang="ts">
  import { Label } from '@hcengineering/ui'
  import materials from '@hcengineering/materials'

  import attachment, { type Photo } from '@hcengineering/attachment'
  import { SortingOrder } from '@hcengineering/core'
  import { createQuery, getBlobRef } from '@hcengineering/presentation'
  import { type Material } from '@hcengineering/materials'
  import { createEventDispatcher } from 'svelte'

  /** Shows a material's photos large, one at a time, with previous / next. Read only. */
  export let material: Material

  const dispatch = createEventDispatcher()
  const query = createQuery()
  let photos: Photo[] = []
  let loaded = false
  let index = 0

  $: query.query(
    attachment.class.Photo,
    { attachedTo: material._id },
    (result) => {
      photos = result
      loaded = true
      if (index >= result.length) index = 0
    },
    { sort: { createdOn: SortingOrder.Ascending } }
  )
  $: current = photos[index]
  $: location = [material.rack, material.level].filter((part) => part !== undefined && part !== '').join(' / ')

  function close (): void {
    dispatch('close')
  }
  function step (by: number): void {
    if (photos.length > 1) index = (index + by + photos.length) % photos.length
  }
  function key (e: KeyboardEvent): void {
    if (e.key === 'Escape') close()
    else if (e.key === 'ArrowLeft') step(-1)
    else if (e.key === 'ArrowRight') step(1)
  }
</script>

<svelte:window on:keydown={key} />

<!-- Clicking the dark background closes the viewer. -->
<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="overlay" role="presentation" on:click|self={close}>
  <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="materials-photo-title">
    <div class="head">
      <h2 id="materials-photo-title" title={material.code}>{material.code}</h2>
      <button on:click={close} aria-label="Close">×</button>
    </div>
    <p class="info">
      {material.name}{#if location !== ''}
        · 位置：{location}{/if}
    </p>
    <div class="viewer">
      {#if current !== undefined}
        {#key current._id}
          {#await getBlobRef(current.file, current.name) then image}
            <img src={image.src} alt={current.name} />
          {:catch}
            <p class="note"><Label label={materials.string.PagePhotoFailed} /></p>
          {/await}
        {/key}
      {:else if loaded}
        <p class="note"><Label label={materials.string.PageNoPhotos} /></p>
      {:else}
        <p class="note"><Label label={materials.string.PageLoading} /></p>
      {/if}
    </div>
    {#if photos.length > 1}
      <div class="nav">
        <button on:click={() => { step(-1) }}><Label label={materials.string.PagePrevious} /></button>
        <span>{index + 1} / {photos.length}</span>
        <button on:click={() => { step(1) }}><Label label={materials.string.PageNext} /></button>
      </div>
    {/if}
  </section>
</div>

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.7);
  }
  .dialog {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    background: var(--popup-bg-color, #24252a);
    color: var(--theme-content-color);
    width: min(56rem, 95vw);
    max-height: 92vh;
    border-radius: 0.7rem;
    padding: 1.25rem;
    box-shadow: var(--popup-shadow);
    box-sizing: border-box;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  h2 {
    font-size: 1.1rem;
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .info {
    margin: 0;
    color: var(--theme-caption-color);
    overflow-wrap: anywhere;
  }
  .viewer {
    flex: 1;
    min-height: 12rem;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.25);
    border-radius: 0.5rem;
    overflow: hidden;
  }
  img {
    max-width: 100%;
    max-height: 70vh;
    object-fit: contain;
  }
  .note {
    color: var(--theme-caption-color);
    padding: 2rem;
    text-align: center;
  }
  .nav {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
  }
  button {
    color: var(--theme-content-color);
    font: inherit;
    border: 1px solid var(--theme-button-border);
    background: var(--theme-button-default);
    border-radius: 0.4rem;
    padding: 0.4rem 0.8rem;
    cursor: pointer;
  }
</style>
