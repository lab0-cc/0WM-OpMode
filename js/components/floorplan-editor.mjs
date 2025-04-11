// This module implements a floorplan editor

import { Angle2, Point2, Polygon2, Ray2, Segment2, Vector2 } from '/js/linalg.mjs';
import { Statusable, Stylable } from '/js/mixins.mjs';
import { createElement } from '/js/util.mjs';
import { Context2D } from '/js/context2d.mjs';


const LINE_WIDTH = 1;         // Default line width
const HOVERED_LINE_WIDTH = 2; // Hovered line width
const MAGNETISM = 8;          // Magic snapping constant


class FloorplanEditor extends Statusable(Stylable(HTMLElement)) {
    // Keyboard modifiers
    #altPressed;
    #ctrlPressed;
    #shiftPressed;
    // Mouse interaction
    #cursor;
    #draggingAnchor;
    #draggingShape;
    #hoveredAnchor;
    #hoveredEdge;
    #hoveredEdgeProjection;
    #hoveredShape;
    #magnetism;
    #mouse;
    // Viewport
    #canvas;
    #ctx;
    #img;
    #revScale;
    #scale;
    // Miscellaneous
    #canClosePolygon;
    #currentShape;
    #drawingMode;
    #hatchedPattern;
    #shapes;
    #state;
    #statusModified;
    #toolbar;

    constructor() {
        super();

        this.#img = createElement('img', null);
        this.#img.addEventListener('load', this.#updateViewport.bind(this));
        window.addEventListener('resize', this.#updateViewport.bind(this));
        this.appendToShadow(this.#img);

        this.#toolbar = createElement('div', 'toolbar');
        for (const mode of ['polygon', 'line']) {
            const div = createElement('div', 'button');
            if (mode === 'polygon')
                div.classList.add('selected');
            div.id = mode;
            div.addEventListener('click', () => {
                [...this.#toolbar.children].forEach(e => e.classList.remove('selected'));
                div.classList.add('selected');
                this.#setDrawingMode(mode);
            });
            this.#toolbar.appendChild(div);
        }
        this.appendToShadow(this.#toolbar);

        this.#canvas = createElement('canvas', null, { width: 1, height: 1 });
        this.appendToShadow(this.#canvas);
        this.#ctx = this.#canvas.getContext('2d');
        Object.setPrototypeOf(this.#ctx, Context2D.prototype);
        this.#ctx.lineWidth = LINE_WIDTH;

        this.#shiftPressed = false;
        this.#ctrlPressed = false;
        this.#altPressed = false;
        this.#mouse = null;
        this.#scale = 1;
        this.#revScale = 1;
        this.#magnetism = MAGNETISM;
        this.#statusModified = false;

        this.#canvas.addEventListener('contextmenu', this.#rightClick.bind(this));
        this.#canvas.addEventListener('pointermove', this.#pointerMove.bind(this));
        this.#canvas.addEventListener('pointerdown', this.#pointerDown.bind(this));
        this.#canvas.addEventListener('pointerup', this.#pointerUp.bind(this));
        this.#canvas.addEventListener('dblclick', this.#doubleClick.bind(this));
        document.addEventListener('keydown', this.#keyDown.bind(this));
        document.addEventListener('keyup', this.#updateKeys.bind(this));
        this.#shapes = [];

        const patCanvas = createElement('canvas', null, { width: 8, height: 8 });
        const patCtx = patCanvas.getContext('2d');
        patCtx.strokeStyle = '#0005';
        patCtx.moveTo(0, 4);
        patCtx.lineTo(4, 0);
        patCtx.moveTo(4, 8);
        patCtx.lineTo(8, 4);
        patCtx.stroke();
        this.#hatchedPattern = this.#ctx.createPattern(patCanvas, 'repeat');

        this.addStylesheet('components/floorplan-editor.css');
    }

    connectedCallback() {
        this.#setDrawingMode('polygon');
    }

    // Handle pointerdown events
    #pointerDown(e) {
        this.#canvas.setPointerCapture(e.pointerId);

        // Only handle regular single clicks here
        if (e.button !== 0 | e.detail > 1 | this.#currentShape.length > 0)
            return;

        // Clicking a hovered anchor prepares that anchor to be moved
        if (this.#hoveredAnchor !== -1) {
            this.#draggingShape = this.#hoveredShape;
            this.#draggingAnchor = this.#hoveredAnchor;
        }
        // Clicking a hovered edge while pressing ⌃ or ⌘ creates an anchor and prepares it to be
        // moved
        else if (this.#hoveredEdge !== null && this.#state === 'default' && this.#ctrlPressed) {
            const index = this.#hoveredEdge.p.index + 1;
            this.#hoveredShape.insert(index, this.#hoveredEdgeProjection);
            this.#state = 'dragging';
            this.#draggingShape = this.#hoveredShape;
            this.#draggingAnchor = index;
        }
        // In every other case, create a new shape at the current uncorrected mouse position
        else {
            this.#currentShape = [new Point2(e.offsetX, e.offsetY).scaled(this.#scale)];
            this.#state = 'drawing';
        }

        // Clear any hovered state and redraw
        this.#resetHoveredState();
        this.#redraw();
    }

    // Handle pointermove events
    #pointerMove(e) {
        // Clear any hovered state
        this.#resetHoveredState();

        // If a shape is marked for dragging, set the state accordingly
        if (this.#draggingShape !== null) {
            this.#state = 'dragging';
        }

        // Snap the cursor depending on which modifier keys are pressed
        if (e instanceof MouseEvent)
            this.#mouse = new Point2(e.offsetX, e.offsetY);
        this.#cursor = this.#mouse.scaled(this.#scale);
        this.#snap();

        switch (this.#state) {
            case 'dragging':
                this.#draggingShape.update(this.#draggingAnchor, this.#cursor);
                break;
            case 'drawing':
                // If we are not dragging an anchor, check for polygon closure
                this.#canClosePolygon = this.#drawingMode === 'polygon'
                                        && this.#currentShape.length >= 3
                                        && this.#cursor.to(this.#currentShape[0]).norm()
                                           < this.#magnetism;
                break;
        }

        // Recompute the hovered state and redraw
        this.#recomputeHovered();
        this.#redraw();
    }

    // Handle pointerup events
    #pointerUp(e) {
        this.#canvas.releasePointerCapture(e.pointerId);

        // Only handle regular clicks here
        if (e.button !== 0)
            return;

        // If a shape is marked for dragging
        if (this.#draggingShape !== null) {
            this.#resetDraggingState();

            // If we are currently dragging it, stop the action
            if (this.#state === 'dragging') {
                this.#state = 'default';
            }
            // If we are not currently dragging it (only clicking), create a new shape at the
            // current uncorrected mouse position
            else {
                this.#currentShape = [new Point2(e.offsetX, e.offsetY)];
                this.#state = 'drawing';
            }
        }

        // When drawing
        else if (this.#state === 'drawing') {
            const dist = this.#currentShape.at(-1).to(this.#cursor).norm();
            switch (this.#drawingMode) {
                // When drawing a line, a mouseup event when the mouse is far enough from the
                // previous anchor finishes the line
                case 'line':
                    if (dist > this.#magnetism) {
                        this.#currentShape.push(this.#cursor);
                        this.#pushCurrentShape();
                    }
                    break;
                // When drawing a polygon
                case 'polygon':
                    // Clicking near the first anchor when we already have 3 anchors closes the
                    // polygon
                    if (this.#canClosePolygon)
                        this.#pushCurrentShape();
                    // If the mouse is far enough from the previous anchor, add an anchor at the
                    // current mouse position
                    else if (dist > this.#magnetism)
                        this.#currentShape.push(this.#cursor);
                    break;
            }
        }

        // Recompute states
        this.#pointerMove(e);
    }

    // Handle contextmenu events
    #rightClick(e) {
        e.preventDefault();

        // The right click action only works on hovered shapes
        if (this.#hoveredShape !== null) {
            // If we are hovering a polygon anchor and it can be deleted, delete it
            if (this.#hoveredAnchor !== -1 && this.#hoveredShape instanceof Polygon2
                && this.#hoveredShape.points.length >= 4)
                this.#hoveredShape.remove(this.#hoveredAnchor);
            // Else, delete the whole shape
            else
                this.#shapes.splice(this.#shapes.indexOf(this.#hoveredShape), 1);

            // Recompute the hovered state and redraw
            this.#recomputeHovered();
            this.#redraw();
        }
    }

    // Handle dblclick events
    #doubleClick(e) {
        // If we are drawing a polygon and it can be closed, close it
        if (this.#drawingMode === 'polygon' && this.#currentShape.length >= 3) {
            this.#pushCurrentShape();

            // Recompute the hovered state and redraw
            this.#recomputeHovered();
            this.#redraw();
        }
    }

    // Handle keyup events and update currently pressed keys
    #updateKeys(e) {
        this.#shiftPressed = e.shiftKey;
        this.#ctrlPressed = e.ctrlKey || e.metaKey;
        this.#altPressed = e.altKey;
        if (this.#mouse !== null)
            this.#pointerMove(e);
    }

    // Handle keydown events
    #keyDown(e) {
        if (e.code === 'Escape')
            this.#setDrawingMode(this.#drawingMode);
        else
            this.#updateKeys(e);
    }

    // Update viewport scaling
    #updateViewport() {
        const rect = this.getBoundingClientRect();
        const toolbarWidth = this.#toolbar.getBoundingClientRect().width;
        this.#scale = Math.max(this.#img.naturalWidth / (rect.width - toolbarWidth),
                               this.#img.naturalHeight / rect.height);
        this.#revScale = 1 / this.#scale;
        this.#magnetism = MAGNETISM * this.#scale;
        this.#canvas.width = this.#img.naturalWidth * this.#revScale;
        this.#canvas.height = this.#img.naturalHeight * this.#revScale;
        this.#redraw();
    }

    // Snap the cursor depending on whether ⇧, ⌃/⌘, and ⎇ are pressed
    #snap() {
        const sources = [];

        // Snap to the current viewport;
        if (this.#cursor.x < 0)
            this.#cursor.x = 0;
        else if (this.#cursor.x > this.#img.naturalWidth)
            this.#cursor.x = this.#img.naturalWidth;
        if (this.#cursor.y < 0)
            this.#cursor.y = 0;
        else if (this.#cursor.y > this.#img.naturalHeight)
            this.#cursor.y = this.#img.naturalHeight;

        // Snap to the closest 45-degree angle if ⇧ is pressed when dragging or drawing
        if (this.#shiftPressed && (this.#state === 'dragging' || this.#state === 'drawing')) {
            if (this.#state === 'dragging') {
                switch (this.#draggingShape.constructor) {
                    // When dealing with closed polygons, add the anchor after the one being dragged
                    case Polygon2:
                        const len = this.#draggingShape.points.length
                        sources.push(this.#draggingShape.points[(this.#draggingAnchor + 1) % len]);
                    // In all cases, add the anchor before the one being dragged
                    case Segment2:
                        sources.push(this.#draggingShape.points.at(this.#draggingAnchor - 1));
                        break;
                }
            }
            else {
                // If the shape is still being drawn, add the last anchor
                sources.push(this.#currentShape.at(-1));
            }

            // Snap to the closest 45-degree angle, and select the ray source with ⎇
            this.#cursor = this.#angleSnap(sources.at(this.#altPressed - 1));
        }

        // Snap to the closest edge if ⌃ or ⌘ are pressed
        if (this.#ctrlPressed && (this.#state === 'dragging' || this.#state === 'drawing'))
            this.#cursor = this.#snapToClosestEdge(this.#draggingShape, sources);
    }

    // Recompute what is currently below the cursor
    #recomputeHovered() {
        if (this.#state === 'default') {
            // First, try to find an anchor
            this.#findHoverAnchor();

            // If not found, try to find an edge if ⌃ or ⌘ are pressed
            if (this.#ctrlPressed && this.#hoveredShape === null)
                this.#findHoverEdge();

            // If not found, try to find a shape
            if (this.#hoveredShape === null)
                this.#findHoverShape();
        }
    }

    // Reset the hovered state variables
    #resetHoveredState() {
        this.#hoveredShape = null;
        this.#hoveredEdge = null;
        this.#hoveredAnchor = -1;
        this.#hoveredEdgeProjection = null;
    }

    // Reset the dragging state variables
    #resetDraggingState() {
        this.#draggingShape = null;
        this.#draggingAnchor = -1;
    }

    // Reset to default state
    #resetDefault() {
        this.#currentShape = [];
        this.#state = 'default';
    }

    // Reset intermediary states and set the drawing mode
    #setDrawingMode(mode) {
        this.#drawingMode = mode;
        this.#resetDefault();
        this.#resetHoveredState();
        this.#resetDraggingState();
        this.#canClosePolygon = false;
        this.#redraw();
    }

    // Set the canvas cursor
    #setCursor(cursor) {
        this.#canvas.style.cursor = cursor;
    }

    // Draw one canvas frame
    #redraw() {
        this.#ctx.clearRect(Point2.origin, new Vector2(this.#canvas.width, this.#canvas.height));
        this.#statusModified = false;

        // Fill the polygon mask
        this.#fillPolygons();

        if (this.#shapes.filter(e => e instanceof Polygon2).length === 0)
            this.setAttribute('status', 1);

        // Draw each shape
        for (const shape of this.#shapes)
            this.#drawShape(shape);

        switch (this.#state) {
            case 'drawing':
                // Draw the current shape
                if (this.#drawingMode === 'line') {
                    this.#drawLine(new Segment2(this.#currentShape[0], this.#cursor), true, '#000');
                }
                else if (this.#drawingMode === 'polygon') {
                    this.#drawPolygon(new Polygon2(this.#currentShape, true));
                    // If adding an anchor at the current cursor position creates
                    // (self-)intersecting polygons, display the temporary edge in red
                    const c = this.#isInvalid(new Polygon2([...this.#currentShape, this.#cursor],
                                                           true)) ? '#f00' : '#000';
                    this.#drawLine(new Segment2(this.#currentShape.at(-1), this.#cursor), true, c);
                }
                if (this.#canClosePolygon) {
                    this.#setCursor('cell');
                    this.#highlightFirstAnchor(this.#currentShape[0]);
                }
                else {
                    this.#setCursor('crosshair');
                }
                break;
            case 'dragging':
                this.#setCursor('grabbing');
                break;
            case 'default':
                if (this.#hoveredEdgeProjection === null) {
                    if (this.#hoveredAnchor === -1)
                        this.#setCursor('crosshair');
                    else
                        this.#setCursor('grab');
                }
                else {
                    this.#setCursor('copy');
                    this.#ctx.beginPath();
                    this.#ctx.circle(this.#hoveredEdgeProjection.scaled(this.#revScale),
                                     2 * HOVERED_LINE_WIDTH);
                    this.#ctx.fillStyle = '#0828';
                    this.#ctx.fill();
                }
                break;
        }

        if (!this.#statusModified)
            this.setAttribute('status', 0);
    }

    // Fill the polygon mask following an inverse even-odd rule
    #fillPolygons() {
        let count = 0;
        this.#ctx.beginPath();

        // Draw each polygon
        for (let shape of this.#shapes) {
            if (shape instanceof Polygon2) {
                this.#ctx.polygon(shape.scaled(this.#revScale));
                count++;
            }
        }

        // If at least one polygon was filled, inverse the fill with a rectangle
        if (count > 0)
            this.#ctx.rect(new Point2(-1, -1),
                           new Vector2(this.#canvas.width + 2, this.#canvas.height + 2));

        this.#ctx.fillStyle = this.#hatchedPattern;
        this.#ctx.fill('evenodd');
    }

    // Draw a shape on the canvas
    #drawShape(shape) {
        const currentlyHovered = shape === this.#hoveredShape;
        this.#ctx.lineWidth = LINE_WIDTH;

        // If the whole shape is hovered, highlight it
        if (currentlyHovered && this.#hoveredAnchor === -1
            && (this.#hoveredEdge === null || shape instanceof Segment2))
            this.#ctx.lineWidth = HOVERED_LINE_WIDTH;

        switch (shape.constructor) {
            case Segment2:
                this.#drawLine(shape, false, 'black');
                break;
            case Polygon2:
                this.#drawPolygon(shape);
                if (currentlyHovered && this.#hoveredEdge !== null) {
                    this.#ctx.beginPath();
                    this.#ctx.lineWidth = HOVERED_LINE_WIDTH;
                    this.#ctx.line(this.#hoveredEdge.scaled(this.#revScale));
                    this.#ctx.stroke();
                }
                break;
        }

        // If the shape is hovered, show its anchors and highlight the current one
        if (currentlyHovered) {
            this.#ctx.fillStyle = '#fff';
            for (let i = 0; i < shape.points.length; i++) {
                if (i === this.#hoveredAnchor)
                    this.#ctx.lineWidth = HOVERED_LINE_WIDTH;
                else
                    this.#ctx.lineWidth = LINE_WIDTH;
                this.#ctx.circle(shape.points[i].scaled(this.#revScale), 2 * HOVERED_LINE_WIDTH);
                this.#ctx.fill();
                this.#ctx.stroke();
            }
        }
        this.#ctx.lineWidth = LINE_WIDTH;
    }

    // Draw a line on the canvas
    #drawLine(l, ghost=false, color='#000') {
        this.#ctx.beginPath();
        this.#ctx.line(l.scaled(this.#revScale));
        if (ghost)
            this.#ctx.setLineDash([4 * LINE_WIDTH, 4 * LINE_WIDTH]);
        else
            this.#ctx.setLineDash([]);
        this.#ctx.strokeStyle = color;
        this.#ctx.stroke();
        this.#ctx.setLineDash([]);
    }

    // Check whether the given polygon leads to an invalid canvas geometry
    #isInvalid(p) {
        if (p.isSelfIntersecting())
            return true;
        for (const shape of this.#shapes) {
            if (shape === p)
                continue;
            if (shape instanceof Polygon2 && p.intersects(shape)) {
                return true;
            }
        }
        return false;
    }

    // Draw a polygon on the canvas
    #drawPolygon(p) {
        this.#ctx.beginPath();
        this.#ctx.polygon(p.scaled(this.#revScale));
        if (this.#isInvalid(p)) {
            this.setAttribute('status', 2);
            this.#ctx.strokeStyle = '#f00';
        }
        else {
            this.#ctx.strokeStyle = '#000';
        }
        this.#ctx.setLineDash([]);
        this.#ctx.stroke();
    }

    // Highlight the first polygon anchor
    #highlightFirstAnchor(p) {
        this.#ctx.fillStyle = '#ff0';
        this.#ctx.beginPath();
        this.#ctx.circle(p.scaled(this.#revScale), 2 * HOVERED_LINE_WIDTH);
        this.#ctx.fill();
        this.#ctx.stroke();
    }

    // Push the shape being drawn to the list of shapes
    #pushCurrentShape() {
        switch (this.#drawingMode) {
            case 'line':
                this.#shapes.push(new Segment2(...this.#currentShape));
                break;
            case 'polygon':
                this.#shapes.push(new Polygon2(this.#currentShape));
                break;
        }
        this.#resetDefault();
    }

    // Try to find the hovered anchor
    #findHoverAnchor() {
        for (const shape of this.#shapes) {
            for (let i = 0; i < shape.points.length; i++) {
                const pt = shape.points[i];
                const d = this.#cursor.to(pt).norm();
                if (d <= this.#magnetism) {
                    this.#hoveredShape = shape;
                    this.#hoveredAnchor = i;
                    return;
                }
            }
        }
    }

    // Try to find the hovered shape
    #findHoverShape() {
        let boundingBox = null;
        // We iterate from back to front, prioritizing lines
        for (const shape of this.#shapes) {
            switch (shape.constructor) {
                case Segment2:
                    if (shape.distance(this.#cursor) <= this.#magnetism)
                      this.#hoveredShape = shape;
                    break;
                case Polygon2:
                    const bb = shape.boundingBox();
                    if (shape.windingNumber(this.#cursor) !== 0
                        && (this.#hoveredShape === null
                            || !(this.#hoveredShape instanceof Segment2))
                        && (boundingBox === null || boundingBox.contains(bb))) {
                        this.#hoveredShape = shape;
                        boundingBox = bb;
                    }
                    break;
            }
        }
    }

    // Try to find the hovered edge
    #findHoverEdge() {
        let bestDist = this.#magnetism;

        for (const shape of this.#shapes) {
            if (!(shape instanceof Polygon2))
                continue;

            for (const edge of shape.edges()) {
                const projection = edge.project(this.#cursor, true);
                const dist = projection.to(this.#cursor).norm();
                if (dist < bestDist) {
                    bestDist = dist;
                    this.#hoveredEdge = edge;
                    this.#hoveredEdgeProjection = projection;
                    this.#hoveredShape = shape;
                }
            }
        }
    }

    // Changes of image source are observed
    static get observedAttributes() {
        return super.observedAttributes.concat(['src']);
    }

    // Changing the image source changes the canvas background
    attributeChangedCallback(name, old, current) {
        super.attributeChangedCallback(name, old, current);
        switch (name) {
            case 'src':
                this.#img.src = current;
                break;
            case 'status':
                this.#statusModified = true;
                break;
        }
    }

    // Snap the mouse cursor to the closest edge
    #snapToClosestEdge(skipShape=null, raySources=[]) {
        const sqThreshold = this.#magnetism * this.#magnetism;
        let bestSqdist = Infinity;
        let bestCandidate = this.#cursor;

        // Check every edge of every shape
        for (const shape of this.#shapes) {
            if (shape === skipShape)
                continue;
            let edges = [];
            switch (shape.constructor) {
                case Segment2:
                    edges = [shape];
                    break;
                case Polygon2:
                    edges = shape.edges();
                    break;
            }
            // Find the edge closest to the cursor
            for (const edge of edges) {
                let candidates;
                if (raySources.length === 0)
                    candidates = [edge.project(this.#cursor, true)];
                else
                    candidates = raySources.map(p => edge.intersect(new Ray2(p, this.#cursor)))
                                           .filter(Boolean);
                for (const candidate of candidates) {
                    const sqdist = this.#cursor.to(candidate).sqnorm();
                    if (sqdist < bestSqdist && sqdist <= sqThreshold) {
                        bestSqdist = sqdist;
                        bestCandidate = candidate;
                        this.#hoveredEdge = edge;
                        this.#hoveredShape = shape;
                    }
                }
            }
        }

        return bestCandidate;
    }

    // Snap the mouse cursor so that there is a 45×n°-angle between it and the previous anchor
    #angleSnap(source) {
        const delta = source.to(this.#cursor);
        const snappedAngle = new Angle2(Math.round(delta.angle().radians() / (Math.PI/4))
                                        * (Math.PI/4));
        return source.plus(new Vector2(delta.norm(), 0).rotated(snappedAngle));
    }

    // Return serialized data
    toJSON() {
        return { floorplan: { height: this.#img.naturalHeight, width: this.#img.naturalWidth },
                 shapes: this.#shapes.map(e => e.toJSON()) };
    }
}


try {
    customElements.define('floorplan-editor', FloorplanEditor);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}
