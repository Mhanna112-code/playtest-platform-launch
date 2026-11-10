/**
 * (§371) A small DOM for rendering client components in the node test environment (no jsdom here): enough for react-dom/client to mount, update and unmount a
 * tree, delegate its events from the root, and for the components' own effects (listeners, look-ups by id or data-*). Install it BEFORE importing react-dom or
 * a component (they read `window` when they load): `installMiniDom()`, then `await import(...)`.
 */
type Listener = { type: string; fn: (e: MiniEvent) => void; capture: boolean };
export type MiniEvent = { type: string; bubbles: boolean; cancelable: boolean; target: MiniNode | null; currentTarget: MiniNode | null; defaultPrevented: boolean; timeStamp: number; isTrusted: boolean; eventPhase: number; stopped: boolean; preventDefault: () => void; stopPropagation: () => void; stopImmediatePropagation: () => void; detail?: unknown; submitter?: unknown };

export class MiniNode {
  nodeType: number;
  nodeName: string;
  ownerDocument: MiniDocument | null;
  parentNode: MiniNode | null = null;
  childNodes: MiniNode[] = [];
  private listeners: Listener[] = [];
  constructor(type: number, name: string, doc: MiniDocument | null) {
    this.nodeType = type;
    this.nodeName = name;
    this.ownerDocument = doc;
  }
  get parentElement() { return this.parentNode && this.parentNode.nodeType === 1 ? (this.parentNode as MiniElement) : null; }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get nextSibling(): MiniNode | null { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null; }
  get previousSibling(): MiniNode | null { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) - 1] ?? null; }
  get isConnected(): boolean { if (this.nodeType === 9) return true; for (let n = this.parentNode; n; n = n.parentNode) if (n.nodeType === 9) return true; return false; }
  appendChild<T extends MiniNode>(c: T): T { return this.insertBefore(c, null); }
  insertBefore<T extends MiniNode>(c: T, ref: MiniNode | null): T {
    if (c.nodeType === 11) { for (const k of [...c.childNodes]) this.insertBefore(k, ref); return c; }
    c.parentNode?.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i < 0) this.childNodes.push(c);
    else this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild<T extends MiniNode>(c: T): T {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  remove() { this.parentNode?.removeChild(this); }
  contains(o: MiniNode | null): boolean { for (let n = o; n; n = n.parentNode) if (n === this) return true; return false; }
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(""); }
  set textContent(t: string) { for (const c of [...this.childNodes]) this.removeChild(c); if (t) this.appendChild(this.ownerDocument!.createTextNode(String(t))); }
  addEventListener(type: string, fn: (e: MiniEvent) => void, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === "boolean" ? opts : !!opts?.capture;
    if (!this.listeners.some((l) => l.type === type && l.fn === fn && l.capture === capture)) this.listeners.push({ type, fn, capture });
  }
  removeEventListener(type: string, fn: (e: MiniEvent) => void, opts?: boolean | { capture?: boolean }) {
    const capture = typeof opts === "boolean" ? opts : !!opts?.capture;
    this.listeners = this.listeners.filter((l) => !(l.type === type && l.fn === fn && l.capture === capture));
  }
  /** Capture from the top down to the target, then bubble back up (when the event bubbles). */
  dispatchEvent(e: MiniEvent) {
    e.target = this;
    const path: MiniNode[] = [this];
    for (let n = this.parentNode; n; n = n.parentNode) path.push(n);
    const run = (n: MiniNode, capture: boolean, phase: number) => {
      e.currentTarget = n;
      e.eventPhase = phase;
      for (const l of [...n.listeners]) if (l.type === e.type && (phase === 2 || l.capture === capture)) l.fn(e);
    };
    for (let i = path.length - 1; i > 0 && !e.stopped; i--) run(path[i], true, 1);
    if (!e.stopped) run(this, false, 2);
    if (e.bubbles) for (let i = 1; i < path.length && !e.stopped; i++) run(path[i], false, 3);
    e.currentTarget = null;
    return !e.defaultPrevented;
  }
}

export class MiniText extends MiniNode {
  nodeValue: string;
  constructor(text: string, doc: MiniDocument) { super(3, "#text", doc); this.nodeValue = text; }
  get data() { return this.nodeValue; }
  set data(v: string) { this.nodeValue = v; }
  get textContent() { return this.nodeValue; }
  set textContent(v: string) { this.nodeValue = v; }
}

type Selector = { tag?: string; id?: string; classes: string[]; attrs: { name: string; value?: string }[] };
function parseSelector(sel: string): Selector[][] {
  return sel.split(",").map((one) => one.trim().split(/\s+/).filter(Boolean).map((part) => {
    const s: Selector = { classes: [], attrs: [] };
    const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:="([^"]*)")?\]|(:[\w-]+(?:\([^)]*\))?)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(part))) {
      if (m[1]) s.tag = m[1].toLowerCase();
      else if (m[2]) s.id = m[2];
      else if (m[3]) s.classes.push(m[3]);
      else if (m[4]) s.attrs.push({ name: m[4], value: m[5] });
    }
    return s;
  }));
}
const matchOne = (el: MiniElement, s: Selector) => (!s.tag || el.localName === s.tag) && (!s.id || el.getAttribute("id") === s.id) && s.classes.every((c) => (el.getAttribute("class") ?? "").split(/\s+/).includes(c)) && s.attrs.every((a) => el.hasAttribute(a.name) && (a.value === undefined || el.getAttribute(a.name) === a.value));
function matches(el: MiniElement, sel: string) {
  return parseSelector(sel).some((chain) => {
    if (!matchOne(el, chain[chain.length - 1])) return false;
    let at: MiniElement | null = el.parentElement;
    for (let i = chain.length - 2; i >= 0; i--) {
      while (at && !matchOne(at, chain[i])) at = at.parentElement;
      if (!at) return false;
      at = at.parentElement;
    }
    return true;
  });
}

export class MiniElement extends MiniNode {
  namespaceURI: string;
  localName: string;
  private attrs = new Map<string, string>();
  style: Record<string, unknown> & { setProperty: (k: string, v: string) => void; removeProperty: (k: string) => void };
  value = "";
  defaultValue = "";
  checked = false;
  open = false;
  innerHTMLText = "";
  constructor(tag: string, doc: MiniDocument, ns = "http://www.w3.org/1999/xhtml") {
    super(1, tag.toUpperCase(), doc);
    this.localName = tag.toLowerCase();
    this.namespaceURI = ns;
    const style: Record<string, unknown> = {};
    this.style = Object.assign(style, { setProperty: (k: string, v: string) => { style[k] = v; }, removeProperty: (k: string) => { delete style[k]; } });
  }
  get tagName() { return this.nodeName; }
  get id() { return this.getAttribute("id") ?? ""; }
  set id(v: string) { this.setAttribute("id", v); }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(v: string) { this.setAttribute("class", v); }
  get children() { return this.childNodes.filter((c): c is MiniElement => c.nodeType === 1); }
  set innerHTML(v: string) { this.innerHTMLText = v; }
  get innerHTML() { return this.innerHTMLText; }
  get dataset() { const out: Record<string, string> = {}; for (const [k, v] of this.attrs) if (k.startsWith("data-")) out[k.slice(5).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = v; return out; }
  setAttribute(k: string, v: string) { this.attrs.set(k.toLowerCase(), String(v)); }
  setAttributeNS(_ns: string | null, k: string, v: string) { this.setAttribute(k, v); }
  getAttribute(k: string) { return this.attrs.get(k.toLowerCase()) ?? null; }
  hasAttribute(k: string) { return this.attrs.has(k.toLowerCase()); }
  removeAttribute(k: string) { this.attrs.delete(k.toLowerCase()); }
  removeAttributeNS(_ns: string | null, k: string) { this.removeAttribute(k); }
  get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
  matches(sel: string) { return matches(this, sel); }
  closest(sel: string): MiniElement | null { if (this.matches(sel)) return this; for (let n = this.parentElement; n; n = n.parentElement) if (n.matches(sel)) return n; return null; }
  querySelectorAll(sel: string): MiniElement[] {
    const out: MiniElement[] = [];
    const walk = (n: MiniNode) => { for (const c of n.childNodes) if (c.nodeType === 1) { if ((c as MiniElement).matches(sel)) out.push(c as MiniElement); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  getBoundingClientRect() { return { top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, x: 0, y: 0 }; }
  getClientRects() { return this.isConnected ? [this.getBoundingClientRect()] : []; }
  scrollIntoView() {}
  focus() { if (this.ownerDocument) this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument && this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  get scrollHeight() { return 0; }
  get clientHeight() { return 0; }
  get offsetHeight() { return 0; }
  get offsetParent() { return null; }
  get selectionStart() { return this.value.length; }
  get selectionEnd() { return this.value.length; }
  setSelectionRange() {}
}

export class MiniDocument extends MiniNode {
  documentElement: MiniElement;
  body: MiniElement;
  head: MiniElement;
  activeElement: MiniElement | null = null;
  defaultView: unknown = null;
  visibilityState = "visible";
  cookie = "";
  /** react-dom checks `"oninput" in document` when it loads: without it, it would watch for IE's propertychange instead of input events. */
  oninput = null;
  onchange = null;
  constructor() {
    super(9, "#document", null);
    this.ownerDocument = null;
    this.documentElement = new MiniElement("html", this);
    this.head = new MiniElement("head", this);
    this.body = new MiniElement("body", this);
    this.appendChild(this.documentElement);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag: string) { return new MiniElement(tag, this); }
  createElementNS(ns: string, tag: string) { return new MiniElement(tag, this, ns); }
  createTextNode(t: string) { return new MiniText(t, this); }
  createComment(t: string) { const c = new MiniText(t, this); c.nodeType = 8; c.nodeName = "#comment"; return c; }
  createDocumentFragment() { return new MiniNode(11, "#document-fragment", this); }
  getElementById(id: string) { return this.documentElement.querySelector(`#${id}`); }
  querySelectorAll(sel: string) { return this.documentElement.matches(sel) ? [this.documentElement, ...this.documentElement.querySelectorAll(sel)] : this.documentElement.querySelectorAll(sel); }
  querySelector(sel: string) { return this.querySelectorAll(sel)[0] ?? null; }
  hasFocus() { return true; }
  getSelection() { return null; }
}

/** An event to dispatch on a mini node (bubbles, cancelable). */
export function miniEvent(type: string, extra: Partial<MiniEvent> = {}): MiniEvent {
  return {
    type, bubbles: true, cancelable: true, target: null, currentTarget: null, defaultPrevented: false, timeStamp: Date.now(), isTrusted: true, eventPhase: 0, stopped: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this.stopped = true; },
    stopImmediatePropagation() { this.stopped = true; },
    ...extra,
  };
}

function storage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, String(v)), removeItem: (k: string) => void m.delete(k), clear: () => m.clear(), key: (i: number) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}

/** Puts `window` and `document` (and the few browser globals the components touch) on globalThis. Returns the document and an undo. */
export function installMiniDom(path = "/app/sessions/s1") {
  const g = globalThis as Record<string, unknown>;
  const before = new Map(["window", "document", "location", "sessionStorage", "localStorage", "HTMLElement", "HTMLDetailsElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLIFrameElement", "Element", "Node", "CSS", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "matchMedia", "MutationObserver", "ResizeObserver", "IntersectionObserver", "IS_REACT_ACT_ENVIRONMENT"].map((k) => [k, Object.getOwnPropertyDescriptor(g, k)]));
  const doc = new MiniDocument();
  const win = new EventTarget() as EventTarget & Record<string, unknown>;
  class Iframe extends MiniElement {}
  /** Watchers that never fire (nothing here lays out or mutates behind React's back). */
  class Quiet { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
  Object.assign(win, {
    document: doc,
    location: { pathname: path, search: "", hash: "", href: `http://localhost${path}`, origin: "http://localhost", host: "localhost", replace: () => {}, assign: () => {}, reload: () => {} },
    history: { replaceState: () => {}, pushState: () => {}, state: null },
    sessionStorage: storage(),
    localStorage: storage(),
    navigator: globalThis.navigator,
    HTMLElement: MiniElement, HTMLDetailsElement: MiniElement, HTMLTextAreaElement: MiniElement, HTMLInputElement: MiniElement, HTMLIFrameElement: Iframe, Element: MiniElement, Node: MiniNode,
    CSS: { escape: (s: string) => s.replace(/["\\]/g, "\\$&") },
    innerHeight: 800, innerWidth: 1200, scrollX: 0, scrollY: 0, devicePixelRatio: 1,
    scrollTo: () => {}, scrollBy: () => {},
    requestAnimationFrame: (f: (t: number) => void) => setTimeout(() => f(Date.now()), 0),
    cancelAnimationFrame: (t: ReturnType<typeof setTimeout>) => clearTimeout(t),
    getComputedStyle: () => ({ getPropertyValue: () => "", lineHeight: "20px" }),
    matchMedia: () => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }),
    setTimeout, clearTimeout, setInterval, clearInterval, fetch: (...a: Parameters<typeof fetch>) => (globalThis.fetch as typeof fetch)(...a),
    Event, CustomEvent, MutationObserver: Quiet, ResizeObserver: Quiet, IntersectionObserver: Quiet,
  });
  doc.defaultView = win;
  for (const k of ["location", "sessionStorage", "localStorage", "HTMLElement", "HTMLDetailsElement", "HTMLTextAreaElement", "HTMLInputElement", "HTMLIFrameElement", "Element", "Node", "CSS", "requestAnimationFrame", "cancelAnimationFrame", "getComputedStyle", "matchMedia", "MutationObserver", "ResizeObserver", "IntersectionObserver"]) {
    Object.defineProperty(g, k, { value: win[k], configurable: true, writable: true });
  }
  Object.defineProperty(g, "window", { value: win, configurable: true, writable: true });
  Object.defineProperty(g, "document", { value: doc, configurable: true, writable: true });
  g.IS_REACT_ACT_ENVIRONMENT = true;
  const undo = () => {
    for (const [k, d] of before) {
      if (d) Object.defineProperty(g, k, d);
      else delete g[k];
    }
  };
  return { doc, win, undo };
}

/** The text of a node and everything in it, spaces between blocks squeezed. */
export const textOf = (n: MiniNode | null) => (n?.textContent ?? "").replace(/\s+/g, " ").trim();
