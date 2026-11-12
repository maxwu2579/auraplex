// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { unzipSync } from 'fflate'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'

const MAX_IMAGE = 20_000_000
export function extractStockImage (
  archive: Uint8Array,
  path: string
): { bytes: Uint8Array, type: string, name: string } {
  const ext = /\.(png|jpe?g|gif|bmp)$/i.exec(path)?.[1]?.toLowerCase()
  if (ext === undefined || !path.startsWith('xl/media/')) throw new Error('图片类型或位置无效')
  const data = unzipSync(archive, {
    filter: (entry) => {
      if (entry.name !== path) return false
      if (entry.originalSize > MAX_IMAGE) throw new Error('图片超过 20 MB')
      return true
    }
  })[path]
  if (data === undefined || data.length === 0) throw new Error('图片不存在或为空')
  const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`
  return { bytes: data, type, name: `excel-sha256-${bytesToHex(sha256(data))}` }
}
