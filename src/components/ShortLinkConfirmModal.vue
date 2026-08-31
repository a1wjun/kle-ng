<template>
  <div v-if="isVisible" class="modal fade show d-block" tabindex="-1" @click.self="onBackdropClick">
    <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable">
      <div class="modal-content">
        <div class="modal-header">
          <h5 class="modal-title">
            {{ modalTitle }}
          </h5>
          <button type="button" class="btn-close" @click="close" aria-label="Close"></button>
        </div>

        <!-- Auto-confirming via the "don't show again" preference: the user opted out of
             the warning, so a create still in flight must not flash it at them anyway.
             Checked before the 'done' result below only matters while stage is still
             'creating' — confirm() clears it once the request settles either way. -->
        <div v-if="silentCreate" class="modal-body text-center py-4">
          <span class="spinner-border spinner-border-sm me-2" aria-hidden="true"></span>
          Creating short link…
        </div>

        <!-- Consent. Nothing has been stored yet, and Cancel is still a way out. -->
        <div v-else-if="stage !== 'done'" class="modal-body">
          <!-- Skipped once the user has already dismissed it (skipWarning): getting here
               with skipWarning on means a sanitize issue forced the screen open (see
               openForCurrentLayout), not that the privacy tradeoffs need repeating. -->
          <template v-if="!shortLinksStore.skipWarning">
            <p>
              A short link stores this layout on the kle-ng server and gives you a URL that points
              at it. Before you create one:
            </p>
            <ul class="mb-3">
              <li class="mb-2">
                <strong>It makes the design public.</strong> Anyone who has the link can open the
                layout, without signing in. Treat creating a short link as publishing the design.
              </li>
              <li class="mb-2">
                <strong>It cannot be undone.</strong> There is no way to delete a short link or
                withdraw a layout once it has been stored — not from the app, and not by deleting
                your account. Assume it is permanent.
              </li>
              <li class="mb-2">
                <strong>kle-ng may keep and use it.</strong> The stored layout may be retained
                indefinitely and used by kle-ng in the future, including after you stop using the
                app.
              </li>
            </ul>
            <p class="mb-0 text-body-secondary">
              If you would rather not store anything on the server, use the plain
              <strong>Share Link</strong> button instead. It packs the whole layout into the URL, so
              it needs no account and no server — it is just much longer.
            </p>
          </template>

          <div
            v-if="sanitizeIssueCount > 0"
            class="alert alert-warning d-flex align-items-start gap-2 mt-3 mb-0"
            role="alert"
            data-testid="short-link-sanitize-warning"
          >
            <BiExclamationTriangle class="flex-shrink-0 mt-1" aria-hidden="true" />
            <div>
              This layout has {{ sanitizeIssueCount }} item{{
                sanitizeIssueCount === 1 ? '' : 's'
              }}
              that <strong>Sanitize Layout</strong> could clean up before it is shared publicly.
              <div class="mt-2">
                <button
                  type="button"
                  class="btn btn-sm btn-outline-warning"
                  data-testid="short-link-open-sanitize"
                  @click="openSanitizeTool"
                >
                  Open Sanitize Layout
                </button>
              </div>
            </div>
          </div>

          <div v-if="!shortLinksStore.skipWarning" class="form-check mt-3">
            <input
              id="shortLinkDontShowAgain"
              v-model="dontShowAgain"
              class="form-check-input"
              type="checkbox"
              data-testid="short-link-dont-show-again"
            />
            <label class="form-check-label" for="shortLinkDontShowAgain">
              Don't show this warning again
            </label>
          </div>

          <div
            v-if="errorMessage"
            class="alert alert-danger mt-3 mb-0"
            role="alert"
            data-testid="short-link-error"
          >
            {{ errorMessage }}
          </div>
        </div>

        <!-- Result. The link is shown rather than pushed to the clipboard, so nothing
             changes behind the user's back and the field stays available if whatever
             they copied next overwrote it. -->
        <div v-else class="modal-body">
          <label for="shortLinkUrl" class="form-label">Short link</label>
          <div class="input-group">
            <input
              id="shortLinkUrl"
              ref="urlInput"
              type="text"
              class="form-control"
              data-testid="short-link-url"
              :value="shortUrl"
              readonly
              @focus="selectAll"
            />
            <button
              type="button"
              class="btn"
              :class="copied ? 'btn-primary' : 'btn-outline-secondary'"
              data-testid="short-link-copy"
              @click="copy"
            >
              {{ copied ? 'Copied' : 'Copy' }}
            </button>
          </div>
          <div class="form-text" data-testid="short-link-hint">
            {{
              copyFailed
                ? 'Copying failed — select the link above and copy it manually.'
                : 'Save this link before closing'
            }}
          </div>
        </div>

        <div v-if="!silentCreate" class="modal-footer">
          <template v-if="stage !== 'done'">
            <button
              type="button"
              class="btn btn-secondary"
              data-testid="short-link-cancel"
              @click="close"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-primary"
              data-testid="short-link-confirm"
              :disabled="stage === 'creating'"
              @click="confirm"
            >
              <span
                v-if="stage === 'creating'"
                class="spinner-border spinner-border-sm me-2"
                aria-hidden="true"
              ></span>
              {{ errorMessage ? 'Try again' : 'Create anyway' }}
            </button>
          </template>
          <button
            v-else
            type="button"
            class="btn btn-primary"
            data-testid="short-link-close"
            @click="close"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { useKeyboardStore } from '@/stores/keyboard'
import { useShortLinksStore } from '@/stores/short-links'
import { useLayoutEditorSettingsStore } from '@/stores/layoutEditorSettings'
import { buildShortLinkUrl } from '@/utils/short-links'
import { scanLayout } from '@/utils/sanitize'
import BiExclamationTriangle from 'bootstrap-icons/icons/exclamation-triangle.svg'

interface Props {
  isVisible: boolean
}

interface Emits {
  (e: 'close'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const keyboardStore = useKeyboardStore()
const shortLinksStore = useShortLinksStore()
const layoutEditorSettingsStore = useLayoutEditorSettingsStore()

type Stage = 'consent' | 'creating' | 'done'

const stage = ref<Stage>('consent')
const shortUrl = ref('')
const errorMessage = ref<string | null>(null)
const copied = ref(false)
const copyFailed = ref(false)
const dontShowAgain = ref(false)
const urlInput = ref<HTMLInputElement | null>(null)
// True only while a create is running because skipWarning auto-confirmed it, without the
// user ever seeing the consent screen — the warning body and buttons stay hidden for the
// duration so a slow request doesn't flash the very warning the user opted out of.
const silentCreate = ref(false)

let copiedTimer: ReturnType<typeof setTimeout> | null = null

// Reactive so it stays current if the user opens Sanitize Layout, fixes issues,
// and comes back — no manual re-scan needed. Sums every rule's count across both
// fixable kinds (redundancy + normalization) purely as a "there's something here"
// signal; this is not shown anywhere alongside a breakdown, so the two scales
// mixing is fine. Warning-only rules are excluded: the copy below offers a
// cleanup, and an issue the tool cannot fix would make that offer false.
const sanitizeIssueCount = computed(() =>
  scanLayout(keyboardStore.keys)
    .filter((result) => result.fixable)
    .reduce((sum, result) => sum + result.count, 0),
)

// Sends the user to fix things up rather than blocking them — Create short link
// still works with issues present, this is a nudge, not a gate.
const openSanitizeTool = () => {
  layoutEditorSettingsStore.showSanitizeToolPanel = true
  close()
}

const modalTitle = computed(() => {
  if (stage.value === 'done') return 'Your short link'
  if (silentCreate.value) return 'Creating short link…'
  return 'Create a short link?'
})

const close = () => emit('close')

// A misclick on the backdrop must not take the link away with it. Escape and the two
// close buttons still work — this only removes the dismissal that happens by accident.
const onBackdropClick = () => {
  if (stage.value === 'done') return
  close()
}

const confirm = async () => {
  // The button is disabled while creating, but `stage` only reaches the DOM on the next
  // tick, so two clicks in one tick would both arrive here.
  if (stage.value === 'creating') return

  stage.value = 'creating'
  errorMessage.value = null
  // Committed the moment creation is attempted, not on every checkbox toggle: checking
  // it and then hitting Cancel must not silently mute the warning for later layouts.
  if (dontShowAgain.value) shortLinksStore.skipWarning = true

  try {
    const id = await shortLinksStore.create(keyboardStore.encodeCurrentLayout())
    if (!id) {
      // A silent (skipWarning) attempt that fails still needs the user to see why and
      // decide what to do next, so it falls back to the normal consent+error screen.
      silentCreate.value = false
      errorMessage.value = shortLinksStore.errorMessage || 'Could not create a short link.'
      stage.value = 'consent'
      return
    }
    shortUrl.value = buildShortLinkUrl(id)
    stage.value = 'done'
    silentCreate.value = false
    // Focus the field rather than copying: the user asked for a link, not for their
    // clipboard to change. Selecting it makes a manual copy one keystroke away.
    await nextTick()
    urlInput.value?.focus()
  } catch (error) {
    console.error('Error creating short link:', error)
    silentCreate.value = false
    errorMessage.value = 'Could not create a short link. Please try again.'
    stage.value = 'consent'
  }
}

const selectAll = () => urlInput.value?.select()

const copy = async () => {
  copyFailed.value = false
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable')
    await navigator.clipboard.writeText(shortUrl.value)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // The link is on screen either way, so a refused clipboard is a hint, not an error.
    copyFailed.value = true
    selectAll()
  }
}

const reset = () => {
  stage.value = 'consent'
  shortUrl.value = ''
  errorMessage.value = null
  copied.value = false
  copyFailed.value = false
  dontShowAgain.value = false
  silentCreate.value = false
  if (copiedTimer) {
    clearTimeout(copiedTimer)
    copiedTimer = null
  }
}

// Skips the warning entirely when this exact layout has already been shortened once
// this session — the id is already known, so there is nothing to confirm and nothing
// to wait for. A fresh sha256-keyed hit is exact (see stores/short-links.ts), so this
// is not a guess: showing the link again is not "probably the same", it IS the same.
//
// Failing that, skipWarning (the "Don't show this warning again" checkbox, persisted
// in stores/short-links.ts) skips the consent *screen*, not the creation call itself:
// confirm() still runs, so a layout that has never been shared still hits the network,
// just without making the user look at the warning text first.
const openForCurrentLayout = async () => {
  const cachedId = shortLinksStore.cached(keyboardStore.encodeCurrentLayout())
  if (cachedId) {
    shortUrl.value = buildShortLinkUrl(cachedId)
    errorMessage.value = null
    copied.value = false
    copyFailed.value = false
    stage.value = 'done'
    await nextTick()
    urlInput.value?.focus()
    return
  }
  reset()
  // A dirty layout still needs the user to look at the consent screen even with
  // skipWarning on — that preference means "I know the privacy tradeoffs," not
  // "never tell me about anything," and the sanitize nudge is the latter.
  if (shortLinksStore.skipWarning && sanitizeIssueCount.value === 0) {
    silentCreate.value = true
    await confirm()
  }
}

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') close()
}

watch(
  () => props.isVisible,
  (visible) => {
    if (visible) {
      // Reset on open, not on close: a link left in the field would otherwise be the
      // first thing the next layout's dialog showed.
      void openForCurrentLayout()
      document.addEventListener('keydown', handleKeyDown)
      document.body.classList.add('modal-open')
    } else {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.classList.remove('modal-open')
    }
  },
)

onMounted(() => {
  if (props.isVisible) {
    document.addEventListener('keydown', handleKeyDown)
    document.body.classList.add('modal-open')
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeyDown)
  document.body.classList.remove('modal-open')
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<style scoped>
.modal {
  background: rgba(0, 0, 0, 0.5);
}
</style>
