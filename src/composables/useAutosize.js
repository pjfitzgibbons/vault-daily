import { onMounted, watch, nextTick } from 'vue'

/**
 * Grow a textarea to fit its content.
 *
 * Drives `min-height` (never `height`), so it coexists with `resize: vertical`:
 *  - the drag handle sets inline `height` (user's preferred size),
 *  - autosize sets inline `min-height` (a floor that keeps all text visible).
 * The rendered height is therefore max(user-dragged height, content height).
 *
 * @param {import('vue').Ref<HTMLTextAreaElement|null>} elRef
 * @param {() => any} source  reactive getter; resize re-runs whenever it changes
 */
export function useAutosize(elRef, source) {
  // Every scrollable ancestor of `el`, plus the document scroller. Collapsing the
  // textarea to measure momentarily shrinks layout, so the browser reflows and
  // scrolls one of these to keep the caret visible — a jump on every keystroke.
  function scrollAncestors(el) {
    const list = []
    let node = el.parentElement
    while (node) {
      const oy = getComputedStyle(node).overflowY
      if (oy === 'auto' || oy === 'scroll') list.push(node)
      node = node.parentElement
    }
    const doc = document.scrollingElement || document.documentElement
    if (doc && !list.includes(doc)) list.push(doc)
    return list
  }

  function resize() {
    const el = elRef.value
    if (!el) return
    // Snapshot scroll positions and restore them synchronously, so the transient
    // collapse below never becomes observable to the user.
    const scrollers = scrollAncestors(el).map(n => [n, n.scrollTop])
    // Measure pure content height, independent of any dragged height / prior floor.
    const prevHeight = el.style.height
    el.style.height = 'auto'
    el.style.minHeight = '0px'
    const contentHeight = el.scrollHeight
    el.style.height = prevHeight            // restore the user's dragged height (if any)
    el.style.minHeight = `${contentHeight + 2}px`
    for (const [node, top] of scrollers) {
      if (node.scrollTop !== top) node.scrollTop = top
    }
  }

  onMounted(() => nextTick(resize))
  if (source) watch(source, () => nextTick(resize))

  return { resize }
}
