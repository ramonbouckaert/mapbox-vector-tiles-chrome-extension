import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatMessage, t } from '../src/i18n.ts'
import type { MessageKey } from '../src/i18n.ts'

type Placeholder = { content: string; example?: string }
type Message = { message: string; description?: string; placeholders?: Record<string, Placeholder> }
type Catalog = Record<string, Message>

const LOCALES_DIR = join(import.meta.dirname, '..', 'public', '_locales')
const DEFAULT_LOCALE = 'en'

const readCatalog = (locale: string): Catalog =>
  JSON.parse(readFileSync(join(LOCALES_DIR, locale, 'messages.json'), 'utf8'))

const locales = readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

// Chrome matches placeholder names case-insensitively.
const placeholdersUsedIn = (message: string): string[] =>
  [...message.matchAll(/\$([A-Za-z0-9_]+)\$/g)].map((match) => match[1]!.toLowerCase()).sort()

const english = readCatalog(DEFAULT_LOCALE)
const englishKeys = Object.keys(english).sort()

// chrome.i18n does not exist here, so these exercise the bundled English
// fallback - the path that renders when a catalog fails to resolve at runtime.
describe('message formatting', () => {
  it('renders a message that has no placeholders', () => {
    assert.equal(t('clearAll'), 'Clear All')
  })

  it('substitutes a single placeholder from a bare string', () => {
    assert.equal(
      t('loadingTileWithSize', '1.2 kB'),
      'Loading tile as JSON (original size 1.2 kB)...',
    )
  })

  it('substitutes a single placeholder from an array', () => {
    assert.equal(
      t('loadingTileWithSize', ['1.2 kB']),
      'Loading tile as JSON (original size 1.2 kB)...',
    )
  })

  it('substitutes several placeholders in argument order', () => {
    assert.equal(
      formatMessage('warnUnreadableTile', ['{z: 10, x: 512, y: 384}', '4096', '8192']),
      'Cannot read a vector tile from the network response for tile {z: 10, x: 512, y: 384} ' +
        '(decoded size 4096, expected 8192). The request was probably aborted while its body was being read.',
    )
  })

  it('never leaves a placeholder token in the output', () => {
    for (const key of Object.keys(english) as MessageKey[]) {
      const rendered = formatMessage(key, ['a', 'b', 'c'])
      assert.doesNotMatch(rendered, /\$[A-Za-z0-9_]+\$/, `${key} still contains a placeholder`)
    }
  })
})

describe('locale catalogs', () => {
  it('ships the default locale declared in the manifest', () => {
    assert.ok(locales.includes(DEFAULT_LOCALE))
  })

  it('ships more than just English', () => {
    assert.ok(locales.length > 1, `only found: ${locales.join(', ')}`)
  })

  for (const locale of locales) {
    describe(locale, () => {
      const catalog = readCatalog(locale)

      it('has exactly the English keys', () => {
        assert.deepEqual(Object.keys(catalog).sort(), englishKeys)
      })

      it('has a non-empty message for every key', () => {
        for (const [key, entry] of Object.entries(catalog)) {
          assert.ok(entry.message?.trim(), `${locale}/${key} has an empty message`)
        }
      })

      it('uses the same placeholders as English', () => {
        for (const key of englishKeys) {
          const expected = placeholdersUsedIn(english[key]!.message)
          const actual = placeholdersUsedIn(catalog[key]!.message)
          assert.deepEqual(actual, expected, `${locale}/${key} placeholders differ`)
        }
      })

      it('declares every placeholder it uses', () => {
        for (const [key, entry] of Object.entries(catalog)) {
          const declared = Object.keys(entry.placeholders ?? {})
            .map((name) => name.toLowerCase())
            .sort()
          assert.deepEqual(
            declared,
            placeholdersUsedIn(entry.message),
            `${locale}/${key} declares placeholders that do not match the message`,
          )
        }
      })

      it('maps each placeholder to a substitution argument', () => {
        for (const [key, entry] of Object.entries(catalog)) {
          for (const [name, placeholder] of Object.entries(entry.placeholders ?? {})) {
            assert.match(
              placeholder.content,
              /^\$[1-9]$/,
              `${locale}/${key} placeholder "${name}" must reference $1-$9`,
            )
          }
        }
      })
    })
  }
})
