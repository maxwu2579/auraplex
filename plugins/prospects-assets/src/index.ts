import { loadMetadata } from '@hcengineering/platform'
import prospects from '@hcengineering/prospects'
const icons = require('../assets/icons.svg') as string // eslint-disable-line
loadMetadata(prospects.icon, { Prospects: `${icons}#materials` })
