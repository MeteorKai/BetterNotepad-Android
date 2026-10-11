import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("only note drag handles disable touch scrolling and all arrangement controls have 44px targets", () => {
  const dom = new JSDOM(`<style>${css}</style>`);
  try {
    const rules = Array.from(dom.window.document.querySelector("style").sheet.cssRules);
    const handle = rules.find(rule => rule.selectorText === ".note-drag-handle");
    assert.equal(handle.style.getPropertyValue("touch-action"), "none");
    assert.equal(handle.style.width, "44px"); assert.equal(handle.style.height, "44px");
    const cards = rules.find(rule => rule.selectorText === ".notes-grid.is-sorting .note-card");
    assert.equal(cards.style.getPropertyValue("touch-action"), "pan-y");
    assert.deepEqual(rules.filter(rule => rule.selectorText !== ".image-viewport" && rule.style?.getPropertyValue("touch-action") === "none").map(rule => rule.selectorText), [".note-drag-handle"]);
    assert.doesNotMatch(css, /\.tag-sort|\.tag-reorder|\.tag-drag/);
    assert.equal(rules.find(rule => rule.selectorText === ".note-order-actions button").style.getPropertyValue("min-height"), "44px");
  } finally { dom.window.close(); }
});

test("unpinning removes the selected background even while the pointer stays over the button", () => {
  const dom = new JSDOM('<style></style><button class="icon-button pin-button is-pinned" aria-pressed="true" data-pointer-hover></button>');
  try {
    const style = dom.window.document.querySelector("style");
    style.textContent = css;
    const hover = Array.from(style.sheet.cssRules).find(rule => rule.conditionText === "(hover: hover)");
    assert.ok(hover);
    // Enable the real hover rules in this inert DOM test. An attribute stands
    // in for :hover with the same specificity; this is not emulator/UI testing.
    style.textContent += "\n" + Array.from(hover.cssRules).map(rule => rule.cssText.replaceAll(":hover", "[data-pointer-hover]")).join("\n");
    const pin = dom.window.document.querySelector("button");
    assert.notEqual(dom.window.getComputedStyle(pin).background, "rgba(0, 0, 0, 0)");
    pin.classList.remove("is-pinned");
    pin.setAttribute("aria-pressed", "false");
    assert.equal(dom.window.getComputedStyle(pin).background, "rgba(0, 0, 0, 0)", "未置顶的按钮不能被 hover 重新点亮");
    pin.classList.add("is-pinned");
    pin.setAttribute("aria-pressed", "true");
    assert.equal(dom.window.getComputedStyle(pin).background, "var(--accent)");
    assert.equal(dom.window.getComputedStyle(pin).color, "var(--accent-ink)");
  } finally { dom.window.close(); }
});
function luminance(hex) {
  let color = hex.slice(1);
  if (color.length === 3) color = [...color].map(char => char + char).join("");
  return color.match(/../g).slice(0, 3).map(value => parseInt(value, 16) / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
}

test("bulk selection keeps its accent ring on hover and clears the card and checkmark highlight when deselected", () => {
  const dom = new JSDOM('<style></style><button class="note-card color-1 is-selected" data-pointer-hover><span class="selection-mark checked"></span></button>');
  try {
    const style = dom.window.document.querySelector("style");
    style.textContent = css;
    const hover = Array.from(style.sheet.cssRules).find(rule => rule.conditionText === "(hover: hover)");
    style.textContent += "\n" + Array.from(hover.cssRules).map(rule => rule.cssText.replaceAll(":hover", "[data-pointer-hover]")).join("\n");
    const card = dom.window.document.querySelector("button"), mark = card.querySelector("span");
    assert.match(dom.window.getComputedStyle(card).boxShadow, /2px var\(--accent\)/);
    assert.equal(dom.window.getComputedStyle(mark).background, "var(--accent)");
    assert.equal(dom.window.getComputedStyle(mark).color, "var(--accent-ink)");
    card.classList.remove("is-selected"); mark.classList.remove("checked");
    assert.doesNotMatch(dom.window.getComputedStyle(card).boxShadow, /var\(--accent\)/);
    assert.equal(dom.window.getComputedStyle(mark).background, "var(--paper)");
  } finally { dom.window.close(); }
});
function contrast(first, second) {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

for (const theme of ["warm", "light", "dark"]) {
  test(`${theme} theme keeps small text legible on paper and note cards`, () => {
    const block = css.match(new RegExp(`\\[data-theme="${theme}"\\] \\{([^}]+)`))[1];
    const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+): (#[\da-f]{3,8});/g)].map(match => [match[1], match[2]]));
    const pairs = [["ink", "paper"], ["ink", "chip"], ["faint", "surface"], ["accent-ink", "accent"],
      ...[0, 1, 2, 3].flatMap(index => [["ink", `card-${index}`], ["sub", `card-${index}`]])];
    for (const [foreground, background] of pairs) {
      const ratio = contrast(tokens[foreground], tokens[background]);
      assert.ok(ratio >= 4.5, `${foreground} on ${background}: ${ratio.toFixed(2)} is below 4.5`);
    }
  });
}
