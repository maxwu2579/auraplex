//
// Copyright © 2020, 2021 Anticrm Platform Contributors.
// Copyright © 2021, 2022 Hardcore Engineering Inc.
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

import { type Builder, Mixin } from '@hcengineering/model'

import contact from '@hcengineering/contact'
import core from '@hcengineering/core'
import materials from '@hcengineering/materials'
import { TClass } from '@hcengineering/model-core'
import { TNotificationType } from '@hcengineering/model-notification'
import notification from '@hcengineering/notification'
import { type Resource } from '@hcengineering/platform'
import serverCore from '@hcengineering/server-core'
import serverNotification, {
  type HTMLPresenter,
  type NotificationContentProvider,
  type NotificationPresenter,
  type Presenter,
  type TextPresenter,
  type TypeMatch,
  type TypeMatchFunc
} from '@hcengineering/server-notification'

export { serverNotificationId } from '@hcengineering/server-notification'

@Mixin(serverNotification.mixin.HTMLPresenter, core.class.Class)
export class THTMLPresenter extends TClass implements HTMLPresenter {
  presenter!: Resource<Presenter>
}

@Mixin(serverNotification.mixin.TextPresenter, core.class.Class)
export class TTextPresenter extends TClass implements TextPresenter {
  presenter!: Resource<Presenter>
}

@Mixin(serverNotification.mixin.NotificationPresenter, core.class.Class)
export class TNotificationPresenter extends TClass implements NotificationPresenter {
  presenter!: Resource<NotificationContentProvider>
}

@Mixin(serverNotification.mixin.TypeMatch, notification.class.NotificationType)
export class TTypeMatch extends TNotificationType implements TypeMatch {
  func!: TypeMatchFunc
}

export function createModel (builder: Builder): void {
  builder.createModel(THTMLPresenter, TTextPresenter, TTypeMatch, TNotificationPresenter)

  // Low stock alerts. Registered here, not in model-materials, because the Trigger
  // class is defined by model-server-core, which is built after model-materials.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverNotification.trigger.OnMaterialStockMovement,
    isAsync: true,
    txMatch: { _class: core.class.TxCreateDoc, objectClass: materials.class.StockMovement }
  })

  // Auraplex tracking: record logins (online status itself is temporary) and watch page opens.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverNotification.trigger.OnAuditLogin,
    txMatch: { objectClass: core.class.UserStatus }
  })
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverNotification.trigger.OnAuditView,
    txMatch: {
      _class: { $in: [core.class.TxCreateDoc, core.class.TxUpdateDoc] as any },
      objectClass: 'departments:class:AuditEvent' as any
    }
  })

  // Auraplex orders: fill new orders from the flow and apply checked order actions (ids spelled out
  // for the same build-order reason as above).
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverNotification.trigger.OnOrder,
    txMatch: {
      _class: core.class.TxCreateDoc,
      objectClass: { $in: ['departments:class:Order', 'departments:class:OrderAction'] as any }
    }
  })

  // Auraplex applications: close open steps and tell the approvers when the applicant withdraws or cancels.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverNotification.trigger.OnApplicationCancelled,
    txMatch: {
      _class: core.class.TxUpdateDoc,
      objectClass: 'process:class:Execution' as any
    }
  })

  // Auraplex automation rules: react when an application is approved or rejected.
  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverNotification.trigger.OnApplicationRule,
    txMatch: {
      _class: core.class.TxUpdateDoc,
      objectClass: { $in: ['process:class:Execution', 'process:class:ApproveRequest'] as any }
    }
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverNotification.trigger.OnAttributeCreate,
    txMatch: {
      objectClass: core.class.Attribute,
      _class: core.class.TxCreateDoc
    }
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverNotification.trigger.OnAttributeUpdate,
    txMatch: {
      objectClass: core.class.Attribute,
      _class: core.class.TxUpdateDoc
    }
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverNotification.trigger.OnDocRemove,
    txMatch: {
      _class: core.class.TxRemoveDoc
    }
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverNotification.trigger.OnEmployeeDeactivate,
    isAsync: true,
    txMatch: {
      _class: core.class.TxMixin,
      mixin: contact.mixin.Employee
    }
  })

  builder.createDoc(serverCore.class.Trigger, core.space.Model, {
    trigger: serverNotification.trigger.PushNotificationsHandler,
    isAsync: true,
    txMatch: {
      _class: core.class.TxCreateDoc,
      objectClass: notification.class.InboxNotification
    }
  })

  builder.mixin(
    notification.ids.MentionNotificationType,
    notification.class.NotificationType,
    serverNotification.mixin.TypeMatch,
    {
      func: serverNotification.function.MentionTypeMatch
    }
  )
}
