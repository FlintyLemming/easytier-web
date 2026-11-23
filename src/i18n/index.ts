import { createI18n } from 'vue-i18n'
import zhCN from './zh-CN'
import en from './en'

export type Locale = 'zh-CN' | 'en'
const KEY = 'et.locale'

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'zh-CN' || saved === 'en') return saved
  } catch { /* storage unavailable */ }
  return navigator.language.startsWith('zh') ? 'zh-CN' : 'en'
}

export const i18n = createI18n({
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: 'en',
  messages: { 'zh-CN': zhCN, en },
})

export function setLocale(l: Locale): void {
  i18n.global.locale.value = l
  try { localStorage.setItem(KEY, l) } catch { /* ignore */ }
  document.documentElement.lang = l
}

document.documentElement.lang = i18n.global.locale.value

/** For code outside components (router guard, hosts). */
export const t = i18n.global.t
