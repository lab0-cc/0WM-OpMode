// This module implements a floorplan viewer with 3-point georeferencing

import { Point2, Vector2 } from '/js/linalg.mjs';
import { Statusable, Stylable } from '/js/mixins.mjs';
import { createElement as E } from '/js/util.mjs';


class FloorplanContainer extends Statusable(Stylable(HTMLElement)) {
    #anchorDrag;
    #anchorDrop;
    #anchorMove;
    #anchors;
    #currentlyDragging;
    #img;
    #offsetX;
    #offsetY;
    #scale;

    constructor() {
        super();

        document.floorplanContainer = this;
        this.#img = this.appendToShadow(E('img'));

        this.#anchorDrag = this.#_anchorDrag.bind(this);
        this.#anchorDrop = this.#_anchorDrop.bind(this);
        this.#anchorMove = this.#_anchorMove.bind(this);

        this.#anchors = [];
        for (let i = 0; i < 3; i++) {
            const anchor = this.appendToShadow(E('div', 'anchor'));
            anchor.addEventListener('mousedown', this.#anchorDrag);
            this.#anchors.push(anchor);
        }

        this.addStylesheet('components/floorplan-container.css');
        this.#img.addEventListener('load', this.#imageLoad.bind(this));
        new ResizeObserver(() => this.#resize()).observe(this);
    }

    // Get the floorplan dimensions
    getDimensions() {
        return new Vector2(this.#img.naturalWidth, this.#img.naturalHeight);
    }

    // Update the floorplan scale after a resize or a load event
    #resize() {
        this.#scale = this.#img.naturalWidth / this.#img.getBoundingClientRect().width;
        this.style.setProperty('--scale', this.#scale);
    }

    // Handle image load events
    #imageLoad() {
        // This part is incredibly racy, as the image can get loaded before resizing to its
        // container’s dimensions. Therefore, we only perform scale-free operations here.
        this.#resize();
        if (parseInt(this.getAttribute('status')) > 0) {
            const bb = this.#img.getBoundingClientRect();
            const dim = Math.min(bb.width, bb.height);
            const small = `${.2 * dim * this.#scale}px`;
            const big = `${.7 * dim * this.#scale}px`;
            this.#anchors[0].style.setProperty('--left', small);
            this.#anchors[0].style.setProperty('--top', small);
            this.#anchors[1].style.setProperty('--left', big);
            this.#anchors[1].style.setProperty('--top', small);
            this.#anchors[2].style.setProperty('--left', small);
            this.#anchors[2].style.setProperty('--top', big);
        }
    }

    // Handle mousedown events on anchors
    #_anchorDrag(e) {
        e.preventDefault();
        this.#currentlyDragging = e.target;
        this.#offsetX = e.offsetX - 12;
        this.#offsetY = e.offsetY - 12;
        document.addEventListener('mousemove', this.#anchorMove);
        document.addEventListener('mouseup', this.#anchorDrop);
    }

    // Handle mousemove events on anchors
    #_anchorMove(e) {
        const rect = this.#img.getBoundingClientRect();
        const x = Math.min(rect.width, Math.max(0, e.clientX - rect.left - this.#offsetX));
        const y = Math.min(rect.height, Math.max(0, e.clientY - rect.top - this.#offsetY));

        this.#currentlyDragging.style.setProperty('--left', `${x * this.#scale}px`);
        this.#currentlyDragging.style.setProperty('--top', `${y * this.#scale}px`);

        document.worldMap.updateOverlay(this.getAnchors(), this.getDimensions(),
                                        this.getAttribute('src'));
    }

    // Handle mouseup events on anchors
    #_anchorDrop(e) {
        this.#currentlyDragging = null;
        document.removeEventListener('mousemove', this.#anchorMove);
        document.removeEventListener('mouseup', this.#anchorDrop);
    }

    // Get the positioned anchors
    getAnchors() {
        return this.#anchors.map(e => new Point2(parseInt(e.style.getPropertyValue('--left')),
                                                 parseInt(e.style.getPropertyValue('--top'))));
    }

    static get observedAttributes() {
        return super.observedAttributes.concat(['src']);
    }

    attributeChangedCallback(name, old, current) {
        super.attributeChangedCallback(name, old, current);
        switch (name) {
            case 'src':
                this.#img.src = current;
                break;
        }
    }

    // Return serialized data
    toJSON() {
        return this.getAnchors().map(e => e.toJSON());
    }

    // Ingest serialized data
    ofJSON(anchors) {
        this.#anchors.forEach((e, i) => {
            const anchor = anchors[i];
            e.style.setProperty('--left', `${anchor.x}px`);
            e.style.setProperty('--top', `${anchor.y}px`);
        })
    }
}


try {
    customElements.define('floorplan-container', FloorplanContainer);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}
