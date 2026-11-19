// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { Resources } from '@hcengineering/platform'
import Directory from './components/Directory.svelte'
import Orders from './components/Orders.svelte'
import OrderFlowSettings from './components/OrderFlowSettings.svelte'
import ActivityLog from './components/ActivityLog.svelte'
import Workload from './components/Workload.svelte'
import TrackingSettingsPage from './components/TrackingSettingsPage.svelte'
import TodayActivity from './components/TodayActivity.svelte'
import OrderPanel from './components/OrderPanel.svelte'
import departments, { type Order } from '@hcengineering/departments'
import type { Client, Doc, Ref } from '@hcengineering/core'

/** Inbox and links show an order as "ORD-0001 顶部贴标机". */
async function orderTitle (client: Client, ref: Ref<Doc>, doc?: Doc): Promise<string> {
  const order = (doc as Order | undefined) ?? await client.findOne(departments.class.Order, { _id: ref as Ref<Order> })
  return order === undefined ? '' : `${order.number ?? ''} ${order.title}`.trim()
}

export default async (): Promise<Resources> => ({
  component: { Directory, Orders, OrderFlowSettings, ActivityLog, Workload, TrackingSettingsPage, TodayActivity, OrderPanel },
  function: { OrderTitle: orderTitle }
})
