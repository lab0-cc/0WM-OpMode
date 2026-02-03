// This module implements a 3D floorplan viewer

import { Angle2, Matrix2, Point2, Point3, Vector2 } from '/js/linalg.mjs';
import { createElement } from '/js/util.mjs';
import { Statusable, Stylable } from '/js/mixins.mjs';
import { Context2D } from '/js/context2d.mjs';


class FloorplanViewer extends Statusable(Stylable(HTMLElement)) {
    #canvas;
    #ctx;
    #img;
    #scale;
    #wallHeight;

    #dragging;
    #lastX;
    #lastY;
    #pitch;
    #yaw;

    constructor() {
        super();

        this.#img = createElement('img', null);
        this.#img.addEventListener('load', this.#updateViewport.bind(this));
        window.addEventListener('resize', this.#updateViewport.bind(this));

        this.#canvas = createElement('canvas', null, { width: 1, height: 1 });
        this.appendToShadow(this.#canvas);
        this.#ctx = this.#canvas.getContext('2d');
        Object.setPrototypeOf(this.#ctx, Context2D.prototype);

        this.#dragging = false;
        this.#lastX = 0;
        this.#lastY = 0;
        this.#yaw = Math.PI / 4;
        this.#pitch = Math.PI / 8;
        this.#wallHeight = NaN;

        this.#canvas.addEventListener('mousedown', this.#mouseDown.bind(this));
        window.addEventListener('mousemove', this.#mouseMove.bind(this));
        window.addEventListener('mouseup', this.#mouseUp.bind(this));

        this.addStylesheet('components/floorplan-viewer.css');
    }

    connectedCallback() {
        this.#updateViewport();
    }

    // Handle mousedown events
    #mouseDown(e) {
        this.#dragging = true;
        this.#lastX = e.clientX;
        this.#lastY = e.clientY;
    }

    // Handle mousemove events
    #mouseMove(e) {
        if (!this.#dragging)
            return;
        const dx = e.clientX - this.#lastX;
        const dy = e.clientY - this.#lastY;
        this.#yaw += dx * 0.01;
        this.#pitch += dy * 0.01;
        this.#pitch = Math.max(Math.PI/12, Math.min(5*Math.PI/12, this.#pitch));
        this.#lastX = e.clientX;
        this.#lastY = e.clientY;
        this.#updateViewport();
    }

    // Handle mouseup events
    #mouseUp(e) {
        this.#dragging = false;
    }

    // Update viewport
    #updateViewport() {
        const ratio = window.devicePixelRatio || 1;
        const rect = this.getBoundingClientRect();
        this.#scale = Math.min(rect.width, rect.height) /
                      Math.max(this.#img.naturalWidth, this.#img.naturalHeight) * ratio;
        this.#canvas.width = rect.width * ratio;
        this.#canvas.height = rect.height * ratio;
        this.#redraw();
    }

    // Refresh the component
    refresh() {
        this.#redraw();
    }

    // Draw one canvas frame
    #redraw() {
        this.#ctx.clearRect(Point2.origin, new Vector2(this.#canvas.width, this.#canvas.height));

        const yaw = new Angle2(this.#yaw);
        const pitch = new Angle2(this.#pitch);
        const iCtr = new Vector2(this.#img.naturalWidth / 2, this.#img.naturalHeight / 2);
        const cCtr = new Vector2(this.#canvas.width / 2, this.#canvas.height / 2);

        const a = this.#scale * yaw.cos;
        const b = this.#scale * yaw.sin;
        const c = -this.#scale * yaw.sin * pitch.sin;
        const d = this.#scale * yaw.cos * pitch.sin;
        const e = cCtr.x - this.#scale * (iCtr.x * yaw.cos + iCtr.y * yaw.sin);
        const f = cCtr.y + this.#scale * (iCtr.x * yaw.sin - iCtr.y * yaw.cos) * pitch.sin;

        this.#ctx.save();
        this.#ctx.setTransform(new Matrix2(a, b, c, d), new Vector2(e, f));
        this.#ctx.drawImage(this.#img, Point2.origin);
        this.#ctx.restore();

        // Point projection helper
        const project = p => {
            const x = p.x * yaw.cos + p.z * yaw.sin;
            const z = -p.x * yaw.sin + p.z * yaw.cos;
            const y = p.y * pitch.cos - z * pitch.sin;
            return new Point2(cCtr.x + x * this.#scale, cCtr.y - y * this.#scale);
        }

        // Calculate wall height
        let height;
        const mapScale = document.worldMap?.getScale();
        if (mapScale === null || isNaN(this.#wallHeight))
            height = 200;
        else
            height = this.#wallHeight * mapScale;

        // Display walls
        for (const shape of document.floorplanEditor?.shapes() ?? []) {
            if (shape.length > 2)
                shape.push(shape[0]);
            for (let i = 0; i < shape.length - 1; i++) {
                const p1 = shape[i];
                const p2 = shape[i + 1];
                const x1 = p1.x - iCtr.x;
                const z1 = p1.y - iCtr.y;
                const x2 = p2.x - iCtr.x;
                const z2 = p2.y - iCtr.y;
                this.#ctx.beginPath();
                this.#ctx.moveTo(project(new Point3(x1, 0, z1)));
                this.#ctx.lineTo(project(new Point3(x2, 0, z2)));
                this.#ctx.lineTo(project(new Point3(x2, height, z2)));
                this.#ctx.lineTo(project(new Point3(x1, height, z1)));
                this.#ctx.closePath();
                this.#ctx.fillStyle = '#aaab';
                this.#ctx.fill();
            }
        }
    }

    static get observedAttributes() {
        return super.observedAttributes.concat(['src', 'wall-height']);
    }

    attributeChangedCallback(name, old, current) {
        super.attributeChangedCallback(name, old, current);
        switch (name) {
            case 'src':
                this.#img.src = current;
                break;
            case 'wall-height':
                this.#wallHeight = parseFloat(current);
                break;
        }
    }
}


try {
    customElements.define('floorplan-viewer', FloorplanViewer);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}
