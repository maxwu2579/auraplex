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

import type { Resources } from '@hcengineering/platform'
import Connect from './components/Connect.svelte'
import State from './components/State.svelte'
import Icon from './components/Icon.svelte'
import Chat from './components/Chat.svelte'
import { disconnect } from './api'

export default async (): Promise<Resources> => ({
  component: { Connect, State, Icon, Chat },
  handler: { Disconnect: disconnect }
})
