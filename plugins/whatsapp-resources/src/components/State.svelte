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
  export let integration: Integration
</script>

<div class="state">
  <p><Label label={whatsapp.string.PhoneNumberId} /> — {integration.data?.phoneNumberId}</p>
  <p><Label label={whatsapp.string.WabaId} /> — {integration.data?.wabaId}</p>
  <p><Label label={whatsapp.string.TokenStored} /></p>
</div>

<style>
  .state p {
    margin: 0.5rem 0;
    overflow-wrap: anywhere;
  }
</style>
