import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { Key } from '@adamws/kle-serial'
import SanitizeToolPanel from '../SanitizeToolPanel.vue'
import { useKeyboardStore } from '@/stores/keyboard'
import { scanLayout } from '@/utils/sanitize'

function makeKey(overrides: Partial<Key> = {}): Key {
  return Object.assign(new Key(), overrides)
}

/**
 * Seeds the store with a layout carrying every issue type: offset from the
 * origin, a whitespace-only label, orphaned size/color overrides, and a stale
 * rotation origin — across one unrotated and one rotated key.
 *
 * Rotation angles are deliberately in range here, so the tests below have
 * exactly one normalization rule with issues to reason about; the rotation-angle
 * rule gets its own seeds.
 */
function seedDirtyLayout(store: ReturnType<typeof useKeyboardStore>) {
  const a = makeKey({ x: 3, y: 2, rotation_angle: 0, rotation_x: 1, rotation_y: 1 })
  a.labels[0] = ' '
  a.textSize[4] = 5
  a.textColor[4] = '#ff0000'

  const b = makeKey({ x: 4, y: 2, rotation_angle: 20, rotation_x: 4, rotation_y: 2 })
  b.labels[0] = 'B'

  store.keys = [a, b]
}

describe('SanitizeToolPanel', () => {
  let wrapper: VueWrapper
  let store: ReturnType<typeof useKeyboardStore>

  const checkbox = (ruleId: string) => wrapper.get(`[data-testid="sanitize-checkbox-${ruleId}"]`)
  const count = (ruleId: string) =>
    wrapper.get(`[data-testid="sanitize-count-${ruleId}"]`).text().trim()
  const isChecked = (ruleId: string) => (checkbox(ruleId).element as HTMLInputElement).checked
  const isDisabled = (ruleId: string) => (checkbox(ruleId).element as HTMLInputElement).disabled
  const applyButton = () => wrapper.get('[data-testid="sanitize-apply"]')

  async function open() {
    await wrapper.setProps({ visible: true })
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useKeyboardStore()
    seedDirtyLayout(store)
    wrapper = mount(SanitizeToolPanel, { props: { visible: false } })
  })

  afterEach(() => {
    wrapper.unmount()
  })

  describe('scanning on open', () => {
    it('renders the panel only when visible', async () => {
      expect(wrapper.find('.sanitize-tool-panel').exists()).toBe(false)
      await open()
      expect(wrapper.find('.sanitize-tool-panel').exists()).toBe(true)
      expect(wrapper.find('.panel-title').text()).toContain('Sanitize Layout')
    })

    it('shows a count for every category', async () => {
      await open()

      expect(count('coordinate-offset')).toBe('1')
      expect(count('whitespace-label')).toBe('1')
      expect(count('blank-label-text-size')).toBe('1')
      expect(count('blank-label-text-color')).toBe('1')
      expect(count('stale-rotation-origin')).toBe('1')
    })

    it('pre-selects every category with issues', async () => {
      await open()

      for (const id of [
        'coordinate-offset',
        'whitespace-label',
        'blank-label-text-size',
        'blank-label-text-color',
        'stale-rotation-origin',
      ]) {
        expect(isChecked(id), `${id} should be checked`).toBe(true)
      }
    })

    it('groups categories by kind', async () => {
      await open()

      const redundancy = wrapper.get('[data-testid="sanitize-group-redundancy"]')
      const normalization = wrapper.get('[data-testid="sanitize-group-normalization"]')

      expect(normalization.find('[data-testid="sanitize-rule-coordinate-offset"]').exists()).toBe(
        true,
      )
      expect(normalization.find('[data-testid="sanitize-rule-rotation-angle"]').exists()).toBe(true)
      expect(redundancy.find('[data-testid="sanitize-rule-coordinate-offset"]').exists()).toBe(
        false,
      )
      expect(redundancy.find('[data-testid="sanitize-rule-whitespace-label"]').exists()).toBe(true)
    })

    it('shows a short description inline under each rule name', async () => {
      await open()

      for (const result of scanLayout([])) {
        const row = wrapper.get(`[data-testid="sanitize-rule-${result.ruleId}"]`)
        expect(row.get('.rule-name').text()).toBe(result.name)
        expect(row.get('.rule-description').text()).toBe(result.description)
      }
    })

    it('carries no tooltip on the rule rows', async () => {
      // Everything a row has to say is on the row. Nothing is hidden behind hover.
      await open()

      for (const label of wrapper.findAll('.form-check-label')) {
        expect(label.attributes('title')).toBeUndefined()
        expect(label.attributes('data-bs-title')).toBeUndefined()
      }
    })

    it('reports a clean layout and disables Apply', async () => {
      store.keys = [makeKey({ x: 0, y: 0 })]
      await open()

      expect(wrapper.find('.clean-banner').exists()).toBe(true)
      expect(applyButton().attributes('disabled')).toBeDefined()
      expect(isDisabled('coordinate-offset')).toBe(true)
    })

    it('flags out-of-range rotation angles and wraps them on Apply', async () => {
      // The angle controls always write a wrapped value; a hand-edited JSON can
      // carry anything, which is what this rule is for.
      store.keys = [
        makeKey({ x: 0, y: 0, rotation_angle: 3600 }),
        makeKey({ x: 1, y: 0, rotation_angle: 345, rotation_x: 1, rotation_y: 0 }),
      ]
      await open()

      expect(count('rotation-angle')).toBe('2')
      expect(isChecked('rotation-angle')).toBe(true)

      await applyButton().trigger('click')

      expect(store.keys[0]!.rotation_angle).toBe(0)
      expect(store.keys[1]!.rotation_angle).toBe(-15)
      expect(count('rotation-angle')).toBe('0')
    })

    it('shows at most one status line', async () => {
      // After an Apply that cleans everything, both banners would otherwise
      // qualify. The result of the Apply wins — an all-clean layout is already
      // evident from the zeroed counts — so the panel height stays fixed.
      await open()
      await applyButton().trigger('click')

      expect(wrapper.find('[data-testid="sanitize-result"]').exists()).toBe(true)
      expect(wrapper.find('.clean-banner').exists()).toBe(false)
      expect(wrapper.findAll('.status-banner')).toHaveLength(1)
    })
  })

  describe('applying fixes', () => {
    it('fixes every selected category', async () => {
      await open()
      await applyButton().trigger('click')

      expect(store.keys[0]!.labels[0]).toBe('')
      expect(store.keys[0]!.textSize[4]).toBe(0)
      expect(store.keys[0]!.textColor[4]).toBe('')
      expect(store.keys[0]!.rotation_x).toBe(0)
      expect(store.keys[0]!.rotation_y).toBe(0)
      expect(store.keys[0]!.x).toBe(0)
    })

    it('leaves an unchecked category untouched', async () => {
      await open()
      await checkbox('coordinate-offset').setValue(false)
      await applyButton().trigger('click')

      // The deselected category kept its issue and its count...
      expect(store.keys[0]!.x).toBe(3)
      expect(count('coordinate-offset')).toBe('1')
      // ...while everything else was fixed.
      expect(count('whitespace-label')).toBe('0')
      expect(count('blank-label-text-size')).toBe('0')
      expect(count('blank-label-text-color')).toBe('0')
      expect(count('stale-rotation-origin')).toBe('0')
    })

    it('rescans after Apply without re-checking a deselected category', async () => {
      await open()
      await checkbox('coordinate-offset').setValue(false)
      await applyButton().trigger('click')

      expect(isChecked('coordinate-offset')).toBe(false)
      expect(isDisabled('whitespace-label')).toBe(true)
    })

    it('adds exactly one history entry per Apply, however many rules ran', async () => {
      const before = store.canUndo
      expect(before).toBe(false)

      await open()
      await applyButton().trigger('click')

      // One Apply touching five rules across two keys == one undo step.
      store.undo()
      expect(store.keys[0]!.x).toBe(3)
      expect(store.keys[0]!.labels[0]).toBe(' ')
      expect(store.canUndo).toBe(false)
    })

    it('undoes consecutive Applies one step at a time', async () => {
      // A single Apply cannot distinguish saving history before vs after the
      // mutation -- both leave one undo that appears to work. Two consecutive
      // Applies can: saving first leaves the newest history entry holding the
      // pre-mutation state, so this undo would skip straight past the
      // intermediate state and revert both Applies at once.
      await open()
      await checkbox('coordinate-offset').setValue(false)
      await applyButton().trigger('click')
      expect(store.keys[0]!.labels[0]).toBe('')
      expect(store.keys[0]!.x).toBe(3)

      await checkbox('coordinate-offset').setValue(true)
      await applyButton().trigger('click')
      expect(store.keys[0]!.x).toBe(0)

      // Back to after the first Apply: the offset is restored, the label is not.
      store.undo()
      expect(store.keys[0]!.x).toBe(3)
      expect(store.keys[0]!.labels[0]).toBe('')

      // And back to the original state.
      store.undo()
      expect(store.keys[0]!.labels[0]).toBe(' ')
    })

    it('does nothing when no category is selected', async () => {
      await open()
      for (const id of [
        'coordinate-offset',
        'whitespace-label',
        'blank-label-text-size',
        'blank-label-text-color',
        'stale-rotation-origin',
      ]) {
        await checkbox(id).setValue(false)
      }

      expect(applyButton().attributes('disabled')).toBeDefined()
      expect(store.canUndo).toBe(false)
    })

    it('re-scans before acting, so a stale count cannot fake a fix', async () => {
      // The panel is non-modal: the layout can move on between the scan that
      // enabled Apply and the click itself. Acting on the stale counts would run
      // a batch of no-ops, still record an undo step for them, and report
      // properties that were never cleared.
      await open()
      expect(count('whitespace-label')).toBe('1')

      // Replace the layout with a clean one behind the panel, leaving every
      // displayed count stale. Not via a store action, so no history entry is
      // recorded and nothing prompts the panel to re-scan.
      store.keys = [makeKey({ x: 0, y: 0 })]
      expect(store.canUndo).toBe(false)

      await applyButton().trigger('click')

      // No undo step for a batch that changed nothing...
      expect(store.canUndo).toBe(false)
      // ...no result banner claiming otherwise...
      expect(wrapper.find('[data-testid="sanitize-result"]').exists()).toBe(false)
      // ...and the counts now reflect the real layout.
      expect(count('whitespace-label')).toBe('0')
    })
  })

  describe('canvas notification', () => {
    it('dispatches keys-modified after the mutation, not before', async () => {
      // Asserting merely that the event fired is not enough: saveState() fires one
      // too, before the keys change. What matters is that a listener sees the new
      // geometry, since the canvas recomputes bounds from that event.
      const seen: number[] = []
      const listener = () => seen.push(store.keys[0]!.x)
      window.addEventListener('keys-modified', listener)

      await open()
      await applyButton().trigger('click')

      window.removeEventListener('keys-modified', listener)

      expect(seen.length).toBeGreaterThan(0)
      expect(seen[seen.length - 1]!).toBe(0)
    })
  })

  describe('result banner', () => {
    it('reports the two kinds separately rather than as one total', async () => {
      await open()
      await applyButton().trigger('click')

      const text = wrapper.get('[data-testid="sanitize-result"]').text()
      expect(text).toContain('Cleared 4 redundant properties')
      expect(text).toContain('Normalized layout position')
      // The naive sum would have been 5.
      expect(text).not.toContain('5')
    })

    it('omits the normalization half when only redundancy rules ran', async () => {
      await open()
      await checkbox('coordinate-offset').setValue(false)
      await applyButton().trigger('click')

      const text = wrapper.get('[data-testid="sanitize-result"]').text()
      expect(text).toContain('Cleared 4 redundant properties')
      expect(text).not.toContain('Normalized layout position')
    })

    it('omits the redundancy half when only the offset rule ran', async () => {
      await open()
      for (const id of [
        'whitespace-label',
        'blank-label-text-size',
        'blank-label-text-color',
        'stale-rotation-origin',
      ]) {
        await checkbox(id).setValue(false)
      }
      await applyButton().trigger('click')

      const text = wrapper.get('[data-testid="sanitize-result"]').text()
      expect(text).toBe('Normalized layout position')
    })

    it('names every normalization rule that ran rather than counting them', async () => {
      // Two normalization rules on different scales — a whole-layout shift and a
      // per-key tally — have no meaningful sum, so the banner lists them by name.
      store.keys = [makeKey({ x: 3, y: 2, rotation_angle: 3600 })]

      await open()
      await applyButton().trigger('click')

      expect(wrapper.get('[data-testid="sanitize-result"]').text()).toBe(
        'Normalized layout position, rotation angles',
      )
    })

    it('uses the singular for a single property', async () => {
      const key = makeKey({ x: 0, y: 0 })
      key.textSize[0] = 5
      store.keys = [key]

      await open()
      await applyButton().trigger('click')

      expect(wrapper.get('[data-testid="sanitize-result"]').text()).toContain(
        'Cleared 1 redundant property',
      )
    })
  })

  describe('rescan', () => {
    it('resets the selection to every category with issues', async () => {
      await open()
      await checkbox('coordinate-offset').setValue(false)
      expect(isChecked('coordinate-offset')).toBe(false)

      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('Rescan'))!
        .trigger('click')

      expect(isChecked('coordinate-offset')).toBe(true)
      expect(wrapper.find('[data-testid="sanitize-result"]').exists()).toBe(false)
    })

    it('picks up edits made while the panel is open', async () => {
      await open()
      expect(count('whitespace-label')).toBe('1')

      store.keys[1]!.labels[3] = '  '
      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('Rescan'))!
        .trigger('click')

      expect(count('whitespace-label')).toBe('2')
    })
  })

  describe('warning-only rules', () => {
    /** Two keys overlapping by half a unit, and nothing else wrong. */
    function seedCollidingLayout() {
      store.keys = [makeKey({ x: 0, y: 0 }), makeKey({ x: 0.5, y: 0 })]
    }

    it('groups warnings separately from fixable rules', async () => {
      await open()

      expect(wrapper.find('[data-testid="sanitize-group-advisory"]').exists()).toBe(true)
      expect(wrapper.get('[data-testid="sanitize-group-advisory"]').text()).toContain('Warnings')
    })

    it('renders no checkbox for a rule that cannot fix itself', async () => {
      await open()

      expect(wrapper.find('[data-testid="sanitize-checkbox-key-collisions"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="sanitize-count-key-collisions"]').exists()).toBe(true)
    })

    it('leaves the warning standing after an Apply', async () => {
      seedCollidingLayout()
      await open()

      expect(count('key-collisions')).toBe('1')
      // Nothing fixable to do, so Apply is off — and the overlap is still there.
      expect(applyButton().attributes('disabled')).toBeDefined()
      expect(count('key-collisions')).toBe('1')
    })

    it('says the layout is otherwise clean but still needs review', async () => {
      seedCollidingLayout()
      await open()

      const banner = wrapper.get('[data-testid="sanitize-warnings"]').text()
      expect(banner).toContain('Nothing to clean up.')
      expect(banner).toContain('Overlapping keys')
      // The "all clear" banner must not claim the layout is fine.
      expect(wrapper.find('.clean-banner').exists()).toBe(false)
    })

    it('shows no warning banner when there is nothing to warn about', async () => {
      store.keys = [makeKey({ x: 0, y: 0 })]
      await open()

      expect(wrapper.find('[data-testid="sanitize-warnings"]').exists()).toBe(false)
      expect(wrapper.find('.clean-banner').exists()).toBe(true)
    })

    it('drops the "otherwise clean" lead while fixable issues remain', async () => {
      await open()

      expect(wrapper.get('[data-testid="sanitize-warnings"]').text()).not.toContain(
        'Nothing to clean up.',
      )
    })

    it('selects the offending keys on canvas', async () => {
      seedCollidingLayout()
      await open()

      await wrapper.get('[data-testid="sanitize-select-key-collisions"]').trigger('click')

      expect(store.selectedKeys).toHaveLength(2)
      expect(store.selectedKeys).toContain(store.keys[0])
      expect(store.selectedKeys).toContain(store.keys[1])
    })

    it('offers no Select action when there is nothing to select', async () => {
      store.keys = [makeKey({ x: 0, y: 0 })]
      await open()

      expect(wrapper.find('[data-testid="sanitize-select-key-collisions"]').exists()).toBe(false)
    })
  })

  describe('closing', () => {
    it('emits close from the Close button', async () => {
      await open()
      await wrapper
        .findAll('button')
        .find((b) => b.text().includes('Close'))!
        .trigger('click')

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('emits close on Escape', async () => {
      await open()
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

      expect(wrapper.emitted('close')).toBeTruthy()
    })

    it('ignores Escape when hidden', async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))

      expect(wrapper.emitted('close')).toBeFalsy()
    })
  })
})
