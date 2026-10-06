// Browser APIs the media bar uses that Chromium 63/69 lacks. Bundled by
// build.mjs and loaded before slideshowpure.js.
import ResizeObserverPolyfill from 'resize-observer-polyfill';

if (typeof window.ResizeObserver === 'undefined') {
    window.ResizeObserver = ResizeObserverPolyfill;
}

function replaceChildren() {
    while (this.lastChild) {
        this.removeChild(this.lastChild);
    }
    this.append.apply(this, arguments);
}

[Element, Document, DocumentFragment].forEach(function (owner) {
    if (!owner.prototype.replaceChildren) {
        owner.prototype.replaceChildren = replaceChildren;
    }
});
