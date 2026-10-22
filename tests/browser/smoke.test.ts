import { assert, describe, it } from "@effect/vitest"

describe("browser", () => {
  it("has a real DOM with layout", () => {
    const el = document.createElement("div")
    el.style.width = "100px"
    el.textContent = "hello"
    document.body.appendChild(el)
    assert.isTrue(el.getBoundingClientRect().width === 100)
    assert.isTrue(typeof getSelection === "function")
  })
})
