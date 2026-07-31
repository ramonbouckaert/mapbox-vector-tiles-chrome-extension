// The English catalog is bundled so it can serve as a fallback when chrome.i18n
// is unavailable or returns nothing. It is small, and it keeps the UI readable
// instead of showing raw message keys.
import enMessages from '../public/_locales/en/messages.json' with { type: 'json' }

type Placeholder = { content: string; example?: string }
type CatalogEntry = {
  message: string
  description?: string
  placeholders?: Record<string, Placeholder>
}

export type MessageKey = keyof typeof enMessages

const catalog = enMessages as Record<string, CatalogEntry>

const PLACEHOLDER_TOKEN = /\$([A-Za-z0-9_]+)\$/g

/**
 * Resolves `$NAME$` tokens against the substitution list the same way Chrome
 * does, so the English fallback renders identically to a translated message.
 * Placeholder names are matched case-insensitively, as Chrome matches them.
 */
export const formatMessage = (key: MessageKey, substitutions: readonly string[] = []): string => {
  const entry = catalog[key]
  if (!entry) return key
  return entry.message.replace(PLACEHOLDER_TOKEN, (token, name: string) => {
    const placeholder = entry.placeholders?.[name.toLowerCase()]
    if (!placeholder) return token
    const index = Number(placeholder.content.slice(1))
    return substitutions[index - 1] ?? ''
  })
}

/**
 * Looks up a translated message for the browser's UI language, falling back to
 * the bundled English text.
 */
export const t = (key: MessageKey, substitutions: string | readonly string[] = []): string => {
  const values = typeof substitutions === 'string' ? [substitutions] : [...substitutions]
  // Always pass an array: Chrome returns an empty string rather than the message
  // when the substitutions argument does not line up with the placeholders.
  const translated =
    typeof chrome !== 'undefined' && chrome.i18n ? chrome.i18n.getMessage(key, values) : ''
  return translated || formatMessage(key, values)
}

const ATTRIBUTE_KEYS: readonly [attribute: string, target: string][] = [
  ['data-i18n-title', 'title'],
  ['data-i18n-aria-label', 'aria-label'],
  ['data-i18n-placeholder', 'placeholder'],
]

/**
 * Replaces the text of every `[data-i18n]` element, and the corresponding
 * attribute of every `[data-i18n-*]` element. The markup keeps its English text
 * inline so the page still reads correctly if this never runs.
 */
export const localizeDocument = (root: ParentNode = document): void => {
  if (typeof chrome !== 'undefined' && chrome.i18n) {
    document.documentElement.lang = chrome.i18n.getUILanguage()
  }

  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    const key = element.dataset['i18n'] as MessageKey | undefined
    if (key) element.textContent = t(key)
  })

  for (const [attribute, target] of ATTRIBUTE_KEYS) {
    root.querySelectorAll<HTMLElement>(`[${attribute}]`).forEach((element) => {
      const key = element.getAttribute(attribute) as MessageKey | null
      if (key) element.setAttribute(target, t(key))
    })
  }
}
