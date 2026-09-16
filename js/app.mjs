// This module provides the OpMode application entrypoint.

import { createElement as E } from '/js/util.mjs';

const EDITION_TABS = { edit: 'Floorplan Editor', map: 'Map Editor', misc: 'Additional Parameters' };
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/web'];

// Create a single input field
function createField(id, description, suffix) {
    const field = E('span', 'field');
    field.appendElements(
        { tag: 'label', attributes: { for_: id }, content: description },
        { tag: 'input', attributes: { type: 'number', id, 'step': .1, min: 0, required: 'required' } },
        { tag: 'span', className: 'suffix', content: suffix }
    );
    return field;
}

// Get an input status
function getStatus(e) {
    if (e.value === '')
        return 1;
    if (e.checkValidity())
        return 0;
    return 2;
}

export class App {
    #app;
    #b64Data;
    #floorplanContainer;
    #floorplanEditor;
    #id;
    #nameInput;
    #progress;
    #submitBtn;
    #tabContainer;
    #worldMap;
    #panes;

    constructor() {
        fetch('/config.json').then(r => r.json().then(data => {
            window.apiURL = data.api;
            this.#app = document.body.appendElement({ tag: 'div', className: 'app' });
            [this.#tabContainer, this.#progress,, this.#worldMap] = this.#app.appendElements(
                'tab-container',
                { tag: 'div', className: 'progress' },
                { tag: 'div', className: 'pane mask' },
                'world-map'
            );
            this.#panes = {};
            this.#defaultView();
        }));
    }

    // Clear the app’s transient data
    async #resetApp() {
        this.#worldMap.classList.remove('editing');
        await customElements.whenDefined('world-map');
        await this.#worldMap.ready;
        await this.#worldMap.resetOverlay();
        this.#tabContainer.clearTabs?.();
        for (const [name, pane] of Object.entries(this.#panes)) {
            pane.remove();
            delete this.#panes[name]
        }
    }

    // Reset the sending state
    #resetProgress() {
        document.body.classList.remove('sending');
        this.#progress.style.removeProperty('width');
        this.#submitBtn.disabled = false;
    }

    // Load a floorplan. The application only supports JPEG, PNG and WebP images.
    #loadFloorplan(e) {
        const file = e.target.files[0];
        if (!ALLOWED_MIME.includes(file.type)) {
            alert('Invalid file. Please select a supported image type (JPEG, PNG or WebP).')
            return;
        }

        const reader = new FileReader();
        reader.addEventListener('load', () => this.#b64Data = reader.result);
        reader.readAsDataURL(file);
        const url = URL.createObjectURL(file);
        this.editionView(url);
    }

    // Submit the floorplan data
    #submit() {
        this.#submitBtn.disabled = true;
        document.body.classList.add('sending');
        const anchors = [];
        const localAnchors = this.#floorplanContainer.toJSON();
        const globalAnchors = this.#worldMap.toJSON();
        for (let i = 0; i < localAnchors.length; i++) {
            const { x, y } = localAnchors[i];
            const { lng, lat } = globalAnchors[i];
            anchors.push({ x: x, y: y, lng: lng, lat: lat });
        }

        const payload = this.#floorplanEditor.toJSON();
        payload.anchors = anchors;
        payload.floorplan.data = this.#b64Data;
        payload.name = this.#nameInput.value;
        payload.zmin = parseFloat(document.getElementById('zmin').value);
        payload.zmax = parseFloat(document.getElementById('zmax').value);

        const xhr = new XMLHttpRequest();
        if (this.#id === null)
            xhr.open('POST', `${window.apiURL}/maps`);
        else
            xhr.open('PUT', `${window.apiURL}/maps/${this.#id}`);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.upload.addEventListener('progress', e => this.#progress.style.width = `${100 * e.loaded / e.total}%`);
        xhr.addEventListener('load', () => {
            this.#resetProgress();
            if (xhr.status >= 200 && xhr.status < 300) {
                this.#defaultView();
            }
            else {
                alert('An error occurred');
            }
        });

        xhr.addEventListener('error', () => {
            this.#resetProgress();
            alert('An error occurred');
        });

        xhr.send(JSON.stringify(payload));
    }

    // Switch to default view
    async #defaultView() {
        await this.#resetApp();
        const [input,, resetView, locate] = this.#tabContainer.appendElements(
            { tag: 'input', attributes: { id: 'floorplan-input', type: 'file', accept: ALLOWED_MIME.join() } },
            { tag: 'label', attributes: { for_: 'floorplan-input' }, content: 'New floorplan' },
            { tag: 'button', className: 'right', content: 'Reset view' },
            { tag: 'button', className: 'right', content: 'Locate floorplans' }
        );
        input.addEventListener('change', this.#loadFloorplan.bind(this));
        let timer = null;
        locate.style.setProperty('--color', '#f00');
        const delay = 4;
        locate.style.animationDuration = `${delay}s`;
        const leave = () => {
            locate.classList.add('started');
            timer = setTimeout(() => {
                this.#worldMap.unlocateFloorplans();
                locate.classList.remove('timer');
                locate.classList.remove('started');
            }, delay * 1000);
        }
        const enter = () => {
            if (timer != null)
                clearTimeout(timer);
            locate.classList.remove('started');
            locate.classList.add('timer');
            this.#worldMap.locateFloorplans(enter, leave);
        }
        locate.addEventListener('mouseenter', enter);
        locate.addEventListener('mouseleave', leave);
        resetView.addEventListener('click', () => this.#worldMap.resetView());
    }

    // Switch to edition view
    async editionView(url, id = null, data = null) {
        await this.#resetApp();
        this.#worldMap.classList.add('editing');
        this.#id = id;
        for (const [target, title] of Object.entries(EDITION_TABS)) {
            const pane = this.#app.appendElement({ tag: 'div', className: 'pane', attributes: { id: target } });
            this.#panes[target] = pane;
            this.#tabContainer.appendChild(E('div', 'tab', { dataTarget: target }, title));
        }

        const [cancelBtn, form] = this.#tabContainer.appendElements(
            { tag: 'button', className: 'right', content: 'Cancel' },
            { tag: 'form', className: 'right' }
        );
        [this.#nameInput, this.#submitBtn] = form.appendElements(
            { tag: 'input', className: 'right', attributes: { placeholder: 'Floorplan name', type: 'text', required: 'required' } },
            { tag: 'button', className: 'right', attributes: { disabled: 'disabled', type: 'submit' }, content: 'Submit' }
        );
        cancelBtn.addEventListener('click', this.#defaultView.bind(this));
        this.#submitBtn.addEventListener('click', this.#submit.bind(this));
        this.#nameInput.addEventListener('input', () => {
            this.#nameInput.dispatchEvent(new Event('statuschange', { bubbles: true }));
        });

        this.#floorplanEditor = this.#panes['edit'].appendElement({ tag: 'floorplan-editor', attributes: { src: url, status: data === null ? 1 : 0 } });
        let place, unplace;
        [this.#floorplanContainer, place, unplace] = this.#panes['map'].appendElement(
            { tag: 'div', className: 'left-panel' }
        ).appendElements(
            { tag: 'floorplan-container', attributes: { src: url, status: data === null ? 1 : 0 } },
            { tag: 'button', className: 'next', attributes: { id: 'place' }, content: 'Place in current view' },
            { tag: 'button', className: 'previous', attributes: { id: 'unplace', disabled: 'disabled' }, content: 'Remove from the map' }
        );

        place.addEventListener('click', () => {
            this.#floorplanContainer.setAttribute('status', 0);
            this.#worldMap.placeFloorplan();
            unplace.disabled = false;
        });
        unplace.addEventListener('click', () => {
            this.#floorplanContainer.setAttribute('status', 1);
            this.#worldMap.unplaceFloorplan();
            unplace.disabled = true;
        });

        const [miscPanel, floorplanViewer] = this.#panes['misc'].appendElements(
            { tag: 'div', className: 'top-panel' },
            { tag: 'floorplan-viewer', attributes: { src: url } }
        );
        miscPanel.appendElements(
            createField('zmin', 'Floor altitude', 'm'),
            createField('zmax', 'Ceiling altitude', 'm'),
            createField('height', 'Height', 'm')
        );
        const zmin = document.getElementById('zmin');
        const zmax = document.getElementById('zmax');
        const height = document.getElementById('height');

        function updateStatus() {
            floorplanViewer.setAttribute('status', Math.max(getStatus(zmin), getStatus(zmax), getStatus(height)));
            floorplanViewer.setAttribute('wall-height', parseFloat(height.value));
            floorplanViewer.refresh?.();
        }

        function updateHeight() {
            height.disabled = !zmin.checkValidity();
            height.value = parseFloat(zmax.value) - parseFloat(zmin.value);
            updateStatus();
        }

        zmin.addEventListener('change', updateHeight);
        zmax.addEventListener('change', updateHeight);
        height.addEventListener('change', e => {
            zmax.value = parseFloat(e.target.value) + parseFloat(zmin.value);
            updateStatus();
        });

        if (data !== null) {
            this.#nameInput.value = data.name;
            zmin.value = data.zmin;
            zmax.value = data.zmax;
            updateHeight();
            this.#floorplanContainer.ofJSON(data.anchors);
            this.#worldMap.placeFloorplan(data.anchors, id);
            unplace.disabled = false;
            this.#floorplanEditor.ofJSON(data);
        }

        updateHeight();
    }
}
