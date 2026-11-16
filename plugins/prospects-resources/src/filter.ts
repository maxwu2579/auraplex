import { writable } from 'svelte/store'
export interface ProspectFilter {
  field?: 'source' | 'country' | 'industry' | 'status' | 'period'
  value?: string
}
export const prospectFilter = writable<ProspectFilter>({})
