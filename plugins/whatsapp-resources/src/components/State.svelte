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
  import type { Integration } from '@hcengineering/account-client'
  import { Label } from '@hcengineering/ui'
  import whatsapp from '@hcengineering/whatsapp'
  import { onMount } from 'svelte'
  import { ConnectionError, getConnection, type ConnectionState } from '../api'
  export let integration: Integration
  let unavailable = false
  let state: ConnectionState | undefined

  onMount(() => {
    void getConnection().then((result) => { state = result }).catch((error) => {
      unavailable = error instanceof ConnectionError && error.label === whatsapp.string.Unavailable
    })
  })
</script>

<div class="state">
  {#if unavailable}
    <p role="status"><Label label={whatsapp.string.Unavailable} /></p>
  {:else if state?.provider === 'waha'}
    <p>WAHA · <Label label={state.connected ? whatsapp.string.Connected
      : ['STARTING', 'SCAN_QR_CODE'].includes(state.status ?? '') ? whatsapp.string.WahaWaiting
      : state.status === 'UNCONFIGURED' ? whatsapp.string.Unavailable : whatsapp.string.WahaDisconnected} />
      {state.displayPhone ?? ''}
    </p>
  {:else}
  <p><Label label={whatsapp.string.PhoneNumberId} /> — {integration.data?.phoneNumberId}</p>
  <p><Label label={whatsapp.string.WabaId} /> — {integration.data?.wabaId}</p>
  <p><Label label={whatsapp.string.TokenStored} /></p>
  {/if}
</div>

<style>
  .state p {
    margin: 0.5rem 0;
    overflow-wrap: anywhere;
  }
</style>
