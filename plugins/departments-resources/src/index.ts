// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { Resources } from '@hcengineering/platform'
import Directory from './components/Directory.svelte'
import Orders from './components/Orders.svelte'
import OrderFlowSettings from './components/OrderFlowSettings.svelte'
import ActivityLog from './components/ActivityLog.svelte'
import Workload from './components/Workload.svelte'
import TrackingSettingsPage from './components/TrackingSettingsPage.svelte'

export default async (): Promise<Resources> => ({
  component: { Directory, Orders, OrderFlowSettings, ActivityLog, Workload, TrackingSettingsPage }
})
