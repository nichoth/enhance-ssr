import { test } from '@substrate-system/tapzero'
import isCustomElement from '../src/is-custom-element.mjs'

test('isCustomElement', t => {
    t.ok(isCustomElement, 'exists')
})

test('should identify valid custom element tag names', t => {
    t.ok(isCustomElement('tag-name'))
    t.ok(isCustomElement('tag-😬'))
})

test('should identify invalid custom element tag names', t => {
    t.ok(!isCustomElement('Tag-Name'), 'catches uppercase')
    t.ok(!isCustomElement('-tag-name'), 'catches starting dash')
    t.ok(!isCustomElement('1tag-name'), 'catches starting digit')
    t.ok(!isCustomElement('font-face'), 'catches reserved tag')
})
