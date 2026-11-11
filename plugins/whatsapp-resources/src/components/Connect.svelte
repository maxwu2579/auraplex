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
  import { createEventDispatcher } from 'svelte'
  import { Button, Label } from '@hcengineering/ui'
  import type { IntlString } from '@hcengineering/platform'
  import type { Integration } from '@hcengineering/account-client'
  import whatsapp from '@hcengineering/whatsapp'
  import { ConnectionError, getConnection, saveConnection } from '../api'

  export let integration: Integration | undefined = undefined
  let phoneNumberId = integration?.data?.phoneNumberId ?? ''
  let wabaId = integration?.data?.wabaId ?? ''
  let token = ''
  let webhook = ''
  let connected = integration !== undefined
  let busy = true
  let error: IntlString | undefined
  const dispatch = createEventDispatcher()

  async function init (): Promise<void> {
    try {
      const state = await getConnection()
      connected = state.connected
      phoneNumberId = state.phoneNumberId ?? ''
      wabaId = state.wabaId ?? ''
      webhook = state.webhook
    } catch (err) {
      error = err instanceof ConnectionError ? err.label : whatsapp.string.Failed
    } finally {
      busy = false
    }
  }

  async function save (): Promise<void> {
    busy = true
    error = undefined
    try {
      const saving = saveConnection(phoneNumberId.trim(), wabaId.trim(), token)
      token = ''
      await saving
      dispatch('close', { connected: true })
    } catch (err) {
      error = err instanceof ConnectionError ? err.label : whatsapp.string.Failed
    } finally {
      busy = false
    }
  }

  void init()
</script>

<form class="whatsapp-connect" on:submit|preventDefault={save}>
  <h2><Label label={whatsapp.string.Whatsapp} /></h2>
  <label>
    <span><Label label={whatsapp.string.PhoneNumberId} /></span>
    <input
      name="phoneNumberId"
      bind:value={phoneNumberId}
      inputmode="numeric"
      pattern="[0-9]+"
      required
      disabled={busy || connected}
    />
  </label>
  <label>
    <span><Label label={whatsapp.string.WabaId} /></span>
    <input
      name="wabaId"
      bind:value={wabaId}
      inputmode="numeric"
      pattern="[0-9]+"
      required
      disabled={busy || connected}
    />
  </label>
  <label>
    <span><Label label={whatsapp.string.AccessToken} /></span>
    <input
      name="accessToken"
      type="password"
      bind:value={token}
      autocomplete="off"
      spellcheck="false"
      required={!connected}
      disabled={busy}
    />
  </label>
  {#if connected}<small><Label label={whatsapp.string.TokenHint} /></small>{/if}
  {#if webhook !== ''}
    <label>
      <span><Label label={whatsapp.string.Webhook} /></span>
      <input aria-label="Webhook" value={webhook} readonly />
    </label>
  {/if}
  {#if error !== undefined}<p class="error" role="alert"><Label label={error} /></p>{/if}
  <div class="buttons">
    <Button label={whatsapp.string.Cancel} disabled={busy} on:click={() => dispatch('close')} />
    <Button
      label={connected ? whatsapp.string.Save : whatsapp.string.Connect}
      kind="primary"
      loading={busy}
      disabled={busy ||
        !/^[0-9]+$/.test(phoneNumberId) ||
        !/^[0-9]+$/.test(wabaId) ||
        (!connected && token.trim() === '')}
      on:click={save}
    />
  </div>
</form>

<style>
  .whatsapp-connect {
    width: min(28rem, 90vw);
    padding: 1.5rem;
    border-radius: 0.75rem;
    background: var(--popup-bg-color);
    box-shadow: var(--popup-shadow);
  }
  h2 {
    margin: 0 0 1.5rem;
    font-size: 1.2rem;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-top: 1rem;
  }
  input {
    width: 100%;
    min-width: 0;
    padding: 0.6rem;
    border: 1px solid var(--theme-button-border);
    border-radius: 0.4rem;
    background: var(--theme-button-default);
    color: var(--theme-content-color);
  }
  small {
    display: block;
    margin-top: 0.5rem;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 1rem;
    margin-top: 1.5rem;
  }
  .error {
    color: var(--theme-error-color);
    margin-top: 1rem;
  }
</style>
