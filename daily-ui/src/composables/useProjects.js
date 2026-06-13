// ── useProjects.js ────────────────────────────────────────────────────────────
import { ref, onMounted } from 'vue'

let _projects = null  // module-level cache — only one fetch per page load

export function useProjects() {
  if (!_projects) _projects = ref([])

  onMounted(async () => {
    if (_projects.value.length) return  // already loaded
    try {
      const res = await fetch('/api/projects')
      if (res.ok) _projects.value = await res.json()
    } catch { /* silently ignore — autocomplete just won't show */ }
  })

  return { projects: _projects }
}
