import { expect, test, type Page } from '@playwright/test'

test.use({
  viewport: { width: 390, height: 844 },
  screen: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
})

interface ShellState {
  documentScrollTop: number
  bodyScrollTop: number
  mainScrollTop: number
  mainClientHeight: number
  mainScrollHeight: number
  shell: { top: number; bottom: number; height: number }
  nav: { top: number; bottom: number; height: number; position: string }
}

async function afterLayout(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

async function readShellState(page: Page): Promise<ShellState> {
  return page.evaluate(() => {
    const shell = document.querySelector<HTMLElement>('.app-shell')
    const main = document.querySelector<HTMLElement>('.app-main[data-scroll-container="main-content"]')
    const nav = document.querySelector<HTMLElement>('.bottom-nav')
    if (!shell || !main || !nav) throw new Error('PWA shell elements are missing')
    const shellRect = shell.getBoundingClientRect()
    const navRect = nav.getBoundingClientRect()
    return {
      documentScrollTop: document.scrollingElement?.scrollTop ?? -1,
      bodyScrollTop: document.body.scrollTop,
      mainScrollTop: main.scrollTop,
      mainClientHeight: main.clientHeight,
      mainScrollHeight: main.scrollHeight,
      shell: { top: shellRect.top, bottom: shellRect.bottom, height: shellRect.height },
      nav: {
        top: navRect.top,
        bottom: navRect.bottom,
        height: navRect.height,
        position: getComputedStyle(nav).position,
      },
    }
  })
}

async function expectAnchoredShell(page: Page) {
  const state = await readShellState(page)
  expect(state.documentScrollTop).toBe(0)
  expect(state.bodyScrollTop).toBe(0)
  expect(state.shell.top).toBeCloseTo(0, 0)
  expect(state.shell.bottom).toBeCloseTo(state.shell.height, 0)
  expect(state.nav.position).toBe('relative')
  expect(state.nav.bottom).toBeCloseTo(state.shell.bottom, 0)
  await expect(page.locator('.app-shell > .app-main + .bottom-nav')).toHaveCount(1)
  return state
}

test('keeps the mobile nav anchored through routes, scrolling, modal, and lifecycle changes', async ({
  page,
}) => {
  test.setTimeout(120_000)

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Scan library' })).toBeVisible()
  await expect(page.locator('.scan-card')).toHaveCount(21, { timeout: 30_000 })

  const initial = await expectAnchoredShell(page)
  expect(initial.mainScrollHeight).toBeGreaterThan(initial.mainClientHeight)

  const main = page.locator('.app-main[data-scroll-container="main-content"]')
  const maxScroll = initial.mainScrollHeight - initial.mainClientHeight
  for (const scrollTop of [maxScroll, 0, Math.floor(maxScroll / 2), maxScroll]) {
    await main.evaluate((element, top) => element.scrollTo({ top }), scrollTop)
    await expect.poll(async () => (await readShellState(page)).mainScrollTop)
      .toBeCloseTo(scrollTop, 0)
    const scrolled = await expectAnchoredShell(page)
    expect(scrolled.nav.top).toBeCloseTo(initial.nav.top, 0)
  }

  await page.getByRole('button', { name: 'Shortcuts', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Shortcuts' })).toBeVisible()
  await expectAnchoredShell(page)
  await page.getByRole('button', { name: 'Close shortcuts' }).click()
  await expect(page.getByRole('dialog', { name: 'Shortcuts' })).toHaveCount(0)
  await expectAnchoredShell(page)

  await main.evaluate((element) => element.scrollTo({ top: 0 }))
  await page.locator('.scan-card').filter({ hasText: 'AX DIFF_ADC' }).getByRole('button').click()
  await expect(page).toHaveURL(/#series\/brain-04-ax-diff-adc$/)
  await expect(page.locator('.workspace')).toBeVisible({ timeout: 30_000 })
  await expectAnchoredShell(page)

  await page.getByRole('button', { name: 'Library', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Scan library' })).toBeVisible()
  await expect(page).not.toHaveURL(/#series\//)
  await expectAnchoredShell(page)

  await page.evaluate(() => {
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Page.setWebLifecycleState', { state: 'frozen' })
  await cdp.send('Page.setWebLifecycleState', { state: 'active' })
  await afterLayout(page)
  await expectAnchoredShell(page)

  await main.evaluate((element) => {
    const input = document.createElement('input')
    input.type = 'text'
    input.dataset.testKeyboardTarget = 'true'
    element.prepend(input)
    input.focus()
  })
  await expect(page.locator('[data-test-keyboard-target="true"]')).toBeFocused()
  await page.setViewportSize({ width: 844, height: 390 })
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')))
  await afterLayout(page)
  await expectAnchoredShell(page)

  await page.locator('[data-test-keyboard-target="true"]').blur()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => window.dispatchEvent(new Event('orientationchange')))
  await afterLayout(page)
  const restored = await expectAnchoredShell(page)
  expect(restored.shell.height).toBeCloseTo(initial.shell.height, 0)
})
