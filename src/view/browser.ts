// Ported from prosemirror-view (MIT, Marijn Haverbeke and others)
/**
 * Browser detection.
 *
 * @internal
 */

const nav = typeof navigator != "undefined" ? navigator : null
const doc = typeof document != "undefined" ? document : null
const agent = (nav && nav.userAgent) || ""

const ie_edge = /Edge\/(\d+)/.exec(agent)
const ie_upto10 = /MSIE \d/.exec(agent)
const ie_11up = /Trident\/(?:[7-9]|\d{2,})\..*rv:(\d+)/.exec(agent)

/** @internal */
export const ie = !!(ie_upto10 || ie_11up || ie_edge)
/** @internal */
export const ie_version: number = ie_upto10
  ? (document as any).documentMode
  : ie_11up
    ? +ie_11up[1]!
    : ie_edge
      ? +ie_edge[1]!
      : 0
/** @internal */
export const gecko = !ie && /gecko\/(\d+)/i.test(agent)
/** @internal */
export const gecko_version = gecko && +(/Firefox\/(\d+)/.exec(agent) || [0, 0])[1]!

const _chrome = !ie && /Chrome\/(\d+)/.exec(agent)
/** @internal */
export const chrome = !!_chrome
/** @internal */
export const chrome_version = _chrome ? +_chrome[1]! : 0
/** @internal */
export const safari = !ie && !!nav && /Apple Computer/.test(nav.vendor)
// Is true for both iOS and iPadOS for convenience
/** @internal */
export const ios = safari && (/Mobile\/\w+/.test(agent) || (!!nav && nav.maxTouchPoints > 2))
/** @internal */
export const mac = ios || (nav ? /Mac/.test(nav.platform) : false)
/** @internal */
export const windows = nav ? /Win/.test(nav.platform) : false
/** @internal */
export const android = /Android \d/.test(agent)
/** @internal */
export const webkit = !!doc && "webkitFontSmoothing" in doc.documentElement.style
/** @internal */
export const webkit_version = webkit ? +(/\bAppleWebKit\/(\d+)/.exec(navigator.userAgent) || [0, 0])[1]! : 0
