// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import en from '@hcengineering/departments-assets/lang/en.json'
import zh from '@hcengineering/departments-assets/lang/zh.json'

type Labels = typeof en.string & typeof zh.string

/** Messages carry both languages so they can be read independently of the browser's locale. */
export function taskMailLabel (key: keyof Labels): string {
  return `${zh.string[key as keyof typeof zh.string]} / ${en.string[key as keyof typeof en.string]}`
}
