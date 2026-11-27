import type { Resources } from '@hcengineering/platform'
import Directory from './components/Directory.svelte'
import Statistics from './components/Statistics.svelte'
import ProspectPanel from './components/ProspectPanel.svelte'
import MailAutomation from './components/MailAutomation.svelte'
import ReviewQueue from './components/ReviewQueue.svelte'
import TemplateSettings from './components/TemplateSettings.svelte'
export default async (): Promise<Resources> => ({ component: { Directory, Statistics, TemplateSettings, MailAutomation, ProspectPanel, ReviewQueue } })
