import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PresetImportModal from '../PresetImportModal.vue'
import LayoutThumbnail from '../LayoutThumbnail.vue'
import { clearPresetCache } from '@/utils/presets'
import { useKeyboardStore } from '@/stores/keyboard'
import { toast } from '@/composables/useToast'

vi.mock('@/composables/useToast', () => ({
  toast: {
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showInfo: vi.fn(),
    removeToast: vi.fn(),
  },
}))

vi.mock('@/data/presets.json', () => ({
  default: {
    presets: [
      { name: 'Test ANSI', file: 'ansi-104.json', keywords: ['fullsize'] },
      { name: 'Test Ortho', file: 'planck.json', keywords: ['ortholinear', 'grid'] },
      { name: 'Test Blank', file: 'blank.json', keywords: ['empty'] },
    ],
  },
}))

const ONE_KEY_LAYOUT = [['A']]

const mountModal = (pinia: ReturnType<typeof createPinia>) =>
  mount(PresetImportModal, {
    props: { isVisible: false },
    // jsdom's canvas.getContext() returns null, so the renderer inside
    // LayoutThumbnail cannot run here.
    global: { plugins: [pinia], stubs: { LayoutThumbnail: true } },
  })

const open = async (wrapper: ReturnType<typeof mountModal>) => {
  await wrapper.setProps({ isVisible: true })
  await flushPromises()
}

describe('PresetImportModal', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    vi.clearAllMocks()
    clearPresetCache()
    pinia = createPinia()
    setActivePinia(pinia)

    // No IntersectionObserver in jsdom, so the component falls back to loading the
    // whole (tiny) catalogue at once — which is how previews get requested here.
    global.fetch = vi.fn().mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve(url.includes('blank.json') ? [] : ONE_KEY_LAYOUT),
      } as Response),
    )
  })

  afterEach(() => {
    document.body.classList.remove('modal-open')
  })

  const cards = (wrapper: ReturnType<typeof mountModal>) =>
    wrapper.findAll('[data-testid="preset-card"]')

  it('renders nothing until it is opened', () => {
    const wrapper = mountModal(pinia)
    expect(wrapper.find('[data-testid="modal-preset-import"]').exists()).toBe(false)
  })

  it('shows one card per catalogue entry with the total underneath', async () => {
    const wrapper = mountModal(pinia)
    await open(wrapper)

    expect(cards(wrapper)).toHaveLength(3)
    expect(wrapper.find('[data-testid="preset-count"]').text()).toBe('3 presets available')
    expect(document.body.classList.contains('modal-open')).toBe(true)
  })

  it('draws a thumbnail for a layout with keys', async () => {
    const wrapper = mountModal(pinia)
    await open(wrapper)

    expect(wrapper.findAllComponents(LayoutThumbnail).length).toBe(2)
    const ansi = wrapper.find('[data-preset-name="Test ANSI"]')
    expect(ansi.text()).toContain('1 key')
  })

  // An empty layout renders as a tiny white square, which reads as a broken preview
  // rather than as "this one is blank on purpose".
  it('labels an empty preset instead of drawing it', async () => {
    const wrapper = mountModal(pinia)
    await open(wrapper)

    const blank = wrapper.find('[data-preset-name="Test Blank"]')
    expect(blank.find('[data-testid="preset-card-empty"]').exists()).toBe(true)
    expect(blank.findComponent(LayoutThumbnail).exists()).toBe(false)
    expect(blank.text()).toContain('Empty')
  })

  it('filters by name and reports the result count', async () => {
    const wrapper = mountModal(pinia)
    await open(wrapper)

    await wrapper.find('[data-testid="preset-search"]').setValue('ansi')

    expect(cards(wrapper)).toHaveLength(1)
    expect(wrapper.find('[data-preset-name="Test ANSI"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="preset-count"]').text()).toBe('1 result(s)')
  })

  it('filters on keywords that never appear in the name', async () => {
    const wrapper = mountModal(pinia)
    await open(wrapper)

    await wrapper.find('[data-testid="preset-search"]').setValue('ortholinear')

    expect(cards(wrapper)).toHaveLength(1)
    expect(wrapper.find('[data-preset-name="Test Ortho"]').exists()).toBe(true)
    // The match was on a keyword, so nothing in the displayed name may be marked up:
    // the highlight indices belong to a different string.
    expect(wrapper.find('[data-preset-name="Test Ortho"]').html()).not.toContain('<mark>')
  })

  it('says so when nothing matches', async () => {
    const wrapper = mountModal(pinia)
    await open(wrapper)

    await wrapper.find('[data-testid="preset-search"]').setValue('zzzznotathing')

    expect(cards(wrapper)).toHaveLength(0)
    expect(wrapper.find('[data-testid="preset-empty-state"]').exists()).toBe(true)
  })

  it('loads the preset on a single click and closes', async () => {
    const store = useKeyboardStore()
    const loadSpy = vi.spyOn(store, 'loadKLELayout')

    const wrapper = mountModal(pinia)
    await open(wrapper)

    await wrapper.find('[data-preset-name="Test ANSI"]').trigger('click')
    await flushPromises()

    expect(loadSpy).toHaveBeenCalledWith(ONE_KEY_LAYOUT)
    expect(store.filename).toBe('ansi-104')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('reports a failed load as a toast', async () => {
    const wrapper = mountModal(pinia)
    await open(wrapper)

    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))
    clearPresetCache()

    await wrapper.find('[data-preset-name="Test ANSI"]').trigger('click')
    await flushPromises()

    expect(toast.showError).toHaveBeenCalledWith('Failed to load Test ANSI', 'Error loading preset')
  })

  it('shows a placeholder for a preview that could not be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'))

    const wrapper = mountModal(pinia)
    await open(wrapper)

    expect(wrapper.findAll('[data-testid="preset-card-error"]')).toHaveLength(3)
    expect(wrapper.find('[data-preset-name="Test ANSI"]').text()).toContain('Preview unavailable')
  })

  it('closes on Escape and releases the body scroll lock', async () => {
    const wrapper = mountModal(pinia)
    await open(wrapper)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toBeTruthy()

    await wrapper.setProps({ isVisible: false })
    expect(document.body.classList.contains('modal-open')).toBe(false)
  })

  it('closes on a backdrop click', async () => {
    const wrapper = mountModal(pinia)
    await open(wrapper)

    await wrapper.find('[data-testid="modal-preset-import"]').trigger('click')

    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
