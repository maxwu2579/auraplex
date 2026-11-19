<!-- Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0. -->
<script lang="ts">
  import jsQR from 'jsqr'
  import { languageStore } from '@hcengineering/ui'
  import { createEventDispatcher, onDestroy, onMount } from 'svelte'

  /** Camera QR scanner: emits `detected` with the text of the first code it reads. */
  const dispatch = createEventDispatcher<{ detected: string, close: undefined }>()
  let video: HTMLVideoElement
  let canvas: HTMLCanvasElement
  let stream: MediaStream | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let problem = ''
  $: zh = $languageStore === 'zh'

  onMount(async () => {
    if (navigator.mediaDevices?.getUserMedia === undefined) {
      problem = 'insecure'
      return
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      video.srcObject = stream
      await video.play()
      timer = setInterval(scan, 250)
    } catch {
      problem = 'denied'
    }
  })

  function scan (): void {
    if (video.readyState < 2 || video.videoWidth === 0) return
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx === null) return
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const code = jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })
    if (code !== null && code.data !== '') {
      stop()
      dispatch('detected', code.data)
    }
  }

  function stop (): void {
    if (timer !== undefined) clearInterval(timer)
    timer = undefined
    stream?.getTracks().forEach((track) => { track.stop() })
    stream = undefined
  }

  onDestroy(stop)
</script>

<div class="scanner" role="dialog" aria-label={zh ? '扫描二维码' : 'Scan QR code'}>
  <div class="box">
    <header>
      <strong>{zh ? '扫描二维码' : 'Scan QR code'}</strong>
      <button type="button" class="close" on:click={() => { stop(); dispatch('close') }}>{zh ? '关闭' : 'Close'}</button>
    </header>
    {#if problem === 'insecure'}
      <p class="hint">{zh ? '这个网址不能使用摄像头（要用 https 网址）。也可以用手机相机直接扫二维码。' : 'The camera is not available on this address (https is needed). You can also scan with the phone camera app.'}</p>
    {:else if problem === 'denied'}
      <p class="hint">{zh ? '没有摄像头权限，请在浏览器里允许使用摄像头后再试。' : 'No camera access. Allow the camera in the browser and try again.'}</p>
    {:else}
      <!-- svelte-ignore a11y-media-has-caption -->
      <video bind:this={video} playsinline muted></video>
      <p class="hint">{zh ? '把二维码对准框内' : 'Point the camera at the QR code'}</p>
    {/if}
    <canvas bind:this={canvas} hidden></canvas>
  </div>
</div>

<style>
  .scanner {
    position: fixed; inset: 0; z-index: 30; display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.6); padding: 1rem;
  }
  .box {
    width: min(28rem, 100%); display: flex; flex-direction: column; gap: 0.75rem; padding: 1rem;
    border-radius: 0.75rem; background: var(--theme-popup-color, var(--theme-bg-color)); color: var(--theme-content-color);
  }
  header { display: flex; align-items: center; justify-content: space-between; }
  header strong { color: var(--theme-caption-color); font-size: 1rem; }
  video { width: 100%; border-radius: 0.5rem; background: #000; aspect-ratio: 1 / 1; object-fit: cover; }
  .hint { margin: 0; color: var(--theme-dark-color); font-size: 0.85rem; }
  .close {
    border: 1px solid var(--theme-divider-color); background: transparent; color: var(--theme-content-color);
    border-radius: 0.375rem; padding: 0.4rem 0.9rem; font-size: 0.9rem; cursor: pointer;
  }
</style>
