import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { readdirSync } from 'fs'
import { resolve } from 'path'
import { useKeyboardStore } from '@/stores/keyboard'
import {
  ALL_PRESETS,
  TOP_PRESETS,
  TOP_PRESET_FILES,
  applyPreset,
  clearPresetCache,
  fetchPresetData,
  presetFilename,
  presetUrl,
} from '../presets'

// Deliberately no vi.mock of presets.json: the catalogue assertions below only mean
// something against the real manifest.

const PRESET_DIR = resolve(__dirname, '../../../public/data/presets')

describe('preset catalogue', () => {
  beforeEach(() => {
    clearPresetCache()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('the curated shortlist', () => {
    // The shortlist names files rather than carrying a flag in the manifest, so a
    // rename there would silently drop an entry from the Import menu. This is the
    // check that turns that into a failing build instead.
    it('resolves every promoted file, in the order it promotes them', () => {
      expect(TOP_PRESETS.map((preset) => preset.file)).toEqual([...TOP_PRESET_FILES])
    })
  })

  describe('the manifest and the payloads on disk', () => {
    const filesOnDisk = () => readdirSync(PRESET_DIR).filter((name) => name.endsWith('.json'))

    it('names only files that exist', () => {
      const onDisk = new Set(filesOnDisk())
      const missing = ALL_PRESETS.filter((preset) => !onDisk.has(preset.file))
      expect(missing).toEqual([])
    })

    // Four payloads sat here unreachable for years because nobody registered them.
    // Asserting the reverse direction too means the next one is caught immediately.
    it('leaves no payload unregistered', () => {
      const registered = new Set(ALL_PRESETS.map((preset) => preset.file))
      const orphans = filesOnDisk().filter((name) => !registered.has(name))
      expect(orphans).toEqual([])
    })

    it('uses each name and each file exactly once', () => {
      expect(new Set(ALL_PRESETS.map((p) => p.file)).size).toBe(ALL_PRESETS.length)
      expect(new Set(ALL_PRESETS.map((p) => p.name)).size).toBe(ALL_PRESETS.length)
    })
  })

  describe('presetFilename', () => {
    it('strips the extension', () => {
      expect(presetFilename('ansi-104.json')).toBe('ansi-104')
      expect(presetFilename('multilayout-60-via.json')).toBe('multilayout-60-via')
    })
  })

  describe('fetchPresetData', () => {
    it('downloads a preset once per session', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve([['A']]),
      } as Response)
      vi.stubGlobal('fetch', fetchMock)

      await fetchPresetData('ansi-104.json')
      await fetchPresetData('ansi-104.json')

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock).toHaveBeenCalledWith(presetUrl('ansi-104.json'))

      clearPresetCache()
      await fetchPresetData('ansi-104.json')
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('does not cache a failure', async () => {
      // A dropped connection must not make the preset unusable for the rest of the
      // session — the next click has to be able to try again.
      const fetchMock = vi
        .fn()
        .mockRejectedValueOnce(new Error('network down'))
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([['A']]) } as Response)
      vi.stubGlobal('fetch', fetchMock)

      await expect(fetchPresetData('ansi-104.json')).rejects.toThrow('network down')
      await expect(fetchPresetData('ansi-104.json')).resolves.toEqual([['A']])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('rejects on a non-ok response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found' } as Response),
      )

      await expect(fetchPresetData('ansi-104.json')).rejects.toThrow('HTTP 404')
    })
  })

  describe('applyPreset', () => {
    it('loads the payload and names the download after it', async () => {
      const payload = [['A']]
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(payload) } as Response),
      )

      const store = useKeyboardStore()
      store.filename = 'something-loaded-earlier'
      const loadSpy = vi.spyOn(store, 'loadKLELayout')

      await applyPreset({ name: 'ANSI 104', file: 'ansi-104.json' }, store)

      expect(loadSpy).toHaveBeenCalledWith(payload)
      // loadKeyboard() clears the filename, so this is only right if applyPreset
      // assigns it afterwards.
      expect(store.filename).toBe('ansi-104')
    })

    it('propagates a download failure to the caller', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))

      await expect(
        applyPreset({ name: 'ANSI 104', file: 'ansi-104.json' }, useKeyboardStore()),
      ).rejects.toThrow('network down')
    })
  })
})
