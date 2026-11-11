//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { type IntlString, type Plugin, plugin, type Asset } from '@hcengineering/platform'
import { type AnyComponent } from '@hcengineering/ui/src/types'

/**
 * Share plugin: send a snapshot of a task / document to personal chat apps
 * (WeChat, WhatsApp) as text, image or PDF.
 * @public
 */
export const shareId = 'share' as Plugin

export const share = plugin(shareId, {
  string: {
    Share: '' as IntlString,
    ShareTo: '' as IntlString,
    Fields: '' as IntlString,
    Preview: '' as IntlString,
    PreviewText: '' as IntlString,
    PreviewImage: '' as IntlString,
    Snapshot: '' as IntlString,
    CopyText: '' as IntlString,
    CopyImage: '' as IntlString,
    DownloadImage: '' as IntlString,
    DownloadPDF: '' as IntlString,
    WhatsApp: '' as IntlString,
    WeChat: '' as IntlString,
    SystemShare: '' as IntlString,
    Copied: '' as IntlString,
    ImageCopied: '' as IntlString,
    WeChatCopied: '' as IntlString,
    WeChatImageCopied: '' as IntlString,
    Failed: '' as IntlString,
    SecureContextHint: '' as IntlString,
    Loading: '' as IntlString,
    SharedFrom: '' as IntlString,
    // object kinds
    Task: '' as IntlString,
    Document: '' as IntlString,
    // field labels
    Identifier: '' as IntlString,
    Title: '' as IntlString,
    Status: '' as IntlString,
    Priority: '' as IntlString,
    Assignee: '' as IntlString,
    DueDate: '' as IntlString,
    Project: '' as IntlString,
    Description: '' as IntlString,
    Link: '' as IntlString,
    Teamspace: '' as IntlString,
    UpdatedOn: '' as IntlString,
    Content: '' as IntlString,
    Unassigned: '' as IntlString,
    // priorities
    NoPriority: '' as IntlString,
    Urgent: '' as IntlString,
    High: '' as IntlString,
    Medium: '' as IntlString,
    Low: '' as IntlString
  },
  component: {
    ShareDialog: '' as AnyComponent
  },
  icon: {
    Share: '' as Asset,
    WhatsApp: '' as Asset,
    WeChat: '' as Asset
  }
})

export default share
