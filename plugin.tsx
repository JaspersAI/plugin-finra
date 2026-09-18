import { definePlugin } from '@jaspers-ai/sdk'
import { shortInterest } from './sources.ts'

export default definePlugin({
  id: 'finra',
  sources: { 'short-interest': shortInterest },
  views: {},
})
