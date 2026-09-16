// This module implements a map viewer allowing to position floor plans

import { LAYERS } from '/js/components/datasources.mjs';
import { BoundingBox2, Matrix2, Point2, Vector2 } from '/js/linalg.mjs';
import { Stylable } from '/js/mixins.mjs';
import { createElement as E } from '/js/util.mjs';
import '/js/leaflet.js';
import '/js/leaflet.imageoverlay.rotated.js';

const AVERAGE_EARTH_RADIUS = 6_371_008.771

// Compute a degree cosinus
function dcos(a) {
    return Math.cos(a * Math.PI / 180);
}

// Compute the Haversine distance between two points
function hav(p1, p2) {
    return Math.asin(Math.sqrt ((1 - dcos(p2.lat - p1.lat) + dcos(p1.lat) * dcos(p2.lat) *
                                 (1 - dcos(p2.lng - p1.lng))) / 2)) * 2 * AVERAGE_EARTH_RADIUS;
}

class WorldMap extends Stylable(HTMLElement) {
    #anchors;
    #currentLayer;
    #map;
    #overlay;
    #overlays;
    #ready;
    #scale;

    constructor() {
        super();

        this.ready = new Promise(resolve => {
            this.#ready = resolve;
        });

        this.addStylesheet('components/world-map.css');
        this.addStylesheet('leaflet.css');
        this.addStylesheet('style.css');

        const mapDiv = this.appendToShadow(E('div'));
        this.#map = L.map(mapDiv);
        L.control.scale().addTo(this.#map);
        this.#map.createPane('floorplans');
        this.#map.on('zoomend', this.#zoom.bind(this));

        this.#currentLayer = L.tileLayer(LAYERS.osm.layer, {
            minZoom: 0,
            maxZoom: 20,
            tileSize: 256,
            attribution: LAYERS.osm.attribution,
            maxNativeZoom: LAYERS.osm.maxZoom
        });
        this.#currentLayer.addTo(this.#map);

        const layers = E('select');
        for (const layer in LAYERS)
            layers.appendElement({ tag: 'option', attributes: { value: layer }, content: LAYERS[layer].name });
        this.appendToShadow(layers);
        layers.addEventListener('change', e => {
            this.#map.removeLayer(this.#currentLayer);
            const layer = LAYERS[e.target.value];
            this.#currentLayer = L.tileLayer(layer.layer, {
                minZoom: 0,
                maxZoom: 20,
                tileSize: 256,
                attribution: layer.attribution,
                maxNativeZoom: layer.maxZoom
            });
            this.#currentLayer.addTo(this.#map);
        });

        this.#anchors = null;
        this.#scale = null;

        this.#overlay = null;
        new ResizeObserver(() => this.#map.invalidateSize()).observe(mapDiv);
        this.resetView();
    }

    connectedCallback() {
        document.worldMap = this;
        this.#ready();
    }

    // Initialize the anchors on the map
    #initAnchors(anchors) {
        this.#anchors = [];
        for (let i = 0; i < 3; i++) {
            const ll = anchors === null ? { lng: 0, lat: 0 } : anchors[i];
            const anchor = L.marker(ll, {
                draggable: true,
                icon: L.divIcon({ className: 'anchor', iconSize: [24, 24], iconAnchor: [12, 12] })
            }).addTo(this.#map);
            anchor.on('drag', () =>
              this.updateOverlay(document.floorplanContainer.getAnchors(),
                                 document.floorplanContainer.getDimensions(),
                                 document.floorplanContainer.getAttribute('src')));
            this.#anchors.push(anchor);
        }
    }

    // Reset the map overlay
    resetOverlay() {
        this.unplaceFloorplan();
        this.#map.eachLayer(layer => {
            if (layer instanceof L.ImageOverlay) {
                this.#map.removeLayer(layer);
            }
        });
        this.#overlays = new Map();
        return fetch(`${window.apiURL}/maps`).then(response => {
            if (!response.ok)
                throw new Error(`Failed to load maps (${response.status})`);
            return response.json();
        }).then(ids => Promise.all(ids.map(id => {
            return fetch(`${window.apiURL}/maps/${id}`).then(response => {
                if (!response.ok)
                    throw new Error(`Failed to load map ${id} (${response.status})`);
                return response.json();
            }).then(data => {
                const srcAnchors = [];
                const dstAnchors = [];
                for (const anchor of data.anchors) {
                    srcAnchors.push(new Point2(anchor.x, anchor.y));
                    dstAnchors.push(new Point2(anchor.lng, anchor.lat));
                }
                const srcRect = new Point2(data.width, data.height);
                this.updateOverlay(srcAnchors, srcRect, `${window.apiURL}/${data.path}`, dstAnchors);
                this.#overlays.set(id, this.#overlay);
                const el = this.#overlay.getElement();
                const optionsDiv = el.appendElement({ tag: 'div', className: 'options' });
                optionsDiv.appendElement({ tag: 'div', className: 'name', content: data.name });
                const [editDiv, deleteDiv] = optionsDiv.appendElements(
                    { tag: 'div', className: 'edit', attributes: { title: "Edit" } },
                    { tag: 'div', className: 'delete', attributes: { title: "Delete" } }
                );
                editDiv.addEventListener('click', () => {
                    window.app.editionView(`${window.apiURL}/${data.path}`, id, data);
                });
                deleteDiv.addEventListener('click', () => {
                    fetch(`${window.apiURL}/maps/${id}`, { method: 'DELETE' }).then(response => {
                        if (!response.ok)
                            throw new Error(`Failed to delete map ${id} (${response.status})`);
                        this.resetOverlay();
                    });
                })
                this.#overlay = null;
            }).catch(err => {
                alert(err);
            });
        }))).catch(err => {
            alert(err);
        });
    }

    // Reset the view and overlay
    resetView() {
        fetch(`${window.apiURL}/maps/box`).then(response => {
            if (!response.ok)
                throw new Error(`Failed to load maps bounding box (${response.status})`);
            return response.json();
        }).then(data => {
            // Show Brest, FR, by default
            if (data == null)
                this.#map.setView([48.383313, -4.497187], 14);
            else
                this.#map.fitBounds([[data.sw.lat, data.sw.lng], [data.ne.lat, data.ne.lng]], { paddingTopLeft: [200, 256], paddingBottomRight: [200, 200] });
            this.#zoom();
        });
    }

    // Place the floorplan on the map
    placeFloorplan(anchors = null, id = null) {
        if (this.#anchors === null)
            this.#initAnchors(anchors);

        if (anchors !== null) {
            this.#overlay = this.#overlays.get(id);
            return;
        }

        const rect = this.getBoundingClientRect();
        const paddingX = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--left-panel-width')) + 8;
        const paddingY = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--top-bar-height')) + 8;
        const sw = this.#map.containerPointToLatLng(L.point(paddingX, rect.bottom));
        const ne = this.#map.containerPointToLatLng(L.point(rect.right, paddingY));
        const box = new BoundingBox2(new Point2(sw.lng, sw.lat), new Point2(ne.lng, ne.lat));
        const width = rect.width - paddingX;

        // Here, we want to make it so that our box is a square in the user viewport. WGS84 can be a
        // bit tricky, as the box/viewport mapping is not constant across latitudes, so we have to
        // take that into account. We also downscale the viewport by 10%, to display a margin.
        let halfDeltaX, halfDeltaY;
        if (width > rect.height) {
            halfDeltaX = box.width() * (.05 + .45 * (width - rect.height) / width);
            halfDeltaY = .05 * box.height();
        }
        else {
            halfDeltaX = .05 * box.width();
            halfDeltaY = box.height() * (.05 + .45 * (rect.height - width) / rect.height);
        }
        box.max.x -= halfDeltaX;
        box.min.x += halfDeltaX;
        box.max.y -= halfDeltaY;
        box.min.y += halfDeltaY;

        // Now that we have a square, we want to crop it so that the box has the same aspect ratio
        // as the floorplan in the user viewport
        const fpRect = document.floorplanContainer.getDimensions();
        if (fpRect.x > fpRect.y) {
            const halfDelta = box.height() * (fpRect.x - fpRect.y) / fpRect.x / 2;
            box.max.y -= halfDelta;
            box.min.y += halfDelta;
        }
        else {
            const halfDelta = box.width() * (fpRect.y - fpRect.x) / fpRect.y / 2;
            box.max.x -= halfDelta;
            box.min.x += halfDelta;
        }

        // We can now properly interpolate the anchors
        const floorplanAnchors = document.floorplanContainer.getAnchors();
        for (let i = 0; i < 3; i++) {
            this.#anchors[i].setLatLng({
                lng: box.min.x + floorplanAnchors[i].x * box.width() / fpRect.x,
                lat: box.max.y - floorplanAnchors[i].y * box.height() / fpRect.y
            });
        }
        this.updateOverlay(floorplanAnchors, fpRect,
                           document.floorplanContainer.getAttribute('src'));
    }

    // Unplace the floorplan from the map
    unplaceFloorplan() {
        this.#overlay?.remove();
        this.#overlay = null;
        this.#anchors?.forEach(e => e.remove());
        this.#anchors = null;
    }

    #getDstAnchors() {
        const dstAnchors = [];
        for (const anchor of this.#anchors ?? []) {
            const { lat, lng } = anchor.getLatLng();
            dstAnchors.push(new Point2(lng, lat));
        }
        return dstAnchors;
    }

    // Update the overlay with the proper viewport and transformation
    updateOverlay(srcAnchors, srcRect, url, dstAnchors = null) {
        this.#scale = null;
        const anchors = dstAnchors ?? this.#getDstAnchors();
        if (anchors.length !== 3)
            return;

        const transformation = this.#computeTransformation(srcAnchors, anchors);
        if (transformation === null) {
            return;
        }
        const corners = [
            new Point2(0, 0),
            new Point2(srcRect.x, 0),
            new Point2(0, srcRect.y),
        ].map(p => {
            const { x, y } = transformation[0].appliedTo(p).plus(transformation[1]);
            return L.latLng(y, x);
        });

        if (dstAnchors === null)
            this.#scale = new Vector2(srcRect.x, srcRect.y).norm() / hav(corners[1], corners[2]);

        if (this.#overlay === null)
            this.#overlay = L.imageOverlay.rotated(url, ...corners, { interactive: true, opacity: dstAnchors === null ? .7 : .8, pane: 'floorplans' }).addTo(this.#map);
        else
            this.#overlay.reposition(...corners);
    }

    // Compute the transformation matrix
    #computeTransformation(src, dst) {
        const srcV1 = src[0].to(src[1]);
        const srcV2 = src[0].to(src[2]);
        const dstV1 = dst[0].to(dst[1]);
        const dstV2 = dst[0].to(dst[2]);
        const det = srcV1.cross(srcV2);

        // Return early if the anchors are colinear
        if (Math.abs(det) < 1e-12) {
            return null;
        }

        const a = (dstV1.x * srcV2.y - dstV2.x * srcV1.y) / det;
        const c = (dstV1.y * srcV2.y - dstV2.y * srcV1.y) / det;
        const b = (-dstV1.x * srcV2.x + dstV2.x * srcV1.x) / det;
        const d = (-dstV1.y * srcV2.x + dstV2.y * srcV1.x) / det;
        const dx = dst[0].x - a * src[0].x - b * src[0].y;
        const dy = dst[0].y - c * src[0].x - d * src[0].y;
        return [new Matrix2(a, b, c, d), new Vector2(dx, dy)];
    }

    // Get an approximate pixel/meter scale
    getScale() {
        return this.#scale;
    }

    // Handle zoom events
    #zoom() {
        this.#map.getPane('floorplans').classList.toggle('non-interactive', this.#map.getZoom() < 16);
    }

    // Return serialized data
    toJSON() {
        return this.#anchors.map(e => e.getLatLng());
    }

    // Ingest serialized data
    ofJSON(anchors) {
        this.#anchors.forEach((e, i) => e.setLatLng(anchors[i]));
    }
}


try {
    customElements.define('world-map', WorldMap);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}
