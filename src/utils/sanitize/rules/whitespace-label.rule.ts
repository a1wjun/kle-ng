import type { FixableSanitizeRule } from '../types'

const LABEL_COUNT = 12

/**
 * True when the label holds only whitespace. An already-empty label is not an
 * issue — there is nothing to clear.
 */
function isWhitespaceOnly(label: string | undefined): boolean {
  return typeof label === 'string' && label !== '' && label.trim() === ''
}

export const whitespaceLabelRule: FixableSanitizeRule = {
  id: 'whitespace-label',
  kind: 'redundancy',
  name: 'Whitespace-only labels',
  // Deliberately phrased as what it does rather than claiming the data is
  // meaningless: a whitespace label is inert for every kle-ng render and export
  // path, but downstream consumers of exported JSON may treat "has a label" as
  // significant. The category is individually opt-out, which is the right level
  // of protection.
  description: 'Labels holding only spaces',

  scan(keys) {
    let count = 0
    for (const key of keys) {
      for (let i = 0; i < LABEL_COUNT; i++) {
        if (isWhitespaceOnly(key.labels?.[i])) count++
      }
    }
    return { count }
  },

  fix(keys) {
    for (const key of keys) {
      if (!key.labels) continue
      for (let i = 0; i < LABEL_COUNT; i++) {
        if (isWhitespaceOnly(key.labels[i])) key.labels[i] = ''
      }
    }
  },
}
