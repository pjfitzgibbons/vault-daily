// ── useSplitter.js ────────────────────────────────────────────────────────────
import { onMounted } from 'vue'

export function useSplitter(mainRef) {
  function loadState() {
    const el = mainRef.value
    if (!el) return
    const c = localStorage.getItem('splitCols')
    const r = localStorage.getItem('splitRows')
    if (c) el.style.gridTemplateColumns = `${c} 5px 1fr`
    if (r) el.style.gridTemplateRows    = `${r} 5px 1fr`
  }

  function saveState() {
    const el = mainRef.value
    if (!el) return
    const cs = getComputedStyle(el)
    localStorage.setItem('splitCols', cs.gridTemplateColumns.split(' ')[0])
    localStorage.setItem('splitRows', cs.gridTemplateRows.split(' ')[0])
  }

  function makeDrag(splitterEl, axis) {
    splitterEl.addEventListener('mousedown', e => {
      e.preventDefault()
      const el     = mainRef.value
      const cs     = getComputedStyle(el)
      const tracks = axis === 'x'
        ? cs.gridTemplateColumns.split(' ').map(parseFloat)
        : cs.gridTemplateRows.split(' ').map(parseFloat)
      const start   = axis === 'x' ? e.clientX : e.clientY
      const startPx = tracks[0]
      const avail   = tracks[0] + tracks[2]

      splitterEl.classList.add('dragging')
      document.body.style.cursor     = axis === 'x' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'

      const onMove = e => {
        const delta = (axis === 'x' ? e.clientX : e.clientY) - start
        const newPx = Math.max(120, Math.min(avail - 120, startPx + delta))
        if (axis === 'x') el.style.gridTemplateColumns = `${newPx}px 5px 1fr`
        else              el.style.gridTemplateRows    = `${newPx}px 5px 1fr`
      }
      const onUp = () => {
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        splitterEl.classList.remove('dragging')
        document.body.style.cursor     = ''
        document.body.style.userSelect = ''
        saveState()
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    })
  }

  onMounted(() => {
    loadState()
    const el = mainRef.value
    if (!el) return
    const sv = el.querySelector('#split-v')
    const sh = el.querySelector('#split-h')
    if (sv) makeDrag(sv, 'x')
    if (sh) makeDrag(sh, 'y')
  })
}
