//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import contact, { getName, type Person } from '@hcengineering/contact'
import core, { type Doc, type Space, type Status, makeDocCollabId } from '@hcengineering/core'
import document, { type Document } from '@hcengineering/document'
import { type IntlString, translate } from '@hcengineering/platform'
import { getClient, getMarkup } from '@hcengineering/presentation'
import { markupToJSON, MarkupNodeType, type MarkupNode } from '@hcengineering/text'
import tracker, { IssuePriority, type Issue } from '@hcengineering/tracker'
import { locationToUrl, themeStore } from '@hcengineering/ui'
import { getObjectLinkFragment } from '@hcengineering/view-resources'
import { get } from 'svelte/store'

import share from './plugin'

/**
 * How a field is laid out in the text / image output.
 * - `id`, `title`: merged into the heading line
 * - `meta`: short "label: value" row
 * - `body`: long multi-line block
 * - `link`: URL row
 */
export type ShareFieldRole = 'id' | 'title' | 'meta' | 'body' | 'link'

export interface ShareField {
  id: string
  label: string
  value: string
  role: ShareFieldRole
  defaultOn: boolean
}

/** A snapshot of one object, ready to be turned into text / image / PDF. */
export interface ShareContent {
  kind: string
  fields: ShareField[]
  /** Moment the snapshot was taken; shown in the footer. */
  takenAt: number
  footer: string
}

export type TextFlavor = 'plain' | 'whatsapp'

function lang (): string {
  return get(themeStore).language ?? 'en'
}

async function t (label: IntlString, params: Record<string, any> = {}): Promise<string> {
  return await translate(label, params, lang())
}

export function formatDate (ts: number, withTime = false): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return withTime ? `${date} ${pad(d.getHours())}:${pad(d.getMinutes())}` : date
}

async function objectUrl (doc: Doc): Promise<string> {
  const loc = await getObjectLinkFragment(getClient().getHierarchy(), doc, {})
  return `${window.location.origin}${locationToUrl(loc)}`
}

async function readMarkup (doc: Doc, attr: string): Promise<string> {
  const ref = (doc as any)[attr]
  if (ref == null || ref === '') return ''
  try {
    const markup = await getMarkup(makeDocCollabId(doc, attr), ref)
    return markupToPlainText(markupToJSON(markup))
  } catch (err: any) {
    console.warn('share: could not read content', err)
    return ''
  }
}

/**
 * Converts rich text into chat-friendly plain text: keeps paragraphs, headings,
 * bullet / numbered lists and checklists, drops formatting marks.
 */
export function markupToPlainText (root: MarkupNode): string {
  const out: string[] = []

  const inline = (node: MarkupNode): string => {
    switch (node.type) {
      case MarkupNodeType.text:
        return node.text ?? ''
      case MarkupNodeType.hard_break:
        return '\n'
      case MarkupNodeType.reference:
        return `@${node.attrs?.label ?? ''}`
      case MarkupNodeType.emoji:
        return String(node.attrs?.emoji ?? '')
      case MarkupNodeType.image:
        return '[🖼]'
      case MarkupNodeType.file:
        return `[${String(node.attrs?.title ?? 'file')}]`
      default:
        return (node.content ?? []).map(inline).join('')
    }
  }

  const block = (node: MarkupNode, indent: string): void => {
    switch (node.type) {
      case MarkupNodeType.doc:
      case MarkupNodeType.blockquote:
        for (const c of node.content ?? []) block(c, indent)
        return
      case MarkupNodeType.bullet_list:
      case MarkupNodeType.ordered_list:
      case MarkupNodeType.taskList:
      case MarkupNodeType.todoList: {
        let n = Number(node.attrs?.start ?? 1)
        for (const item of node.content ?? []) {
          let marker = '• '
          if (node.type === MarkupNodeType.ordered_list) marker = `${n++}. `
          if (item.type === MarkupNodeType.taskItem || item.type === MarkupNodeType.todoItem) {
            marker = item.attrs?.checked === true ? '☑ ' : '☐ '
          }
          const parts = item.content ?? []
          const first = parts[0]
          const firstText = first !== undefined && first.type === MarkupNodeType.paragraph ? inline(first) : ''
          out.push(indent + marker + firstText)
          for (const rest of first !== undefined && first.type === MarkupNodeType.paragraph ? parts.slice(1) : parts) {
            block(rest, indent + '  ')
          }
        }
        return
      }
      case MarkupNodeType.horizontal_rule:
        out.push(indent + '———')
        return
      case MarkupNodeType.table:
        for (const row of node.content ?? []) {
          out.push(indent + (row.content ?? []).map((cell) => inline(cell).trim()).join(' | '))
        }
        return
      case MarkupNodeType.code_block:
      case MarkupNodeType.paragraph:
      case MarkupNodeType.heading:
      default: {
        const text = inline(node)
        out.push(
          text
            .split('\n')
            .map((l) => indent + l)
            .join('\n')
        )
      }
    }
  }

  block(root, '')
  // collapse runs of blank lines
  return out
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const priorityLabels: Record<number, IntlString> = {
  [IssuePriority.NoPriority]: share.string.NoPriority,
  [IssuePriority.Urgent]: share.string.Urgent,
  [IssuePriority.High]: share.string.High,
  [IssuePriority.Medium]: share.string.Medium,
  [IssuePriority.Low]: share.string.Low
}

async function issueContent (issue: Issue): Promise<ShareContent> {
  const client = getClient()
  const [status, project, assignee, description, url] = await Promise.all([
    client.findOne(core.class.Status, { _id: issue.status }) as Promise<Status | undefined>,
    client.findOne(tracker.class.Project, { _id: issue.space }),
    issue.assignee != null
      ? (client.findOne(contact.class.Person, { _id: issue.assignee }) as Promise<Person | undefined>)
      : Promise.resolve(undefined),
    readMarkup(issue, 'description'),
    objectUrl(issue)
  ])

  const fields: ShareField[] = [
    { id: 'identifier', label: await t(share.string.Identifier), value: issue.identifier, role: 'id', defaultOn: true },
    { id: 'title', label: await t(share.string.Title), value: issue.title, role: 'title', defaultOn: true },
    { id: 'status', label: await t(share.string.Status), value: status?.name ?? '', role: 'meta', defaultOn: true },
    {
      id: 'priority',
      label: await t(share.string.Priority),
      value: await t(priorityLabels[issue.priority] ?? share.string.NoPriority),
      role: 'meta',
      defaultOn: issue.priority !== IssuePriority.NoPriority
    },
    {
      id: 'assignee',
      label: await t(share.string.Assignee),
      value: assignee !== undefined ? getName(client.getHierarchy(), assignee) : await t(share.string.Unassigned),
      role: 'meta',
      defaultOn: true
    },
    {
      id: 'dueDate',
      label: await t(share.string.DueDate),
      value: issue.dueDate != null ? formatDate(issue.dueDate) : '',
      role: 'meta',
      defaultOn: issue.dueDate != null
    },
    { id: 'project', label: await t(share.string.Project), value: project?.name ?? '', role: 'meta', defaultOn: false },
    { id: 'description', label: await t(share.string.Description), value: description, role: 'body', defaultOn: true },
    // The link only opens for people with an account, so it is off by default.
    { id: 'link', label: await t(share.string.Link), value: url, role: 'link', defaultOn: false }
  ]
  return await finish(await t(share.string.Task), fields)
}

async function documentContent (doc: Document): Promise<ShareContent> {
  const client = getClient()
  const [space, content, url] = await Promise.all([
    client.findOne(document.class.Teamspace, { _id: doc.space }) as Promise<Space | undefined>,
    readMarkup(doc, 'content'),
    objectUrl(doc)
  ])
  const fields: ShareField[] = [
    { id: 'title', label: await t(share.string.Title), value: doc.title, role: 'title', defaultOn: true },
    {
      id: 'teamspace',
      label: await t(share.string.Teamspace),
      value: space?.name ?? '',
      role: 'meta',
      defaultOn: false
    },
    {
      id: 'updatedOn',
      label: await t(share.string.UpdatedOn),
      value: formatDate(doc.modifiedOn, true),
      role: 'meta',
      defaultOn: true
    },
    { id: 'content', label: await t(share.string.Content), value: content, role: 'body', defaultOn: true },
    { id: 'link', label: await t(share.string.Link), value: url, role: 'link', defaultOn: false }
  ]
  return await finish(await t(share.string.Document), fields)
}

async function finish (kind: string, fields: ShareField[]): Promise<ShareContent> {
  const takenAt = Date.now()
  return {
    kind,
    // Empty fields are never offered.
    fields: fields.filter((f) => f.value.trim() !== ''),
    takenAt,
    footer: await t(share.string.SharedFrom, { date: formatDate(takenAt, true) })
  }
}

/** Builds the snapshot for any supported object, or `undefined` for unsupported classes. */
export async function buildShareContent (doc: Doc): Promise<ShareContent | undefined> {
  const h = getClient().getHierarchy()
  if (h.isDerived(doc._class, tracker.class.Issue)) return await issueContent(doc as Issue)
  if (h.isDerived(doc._class, document.class.Document)) return await documentContent(doc as Document)
  return undefined
}

function hasCJK (s: string): boolean {
  return /[\u3000-\u9fff\uff00-\uffef]/.test(s)
}

/** Heading line: "[Task] TSK-12 Fix login" */
export function headingOf (content: ShareContent, selected: Set<string>): { tag: string, title: string } {
  const pick = (role: ShareFieldRole): string =>
    content.fields
      .filter((f) => f.role === role && selected.has(f.id))
      .map((f) => f.value)
      .join(' ')
  return { tag: [content.kind, pick('id')].filter((s) => s !== '').join(' · '), title: pick('title') }
}

/**
 * Text for pasting into a chat. `whatsapp` flavor uses *bold* for the title
 * (WhatsApp renders it); WeChat has no formatting, so `plain` avoids markup.
 */
export function buildShareText (content: ShareContent, selected: Set<string>, flavor: TextFlavor = 'plain'): string {
  const lines: string[] = []
  const { tag, title } = headingOf(content, selected)
  const cn = hasCJK(content.kind)
  const sep = cn ? '：' : ': '
  const head = [cn ? `【${tag}】` : `[${tag}]`, title !== '' && flavor === 'whatsapp' ? `*${title}*` : title]
    .filter((s) => s !== '')
    .join(' ')
  lines.push(head)

  const on = content.fields.filter((f) => selected.has(f.id))
  const meta = on.filter((f) => f.role === 'meta')
  if (meta.length > 0) {
    lines.push('')
    for (const f of meta) lines.push(`${f.label}${sep}${f.value}`)
  }
  for (const f of on.filter((f) => f.role === 'body')) {
    lines.push('', `${f.label}${sep}`, f.value)
  }
  for (const f of on.filter((f) => f.role === 'link')) {
    lines.push('', `${f.label}${sep}${f.value}`)
  }
  lines.push('', `— ${content.footer}`)
  return lines.join('\n')
}

export function fileBaseName (content: ShareContent, selected: Set<string>): string {
  const { tag, title } = headingOf(content, selected)
  const raw = [tag, title].filter((s) => s !== '').join(' ')
  const name = raw.replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim()
  return (name !== '' ? name : 'share').slice(0, 80)
}
