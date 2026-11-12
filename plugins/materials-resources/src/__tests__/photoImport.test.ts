// Copyright © 2026 Auraplex
// Licensed under the Eclipse Public License, Version 2.0.
// https://www.eclipse.org/legal/epl-2.0
import { zipSync } from 'fflate'
import { extractStockImage } from '../photoImport'
test('uses picture content as the repeat-import identity', () => {
  const archive = zipSync({
    'xl/media/a.png': new Uint8Array([1, 2, 3]),
    'xl/media/b.png': new Uint8Array([1, 2, 3]),
    'xl/media/c.png': new Uint8Array([3, 2, 1])
  })
  const a = extractStockImage(archive, 'xl/media/a.png')
  expect(a.name).toBe(extractStockImage(archive, 'xl/media/b.png').name)
  expect(a.name).not.toBe(extractStockImage(archive, 'xl/media/c.png').name)
  expect(a.type).toBe('image/png')
})
test('does not guess a missing or external image', () => {
  const archive = zipSync({ 'xl/media/a.png': new Uint8Array([1]) })
  expect(() => extractStockImage(archive, 'xl/media/missing.png')).toThrow()
  expect(() => extractStockImage(archive, 'other/a.png')).toThrow()
})
