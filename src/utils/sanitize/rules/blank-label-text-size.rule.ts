import { isLabelBlank } from '../label-utils'
import type { FixableSanitizeRule } from '../types'

const LABEL_COUNT = 12

export const blankLabelTextSizeRule: FixableSanitizeRule = {
  id: 'blank-label-text-size',
  kind: 'redundancy',
  name: 'Orphaned text sizes',
  description: 'Font sizes set on empty labels',

  scan(keys) {
    let count = 0
    for (const key of keys) {
      for (let i = 0; i < LABEL_COUNT; i++) {
        if (isLabelBlank(key.labels?.[i]) && key.textSize?.[i]) count++
      }
    }
    return { count }
  },

  fix(keys) {
    for (const key of keys) {
      if (!key.textSize) continue
      for (let i = 0; i < LABEL_COUNT; i++) {
        if (isLabelBlank(key.labels?.[i]) && key.textSize[i]) key.textSize[i] = 0
      }
    }
  },
}
