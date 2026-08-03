# Mobile PWA shell validation

This document separates Lumen's application-owned shell guarantees from viewport state owned by iOS WebKit. Chromium emulation is a regression check, not evidence that an intermittent installed-PWA WebKit defect is fixed.

## Current application boundary

The shell hierarchy is `.bottom-nav` → `.app-shell` → `#root` → `body` → `html`. The nav is a direct child of `.app-shell` and the next sibling of `.app-main[data-scroll-container="main-content"]`; it is not a descendant of the content scroller or a route-transition wrapper. There is no route animation library or animated page wrapper. Library and viewer are the two main application states, with viewer state represented by `#series/<id>` (and `#local` for locally opened data).

`index.html` declares `width=device-width, initial-scale=1, viewport-fit=cover` and does not disable zoom. This repository does not currently contain a web-app manifest or service worker, so there is no manifest `display` value to report. iOS Add to Home Screen behavior must therefore be recorded explicitly during device validation; browser emulation cannot establish installed standalone behavior.

The application contract is:

- `html`, `body`, `#root`, and `.app-shell` remain the visible-screen height and do not scroll.
- `.app-main` is the only shell-owned route scroller.
- `.bottom-nav` is a normal-flow grid row and its background and single bottom-padding declaration cover the bottom safe area.
- Focus, resize, orientation, visibility, and page-show events only produce development diagnostics. They do not write shell dimensions, toggle the viewport meta tag, apply offsets, or reload the page.

## Automated regression

Run:

```bash
npx playwright test e2e/pwa-mobile-shell.spec.ts
```

The test uses a 390 × 844 mobile viewport and verifies the library and bundled viewer routes, the library/viewer transition, a long library scroller, repeated upward and downward scrolling, shortcut-dialog open/close, synthetic `pageshow` and `visibilitychange`, a Chromium freeze/resume lifecycle, text-input focus/blur, and portrait/landscape/portrait sizing. At every checkpoint it verifies that the document remains at scroll position zero, `.app-main` owns the scroll offset, the nav remains a direct normal-flow shell row, and the nav rectangle remains on the shell's bottom edge.

Chromium reports a zero bottom safe-area inset in this setup. The exact-once safe-area declaration is covered by `src/pwaShell.test.ts`; nonzero rendering remains a physical-device check.

## Required physical-device matrix

Record the iPhone model, iOS version, installation source URL, whether the app launched without Safari chrome, initial orientation, and the development `[PWA viewport]` console records for each run. Use at least one notched or Dynamic Island iPhone with a nonzero bottom inset and one iPhone/iPad configuration without a bottom inset. Repeat on the oldest and newest iOS releases supported by the project.

For each device/configuration:

1. Remove the existing Home Screen installation, load the deployed URL in Safari, add it to the Home Screen, and cold-launch it. Confirm the library route, full-width nav background through the unsafe bottom region, and one intentional base gap above the home indicator.
2. Scroll the complete library to the bottom and back to the top at least five times, including direction reversals. Confirm the Safari document does not scroll, content remains reachable, and the nav never changes vertical position or travels with the cards.
3. Open a bundled series, switch through 3D, 2D, Split, and Compare layouts, return to the library with both in-app navigation and browser history, and repeat. Confirm route/layout swaps do not move or cover the nav.
4. Open and close the Shortcuts dialog from both routes, including while the library is deeply scrolled. Confirm the dialog scrolls internally when necessary and nav geometry is restored unchanged after close.
5. Background the app for 30 seconds and resume it. Repeat after locking and unlocking the device, then after leaving the app suspended long enough for iOS to evict or freeze its process. Confirm the shell returns to the full visible height without a permanently raised nav.
6. Focus and dismiss every control that can invoke system input. While the keyboard is open in landscape, rotate to portrait, dismiss the keyboard, then repeat in the opposite order. Confirm the shell restores its pre-keyboard height after blur and rotation.
7. Repeat the long-scroll, modal, route, background/resume, suspension, and keyboard/rotation cases in portrait and landscape and on both safe-area device variants. Confirm content is not hidden behind the normal-flow nav and the bottom padding is neither missing nor doubled.

A physical run fails if the nav rectangle stops meeting the shell bottom, the document begins scrolling, `.app-main` loses its scroll offset ownership, content is obscured, or the restored shell height remains at a keyboard/previous-orientation dimension. Attach the development diagnostic records from immediately before and after the first failure.

## WebKit boundary

The normal-flow shell removes the application trigger described in [WebKit 301172](https://bugs.webkit.org/show_bug.cgi?id=301172), where fixed or sticky controls can drift while scrolling. It also avoids sizing the shell from `visualViewport`, whose height can remain stale after keyboard and rotation sequences in [WebKit 218983](https://bugs.webkit.org/show_bug.cgi?id=218983), and avoids `svh`/`-webkit-fill-available` interactions reported with `viewport-fit=cover` in [WebKit 254868](https://bugs.webkit.org/show_bug.cgi?id=254868).

WebKit can still corrupt its viewport after external navigation, backgrounding, lock/unlock, or process suspension. [WebKit 262207](https://bugs.webkit.org/show_bug.cgi?id=262207) tracks cases where the visible page suddenly renders at the wrong scale or size. A post-resume diagnostic in which `innerWidth` resembles a desktop virtual viewport, `visualViewport.height` remains at a keyboard or previous-orientation value, or the nav rectangle disagrees with the visible screen is engine-state corruption, not evidence that the nav re-entered the application scroller.

The app intentionally does not claim a CSS cure for corrupted engine state. It does not toggle viewport metadata, maintain a visual-viewport height variable, add a fixed offset, or reload on resume. The development diagnostics in `src/lib/pwaViewportDiagnostics.ts` are the evidence path for deciding whether a later, narrowly guarded recovery is justified; no recovery should be added without physical logs proving impossible resume-time measurements.
