import type { Key } from '@adamws/kle-serial'

/**
 * Distinguishes the two families of sanitize rule.
 *
 * - `redundancy` deletes data that provably has no effect on any render or
 *   export path. Removing it cannot change what the user sees. `count` is the
 *   number of individual fields that would be cleared, so counts are additive.
 * - `normalization` rewrites live data. The result looks identical on canvas,
 *   but the underlying values change. `count` is on the rule's own scale — the
 *   keys it would rewrite, or 0/1 for a whole-layout operation like recentring —
 *   so it must never be summed together with `redundancy` counts, or with
 *   another normalization rule's count.
 * - `advisory` reports a problem the tool must not resolve on its own, because
 *   the resolution is a design decision rather than a mechanical one. An
 *   advisory rule has no `fix` at all, so it never appears in an Apply. `count`
 *   is on its own scale, like `normalization`.
 *
 * This discriminator carries no weight in the engine itself; `applySanitizeFixes`
 * treats every rule identically. It exists so the panel can group and report the
 * families separately, and so a future rule author has to classify consciously.
 * Note that fixability is carried by the presence of `fix`, not by `kind` — a
 * future non-fixable rule need not be `advisory`.
 */
export type SanitizeRuleKind = 'redundancy' | 'normalization' | 'advisory'

export interface SanitizeScanResult {
  /** Number of issues found; drives the UI badge. */
  count: number
  /**
   * The keys the issues sit on, when the rule can name them. Lets the panel
   * offer to select them — the only recourse a rule that cannot fix itself can
   * give the user. References into the scanned array, never copies.
   */
  keys?: readonly Key[]
}

export interface SanitizeRule {
  id: string
  kind: SanitizeRuleKind
  name: string
  /**
   * A short phrase shown inline under the rule name. Keep it to a few words — it
   * has to fit one compact line, and the panel is sized so it never scrolls.
   */
  description: string
  /** Read-only: must not mutate `keys`. */
  scan(keys: Key[]): SanitizeScanResult
  /**
   * Mutates `keys` in place. Must be idempotent, and must leave the layout in a
   * state where every rule's `scan()` is accurate — including other rules'.
   * See the ordering note in `./index.ts`.
   *
   * Omit it for a rule that reports but cannot fix. Absence *is* the signal: a
   * separate `fixable` flag could disagree with reality, an absent method
   * cannot. The panel renders such a rule as a warning with no checkbox, and
   * `applySanitizeFixes` skips it.
   */
  fix?(keys: Key[]): void
}

/**
 * A rule that can fix what it finds — the common case, and what every rule was
 * before warning-only rules existed.
 *
 * Declaring a rule as this rather than as `SanitizeRule` narrows `fix` back to
 * required, so callers holding a concrete rule (its own tests, most of all) can
 * invoke it without a non-null assertion. The registry stays `SanitizeRule[]`.
 */
export interface FixableSanitizeRule extends SanitizeRule {
  fix(keys: Key[]): void
}
