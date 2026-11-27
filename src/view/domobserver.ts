// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * Observing DOM mutations and selection changes.
 *
 * @internal
 */
import * as Arr from "effect/Array"
import * as Option from "effect/Option"
import { Selection } from "../State.ts"
import * as browser from "./browser.ts"
import {
  domIndex,
  type DOMNode,
  type DOMSelection,
  type DOMSelectionRange,
  isDOMNode,
  isElt,
  isEquivalentPosition,
  ancestors,
  isText,
  selectionCollapsed
} from "./dom.ts"
import { hasFocusAndSelection, selectionFromDOM, selectionToDOM } from "./selection.ts"
import type { EditorView } from "./view.ts"

type AnyView = EditorView<any, any, any>

const observeOptions = {
  childList: true,
  characterData: true,
  characterDataOldValue: true,
  attributes: true,
  attributeOldValue: true,
  subtree: true
}
// IE11 has very broken mutation observers, so we also listen to DOMCharacterDataModified
const useCharData = browser.ie && browser.ie_version <= 11

const noSelection: DOMSelectionRange = { anchorNode: null, anchorOffset: 0, focusNode: null, focusOffset: 0 }

class SelectionState {
  // A copy of the last DOM selection seen, as the browser reports it.
  range: DOMSelectionRange = noSelection

  set(sel: DOMSelectionRange) {
    const { anchorNode, anchorOffset, focusNode, focusOffset } = sel
    this.range = { anchorNode, anchorOffset, focusNode, focusOffset }
  }

  clear() {
    this.range = { ...this.range, anchorNode: null, focusNode: null }
  }

  eq(sel: DOMSelectionRange) {
    const range = this.range
    return (
      sel.anchorNode == range.anchorNode &&
      sel.anchorOffset == range.anchorOffset &&
      sel.focusNode == range.focusNode &&
      sel.focusOffset == range.focusOffset
    )
  }
}

/** @internal */
export class DOMObserver {
  queue: Array<MutationRecord> = []
  flushingSoon = -1
  observer: Option.Option<MutationObserver> = Option.none()
  currentSelection = new SelectionState()
  onCharData: Option.Option<(e: Event) => void> = Option.none()
  suppressingSelectionUpdates = false
  lastChangedTextNode: Option.Option<Text> = Option.none()

  constructor(
    readonly view: AnyView,
    readonly handleDOMChange: (from: number, to: number, typeOver: boolean, added: Array<DOMNode>) => void
  ) {
    this.observer = Option.map(
      Option.fromUndefinedOr(window.MutationObserver),
      (MutationObserver) =>
        new MutationObserver((mutations) => {
          mutations.forEach((m) => this.queue.push(m))
          if (
            browser.ie &&
            browser.ie_version <= 11 &&
            mutations.some(
              (m) =>
                (m.type == "childList" && m.removedNodes.length) ||
                (m.type == "characterData" && (m.oldValue ?? "").length > (m.target.nodeValue ?? "").length)
            )
          ) {
            // IE11 will sometimes (on backspacing out a single character
            // text node after a BR node) call the observer callback
            // before actually updating the DOM, which will cause
            // ProseMirror to miss the change
            this.flushSoon()
          } else if (
            browser.safari &&
            view.composing &&
            mutations.some((m) => m.type == "childList" && m.target.nodeName == "TR")
          ) {
            // Safari does weird stuff when finishing a composition in a
            // table cell, which tends to involve inserting inappropriate
            // nodes in the table row.
            view.input.badSafariComposition = true
            this.flushSoon()
          } else {
            this.flush()
          }
        })
    )
    if (useCharData) {
      this.onCharData = Option.some((e: Event) => {
        const event: Event & { readonly prevValue?: string } = e
        if (!e.target || !isDOMNode(e.target)) return
        // SAFETY: the observer reads only `type`, `target` and `oldValue` from a queued record.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        this.queue.push({
          target: e.target,
          type: "characterData",
          oldValue: event.prevValue
        } as MutationRecord)
        this.flushSoon()
      })
    }
  }

  flushSoon() {
    if (this.flushingSoon < 0) {
      this.flushingSoon = window.setTimeout(() => {
        this.flushingSoon = -1
        this.flush()
      }, 20)
    }
  }

  forceFlush() {
    if (this.flushingSoon > -1) {
      window.clearTimeout(this.flushingSoon)
      this.flushingSoon = -1
      this.flush()
    }
  }

  start() {
    if (Option.isSome(this.observer)) {
      this.observer.value.takeRecords()
      this.observer.value.observe(this.view.dom, observeOptions)
    }
    if (Option.isSome(this.onCharData)) {
      this.view.dom.addEventListener("DOMCharacterDataModified", this.onCharData.value)
    }
    this.connectSelection()
  }

  stop() {
    if (Option.isSome(this.observer)) {
      const take = this.observer.value.takeRecords()
      if (take.length) {
        take.forEach((m) => this.queue.push(m))
        window.setTimeout(() => this.flush(), 20)
      }
      this.observer.value.disconnect()
    }
    if (Option.isSome(this.onCharData)) {
      this.view.dom.removeEventListener("DOMCharacterDataModified", this.onCharData.value)
    }
    this.disconnectSelection()
  }

  connectSelection() {
    this.view.dom.ownerDocument.addEventListener("selectionchange", this.onSelectionChange)
  }

  disconnectSelection() {
    this.view.dom.ownerDocument.removeEventListener("selectionchange", this.onSelectionChange)
  }

  suppressSelectionUpdates() {
    this.suppressingSelectionUpdates = true
    setTimeout(() => (this.suppressingSelectionUpdates = false), 50)
  }

  readonly onSelectionChange = (): void => {
    if (!hasFocusAndSelection(this.view)) return
    if (this.suppressingSelectionUpdates) return selectionToDOM(this.view)
    // Deletions on IE11 fire their events in the wrong order, giving
    // us a selection change event before the DOM changes are
    // reported.
    if (browser.ie && browser.ie_version <= 11 && !this.view.state.selection.empty) {
      const sel = this.view.domSelectionRange()
      // Selection.isCollapsed isn't reliable on IE
      if (
        sel.focusNode &&
        sel.anchorNode &&
        isEquivalentPosition(sel.focusNode, sel.focusOffset, sel.anchorNode, sel.anchorOffset)
      ) {
        return this.flushSoon()
      }
    }
    this.flush()
  }

  setCurSelection() {
    this.currentSelection.set(this.view.domSelectionRange())
  }

  ignoreSelectionChange(sel: DOMSelectionRange) {
    if (!sel.focusNode) return true
    const aroundFocus: WeakSet<DOMNode> = new WeakSet(ancestors(sel.focusNode))
    const container = (sel.anchorNode ? ancestors(sel.anchorNode) : []).find((scan) => aroundFocus.has(scan))
    if (
      container &&
      Option.exists(this.view.docView.nearestDesc(container), (desc) =>
        desc.ignoreMutation({
          type: "selection",
          target: (container.nodeType == 3 && container.parentNode) || container
        })
      )
    ) {
      this.setCurSelection()
      return true
    }
    return false
  }

  pendingRecords() {
    if (Option.isSome(this.observer)) {
      this.observer.value.takeRecords().forEach((mut) => this.queue.push(mut))
    }
    return this.queue
  }

  flush() {
    const { view } = this
    if (!view.docView || this.flushingSoon > -1) return
    const now = view.state.config.clock()
    const mutations = this.pendingRecords()
    if (mutations.length) this.queue = []

    // Only read the DOM selection when the editor has focus: this is
    // costly for editors that aren't connected (prosemirror-view 1.42.6 /
    // 1.42.7).
    const selRange =
      !this.suppressingSelectionUpdates && hasFocusAndSelection(view) ? view.domSelectionRange() : undefined
    const newSel = !!selRange && !this.currentSelection.eq(selRange) && !this.ignoreSelectionChange(selRange)

    let from = -1,
      to = -1,
      typeOver = false
    const added: Array<DOMNode> = []
    if (view.editable) {
      mutations.forEach((mut) => {
        const result = this.registerMutation(mut, added)
        if (result) {
          from = from < 0 ? result.from : Math.min(result.from, from)
          to = to < 0 ? result.to : Math.max(result.to, to)
          if (result.typeOver) typeOver = true
        }
      })
    }

    if (
      added.some((n) => n.nodeName == "BR") &&
      (view.input.lastKeyCode === 8 ||
        view.input.lastKeyCode === 46 ||
        (browser.chrome &&
          (view.composing || view.input.compositionEndedAt > now - 50) &&
          mutations.some((m) => m.type == "childList" && m.removedNodes.length)))
    ) {
      // Browsers sometimes insert a bogus break node if you
      // backspace out the last bit of text before an inline-flex node
      added.filter(isBogusBreak).forEach((node) => node.parentNode?.removeChild(node))
    } else if (browser.gecko && added.length) {
      const brs = added.filter(isElt).filter((n) => n.nodeName == "BR")
      if (brs.length == 2) {
        const a = brs[0],
          b = brs[1]
        if (a.parentNode && a.parentNode.parentNode == b.parentNode) b.remove()
        else a.remove()
      } else {
        const { focusNode } = this.currentSelection.range
        const focusBlock = focusNode ? blockParent(view, focusNode) : Option.none()
        brs.forEach((br) => {
          const parent = br.parentNode
          if (parent && parent.nodeName == "LI" && !Option.exists(focusBlock, (block) => block == parent)) br.remove()
        })
      }
    }

    // If it looks like the browser has reset the selection to the
    // start of the document after focus, restore the selection from
    // the state
    if (
      from < 0 &&
      newSel &&
      view.input.lastFocus > now - 200 &&
      Math.max(view.input.lastTouch, view.input.lastClick.time) < now - 300 &&
      selectionCollapsed(selRange) &&
      Option.exists(selectionFromDOM(view), (readSel) => readSel.eq(Selection.near(view.state.doc.resolveUnsafe(0), 1)))
    ) {
      view.input.lastFocus = 0
      selectionToDOM(view)
      this.currentSelection.set(selRange)
      view.scrollToSelection()
    } else if (from > -1 || newSel) {
      if (from > -1) {
        view.docView.markDirty(from, to)
        checkCSS(view)
      }
      if (view.input.badSafariComposition) {
        view.input.badSafariComposition = false
        fixUpBadSafariComposition(view, added)
      }
      this.handleDOMChange(from, to, typeOver, added)
      if (view.docView && view.docView.dirty) view.updateState(view.state)
      else if (selRange && !this.currentSelection.eq(selRange)) selectionToDOM(view)
      if (selRange) this.currentSelection.set(selRange)
    }
  }

  registerMutation(mut: MutationRecord, added: Array<DOMNode>) {
    // Ignore mutations inside nodes that were already noted as inserted
    if (added.indexOf(mut.target) > -1) return null
    const found = this.view.docView.nearestDesc(mut.target)
    if (
      mut.type == "attributes" &&
      (Option.exists(found, (desc) => desc == this.view.docView) ||
        mut.attributeName == "contenteditable" ||
        // Firefox sometimes fires spurious events for null/empty styles
        (mut.attributeName == "style" && !mut.oldValue && isElt(mut.target) && !mut.target.getAttribute("style")))
    ) {
      return null
    }
    if (Option.isNone(found) || found.value.ignoreMutation(mut)) return null
    const desc = found.value

    if (mut.type == "childList") {
      mut.addedNodes.forEach((node) => {
        added.push(node)
        if (isText(node)) this.lastChangedTextNode = Option.some(node)
      })
      if (Option.exists(desc.contentDOM, (content) => content != desc.dom && !content.contains(mut.target))) {
        return { from: desc.posBefore, to: desc.posAfter }
      }
      let prev = mut.previousSibling,
        next = mut.nextSibling
      if (browser.ie && browser.ie_version <= 11 && mut.addedNodes.length) {
        // IE11 gives us incorrect next/prev siblings for some
        // insertions, so if there are added nodes, recompute those
        mut.addedNodes.forEach(({ nextSibling, previousSibling }) => {
          // A missing sibling isn't among the added nodes either.
          if (Array.prototype.indexOf.call(mut.addedNodes, previousSibling) < 0) prev = previousSibling
          if (Array.prototype.indexOf.call(mut.addedNodes, nextSibling) < 0) next = nextSibling
        })
      }
      const fromOffset = prev && prev.parentNode == mut.target ? domIndex(prev) + 1 : 0
      const from = desc.localPosFromDOM(mut.target, fromOffset, -1)
      const toOffset = next && next.parentNode == mut.target ? domIndex(next) : mut.target.childNodes.length
      const to = desc.localPosFromDOM(mut.target, toOffset, 1)
      return { from, to }
    } else if (mut.type == "attributes") {
      return { from: desc.posAtStart - desc.border, to: desc.posAtEnd + desc.border }
    } else {
      // "characterData"
      if (isText(mut.target)) this.lastChangedTextNode = Option.some(mut.target)
      return {
        from: desc.posAtStart,
        to: desc.posAtEnd,
        // An event was generated for a text change that didn't change
        // any text. Mark the dom change to fall back to assuming the
        // selection was typed over with an identical value if it can't
        // find another change.
        typeOver: mut.target.nodeValue == mut.oldValue
      }
    }
  }
}

const cssChecked: WeakMap<AnyView, null> = new WeakMap()
let cssCheckWarned: boolean = false

function checkCSS(view: AnyView) {
  if (cssChecked.has(view)) return
  cssChecked.set(view, null)
  if (["normal", "nowrap", "pre-line"].indexOf(getComputedStyle(view.dom).whiteSpace) !== -1) {
    view.requiresGeckoHackNode = browser.gecko
    if (cssCheckWarned) return
    // oxlint-disable-next-line no-console
    console["warn"](
      "ProseMirror expects the CSS white-space property to be set, preferably to 'pre-wrap'. It is recommended to load style/prosemirror.css from the prosemirror-view package."
    )
    cssCheckWarned = true
  }
}

function rangeToSelectionRange(view: AnyView, range: StaticRange) {
  let anchorNode = range.startContainer,
    anchorOffset = range.startOffset
  let focusNode = range.endContainer,
    focusOffset = range.endOffset

  const currentAnchor = view.domAtPos(view.state.selection.anchor)
  // Since such a range doesn't distinguish between anchor and head,
  // use a heuristic that flips it around if its end matches the
  // current anchor.
  if (isEquivalentPosition(currentAnchor.node, currentAnchor.offset, focusNode, focusOffset)) {
    ;[anchorNode, anchorOffset, focusNode, focusOffset] = [focusNode, focusOffset, anchorNode, anchorOffset]
  }
  return { anchorNode, anchorOffset, focusNode, focusOffset }
}

interface SafariSelection {
  readonly getComposedRanges: (...roots: ReadonlyArray<Document | ShadowRoot>) => ReadonlyArray<StaticRange>
}

const hasComposedRanges = (selection: DOMSelection): selection is DOMSelection & SafariSelection =>
  "getComposedRanges" in selection

// Used to work around a Safari Selection/shadow DOM bug
// Based on https://github.com/codemirror/dev/issues/414 fix
/** @internal */
export function safariShadowSelectionRange(view: AnyView, selection: DOMSelection): Option.Option<DOMSelectionRange> {
  // Safari's version takes the shadow roots as arguments.
  if (hasComposedRanges(selection)) {
    const ranges = selection.getComposedRanges(view.root)
    if (ranges.length) return Option.some(rangeToSelectionRange(view, ranges[0]))
  }

  let found: Option.Option<StaticRange> = Option.none()
  function read(event: InputEvent) {
    event.preventDefault()
    event.stopImmediatePropagation()
    found = Arr.head(event.getTargetRanges())
  }

  // Because Safari (at least in 2018-2022) doesn't provide regular
  // access to the selection inside a shadowRoot, we have to perform a
  // ridiculous hack to get at it—using `execCommand` to trigger a
  // `beforeInput` event so that we can read the target range from the
  // event.
  view.dom.addEventListener("beforeinput", read, true)
  document.execCommand("indent")
  view.dom.removeEventListener("beforeinput", read, true)

  return Option.map(found, (range) => rangeToSelectionRange(view, range))
}

function blockParent(view: AnyView, node: DOMNode): Option.Option<DOMNode> {
  const p = node.parentNode
  if (!p || p == view.dom) return Option.none()
  return Option.exists(view.docView.nearestDesc(p, true), (desc) => desc.node.isBlock)
    ? Option.some(p)
    : blockParent(view, p)
}

// Whether `node` or one of its first descendants is an uneditable element.
// A break the browser inserted in front of an uneditable node.
function isBogusBreak(node: DOMNode): boolean {
  return node.nodeName == "BR" && !!node.nextSibling && uneditableAhead(node.nextSibling)
}

function uneditableAhead(node: ChildNode): boolean {
  return isElt(node) && (node.contentEditable == "false" || (!!node.firstChild && uneditableAhead(node.firstChild)))
}

function nextCellFrom(node: ChildNode): Option.Option<ChildNode> {
  if (node.nodeName == "TD" || node.nodeName == "TH") return Option.some(node)
  return node.nextSibling ? nextCellFrom(node.nextSibling) : Option.none()
}

// The innermost editable first descendant of `parent` that may hold text.
function innermostFirst(parent: ChildNode): ChildNode {
  const first = parent.firstChild
  return first && mayHoldText(first) ? innermostFirst(first) : parent
}

function mayHoldText(node: ChildNode): boolean {
  return isElt(node) && node.contentEditable != "false" && !/^(BR|IMG)$/.test(node.nodeName)
}

// Kludge for a Safari bug where, on ending a composition in an
// otherwise empty table cell, it randomly moves the composed text
// into the table row around that cell, greatly confusing everything.
function fixUpBadSafariComposition(view: AnyView, addedNodes: ReadonlyArray<DOMNode>) {
  const { focusNode, focusOffset } = view.domSelectionRange()
  addedNodes
    .filter((node) => node.parentNode?.nodeName == "TR")
    .forEach((node) =>
      Option.match(Option.flatMap(Option.fromNullOr(node.nextSibling), nextCellFrom), {
        onNone: () => node.parentNode?.removeChild(node),
        onSome: (nextCell) => {
          const parent = innermostFirst(nextCell)
          parent.insertBefore(node, parent.firstChild)
          if (focusNode == node) Option.map(view.domSelection(), (sel) => sel.collapse(node, focusOffset))
        }
      })
    )
}
