import { Serial, type Keyboard } from '@adamws/kle-serial'
import presetsMetadata from '@/data/presets.json'
import type { useKeyboardStore } from '@/stores/keyboard'

/**
 * The built-in preset library.
 *
 * `src/data/presets.json` is the manifest; the payloads it names live in
 * `public/data/presets/` and are plain KLE JSON, fetched on demand. Two surfaces
 * consume this module:
 *
 * - the Import dropdown, which lists only `TOP_PRESETS` as a shortcut, and
 * - `PresetImportModal.vue`, which browses the whole catalogue with previews.
 *
 * Both load through `applyPreset()`, so the two paths cannot drift.
 *
 * NOTE: downloads are memoised for the session, so clicking the same preset twice
 * issues a single request. Tests that assert on `fetch` call counts must reset the
 * cache with `clearPresetCache()` in `beforeEach`, or a later test will be served
 * from the cache and see no request at all.
 */

export interface Preset {
  /** Filename under public/data/presets — also the preset's stable id. */
  file: string
  name: string
  /** Card tooltip and search key; never rendered inline. */
  description?: string
  /** Search-only synonyms; never displayed. */
  keywords?: string[]
}

/** The whole catalogue, in presets.json order — which is the modal's browse order. */
export const ALL_PRESETS: readonly Preset[] = presetsMetadata.presets ?? []

/**
 * The curated shortlist shown directly in the Import dropdown, in this exact order.
 * Everything else is reachable through Import → From Preset.
 *
 * Kept here rather than as a flag in presets.json for two reasons: the promotion
 * order is an editorial decision that has nothing to do with the browse order, and
 * the manifest stays a pure data file that anyone can append to without thinking
 * about the toolbar. `presets.spec.ts` fails if an entry here stops matching a
 * catalogue file, so a rename cannot silently empty the menu.
 */
export const TOP_PRESET_FILES: readonly string[] = [
  'blank.json',
  'ansi-104.json',
  'default-60.json',
  'iso-60.json',
  'ortho-4-12-qmk.json',
  'multilayout-60-via.json',
]

export const TOP_PRESETS: readonly Preset[] = TOP_PRESET_FILES.map((file) =>
  ALL_PRESETS.find((preset) => preset.file === file),
).filter((preset): preset is Preset => preset !== undefined)

export function presetUrl(file: string): string {
  return `${import.meta.env.BASE_URL}data/presets/${file}`
}

/** Download name for a preset — the basename, matching long-standing behaviour. */
export function presetFilename(file: string): string {
  return file.replace(/\.[^/.]+$/, '')
}

export interface PresetPreview {
  keyboard: Keyboard
  keyCount: number
}

const rawCache = new Map<string, Promise<unknown>>()
const previewCache = new Map<string, Promise<PresetPreview>>()

/** Raw KLE JSON for a preset, memoised for the session. */
export function fetchPresetData(file: string): Promise<unknown> {
  const cached = rawCache.get(file)
  if (cached) return cached

  const request = (async () => {
    const response = await fetch(presetUrl(file))
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`)
    }
    return response.json()
  })()

  // A transient failure must not poison the preset for the rest of the session.
  // The extra `.catch` only evicts; the rejection is still delivered to callers.
  request.catch(() => {
    rawCache.delete(file)
  })

  rawCache.set(file, request)
  return request
}

/**
 * A preset deserialized for thumbnail rendering.
 *
 * Deliberately goes through the same `Serial.deserialize` the load path uses, so a
 * preview cannot show something different from what clicking the card produces.
 */
export function loadPresetPreview(file: string): Promise<PresetPreview> {
  const cached = previewCache.get(file)
  if (cached) return cached

  const pending = (async () => {
    const keyboard = Serial.deserialize((await fetchPresetData(file)) as Array<unknown>)
    return { keyboard, keyCount: keyboard.keys.length }
  })()

  pending.catch(() => {
    previewCache.delete(file)
  })

  previewCache.set(file, pending)
  return pending
}

/**
 * The single load path shared by the dropdown and the modal. Throws; callers decide
 * how to report.
 *
 * Takes the store as a parameter rather than calling `useKeyboardStore()` itself,
 * matching `processJsonLayout()` in `json-layout-processor.ts`.
 */
export async function applyPreset(
  preset: Preset,
  keyboardStore: ReturnType<typeof useKeyboardStore>,
): Promise<void> {
  const data = await fetchPresetData(preset.file)
  keyboardStore.loadKLELayout(data)
  // loadKeyboard() clears the filename, so naming the download has to come after.
  keyboardStore.filename = presetFilename(preset.file)
}

/** Drops the memoised responses. Exists for tests that assert on fetch counts. */
export function clearPresetCache(): void {
  rawCache.clear()
  previewCache.clear()
}
