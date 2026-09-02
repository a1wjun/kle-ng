<template>
  <div
    v-if="isVisible"
    class="modal fade show d-block"
    tabindex="-1"
    role="dialog"
    aria-modal="true"
    aria-labelledby="preset-import-title"
    data-testid="modal-preset-import"
    @click.self="close"
  >
    <div class="modal-dialog modal-dialog-centered modal-xl">
      <div class="modal-content">
        <div class="modal-header">
          <h5 id="preset-import-title" class="modal-title">Import from Preset</h5>
          <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
        </div>

        <div class="modal-body">
          <input
            ref="searchInputRef"
            v-model="searchQuery"
            type="text"
            class="form-control mb-3"
            data-testid="preset-search"
            placeholder="Search presets (e.g. 60%, ortho, split)…"
            autocomplete="off"
            @keydown.down.prevent="focusCard(0)"
          />

          <!--
            Fixed height, not content height: the grid is what a search narrows, and
            the modal must not jump around under the pointer while it is being typed
            into — least of all collapse when a query matches nothing.
          -->
          <div ref="scrollRef" class="preset-scroll-area">
            <!--
              One card per preset, and the card is the preview: there is nothing to
              read here that the picture does not already say, so a click loads
              straight away rather than selecting for a second confirmation step.
            -->
            <div v-if="filteredPresets.length" ref="gridRef" class="preset-grid">
              <button
                v-for="(entry, index) in filteredPresets"
                :key="entry.preset.file"
                type="button"
                class="preset-card"
                data-testid="preset-card"
                :data-preset-file="entry.preset.file"
                :data-preset-name="entry.preset.name"
                :title="entry.preset.description || entry.preset.name"
                @click="choose(entry.preset)"
                @keydown="handleGridKeydown($event, index)"
              >
                <span class="preset-card-thumb">
                  <LayoutThumbnail
                    v-if="isDrawable(entry.preset.file)"
                    :keys="previews[entry.preset.file]!.data!.keyboard.keys"
                    :metadata="previews[entry.preset.file]!.data!.keyboard.meta"
                    class="preset-thumb-canvas"
                  />
                  <!--
                    blank.json deserializes to zero keys, which the preview renderer
                    would draw as an 18x18 white square — indistinguishable from a
                    broken render. Say what it is instead.
                  -->
                  <span
                    v-else-if="statusOf(entry.preset.file) === 'ready'"
                    class="preset-card-empty"
                    data-testid="preset-card-empty"
                  >
                    Empty canvas
                  </span>
                  <span
                    v-else-if="statusOf(entry.preset.file) === 'error'"
                    class="preset-card-failed"
                    data-testid="preset-card-error"
                  >
                    <BiExclamationTriangle class="text-warning" aria-hidden="true" />
                  </span>
                  <span v-else class="preset-card-skeleton" aria-hidden="true"></span>
                </span>

                <span class="preset-card-name text-truncate" v-html="entry.html"></span>
                <span class="preset-card-meta small text-muted">{{ metaLine(entry.preset) }}</span>
              </button>
            </div>

            <p
              v-else
              class="preset-empty-state text-muted fst-italic text-center mb-0"
              data-testid="preset-empty-state"
            >
              No presets match your search
            </p>
          </div>

          <div class="form-text mt-2" data-testid="preset-count">
            {{
              searchQuery.trim()
                ? `${filteredPresets.length} result(s)`
                : `${ALL_PRESETS.length} presets available`
            }}
          </div>
        </div>

        <div class="modal-footer">
          <button type="button" class="btn btn-secondary" @click="close">Close</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import Fuse from 'fuse.js'
import { useKeyboardStore } from '@/stores/keyboard'
import { toast } from '@/composables/useToast'
import { escapeHtml, highlightMatches } from '@/utils/fuse-highlight'
import {
  ALL_PRESETS,
  applyPreset,
  loadPresetPreview,
  type Preset,
  type PresetPreview,
} from '@/utils/presets'
import LayoutThumbnail from './LayoutThumbnail.vue'
import BiExclamationTriangle from 'bootstrap-icons/icons/exclamation-triangle.svg'

/**
 * Browses the whole built-in preset library.
 *
 * The Import dropdown lists only the curated `TOP_PRESETS`; everything else is
 * reachable here. Cards draw the layout with the same renderer as the editor
 * canvas (via LayoutThumbnail), so boards can be told apart at a glance.
 */

interface Props {
  isVisible: boolean
}

interface Emits {
  (e: 'close'): void
}

interface SearchResult {
  preset: Preset
  /** The preset name, escaped, with Fuse's match ranges wrapped in <mark> */
  html: string
}

type PreviewStatus = 'loading' | 'ready' | 'error'

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const keyboardStore = useKeyboardStore()

const searchInputRef = ref<HTMLInputElement | null>(null)
const scrollRef = ref<HTMLElement | null>(null)
const gridRef = ref<HTMLElement | null>(null)

const searchQuery = ref('')
const previews = ref<Record<string, { status: PreviewStatus; data?: PresetPreview }>>({})

/* -------------------------------------------------------------------------- */
/* Search                                                                      */
/* -------------------------------------------------------------------------- */

// The catalogue is a static import, so the index is built once for the module
// rather than per modal instance.
const fuse = new Fuse(ALL_PRESETS as Preset[], {
  keys: [
    { name: 'name', weight: 3 },
    { name: 'keywords', weight: 2 },
    { name: 'description', weight: 1 },
  ],
  includeMatches: true,
  // Tighter than the QMK/VIA list's 0.4, which is tuned for long slash-separated
  // keyboard paths. Preset names are short, so 0.4 lets a three-letter query like
  // "iso" reach half the catalogue; 0.3 returns the two ISO boards and stops.
  threshold: 0.3,
  ignoreLocation: true,
  minMatchCharLength: 2,
  distance: 200,
})

const filteredPresets = computed<SearchResult[]>(() => {
  const query = searchQuery.value.trim()
  if (!query) {
    return ALL_PRESETS.map((preset) => ({ preset, html: escapeHtml(preset.name) }))
  }

  return fuse.search(query).map(({ item, matches }) => {
    // highlightMatches indexes into the string it is given, so only a hit on
    // `name` can be highlighted. Indices from a `keywords` or `description`
    // match would mark arbitrary characters of the displayed name.
    const nameMatch = matches?.find((match) => match.key === 'name')
    return {
      preset: item,
      html: nameMatch
        ? highlightMatches(item.name, nameMatch.indices as [number, number][])
        : escapeHtml(item.name),
    }
  })
})

/* -------------------------------------------------------------------------- */
/* Previews                                                                    */
/* -------------------------------------------------------------------------- */

const statusOf = (file: string): PreviewStatus | undefined => previews.value[file]?.status

const isDrawable = (file: string) => {
  const entry = previews.value[file]
  return entry?.status === 'ready' && (entry.data?.keyCount ?? 0) > 0
}

const metaLine = (preset: Preset) => {
  const entry = previews.value[preset.file]
  if (!entry || entry.status === 'loading') return ' ' // reserve the line so cards never resize
  if (entry.status === 'error') return 'Preview unavailable'
  const count = entry.data?.keyCount ?? 0
  return count === 0 ? 'Empty' : `${count} ${count === 1 ? 'key' : 'keys'}`
}

const ensurePreview = async (file: string) => {
  if (previews.value[file]) return // loading, ready or failed — all settled decisions
  previews.value = { ...previews.value, [file]: { status: 'loading' } }
  try {
    const data = await loadPresetPreview(file)
    previews.value = { ...previews.value, [file]: { status: 'ready', data } }
  } catch (error) {
    console.error(`Could not render preview for preset "${file}":`, error)
    previews.value = { ...previews.value, [file]: { status: 'error' } }
  }
}

/* -------------------------------------------------------------------------- */
/* Lazy loading of the cards on screen                                         */
/* -------------------------------------------------------------------------- */

let observer: IntersectionObserver | null = null

const teardownObserver = () => {
  observer?.disconnect()
  observer = null
}

const setupObserver = () => {
  teardownObserver()
  if (!gridRef.value) return

  // No IntersectionObserver (jsdom): the catalogue is a handful of small
  // same-origin files, so loading all of them is a fine degenerate path.
  if (typeof IntersectionObserver === 'undefined') {
    for (const preset of ALL_PRESETS) void ensurePreview(preset.file)
    return
  }

  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const file = (entry.target as HTMLElement).dataset.presetFile
        if (!file) continue
        // The parsed result is cached for the session and there is nothing to
        // cancel, so a card only ever needs to be seen once.
        observer?.unobserve(entry.target)
        void ensurePreview(file)
      }
    },
    { root: scrollRef.value, rootMargin: '160px' },
  )

  for (const card of gridRef.value.querySelectorAll('[data-preset-file]')) {
    observer.observe(card)
  }
}

watch([filteredPresets, gridRef], () => {
  if (!props.isVisible) return
  void nextTick(setupObserver)
})

/* -------------------------------------------------------------------------- */
/* Keyboard navigation across the grid                                         */
/* -------------------------------------------------------------------------- */

function gridCards(): HTMLButtonElement[] {
  return Array.from(gridRef.value?.querySelectorAll<HTMLButtonElement>('.preset-card') ?? [])
}

function focusCard(index: number) {
  gridCards()[index]?.focus()
}

function getColumnCount(): number {
  if (!gridRef.value) return 1
  const columns = getComputedStyle(gridRef.value).gridTemplateColumns.split(' ').filter(Boolean)
  return columns.length || 1
}

function handleGridKeydown(event: KeyboardEvent, index: number) {
  const columns = getColumnCount()
  switch (event.key) {
    case 'ArrowRight':
      event.preventDefault()
      focusCard(index + 1)
      break
    case 'ArrowLeft':
      event.preventDefault()
      if (index === 0) {
        searchInputRef.value?.focus()
      } else {
        focusCard(index - 1)
      }
      break
    case 'ArrowDown':
      event.preventDefault()
      focusCard(index + columns)
      break
    case 'ArrowUp':
      event.preventDefault()
      if (index - columns < 0) {
        searchInputRef.value?.focus()
      } else {
        focusCard(index - columns)
      }
      break
  }
}

/* -------------------------------------------------------------------------- */

const choose = async (preset: Preset) => {
  try {
    await applyPreset(preset, keyboardStore)
  } catch (error) {
    console.error('Error loading preset:', error)
    toast.showError(`Failed to load ${preset.name}`, 'Error loading preset')
  } finally {
    // Closing regardless matches the other import modals: on success the editor
    // is what the user wants to see, and on failure the toast outlives the modal.
    close()
  }
}

const close = () => {
  searchQuery.value = ''
  teardownObserver()
  emit('close')
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') close()
}

watch(
  () => props.isVisible,
  (visible) => {
    if (visible) {
      document.addEventListener('keydown', handleKeyDown)
      document.body.classList.add('modal-open')
      nextTick(() => {
        searchInputRef.value?.focus()
        setupObserver()
      })
    } else {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('modal-open')
      teardownObserver()
    }
  },
)

onMounted(() => {
  if (props.isVisible) {
    document.addEventListener('keydown', handleKeyDown)
    document.body.classList.add('modal-open')
    void nextTick(setupObserver)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
  document.body.classList.remove('modal-open')
  teardownObserver()
})
</script>

<style scoped>
/* No .modal-backdrop element is rendered, so the scrim lives here. */
.modal {
  background: rgba(0, 0, 0, 0.5);
}

/* Fixed, not max-height: filtering changes how many cards there are, and the modal
   has to stay exactly as tall while the user types. */
.preset-scroll-area {
  height: min(60vh, 520px);
  overflow-y: auto;
  overflow-x: hidden;
}

/* Fills the reserved area rather than sitting in the top of it. */
.preset-empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
  gap: 0.75rem;
}

/* On a phone 190px leaves room for a single column, and one card per screenful
   turns browsing fifteen presets into a long scroll. Two smaller cards read
   better than one big one here. */
@media (max-width: 575.98px) {
  .preset-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  }

  .preset-card-thumb {
    height: 64px;
  }
}

/* Styled from scratch rather than with Bootstrap's .card, which fights the
   button reset when the card itself is the control. */
.preset-card {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding: 0.5rem;
  text-align: left;
  background: var(--bs-body-bg);
  border: 1px solid var(--bs-border-color);
  border-radius: var(--bs-border-radius);
  color: var(--bs-body-color);
  cursor: pointer;
  transition:
    background-color 0.15s ease,
    border-color 0.15s ease;
}

.preset-card:hover,
.preset-card:focus-visible {
  background: var(--bs-primary-bg-subtle);
  border-color: var(--bs-primary);
}

/* Fixed box so the grid is already rectangular before any preview lands, and so
   the light-backed preview reads as an intentional swatch in dark mode. */
.preset-card-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 84px;
  overflow: hidden;
  background: var(--bs-tertiary-bg);
  border-radius: var(--bs-border-radius-sm);
}

.preset-thumb-canvas {
  width: 100%;
  height: 100%;
}

/* Bootstrap's spinners partial is not compiled into this app, so the waiting
   state is a plain keyframe rather than .spinner-border. */
.preset-card-skeleton {
  display: block;
  width: 100%;
  height: 100%;
  background: var(--bs-secondary-bg);
  animation: preset-pulse 1.4s ease-in-out infinite;
}

@keyframes preset-pulse {
  50% {
    opacity: 0.4;
  }
}

@media (prefers-reduced-motion: reduce) {
  .preset-card-skeleton {
    animation: none;
  }
}

.preset-card-empty {
  font-size: 0.75rem;
  color: var(--bs-secondary-color);
  border: 1px dashed var(--bs-border-color);
  border-radius: var(--bs-border-radius-sm);
  padding: 0.5rem 0.75rem;
}

.preset-card-name {
  font-weight: 500;
  font-size: 0.875rem;
}

.preset-card-name :deep(mark) {
  background-color: #ffe066;
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}
</style>
