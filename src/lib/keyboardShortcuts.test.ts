import { afterEach, describe, expect, it } from 'vitest'
import { isTextEntryTarget, targetActivatesOnKey } from './keyboardShortcuts'

function mount<T extends HTMLElement>(element: T): T {
  document.body.append(element)
  return element
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('isTextEntryTarget', () => {
  it('claims typing surfaces', () => {
    expect(isTextEntryTarget(mount(document.createElement('input')))).toBe(true)
    expect(isTextEntryTarget(mount(document.createElement('textarea')))).toBe(true)
    expect(isTextEntryTarget(mount(document.createElement('select')))).toBe(true)
    const editable = mount(document.createElement('div'))
    editable.setAttribute('contenteditable', 'true')
    expect(isTextEntryTarget(editable)).toBe(true)
  })

  it('leaves buttons, canvas and null targets to the viewer', () => {
    expect(isTextEntryTarget(mount(document.createElement('button')))).toBe(false)
    expect(isTextEntryTarget(mount(document.createElement('canvas')))).toBe(false)
    expect(isTextEntryTarget(null)).toBe(false)
    const notEditable = mount(document.createElement('div'))
    notEditable.setAttribute('contenteditable', 'false')
    expect(isTextEntryTarget(notEditable)).toBe(false)
  })
})

describe('targetActivatesOnKey', () => {
  it('blocks only Space and Enter on a focused button', () => {
    const button = mount(document.createElement('button'))
    expect(targetActivatesOnKey(button, ' ')).toBe(true)
    expect(targetActivatesOnKey(button, 'Spacebar')).toBe(true)
    expect(targetActivatesOnKey(button, 'Enter')).toBe(true)
  })

  it('lets every advertised viewer shortcut through a focused toolbar button', () => {
    // Regression: a blanket button bail killed layout, cine-step, slice-step,
    // Home/End and R/F/S/L until the user clicked empty canvas.
    const button = mount(document.createElement('button'))
    for (const key of [
      '1',
      '2',
      '3',
      '4',
      'r',
      'R',
      'f',
      's',
      'l',
      'ArrowUp',
      'ArrowDown',
      ',',
      '.',
      'Home',
      'End',
      'Escape',
      '?',
    ]) {
      expect(targetActivatesOnKey(button, key), `key ${key} should reach the viewer`).toBe(false)
    }
  })

  it('treats role="button" like a button and links as Enter-only', () => {
    const pseudoButton = mount(document.createElement('div'))
    pseudoButton.setAttribute('role', 'button')
    expect(targetActivatesOnKey(pseudoButton, ' ')).toBe(true)
    expect(targetActivatesOnKey(pseudoButton, 'Enter')).toBe(true)
    expect(targetActivatesOnKey(pseudoButton, '1')).toBe(false)

    const link = mount(document.createElement('a'))
    expect(targetActivatesOnKey(link, 'Enter')).toBe(true)
    expect(targetActivatesOnKey(link, ' ')).toBe(false)
  })

  it('ignores non-element targets and passive elements', () => {
    expect(targetActivatesOnKey(null, 'Enter')).toBe(false)
    expect(targetActivatesOnKey(window, ' ')).toBe(false)
    expect(targetActivatesOnKey(mount(document.createElement('canvas')), ' ')).toBe(false)
  })
})
