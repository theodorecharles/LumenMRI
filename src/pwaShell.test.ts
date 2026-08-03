import { describe, expect, it } from 'vitest'
import html from '../index.html?raw'
import styles from './styles.css?raw'

describe('PWA safe-area shell contract', () => {
  it('opts into safe-area insets without disabling viewport zoom (PWA AC-3)', () => {
    expect(html).toContain(
      '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
    )
    expect(html).not.toMatch(/user-scalable|maximum-scale|minimum-scale/)
  })

  it('applies the bottom safe area exactly once as normal-flow nav padding (PWA AC-3)', () => {
    expect(styles.match(/env\(safe-area-inset-bottom/g)).toHaveLength(1)
    expect(styles).toMatch(
      /\.bottom-nav \{[\s\S]*?padding: var\(--bottom-nav-block-padding\) 12px\s+calc\(var\(--bottom-nav-block-padding\) \+ env\(safe-area-inset-bottom, 0px\)\);/,
    )
    expect(styles).toMatch(
      /@media \(max-width: 690px\)[\s\S]*?\.bottom-nav \{\s+--bottom-nav-block-padding: 4px;[\s\S]*?padding-inline: 8px;/,
    )
  })

  it('reserves the nav row and keeps shell sizing independent of viewport scripts (PWA AC-3)', () => {
    expect(styles).toMatch(
      /\.app-shell \{[\s\S]*?grid-template-rows: 64px minmax\(0, 1fr\) auto;[\s\S]*?height: 100%;/,
    )
    expect(styles).toMatch(
      /@media \(max-width: 690px\)[\s\S]*?\.app-shell \{\s+grid-template-rows: 58px minmax\(0, 1fr\) auto;/,
    )
  })
})
