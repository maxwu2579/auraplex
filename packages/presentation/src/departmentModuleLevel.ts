// Copyright © 2026 Auraplex. Licensed under the Eclipse Public License, Version 2.0.
import type { ModuleLevel } from '@hcengineering/core'
import { writable } from 'svelte/store'

export const departmentModuleLevel = writable<(alias: string) => ModuleLevel>(() => 'edit')
