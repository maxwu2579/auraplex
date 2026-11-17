// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { Resources } from '@hcengineering/platform'
import Directory from './components/Directory.svelte'
import Orders from './components/Orders.svelte'
import OrderFlowSettings from './components/OrderFlowSettings.svelte'

export default async (): Promise<Resources> => ({ component: { Directory, Orders, OrderFlowSettings } })
