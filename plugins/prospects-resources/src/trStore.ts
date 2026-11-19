// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
// Page-side translation that follows the language switch without reloading.
import { languageStore } from '@hcengineering/ui'
import { derived } from 'svelte/store'
import { pick } from './tr'

/** In pages: {$t('邮件未配置')} */
export const t = derived(languageStore, (lang) => (zh: string): string => pick(lang, zh))

/** True while the page is shown in Chinese. */
export const chinese = derived(languageStore, (lang) => lang === 'zh' || lang === '')
