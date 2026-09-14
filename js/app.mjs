// This module provides the OpMode application entrypoint. Nothing here is supposed to be exported.

import { createElement as E } from '/js/util.mjs';


let app = null;
let floorplanContainer = null;
let floorplanEditor = null;
let floorplanViewer = null;
let worldMap = null;
let b64Data = null;
let progress = null;
let submitBtn = null;
let nameInput = null;
let tabContainer = null;
const panes = {};
const EDITION_TABS = { edit: 'Floorplan Editor', map: 'Map Editor', misc: 'Additional Parameters' };
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/web'];


// Import component modules
function loadComponent(name) {
    import(`/js/components/${name}.mjs`);
}

loadComponent('floorplan-container');
loadComponent('world-map');
loadComponent('floorplan-editor');
loadComponent('floorplan-viewer');
loadComponent('tab-container');


// Submit the floorplan data
function submit() {
    submitBtn.disabled = true;
    document.body.classList.add('sending');
    const anchors = [];
    const localAnchors = floorplanContainer.toJSON();
    const globalAnchors = worldMap.toJSON();
    for (let i = 0; i < localAnchors.length; i++) {
        const { x, y } = localAnchors[i];
        const { lng, lat } = globalAnchors[i];
        anchors.push({ x: x, y: y, lng: lng, lat: lat });
    }

    const payload = floorplanEditor.toJSON();
    payload.anchors = anchors;
    payload.floorplan.data = b64Data;
    payload.name = nameInput.value;
    payload.zmin = parseFloat(document.getElementById('zmin').value);
    payload.zmax = parseFloat(document.getElementById('zmax').value);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${window.apiURL}/maps`);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.upload.addEventListener('progress', e => progress.style.width = `${100 * e.loaded / e.total}%`);
    xhr.addEventListener('load', () => {
        resetProgress();
        if (xhr.status >= 200 && xhr.status < 300) {
            defaultView();
        }
        else {
            alert('An error occurred');
        }
    });

    xhr.addEventListener('error', () => {
        resetProgress();
        alert('An error occurred');
    });

    xhr.send(JSON.stringify(payload));
}


// Reset the sending state
function resetProgress() {
    document.body.classList.remove('sending');
    progress.style.removeProperty('width');
    submitBtn.disabled = false;
}

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

// Create the application
function createApp() {
    app = document.body.appendElement({ tag: 'div', className: 'app' });
    [tabContainer, progress,] = app.appendElements(
        'tab-container',
        { tag: 'div', className: 'progress' },
        { tag: 'div', className: 'pane mask' }
    );
    worldMap = app.appendElement('world-map');
    defaultView();
}

// Clear the app’s transient data
function resetApp() {
    worldMap.classList.remove('editing');
    worldMap.resetOverlay?.();
    tabContainer.clearTabs?.();
    for (const [name, pane] of Object.entries(panes)) {
        pane.remove();
        delete panes[name]
    }
}

// Switch to default view
function defaultView(url) {
    resetApp();
    const [input,] = tabContainer.appendElements(
        { tag: 'input', attributes: { id: 'floorplan-input', type: 'file', accept: ALLOWED_MIME.join() } },
        { tag: 'label', attributes: { for_: 'floorplan-input' }, content: 'New floorplan' }
    );
    input.addEventListener('change', loadFloorplan);
}

// Switch to edition view
function editionView(url) {
    resetApp();
    worldMap.classList.add('editing');
    for (const [target, title] of Object.entries(EDITION_TABS)) {
        const pane = app.appendElement({ tag: 'div', className: 'pane', attributes: { id: target } });
        panes[target] = pane;
        tabContainer.appendChild(E('div', 'tab', { dataTarget: target }, title));
    }

    const cancelBtn = E('button', 'right', null, 'Cancel');
    cancelBtn.addEventListener('click', defaultView);
    tabContainer.appendChild(cancelBtn);
    submitBtn = E('button', 'right submit', { disabled: 'disabled' }, 'Submit');
    submitBtn.addEventListener('click', submit);
    tabContainer.appendChild(submitBtn);
    nameInput = E('input', 'right', { placeholder: 'Project name', type: 'text', required: 'required' });
    nameInput.addEventListener('input', () => {
        nameInput.dispatchEvent(new Event('statuschange', { bubbles: true }));
    });
    tabContainer.appendChild(nameInput);

    floorplanEditor = E('floorplan-editor', null, { src: url, status: 1 });
    panes['edit'].appendChild(floorplanEditor);

    const mapPanel = panes['map'].appendElement({ tag: 'div', className: 'left-panel' });
    let place, unplace;
    [floorplanContainer, place, unplace] = mapPanel.appendElements(
        { tag: 'floorplan-container', attributes: { src: url, status: 1 } },
        { tag: 'button', className: 'next', attributes: { id: 'place' }, content: 'Place in current view' },
        { tag: 'button', className: 'previous', attributes: { id: 'unplace', disabled: 'disabled' }, content: 'Remove from the map' }
    );

    place.addEventListener('click', () => {
        floorplanContainer.setAttribute('status', 0);
        worldMap.placeFloorplan();
        unplace.disabled = false;
    });
    unplace.addEventListener('click', () => {
        floorplanContainer.setAttribute('status', 1);
        worldMap.unplaceFloorplan();
        unplace.disabled = true;
    });

    const miscPanel = panes['misc'].appendElement({ tag: 'div', className: 'top-panel' });
    miscPanel.appendChild(createField('zmin', 'Floor altitude', 'm'));
    miscPanel.appendChild(createField('zmax', 'Ceiling altitude', 'm'));
    miscPanel.appendChild(createField('height', 'Height', 'm'));
    floorplanViewer = panes['misc'].appendElement({ tag: 'floorplan-viewer', attributes: { src: url } });
    const zmin = document.getElementById('zmin');
    const zmax = document.getElementById('zmax');
    const height = document.getElementById('height');

    function updateStatus() {
        floorplanViewer.setAttribute('status', Math.max(getStatus(zmin), getStatus(zmax),
                                                        getStatus(height)));
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

    updateHeight();
}


// Load a floorplan. The application only supports JPEG, PNG and WebP images.
function loadFloorplan(e) {
    const file = e.target.files[0];
    if (!ALLOWED_MIME.includes(file.type)) {
        alert('Invalid file. Please select a supported image type (JPEG, PNG or WebP).')
        return;
    }

    const reader = new FileReader();
    reader.addEventListener('load', () => b64Data = reader.result);
    reader.readAsDataURL(file);
    const url = URL.createObjectURL(file);
    editionView(url);
}


fetch('/config.json').then(r => r.json().then(data => {
    window.apiURL = data.api;
    createApp();
}));
