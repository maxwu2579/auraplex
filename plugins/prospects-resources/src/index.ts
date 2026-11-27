import type { Resources } from '@hcengineering/platform'
import Directory from './components/Directory.svelte'
import Statistics from './components/Statistics.svelte'
import TemplateSettings from './components/TemplateSettings.svelte'
export default async (): Promise<Resources> => ({ component: { Directory, Statistics, TemplateSettings } })
