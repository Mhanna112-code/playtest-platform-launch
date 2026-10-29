// (Owner, Oct 28, batch 20 section 18) Is someone in the middle of something on this page? A field has focus, a field holds text typed since the page loaded,
// or a pop-up or inline box is open (a dialog, an Invite anyway / stop box, an open fold with a form in it). A page never hard-reloads while it is (the
// reload waits, and the page's poll keeps re-rendering it in place instead).

const typed = new Set<HTMLInputElement | HTMLTextAreaElement>();
let listening = false;

const isText = (el: Element | null): el is HTMLInputElement | HTMLTextAreaElement =>
  el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !["checkbox", "radio", "button", "submit", "hidden", "file", "range", "color"].includes(el.type));

function listen() {
  if (listening || typeof document === "undefined") return;
  listening = true;
  document.addEventListener("input", (e) => {
    const el = e.target as Element | null;
    if (isText(el)) typed.add(el);
  }, true);
}

/** Start noticing typing (call once from a mounted component). */
export function watchTyping() {
  listen();
}

/** True while reloading would lose something or interrupt someone. */
export function pageBusy(doc: Document | undefined = typeof document === "undefined" ? undefined : document) {
  if (!doc) return false;
  listen();
  const el = doc.activeElement;
  if (isText(el) || el instanceof HTMLSelectElement || (el instanceof HTMLElement && el.isContentEditable)) return true;
  for (const t of [...typed]) {
    if (!t.isConnected || !t.value.trim()) typed.delete(t);
  }
  if (typed.size) return true;
  return !!doc.querySelector("dialog[open], [role='dialog'], [aria-modal='true'], [data-invite-anyway], [data-changes-box], [data-stop-box], [data-confirm-open]");
}
