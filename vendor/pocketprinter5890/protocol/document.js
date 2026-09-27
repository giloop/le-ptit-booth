/**
 * High-level print document.
 *
 * Describe what to print; `buildJob` turns it into printer bytes.
 */
import { Alignment } from './escpos.js';
/** A document is just an ordered list of elements. */
export class PrintDocument {
    elements;
    constructor(elements = []) {
        this.elements = elements;
    }
    add(element) {
        this.elements.push(element);
        return this;
    }
    /** Plain line of text. */
    text(value, options = {}) {
        return this.add({ type: 'text', value, ...options });
    }
    /** Large, bold, centred. */
    title(value) {
        return this.add({ type: 'text', value, size: 2, bold: true, alignment: Alignment.Center });
    }
    centered(value) {
        return this.add({ type: 'text', value, alignment: Alignment.Center });
    }
    separator(character = '-') {
        return this.add({ type: 'separator', character });
    }
    image(bitmap) {
        return this.add({ type: 'image', bitmap });
    }
    feed(lines) {
        return this.add({ type: 'feed', lines });
    }
    /** Escape hatch for a command the library does not cover. */
    raw(bytes) {
        return this.add({ type: 'raw', bytes });
    }
}
/** Paper handling mode. */
export var PaperMode;
(function (PaperMode) {
    /** Receipt roll: stops at the end of the content. */
    PaperMode["Continuous"] = "continuous";
    /** Fixed-length labels, with positioning between each. */
    PaperMode["Label"] = "label";
})(PaperMode || (PaperMode = {}));
