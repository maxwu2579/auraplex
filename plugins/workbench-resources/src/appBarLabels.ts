//
// Copyright © 2026 Auraplex
//
// Licensed under the Eclipse Public License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License. You may
// obtain a copy of the License at https://www.eclipse.org/legal/epl-2.0
//

import { writable } from 'svelte/store'

// Auraplex: whether the left app bar shows names next to the icons; remembered per browser.
const key = 'auraplex.appBarLabels'

export const appBarLabels = writable<boolean>(localStorage.getItem(key) === 'true')
appBarLabels.subscribe((value) => {
  localStorage.setItem(key, value ? 'true' : 'false')
})
