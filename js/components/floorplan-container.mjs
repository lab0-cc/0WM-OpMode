// This module implements a floorplan viewer with 3-point georeferencing

import { Point2 } from '/js/linalg.mjs';
import { Stylable } from '/js/mixins.mjs';
import { createElement } from '/js/util.mjs';


class FloorplanContainer extends Stylable(HTMLElement) {
    #anchorDrag;
    #anchorDrop;
    #anchorMove;
    #anchors;
    #currentlyDragging;
    #img;
    #offsetX;
    #offsetY;

    constructor() {
        super();

        document.floorplanContainer = this;
        this.#img = createElement('img');
        this.appendToShadow(this.#img);

        this.#anchorDrag = this.#_anchorDrag.bind(this);
        this.#anchorDrop = this.#_anchorDrop.bind(this);
        this.#anchorMove = this.#_anchorMove.bind(this);

        this.#anchors = [];
        for (let i = 0; i < 3; i++) {
            const anchor = createElement('div', 'anchor');
            anchor.addEventListener('mousedown', this.#anchorDrag);
            this.appendToShadow(anchor);
            this.#anchors.push(anchor);
        }

        this.addStylesheet('components/floorplan-container.css');
        this.#img.addEventListener('load', this.#updateImage.bind(this));
    }

    #loadFloorplan(url) {
        this.#img.src = url;
    }

    getBox() {
        return this.#img.getBoundingClientRect();
    }

    #updateImage() {
        this.scale = this.#img.naturalWidth / this.getBox().width;
        this.#resetAnchors();
    }

    #_anchorDrag(e) {
        e.preventDefault();
        this.#currentlyDragging = e.target;
        this.#offsetX = e.offsetX - 12;
        this.#offsetY = e.offsetY - 12;
        document.addEventListener('mousemove', this.#anchorMove);
        document.addEventListener('mouseup', this.#anchorDrop);
    }

    #_anchorMove(e) {
        const rect = this.getBox();
        const x = Math.min(rect.width, Math.max(0, e.clientX - rect.left - this.#offsetX));
        const y = Math.min(rect.height, Math.max(0, e.clientY - rect.top - this.#offsetY));

        this.#currentlyDragging.style.left = `${x}px`;
        this.#currentlyDragging.style.top = `${y}px`;

        document.worldMap.updateOverlay();
    }

    #_anchorDrop(e) {
        this.#currentlyDragging = null;
        document.removeEventListener('mousemove', this.#anchorMove);
        document.removeEventListener('mouseup', this.#anchorDrop);
    }

    #resetAnchors() {
        this.#anchors[0].style.left = '50px';
        this.#anchors[0].style.top = '50px';
        this.#anchors[1].style.left = '200px';
        this.#anchors[1].style.top = '50px';
        this.#anchors[2].style.left = '50px';
        this.#anchors[2].style.top = '200px';
    }

    getAnchors() {
        return this.#anchors.map(e => new Point2(parseInt(e.style.left), parseInt(e.style.top)));
    }

    static get observedAttributes() {
        return ['src'];
    }

    attributeChangedCallback(name, old, current) {
        switch (name) {
            case 'src':
                this.#loadFloorplan(current);
                break;
        }
    }
}


try {
    customElements.define('floorplan-container', FloorplanContainer);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}
