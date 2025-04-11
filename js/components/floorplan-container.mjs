// This module implements a floorplan viewer with 3-point georeferencing

import { Point2, Vector2 } from '/js/linalg.mjs';
import { Statusable, Stylable } from '/js/mixins.mjs';
import { createElement } from '/js/util.mjs';


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
        this.#img.addEventListener('load', this.#imageLoad.bind(this));
        window.addEventListener('resize', this.#resize.bind(this));
    }

    connectedCallback() {
        document.getElementById('place').addEventListener('click', () => {
            this.setAttribute('status', 0);
            document.getElementById('unplace').disabled = false;
        });
        document.getElementById('unplace').addEventListener('click', () => {
            this.setAttribute('status', 1);
            document.getElementById('unplace').disabled = true;
        });
    }

    // Load the floorplan
    #loadFloorplan(url) {
        this.#img.src = url;
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
        this.#resize();
        const fiftyPx = `${50 * this.#scale}px`;
        const twoHundredPx = `${200 * this.#scale}px`;
        this.#anchors[0].style.setProperty('--left', fiftyPx);
        this.#anchors[0].style.setProperty('--top', fiftyPx);
        this.#anchors[1].style.setProperty('--left', twoHundredPx);
        this.#anchors[1].style.setProperty('--top', fiftyPx);
        this.#anchors[2].style.setProperty('--left', fiftyPx);
        this.#anchors[2].style.setProperty('--top', twoHundredPx);
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

        document.worldMap.updateOverlay();
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
                this.#loadFloorplan(current);
                break;
        }
    }

    // Return serialized data
    toJSON() {
        return this.getAnchors().map(e => e.toJSON());
    }
}


try {
    customElements.define('floorplan-container', FloorplanContainer);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}
