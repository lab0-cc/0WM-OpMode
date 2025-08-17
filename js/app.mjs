// This module provides the OpMode application entrypoint. Nothing here is supposed to be exported.

import { createElement } from '/js/util.mjs';


let modal = null;
let app = null;
let floorplanContainer = null;
let floorplanEditor = null;
let floorplanViewer = null;
let worldMap = null;
let b64Data = null;
let progress = null;
let submitBtn = null;
let nameInput = null;
const TABS = { edit: 'Floorplan Editor', map: 'Map Editor', misc: 'Additional Parameters' };
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


// Delete the application and open the intro modal
function deleteApp() {
    app.remove();
    openModal();
}


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
            deleteApp();
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
  const field = createElement('span', 'field');
  const label = createElement('label', null, { for_: id }, description);
  field.appendChild(label);
  const input = createElement('input', null, { type: "number", id, step: .25, min: 0,
                                               required: 'required' });
  field.appendChild(input);
  const suffixSpan = createElement('span', 'suffix', null, suffix);
  field.appendChild(suffixSpan);
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
    app = createElement('div', 'app');
    document.body.appendChild(app);
    const tabContainer = createElement('tab-container');
    app.appendChild(tabContainer);
    progress = createElement('div', 'progress');
    app.appendChild(progress);
    app.appendChild(createElement('div', 'pane mask'));

    const panes = {};
    for (const [target, title] of Object.entries(TABS)) {
        const pane = createElement('div', 'pane', { id: target });
        panes[target] = pane;
        app.appendChild(pane);
        tabContainer.appendChild(createElement('div', 'tab', { dataTarget: target }, title));
    }

    const cancelBtn = createElement('button', 'right', null, 'Cancel');
    cancelBtn.addEventListener('click', deleteApp);
    tabContainer.appendChild(cancelBtn);
    submitBtn = createElement('button', 'right submit', { disabled: 'disabled' }, 'Submit');
    submitBtn.addEventListener('click', submit);
    tabContainer.appendChild(submitBtn);
    nameInput = createElement('input', 'right', { placeholder: 'Project name', type: 'text',
                                                  required: 'required' });
    nameInput.addEventListener('input', () => {
        nameInput.dispatchEvent(new Event('statuschange', { bubbles: true }));
    });
    tabContainer.appendChild(nameInput);
    floorplanEditor = createElement('floorplan-editor', null, { status: 1 });
    panes['edit'].appendChild(floorplanEditor);

    const mapPanel = createElement('div', 'left-panel');
    floorplanContainer = createElement('floorplan-container', null, { status: 1 });
    mapPanel.appendChild(floorplanContainer);
    mapPanel.appendChild(createElement('button', 'next', { id: 'place' }, 'Place in current view'));
    mapPanel.appendChild(createElement('button', 'previous',
                                       { id: 'unplace', disabled: 'disabled' },
                                       'Remove from the map'));
    panes['map'].appendChild(mapPanel);
    worldMap = createElement('world-map');
    panes['map'].appendChild(worldMap);

    const miscPanel = createElement('div', 'top-panel');
    miscPanel.appendChild(createField('zmin', 'Floor altitude', 'm'));
    miscPanel.appendChild(createField('zmax', 'Ceiling altitude', 'm'));
    miscPanel.appendChild(createField('height', 'Height', 'm'));
    panes['misc'].appendChild(miscPanel);
    floorplanViewer = createElement('floorplan-viewer');
    panes['misc'].appendChild(floorplanViewer);
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
    floorplanContainer.setAttribute('src', url);
    floorplanEditor.setAttribute('src', url);
    floorplanViewer.setAttribute('src', url);
    modal.remove();
    document.body.classList.remove('modal-open');
}


// Open the intro modal
function openModal() {
    createApp();
    modal = createElement('div', 'modal');
    modal.appendChild(createElement('div', 'title', null, 'Project selection'));
    const content = createElement('div', 'content center');
    const input = createElement('input', null, { id: 'floorplan-input', type: 'file', accept: ALLOWED_MIME.join() });
    const newProject = createElement('label', null, { for_: 'floorplan-input' }, 'Create a new project');
    content.appendChild(input);
    content.appendChild(newProject);
    input.addEventListener('change', loadFloorplan);
    content.appendChild(document.createTextNode(' or '));
    content.appendChild(createElement('button', null, { disabled: "" }, 'Open an existing project'));
    modal.appendChild(content);
    document.body.appendChild(modal);
    document.body.classList.add('modal-open');
}

fetch('/config.json').then(r => r.json().then(data => {
    window.apiURL = data.api;
    openModal();
}));
