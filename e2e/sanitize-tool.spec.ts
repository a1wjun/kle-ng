import { test, expect, Page } from '@playwright/test'
import { promises as fs } from 'fs'
import { CanvasTestHelper, WaitHelpers, ImportExportHelper, SanitizeToolHelper } from './helpers'

/**
 * A layout carrying several of the redundancies the tool cleans up:
 *
 * - offset from the origin (nothing sits at 0,0)
 * - a per-label color on label index 6 ("B")
 * - a stale rotation origin: rx/ry with no rotation angle (key "C")
 * - a rotated key (key "D"), which drives the visual bounding box
 *
 * The test then clears label 6 through the properties panel, which is how
 * orphaned formatting actually arises: the label goes, the formatting stays.
 * Neither the KLE deserializer nor its serializer will carry an override on a
 * blank label, so this state cannot be imported — it has to be created live.
 */
const FIXTURE = JSON.stringify([
  [{ x: 3, y: 2, t: '#000000\n#ff0000' }, 'A\nB'],
  [{ rx: 1, ry: 1, x: 2, y: 0 }, 'C'],
  [{ r: 20, rx: 6, ry: 3, x: -6, y: -3 }, 'D'],
])

type KleKeyObject = Record<string, unknown>

/** Flattens a KLE export down to just its per-key property objects. */
function keyObjects(layout: unknown[]): KleKeyObject[] {
  const objects: KleKeyObject[] = []
  for (const row of layout) {
    if (!Array.isArray(row)) continue
    for (const item of row) {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        objects.push(item as KleKeyObject)
      }
    }
  }
  return objects
}

async function exportLayout(page: Page, name: string): Promise<unknown[]> {
  const helper = new ImportExportHelper(page, new WaitHelpers(page))
  const path = await helper.exportToJSON(`${name}-${Date.now()}.json`)
  const content = await fs.readFile(path, 'utf-8')
  await fs.unlink(path)
  return JSON.parse(content)
}

test.describe('Sanitize Layout tool', () => {
  let canvasHelper: CanvasTestHelper
  let waitHelpers: WaitHelpers
  let sanitize: SanitizeToolHelper

  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    waitHelpers = new WaitHelpers(page)
    canvasHelper = new CanvasTestHelper(page)
    sanitize = new SanitizeToolHelper(page, waitHelpers)

    await canvasHelper.loadJsonLayout(FIXTURE)
    // Clear the label that carries a color override, leaving the color orphaned.
    await canvasHelper.selectAllKeys()
    await canvasHelper.setKeyLabel('bottomLeft', ' ')
    await canvasHelper.deselectAllKeys()
  })

  test('is listed in the Extra Tools dropdown', async () => {
    await sanitize.getExtraToolsButton().click()
    await waitHelpers.waitForDoubleAnimationFrame()

    await expect(sanitize.getToolMenuItem()).toBeVisible()
    await expect(sanitize.getToolMenuItem()).toBeEnabled()
  })

  test('reports every category on open, grouped by kind', async () => {
    await sanitize.openPanel()

    await sanitize.expectCount('coordinate-offset', 1)
    await sanitize.expectCount('whitespace-label', 3)
    await sanitize.expectCount('blank-label-text-color', 1)
    await sanitize.expectCount('stale-rotation-origin', 1)
    // Nothing set a per-label size, so this category is clean and locked out.
    await sanitize.expectCount('blank-label-text-size', 0)
    await sanitize.expectCheckboxDisabled('blank-label-text-size')

    // Categories with issues start checked.
    await sanitize.expectChecked('coordinate-offset')
    await sanitize.expectChecked('whitespace-label')

    // The offset rule lives in its own group: it rewrites data rather than
    // deleting inert data.
    await expect(
      sanitize.getGroup('normalization').locator('[data-testid="sanitize-rule-coordinate-offset"]'),
    ).toBeVisible()
    await expect(
      sanitize.getGroup('redundancy').locator('[data-testid="sanitize-rule-whitespace-label"]'),
    ).toBeVisible()

    // Warnings get their own group, and no checkbox — this fixture's keys don't
    // overlap, but the row is still listed so its clean state is visible.
    await expect(
      sanitize.getGroup('advisory').locator('[data-testid="sanitize-rule-key-collisions"]'),
    ).toBeVisible()
    await sanitize.expectCount('key-collisions', 0)
    await sanitize.expectNoCheckbox('key-collisions')
  })

  test('warns about overlapping keys without offering to fix them', async ({ page }) => {
    // Two 1u keys half a unit apart: a layout that cannot be built, and whose
    // resolution is the user's call, not the tool's.
    await canvasHelper.loadJsonLayout(JSON.stringify([[{ x: 0, y: 0 }, 'A', { x: -0.5 }, 'B']]))

    await sanitize.openPanel()

    await sanitize.expectCount('key-collisions', 1)
    await sanitize.expectNoCheckbox('key-collisions')

    // Nothing here is fixable, so the banner has to say so rather than leaving
    // the "Nothing to clean up." all-clear standing on its own.
    await expect(sanitize.getWarningBanner()).toBeVisible()
    await expect(sanitize.getWarningBanner()).toContainText('Overlapping keys')
    await expect(sanitize.getCleanBanner()).toBeHidden()
    await sanitize.expectApplyDisabled()
    await sanitize.expectNoScroll()

    // The one recourse a warning can offer: put the offenders under the cursor.
    await sanitize.select('key-collisions')
    await expect(page.getByText('Selected: 2')).toBeVisible()

    // Still reported after a rescan — nothing silently resolved it.
    await sanitize.rescan()
    await sanitize.expectCount('key-collisions', 1)
  })

  test('fits without scrolling, with every rule described on screen', async () => {
    await sanitize.openPanel()
    await sanitize.expectNoScroll()

    // Each rule states what it does inline — nothing hidden behind a hover.
    const row = sanitize.getRuleRow('coordinate-offset')
    await expect(row).toContainText('Layout position')
    await expect(row).toContainText('Move the layout to start at (0,0)')

    // Still no scroll once a status line appears.
    await sanitize.apply()
    await expect(sanitize.getResultBanner()).toBeVisible()
    await sanitize.expectNoScroll()
  })

  test('descriptions are not truncated at the panel width', async () => {
    // They are single-line with `text-overflow: ellipsis`, so an over-long string
    // would silently hide the text it was added to show.
    await sanitize.openPanel()

    for (const description of await sanitize.getPanel().locator('.rule-description').all()) {
      const clipped = await description.evaluate((el) => el.scrollWidth > el.clientWidth)
      expect(clipped, `"${await description.textContent()}" is clipped`).toBe(false)
    }
  })

  test('applies only the checked categories, then normalizes on a second pass', async ({
    page,
  }) => {
    await sanitize.openPanel()

    // ---- First Apply: everything except the coordinate offset ----
    await sanitize.uncheck('coordinate-offset')
    await sanitize.apply()

    await sanitize.expectCount('whitespace-label', 0)
    await sanitize.expectCount('blank-label-text-color', 0)
    await sanitize.expectCount('stale-rotation-origin', 0)
    // The deselected category keeps its issue, its count, and its unchecked state.
    await sanitize.expectCount('coordinate-offset', 1)
    await sanitize.expectUnchecked('coordinate-offset')

    // Only redundancy rules ran, so only that half of the report appears.
    await expect(sanitize.getResultBanner()).toContainText('Cleared')
    await expect(sanitize.getResultBanner()).not.toContainText('Normalized layout position')

    const afterRedundancy = keyObjects(await exportLayout(page, 'sanitize-after-redundancy'))
    // The stale rotation origin is gone from the unrotated key...
    expect(afterRedundancy.filter((k) => k.r === undefined).some((k) => 'rx' in k)).toBe(false)
    // ...but the layout has not moved. `rx`/`ry` are the anchor here because they
    // are absolute coordinates in the KLE format, unlike per-key `x`/`y`, which
    // are cursor deltas and shift around whenever a neighbouring key's properties
    // change.
    const rotatedBefore = afterRedundancy.find((k) => k.r === 20)
    expect(rotatedBefore).toBeDefined()
    expect(rotatedBefore!.rx).toBe(6)
    expect(rotatedBefore!.ry).toBe(3)

    // ---- Second Apply: the coordinate offset alone ----
    await sanitize.check('coordinate-offset')
    await sanitize.apply()

    await sanitize.expectCount('coordinate-offset', 0)
    await sanitize.expectCheckboxDisabled('coordinate-offset')
    await expect(sanitize.getResultBanner()).toContainText('Normalized layout position')

    const afterOffset = keyObjects(await exportLayout(page, 'sanitize-after-offset'))

    // The layout moved, and the rotated key kept its rotation while its origin
    // travelled with it.
    const rotated = afterOffset.find((k) => k.r === 20)
    expect(rotated).toBeDefined()
    expect(rotated!.rx).not.toBe(6)
    expect(rotated!.ry).not.toBe(3)

    // The guard held: shifting the layout did not hand every unrotated key a
    // rotation origin it does not need. Applying the offset rule with the
    // stale-rotation-origin rule inactive is the only way to observe this —
    // running both would clean up after the bug and hide it.
    expect(afterOffset.filter((k) => k.r === undefined).some((k) => 'rx' in k || 'ry' in k)).toBe(
      false,
    )

    // The panel agrees the whole layout is clean now. The clean banner only
    // appears on a fresh open — right after an Apply the result of that Apply is
    // the one status line shown.
    await sanitize.expectApplyDisabled()
    await sanitize.close()
    await sanitize.openPanel()
    await expect(sanitize.getCleanBanner()).toBeVisible()
    await sanitize.expectApplyDisabled()
  })

  test('wraps rotation angles a hand-edited JSON smuggled in', async ({ page }) => {
    // The angle controls always write a wrapped value, so an angle like 3600 can
    // only arrive by editing the JSON directly — which is what this does.
    await canvasHelper.loadJsonLayout(
      JSON.stringify([
        [{ r: 3600, rx: 2, ry: 1, x: 0, y: 0 }, 'A'],
        [{ r: 380, rx: 4, ry: 1, x: 0, y: 0 }, 'B'],
        [{ r: 20, rx: 6, ry: 1, x: 0, y: 0 }, 'C'],
      ]),
    )

    await sanitize.openPanel()

    // The already-wrapped key is not counted.
    await sanitize.expectCount('rotation-angle', 2)
    await sanitize.expectChecked('rotation-angle')
    await expect(
      sanitize.getGroup('normalization').locator('[data-testid="sanitize-rule-rotation-angle"]'),
    ).toBeVisible()

    await sanitize.apply()

    await sanitize.expectCount('rotation-angle', 0)
    await sanitize.expectCheckboxDisabled('rotation-angle')
    await expect(sanitize.getResultBanner()).toContainText('rotation angles')

    const layout = await exportLayout(page, 'sanitize-angles')
    const angles = keyObjects(layout)
      .map((k) => k.r)
      .filter((r) => r !== undefined)

    // 380 came down to 20, matching the key that was already there. (KLE emits
    // `r` only when it changes between rotation clusters, so the two keys now
    // sharing 20 are described by a single `r`.)
    expect(angles).not.toContain(3600)
    expect(angles).not.toContain(380)
    expect(angles).toContain(20)
    expect(angles.every((r) => Math.abs(r as number) <= 180)).toBe(true)

    // The whole turn collapsed to no rotation at all, and its origin — dead
    // weight at any multiple of 360 — went with it. That key sorts into the
    // leading unrotated cluster, so it carries no property object whatsoever.
    expect(layout[0]).toEqual(['A'])
  })

  test('each Apply is a single undo step', async ({ page }) => {
    await sanitize.openPanel()

    await sanitize.uncheck('coordinate-offset')
    await sanitize.apply()
    await sanitize.check('coordinate-offset')
    await sanitize.apply()
    await sanitize.expectCount('coordinate-offset', 0)

    // One undo reverts the second Apply only — despite it having moved every key.
    await canvasHelper.getCanvas().focus()
    await page.keyboard.press('Control+z')
    await waitHelpers.waitForDoubleAnimationFrame()

    await sanitize.rescan()
    await sanitize.expectCount('coordinate-offset', 1)
    // The first Apply's fixes are still in place.
    await sanitize.expectCount('whitespace-label', 0)
    await sanitize.expectCount('stale-rotation-origin', 0)

    // A second undo takes the first Apply back out, restoring every issue.
    await canvasHelper.getCanvas().focus()
    await page.keyboard.press('Control+z')
    await waitHelpers.waitForDoubleAnimationFrame()

    await sanitize.rescan()
    await sanitize.expectCount('whitespace-label', 3)
    await sanitize.expectCount('stale-rotation-origin', 1)
  })

  test('redraws the canvas immediately after normalizing', async () => {
    // The canvas recomputes its bounds from the `keys-modified` event. saveState()
    // fires one *before* the mutation, so if that were the only notification the
    // view would keep rendering pre-shift geometry until some unrelated
    // interaction invalidated it. Nothing is touched between Apply and the
    // screenshot here on purpose.
    await sanitize.openPanel()
    await sanitize.close()
    await canvasHelper.waitForCanvasStability()
    const before = await canvasHelper.getCanvas().screenshot()

    await sanitize.openPanel()
    await sanitize.apply()
    await sanitize.close()
    await canvasHelper.waitForCanvasStability()
    const after = await canvasHelper.getCanvas().screenshot()

    expect(Buffer.compare(before, after)).not.toBe(0)
  })

  test('rescan picks up edits made after the panel has been used', async () => {
    await sanitize.openPanel()
    await sanitize.apply()
    await sanitize.expectApplyDisabled()

    // Dirty the layout again behind the (non-modal) panel.
    await sanitize.close()
    await canvasHelper.selectAllKeys()
    await canvasHelper.setKeyLabel('topRight', '  ')
    await canvasHelper.deselectAllKeys()

    await sanitize.openPanel()
    await sanitize.expectCount('whitespace-label', 3)
    await sanitize.expectApplyEnabled()
  })

  test('closes on Escape', async ({ page }) => {
    await sanitize.openPanel()
    await page.keyboard.press('Escape')
    await sanitize.expectPanelHidden()
  })
})
