// ── useTheme.js ───────────────────────────────────────────────────────────────
// Singleton light/dark theme controller.
//
// Three modes, cycled by the toolbar button and persisted in localStorage:
//   'auto'  → follow the browser / VSCode embedded-browser colour scheme
//             (prefers-color-scheme), live-updating when it changes
//   'light' → force light
//   'dark'  → force dark
//
// The resolved concrete theme ('light' | 'dark') is written to
// <html data-theme="…">, which drives the CSS custom properties in App.vue.
import { ref, computed, watchEffect } from 'vue'

const STORAGE_KEY = 'vault-theme-mode'
export const THEME_MODES = ['auto', 'light', 'dark']

function readStoredMode() {
  try {
    const v = localStorage.getItem(STORAGE_KEY)
    return THEME_MODES.includes(v) ? v : 'auto'
  } catch {
    return 'auto'
  }
}

const mode = ref(readStoredMode())

// Track the browser/OS/VSCode colour scheme reactively.
const mql = (typeof window !== 'undefined' && window.matchMedia)
  ? window.matchMedia('(prefers-color-scheme: dark)')
  : null
const systemDark = ref(mql ? mql.matches : true)
if (mql) {
  const onChange = e => { systemDark.value = e.matches }
  // Safari <14 only supports the deprecated addListener signature.
  if (mql.addEventListener) mql.addEventListener('change', onChange)
  else if (mql.addListener) mql.addListener(onChange)
}

const resolvedTheme = computed(() =>
  mode.value === 'auto' ? (systemDark.value ? 'dark' : 'light') : mode.value
)

// Reflect the resolved theme onto <html> and persist the chosen mode.
watchEffect(() => {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = resolvedTheme.value
  }
})
watchEffect(() => {
  try { localStorage.setItem(STORAGE_KEY, mode.value) } catch { /* ignore */ }
})

function cycleTheme() {
  const i = THEME_MODES.indexOf(mode.value)
  mode.value = THEME_MODES[(i + 1) % THEME_MODES.length]
}

export function useTheme() {
  return { mode, resolvedTheme, cycleTheme }
}
