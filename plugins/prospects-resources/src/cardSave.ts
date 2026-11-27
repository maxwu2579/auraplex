// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// Card photo helpers and the "save without review" path used by batch upload.
import attachment from '@hcengineering/attachment'
import core, { generateId, getCurrentAccount } from '@hcengineering/core'
import { getMetadata } from '@hcengineering/platform'
import presentation, { getClient, uploadFile } from '@hcengineering/presentation'
import prospects, { normalizeEmail, prospectWriteScope, type Prospect, type RecognitionField } from '@hcengineering/prospects'

export const cardFields = [
  'name',
  'company',
  'title',
  'mobile',
  'phone',
  'email',
  'website',
  'address',
  'country',
  'industry',
  'source',
  'notes'
] as const
export type CardDraft = Record<(typeof cardFields)[number], string>

export function apiHeaders (): Record<string, string> {
  return {
    Authorization: 'Bearer ' + (getMetadata(presentation.metadata.Token) ?? ''),
    'Content-Type': 'application/json'
  }
}

/** True when the card AI service is set up; false when it is not or cannot be reached. */
export async function recognizerConfigured (): Promise<boolean> {
  const res = await fetch('/prospects-api/status', { headers: apiHeaders() })
  if (!res.ok) throw new Error('unreachable')
  return (await res.json()).configured === true
}

/** Shrink to at most 1600px on the long side, white background, JPEG. */
export async function compressed (file: File): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (context === null) {
    bitmap.close()
    throw new Error('canvas')
  }
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, 'image/jpeg', 0.85)
  })
  if (blob === null) throw new Error('compress')
  return new File([blob], 'card.jpg', { type: 'image/jpeg' })
}

export async function readUrl (file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve(String(reader.result))
    }
    reader.onerror = () => {
      reject(new Error('read'))
    }
    reader.readAsDataURL(file)
  })
}

export interface Recognition {
  values: Partial<CardDraft>
  needsReview: RecognitionField[]
  model?: string
  recognizedAt?: number
}

export async function recognize (files: File[]): Promise<Recognition> {
  const images = await Promise.all(files.map(async (file) => await readUrl(await compressed(file))))
  const res = await fetch('/prospects-api/recognize', {
    method: 'POST',
    headers: apiHeaders(),
    body: JSON.stringify({ images })
  })
  const data = await res.json()
  if (!res.ok) throw new Error(typeof data.error === 'string' ? data.error : 'recognize')
  return data
}

export type AutoSaveResult = 'saved' | 'empty' | 'duplicate' | 'failed'

/**
 * Recognize one card front and save it straight away.
 * Leaves it for a person to check when nothing useful was read or the email already exists.
 */
export async function autoSaveCard (front: File): Promise<AutoSaveResult> {
  let recognition: Recognition
  try {
    recognition = await recognize([front])
  } catch {
    return 'failed'
  }
  const draft: CardDraft = Object.fromEntries(
    cardFields.map((key) => [key, String(recognition.values[key] ?? '').trim()])
  ) as CardDraft
  if (draft.name === '' && draft.company === '') return 'empty'
  const client = getClient()
  const normalizedEmail = normalizeEmail(draft.email)
  if (normalizedEmail !== '' && (await client.findOne(prospects.class.Prospect, { normalizedEmail })) !== undefined) {
    return 'duplicate'
  }
  try {
    const id = generateId<Prospect>()
    const ops = client.apply(prospectWriteScope)
    if (normalizedEmail !== '') ops.notMatch(prospects.class.Prospect, { normalizedEmail })
    await ops.createDoc(
      prospects.class.Prospect,
      core.space.Workspace,
      {
        ...draft,
        normalizedEmail,
        status: 'new',
        emailCount: 0,
        photos: 0,
        // Nobody looked at it yet, so it is not confirmed.
        recognitionConfirmed: false,
        ...(recognition.model !== undefined
          ? { recognitionModel: recognition.model, recognizedAt: recognition.recognizedAt, recognitionBy: getCurrentAccount().uuid }
          : {})
      },
      id
    )
    const jpg = await compressed(front)
    const { uuid, metadata } = await uploadFile(jpg)
    await ops.addCollection(attachment.class.Photo, core.space.Workspace, id, prospects.class.Prospect, 'photos', {
      name: 'front.jpg',
      file: uuid,
      type: jpg.type,
      size: jpg.size,
      lastModified: Date.now(),
      metadata
    })
    if (!(await ops.commit()).result) return 'duplicate'
    return 'saved'
  } catch {
    return 'failed'
  }
}
