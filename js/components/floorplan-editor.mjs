// This module implements a floorplan editor

import { Angle2, Point2, Polygon2, Ray2, Segment2, Vector2 } from '/js/linalg.mjs';
import { Statusable, Stylable } from '/js/mixins.mjs';
import { createElement as E } from '/js/util.mjs';
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
    #snapSource;
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
    #helpDiv;
    #kbdIndicators;
    #shapes;
    #state;
    #statusModified;
    #toolbar;

    constructor() {
        super();

        document.floorplanEditor = this;
        this.#img = this.appendToShadow(E('img'));
        this.#img.addEventListener('load', this.#updateViewport.bind(this));
        window.addEventListener('resize', this.#updateViewport.bind(this));

        this.#toolbar = this.appendToShadow(E('div', 'toolbar'));
        for (const mode of ['polygon', 'line']) {
            const div = E('div', 'button', { id: mode });
            if (mode === 'polygon')
                div.classList.add('selected');
            div.addEventListener('click', () => {
                [...this.#toolbar.children].forEach(e => e.classList.remove('selected'));
                div.classList.add('selected');
                this.#setDrawingMode(mode);
            });
            this.#toolbar.appendChild(div);
        }

	this.#kbdIndicators = {};
        this.#helpDiv = E('div', 'button', { id: 'help' });

        const indicators = { lmouse: 'Left mouse button', rmouse: 'Right mouse button',
                             shift: 'Shift key', ctrl: 'Ctrl key', alt: 'Alt key',
                             esc: 'Escape key' }

        // On macOS, display platform-specific icons and use proper descriptions
        if (navigator.userAgentData?.platform === 'macOS' || navigator.platform === 'MacIntel'
            || navigator.userAgent.toLowerCase().includes('macintosh')) {
            this.#helpDiv.classList.add('macos');
            indicators.ctrl = 'Command key';
            indicators.alt = 'Option key';
        }

        Object.entries(indicators).forEach(([id, title]) =>
            this.#kbdIndicators[id] = this.#helpDiv.appendElement({ tag: 'div',
                                                                    attributes: { id, title } })
        );
        this.#toolbar.appendChild(this.#helpDiv);

        this.#canvas = this.appendToShadow(E('canvas', null, { width: 1, height: 1 }));
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

        const patCanvas = E('canvas', null, { width: 8, height: 8 });
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

    #setIndicatorHint(id, hint) {
        this.#kbdIndicators[id].textContent = hint;
        this.#kbdIndicators[id].classList.add('expanded');
    }

    #resetIndicatorHint(id) {
        const indicator = this.#kbdIndicators[id];
        indicator.textContent = '';
        indicator.className = [...indicator.classList].filter(e => e === 'active').join(' ');
    }

    #resetIndicatorHints() {
        Object.keys(this.#kbdIndicators).forEach(e => this.#resetIndicatorHint(e));
    }

    #canRemoveAnchor() {
        return this.#hoveredAnchor !== -1 && this.#hoveredShape instanceof Polygon2
               && this.#hoveredShape.points.length >= 4;
    }

    #canSwitchToAnchorInsertion() {
        return this.#hoveredShape instanceof Polygon2 && this.#hoveredEdge !== null;
    }

    #canInsertAnchor() {
        return this.#canSwitchToAnchorInsertion() && this.#ctrlPressed && this.#state === 'default';
    }

    #canPerformRightClick() {
        return this.#hoveredShape !== null && !this.#canInsertAnchor();
    }

    #canPerformLeftClick() {
        return this.#currentShape.at(-1).to(this.#cursor).norm() > this.#magnetism;
    }

    #canSwapRefAnchor() {
        return this.#shiftPressed && this.#draggingShape instanceof Polygon2;
    }

    #updateIndicator(id, active) {
        if (active)
            this.#kbdIndicators[id].classList.add('active');
        else
            this.#kbdIndicators[id].classList.remove('active');
    }

    #disableIndicator(id) {
        this.#kbdIndicators[id].classList.add('disabled');
    }

    #indicatorActive(id) {
        return this.#kbdIndicators[id].classList.contains('active');
    }

    #updateIndicatorHints() {
        switch (this.#state) {
            case 'default':
                if (this.#hoveredAnchor !== -1) {
                    this.#setIndicatorHint('lmouse', 'Press: move anchor');
                }
                else if (this.#canInsertAnchor()) {
                    this.#setIndicatorHint('lmouse', 'Press: insert new anchor');
                }
                else if (this.#draggingShape !== null) {
                    this.#setIndicatorHint('lmouse', 'Move: move anchor');
                }
                else switch (this.#drawingMode) {
                    case 'line':
                        this.#setIndicatorHint('lmouse', 'Press: start drawing wall');
                        break;
                    case 'polygon':
                        this.#setIndicatorHint('lmouse', 'Press: start drawing boundary');
                        break;
                }
                if (this.#canPerformRightClick()) {
                    if (this.#canRemoveAnchor())
                        this.#setIndicatorHint('rmouse', 'Click: remove anchor');
                    else switch (this.#hoveredShape.constructor) {
                        case Segment2:
                            this.#setIndicatorHint('rmouse', 'Click: remove wall');
                            break;
                        case Polygon2:
                            this.#setIndicatorHint('rmouse', 'Click: remove boundary');
                            break;
                    }
                }
                if (this.#canSwitchToAnchorInsertion()) {
                    if (this.#ctrlPressed)
                        this.#setIndicatorHint('ctrl', 'Hold: stay in anchor insertion');
                    else
                        this.#setIndicatorHint('ctrl', 'Hold: switch to anchor insertion');
                }
                ['shift', 'alt', 'esc'].forEach(e => this.#disableIndicator(e));
                break;
            case 'drawing':
                let prefix;
                if (this.#indicatorActive('lmouse'))
                    prefix = 'Release';
                else
                    prefix = 'Click';
                if (this.#canPerformLeftClick()) {
                    switch (this.#drawingMode) {
                        case 'line':
                            this.#setIndicatorHint('lmouse', `${prefix}: finish wall`);
                            break;
                        case 'polygon':
                            if (this.#canClosePolygon)
                                this.#setIndicatorHint('lmouse', `${prefix}: close boundary`);
                            else
                                this.#setIndicatorHint('lmouse', `${prefix}: add anchor`);
                            break;
                    }
                }
                this.#setIndicatorHint('shift', 'Hold: snap to 45° angles');
                if (this.#hoveredEdge !== null)
                    this.#setIndicatorHint('ctrl', 'Hold: snap to closest edge');
                ['rmouse', 'alt'].forEach(e => this.#disableIndicator(e));
                this.#setIndicatorHint('esc', 'Tap: cancel the current action');
                break;
            case 'dragging':
                this.#setIndicatorHint('lmouse', 'Move: move anchor');
                this.#disableIndicator('rmouse');
                this.#setIndicatorHint('shift', 'Hold: snap to 45° angles');
                if (this.#hoveredEdge !== null)
                    this.#setIndicatorHint('ctrl', 'Hold: snap to closest edge');
                if (this.#canSwapRefAnchor())
                    this.#setIndicatorHint('alt', 'Hold: swap reference anchor');
                this.#setIndicatorHint('esc', 'Tap: cancel the current action');
                break;
        }
    }

    // Handle pointerdown events
    #pointerDown(e) {
        if (e.button === 0)
            this.#updateIndicator('lmouse', true);
        else
            this.#updateIndicator('rmouse', true);

        // Only handle regular single clicks here
        if (e.button !== 0 || e.detail > 1 || this.#currentShape.length > 0)
            return;

        this.#canvas.setPointerCapture(e.pointerId);

        // Clicking a hovered anchor prepares that anchor to be moved
        if (this.#hoveredAnchor !== -1) {
            this.#draggingShape = this.#hoveredShape;
            this.#draggingAnchor = this.#hoveredAnchor;
        }
        // Clicking a hovered edge while pressing ⎈ or ⌘ creates an anchor and prepares it to be
        // moved
        else if (this.#canInsertAnchor()) {
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
        this.#resetIndicatorHints();
        this.#resetHoveredState();
        this.#redraw();
        this.#updateIndicatorHints();
    }

    // Handle pointermove events
    #pointerMove(e) {
        // Clear any hovered state
        this.#resetHoveredState();

        // If a shape is marked for dragging, set the state accordingly
        if (this.#draggingShape !== null) {
            this.#state = 'dragging';
        }

        if (e instanceof MouseEvent) {
            if (e.clientX < 250 && e.clientY > document.body.clientHeight - 200)
                this.#helpDiv.classList.add('discrete');
            else
                this.#helpDiv.classList.remove('discrete');
            this.#mouse = new Point2(e.offsetX, e.offsetY);
        }
        this.#cursor = this.#mouse.scaled(this.#scale);

        // Snap the cursor depending on which modifier keys are pressed
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

        // Recompute states
        this.#recomputeAfterEvent();
    }

    // Handle pointerup events
    #pointerUp(e) {
        // Only handle regular clicks here
        if (e.button !== 0) {
            this.#updateIndicator('rmouse', false);
            return;
        }

        this.#updateIndicator('lmouse', false);

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
                this.#currentShape = [new Point2(e.offsetX, e.offsetY).scaled(this.#scale)];
                this.#state = 'drawing';
            }
        }

        // When drawing
        else if (this.#state === 'drawing') {
            switch (this.#drawingMode) {
                // When drawing a line, a mouseup event when the mouse is far enough from the
                // previous anchor finishes the line
                case 'line':
                    if (this.#canPerformLeftClick()) {
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
                    else if (this.#canPerformLeftClick())
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

        // The right click action only works in default mode on hovered shapes when no special
        // action is in progress
        if (this.#state === 'default' && this.#canPerformRightClick()) {
            // If we are hovering a polygon anchor and it can be deleted, delete it
            if (this.#canRemoveAnchor())
                this.#hoveredShape.remove(this.#hoveredAnchor);
            // Else, delete the whole shape
            else
                this.#shapes.splice(this.#shapes.indexOf(this.#hoveredShape), 1);

            // Recompute states
            this.#recomputeAfterEvent();
        }
    }

    // Handle dblclick events
    #doubleClick(e) {
        // If we are drawing a polygon and it can be closed, close it
        if (this.#drawingMode === 'polygon' && this.#currentShape.length >= 3) {
            this.#pushCurrentShape();

            // Recompute states
            this.#recomputeAfterEvent();
        }
    }

    // Handle keyup events and update currently pressed keys
    #updateKeys(e) {
        if (e.code === 'Escape')
            this.#kbdIndicators.esc.classList.remove('active');
        this.#shiftPressed = e.shiftKey;
        this.#updateIndicator('shift', this.#shiftPressed);
        this.#ctrlPressed = e.ctrlKey || e.metaKey;
        this.#updateIndicator('ctrl', this.#ctrlPressed);
        this.#altPressed = e.altKey;
        this.#updateIndicator('alt', this.#altPressed);
        if (this.#mouse !== null)
            this.#pointerMove(e);
    }

    // Handle keydown events
    #keyDown(e) {
        if (e.code === 'Escape') {
            this.#setDrawingMode(this.#drawingMode);
            this.#kbdIndicators.esc.classList.add('active');
        }
        else {
            this.#updateKeys(e);
        }
    }

    // Update viewport scaling
    #updateViewport() {
        const ratio = window.devicePixelRatio || 1;
        const rect = this.getBoundingClientRect();
        const toolbarWidth = this.#toolbar.getBoundingClientRect().width;
        this.#scale = Math.max(this.#img.naturalWidth / (rect.width - toolbarWidth),
                               this.#img.naturalHeight / rect.height);
        this.#revScale = 1 / this.#scale;
        this.#magnetism = MAGNETISM * this.#scale;
        const width = this.#img.naturalWidth * this.#revScale;
        const height = this.#img.naturalHeight * this.#revScale;
        this.#canvas.width = width * ratio;
        this.#canvas.height = height * ratio;
        this.#canvas.style.width = `${width}px`;
        this.#canvas.style.height = `${height}px`;
        this.#ctx.scale(new Vector2(ratio, ratio));
        this.#redraw();
    }

    // Snap the cursor depending on whether ⇧, ⎈/⌘, and ⎇/⌥ are pressed
    #snap() {
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
                    // When dealing with closed polygons, the ray source is selected with ⎇/⌥
                    case Polygon2:
                        const len = this.#draggingShape.points.length;
                        if (this.#altPressed)
                            this.#snapSource = this.#draggingShape.points[(this.#draggingAnchor + 1) % len];
                        else
                            this.#snapSource = this.#draggingShape.points.at(this.#draggingAnchor - 1);
                        break;
                    // When dealing with segments, the ray source is the anchor not being dragged
                    case Segment2:
                        this.#snapSource = this.#draggingShape.points.at(this.#draggingAnchor - 1);
                        break;
                }
            }
            else {
                // If the shape is still being drawn, the ray source is the last anchor
                this.#snapSource = this.#currentShape.at(-1);
            }

            // Snap to the closest 45-degree angle, and select the ray source with ⎇/⌥
            this.#cursor = this.#angleSnap(this.#snapSource);
        }

        // Snap to the closest edge if ⎈ or ⌘ are pressed
        if (this.#ctrlPressed && (this.#state === 'dragging' || this.#state === 'drawing'))
            this.#cursor = this.#snapToClosestEdge();
    }

    // Recompute what is currently below the cursor
    #recomputeHovered() {
        // First, try to find an anchor
        this.#findHoverAnchor();

        if (this.#hoveredShape === null)
            this.#hoveredEdgeProjection = this.#snapToClosestEdge();

        // If no edge shape is hovered, look inside our shapes
        if (this.#hoveredShape === null)
            this.#findHoverShape();
    }

    // Reset the hovered state variables
    #resetHoveredState() {
        this.#hoveredShape = null;
        this.#hoveredEdge = null;
        this.#hoveredAnchor = -1;
        this.#hoveredEdgeProjection = null;
        this.#snapSource = null;
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
        this.#canClosePolygon = false;
    }

    // Reset intermediary states and set the drawing mode
    #setDrawingMode(mode) {
        this.#drawingMode = mode;
        this.#resetDefault();
        this.#resetHoveredState();
        this.#resetDraggingState();
        this.#resetIndicatorHints();
        this.#redraw();
        this.#updateIndicatorHints();
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
                    this.#drawLine(new Segment2(this.#currentShape[0], this.#cursor), true);
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
                if (this.#canInsertAnchor()) {
                    this.#setCursor('copy');
                    this.#ctx.beginPath();
                    this.#ctx.circle(this.#hoveredEdgeProjection.scaled(this.#revScale),
                                     2 * HOVERED_LINE_WIDTH);
                    this.#ctx.fillStyle = '#0828';
                    this.#ctx.fill();
                }
                else {
                    if (this.#hoveredAnchor === -1)
                        this.#setCursor('crosshair');
                    else
                        this.#setCursor('grab');
                }
                break;
        }

        if (!this.#statusModified)
            this.setAttribute('status', 0);
    }

    // Recompute a sane state and redraw after an event
    #recomputeAfterEvent() {
        this.#resetIndicatorHints();
        this.#recomputeHovered();
        this.#redraw();
        this.#updateIndicatorHints();
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

        // In default mode, if the whole shape is hovered, highlight it
        if (this.#state === 'default' && currentlyHovered && this.#hoveredAnchor === -1
            && (!this.#ctrlPressed || this.#hoveredEdge === null || shape instanceof Segment2))
            this.#ctx.lineWidth = HOVERED_LINE_WIDTH;

        switch (shape.constructor) {
            case Segment2:
                this.#drawLine(shape);
                break;
            case Polygon2:
                this.#drawPolygon(shape);
                break;
        }

        if (currentlyHovered && this.#ctrlPressed && this.#hoveredEdge !== null) {
            this.#ctx.beginPath();
            this.#ctx.lineWidth = HOVERED_LINE_WIDTH;
            this.#ctx.line(this.#hoveredEdge.scaled(this.#revScale));
            this.#ctx.stroke();
        }

        // In default mode, if the shape is hovered, show its anchors and highlight the current one
        if (this.#state === 'default' && currentlyHovered) {
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
        this.#hoveredShape = null;
        for (const shape of this.#shapes) {
            if (shape === this.#draggingShape)
                continue;
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
        // We iterate from back to front
        for (const shape of this.#shapes) {
            if (shape === this.#draggingShape || !(shape instanceof Polygon2))
                continue;
            const bb = shape.boundingBox();
            if (shape.windingNumber(this.#cursor) !== 0
                && (boundingBox === null || boundingBox.contains(bb))) {
                this.#hoveredShape = shape;
                boundingBox = bb;
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
    #snapToClosestEdge() {
        const sqThreshold = this.#magnetism * this.#magnetism;
        let bestSqdist = Infinity;
        let bestCandidate = this.#cursor;

        // Check every edge of every shape
        for (const shape of this.#shapes) {
            if (shape === this.#draggingShape)
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
                let candidate;
                if (this.#snapSource === null)
                    candidate = edge.project(this.#cursor, true);
                else
                    candidate = edge.intersect(new Ray2(this.#snapSource, this.#cursor));
                if (candidate !== null) {
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
        const snap = new Angle2(Math.round(source.to(this.#cursor).angle().radians() / (Math.PI/4))
                                * (Math.PI/4));
        return new Ray2(source, new Vector2(1, 0).rotated(snap)).project(this.#cursor);
    }

    // Return serialized shapes
    shapes() {
        return this.#shapes.map(e => e.toJSON());
    }

    // Return serialized data
    toJSON() {
        const structure = [];
        const walls = [];
        for (const shape of this.#shapes) {
            if (shape instanceof Polygon2)
                structure.push(shape.toJSON());
            else
                walls.push(shape.toJSON());
        }
        return { floorplan: { height: this.#img.naturalHeight, width: this.#img.naturalWidth },
                 structure, walls };
    }
}


try {
    customElements.define('floorplan-editor', FloorplanEditor);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}
