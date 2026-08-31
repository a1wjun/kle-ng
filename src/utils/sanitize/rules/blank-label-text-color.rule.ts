import { isLabelBlank } from '../label-utils'
import type { FixableSanitizeRule } from '../types'

const LABEL_COUNT = 12

export const blankLabelTextColorRule: FixableSanitizeRule = {
  id: 'blank-label-text-color',
  kind: 'redundancy',
  name: 'Orphaned text colors',
  description: 'Colors set on empty labels',

  scan(keys) {
    let count = 0
    for (const key of keys) {
      for (let i = 0; i < LABEL_COUNT; i++) {
        if (isLabelBlank(key.labels?.[i]) && key.textColor?.[i]) count++
      }
    }
    return { count }
  },

  fix(keys) {
    for (const key of keys) {
      if (!key.textColor) continue
      for (let i = 0; i < LABEL_COUNT; i++) {
        if (isLabelBlank(key.labels?.[i]) && key.textColor[i]) key.textColor[i] = ''
      }
    }
  },
}
