// Wires `/` to focus a search input. Pages opt in by calling
//   useSearchHotkey(searchInputRef)
// where `searchInputRef` is a template ref bound to the input element.
// The hotkey is ignored when the user is already typing in any input,
// textarea, contenteditable, or select — so admins typing `/` mid-search
// get a literal slash, not a focus jump.

export function useSearchHotkey(targetRef) {
  if (!import.meta.client) return;

  const onKeydown = (e) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
    const active = document.activeElement;
    if (!active) {
      focus(e);
      return;
    }
    const tag = active.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (active.isContentEditable) return;
    focus(e);
  };

  const focus = (e) => {
    const el = unref(targetRef);
    if (!el || typeof el.focus !== 'function') return;
    e.preventDefault();
    el.focus();
    if (typeof el.select === 'function') el.select();
  };

  onMounted(() => window.addEventListener('keydown', onKeydown));
  onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
}
