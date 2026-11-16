import { createApp } from './server'
const port = Number(process.env.PORT ?? '8101')
createApp({
  accountsUrl: process.env.ACCOUNTS_URL ?? '',
  aiUrl: process.env.PROSPECTS_AI_URL,
  model: process.env.PROSPECTS_AI_MODEL,
  key: process.env.PROSPECTS_AI_KEY
}).listen(port)
