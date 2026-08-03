const NAV_SELECTOR = '.bottom-nav'
const SCROLL_CONTAINER_SELECTOR = '.app-main[data-scroll-container="main-content"]'

export type PwaViewportDiagnosticReason =
  | 'initial-load'
  | 'pageshow'
  | 'visibilitychange'
  | 'orientationchange'
  | 'screen-orientation-change'
  | 'window-resize'
  | 'visual-viewport-resize'
  | 'keyboard-focus'
  | 'keyboard-blur'

interface RectMeasurement {
  x: number
  y: number
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export interface PwaViewportDiagnostic {
  reason: PwaViewportDiagnosticReason
  timestamp: string
  visibilityState: DocumentVisibilityState
  window: {
    innerWidth: number
    innerHeight: number
  }
  documentElement: {
    clientWidth: number
    clientHeight: number
  }
  visualViewport: {
    width: number
    height: number
    offsetTop: number
    pageTop: number
    scale: number
  } | null
  screen: {
    width: number
    height: number
  }
  bottomNavigation: {
    selector: typeof NAV_SELECTOR
    rect: RectMeasurement
    computed: {
      position: string
      bottom: string
      transform: string
      height: string
    }
  } | null
  scrollContainer: {
    selector: typeof SCROLL_CONTAINER_SELECTOR
    scrollTop: number
  } | null
}

interface PwaViewportDiagnosticsOptions {
  enabled?: boolean
  log?: (diagnostic: PwaViewportDiagnostic) => void
}

function measureRect(element: Element): RectMeasurement {
  const rect = element.getBoundingClientRect()
  return {
    x: rect.x,
    y: rect.y,
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

export function collectPwaViewportDiagnostic(
  reason: PwaViewportDiagnosticReason,
): PwaViewportDiagnostic {
  const nav = document.querySelector<HTMLElement>(NAV_SELECTOR)
  const scrollContainer = document.querySelector<HTMLElement>(SCROLL_CONTAINER_SELECTOR)
  const navStyle = nav ? window.getComputedStyle(nav) : null
  const viewport = window.visualViewport

  return {
    reason,
    timestamp: new Date().toISOString(),
    visibilityState: document.visibilityState,
    window: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    },
    documentElement: {
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
    },
    visualViewport: viewport
      ? {
          width: viewport.width,
          height: viewport.height,
          offsetTop: viewport.offsetTop,
          pageTop: viewport.pageTop,
          scale: viewport.scale,
        }
      : null,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
    },
    bottomNavigation: nav && navStyle
      ? {
          selector: NAV_SELECTOR,
          rect: measureRect(nav),
          computed: {
            position: navStyle.position,
            bottom: navStyle.bottom,
            transform: navStyle.transform,
            height: navStyle.height,
          },
        }
      : null,
    scrollContainer: scrollContainer
      ? {
          selector: SCROLL_CONTAINER_SELECTOR,
          scrollTop: scrollContainer.scrollTop,
        }
      : null,
  }
}

function isKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

/**
 * Development-only observation for iOS standalone-PWA viewport corruption.
 * This deliberately performs measurements and logging only: it never writes
 * layout state, schedules resize work, or attempts a recovery reload.
 */
export function installPwaViewportDiagnostics(
  options: PwaViewportDiagnosticsOptions = {},
): () => void {
  const enabled = options.enabled ?? import.meta.env.DEV
  if (!enabled) return () => undefined

  const log = options.log
    ?? ((diagnostic: PwaViewportDiagnostic) => console.debug('[PWA viewport]', diagnostic))
  const record = (reason: PwaViewportDiagnosticReason) => {
    log(collectPwaViewportDiagnostic(reason))
  }
  const onPageShow = () => record('pageshow')
  const onVisibilityChange = () => record('visibilitychange')
  const onOrientationChange = () => record('orientationchange')
  const onScreenOrientationChange = () => record('screen-orientation-change')
  const onWindowResize = () => record('window-resize')
  const onVisualViewportResize = () => record('visual-viewport-resize')
  const onFocusIn = (event: FocusEvent) => {
    if (isKeyboardTarget(event.target)) record('keyboard-focus')
  }
  const onFocusOut = (event: FocusEvent) => {
    if (isKeyboardTarget(event.target)) record('keyboard-blur')
  }

  record('initial-load')
  window.addEventListener('pageshow', onPageShow)
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('orientationchange', onOrientationChange)
  window.screen.orientation?.addEventListener('change', onScreenOrientationChange)
  window.addEventListener('resize', onWindowResize)
  window.visualViewport?.addEventListener('resize', onVisualViewportResize)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)

  return () => {
    window.removeEventListener('pageshow', onPageShow)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('orientationchange', onOrientationChange)
    window.screen.orientation?.removeEventListener('change', onScreenOrientationChange)
    window.removeEventListener('resize', onWindowResize)
    window.visualViewport?.removeEventListener('resize', onVisualViewportResize)
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
  }
}
