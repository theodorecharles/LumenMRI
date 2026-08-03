import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  collectPwaViewportDiagnostic,
  installPwaViewportDiagnostics,
  type PwaViewportDiagnostic,
} from './pwaViewportDiagnostics'

class VisualViewportStub extends EventTarget {
  width = 390
  height = 700
  offsetTop = 11
  pageTop = 23
  scale = 1
}

const originalVisualViewport = window.visualViewport

function defineReadonlyNumber(target: object, property: string, value: number) {
  Object.defineProperty(target, property, { configurable: true, value })
}

describe('PWA viewport diagnostics', () => {
  let visualViewport: VisualViewportStub

  beforeEach(() => {
    document.body.innerHTML = `
      <div class="app-shell">
        <main class="app-main" data-scroll-container="main-content"></main>
        <nav class="bottom-nav"></nav>
      </div>
    `
    visualViewport = new VisualViewportStub()
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: visualViewport,
    })
    defineReadonlyNumber(window, 'innerWidth', 390)
    defineReadonlyNumber(window, 'innerHeight', 844)
    defineReadonlyNumber(document.documentElement, 'clientWidth', 390)
    defineReadonlyNumber(document.documentElement, 'clientHeight', 844)
    defineReadonlyNumber(window.screen, 'width', 390)
    defineReadonlyNumber(window.screen, 'height', 844)

    const nav = document.querySelector<HTMLElement>('.bottom-nav')!
    Object.assign(nav.style, {
      position: 'relative',
      bottom: 'auto',
      transform: 'none',
      height: '64px',
    })
    vi.spyOn(nav, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 780,
      top: 780,
      right: 390,
      bottom: 844,
      left: 0,
      width: 390,
      height: 64,
      toJSON: () => ({}),
    })
    const scroller = document.querySelector<HTMLElement>('.app-main')!
    scroller.scrollTop = 128
  })

  afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: originalVisualViewport,
    })
  })

  it('captures all required viewport, nav, and active-scroller measurements (PWA AC-4)', () => {
    const diagnostic = collectPwaViewportDiagnostic('initial-load')

    expect(diagnostic).toMatchObject({
      reason: 'initial-load',
      window: { innerWidth: 390, innerHeight: 844 },
      documentElement: { clientWidth: 390, clientHeight: 844 },
      visualViewport: {
        width: 390,
        height: 700,
        offsetTop: 11,
        pageTop: 23,
        scale: 1,
      },
      screen: { width: 390, height: 844 },
      bottomNavigation: {
        selector: '.bottom-nav',
        rect: { top: 780, bottom: 844, width: 390, height: 64 },
        computed: {
          position: 'relative',
          bottom: 'auto',
          transform: 'none',
          height: '64px',
        },
      },
      scrollContainer: {
        selector: '.app-main[data-scroll-container="main-content"]',
        scrollTop: 128,
      },
    })
    expect(Number.isNaN(Date.parse(diagnostic.timestamp))).toBe(false)
  })

  it('records the required lifecycle without scheduling layout work (PWA AC-4)', () => {
    const records: PwaViewportDiagnostic[] = []
    const animationFrame = vi.spyOn(window, 'requestAnimationFrame')
    const cleanup = installPwaViewportDiagnostics({ enabled: true, log: (event) => records.push(event) })

    window.dispatchEvent(new PageTransitionEvent('pageshow'))
    document.dispatchEvent(new Event('visibilitychange'))
    window.dispatchEvent(new Event('orientationchange'))
    window.screen.orientation?.dispatchEvent(new Event('change'))
    window.dispatchEvent(new Event('resize'))
    visualViewport.dispatchEvent(new Event('resize'))

    const input = document.createElement('input')
    document.body.append(input)
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))

    expect(records.map(({ reason }) => reason)).toEqual([
      'initial-load',
      'pageshow',
      'visibilitychange',
      'orientationchange',
      ...(window.screen.orientation ? ['screen-orientation-change' as const] : []),
      'window-resize',
      'visual-viewport-resize',
      'keyboard-focus',
      'keyboard-blur',
    ])
    expect(animationFrame).not.toHaveBeenCalled()

    cleanup()
    window.dispatchEvent(new Event('resize'))
    visualViewport.dispatchEvent(new Event('resize'))
    expect(records.at(-1)?.reason).toBe('keyboard-blur')
  })

  it('is inert when development diagnostics are disabled (PWA AC-4)', () => {
    const log = vi.fn()
    const cleanup = installPwaViewportDiagnostics({ enabled: false, log })

    window.dispatchEvent(new Event('resize'))
    visualViewport.dispatchEvent(new Event('resize'))

    expect(log).not.toHaveBeenCalled()
    expect(cleanup()).toBeUndefined()
  })
})
