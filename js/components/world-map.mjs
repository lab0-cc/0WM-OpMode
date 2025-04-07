// This module implements a map viewer allowing to position floor plans

import { LAYERS } from '/js/components/datasources.mjs';
import { BoundingBox2, Matrix2, Point2, Vector2 } from '/js/linalg.mjs';
import { Stylable } from '/js/mixins.mjs';
import { createElement } from '/js/util.mjs';
import '/js/leaflet.js';
import '/js/leaflet.imageoverlay.rotated.js';


class WorldMap extends Stylable(HTMLElement) {
    #anchors;
    #currentLayer;
    #map;
    #overlay;

    constructor() {
        super();

        this.addStylesheet('components/world-map.css');
        this.addStylesheet('leaflet.css');
        this.addStylesheet('style.css');

        const mapDiv = createElement('div');
        this.appendToShadow(mapDiv);
        this.#map = L.map(mapDiv, { center: [48.383313, -4.497187], zoom: 14 });

        this.#currentLayer = L.tileLayer(LAYERS.osm.layer, {
            minZoom: 0,
            maxZoom: 19,
            tileSize: 256,
            attribution: LAYERS.osm.attribution
        });
        this.#currentLayer.addTo(this.#map);

        const layers = createElement('select');
        for (const layer in LAYERS)
            layers.appendChild(createElement('option', null, { value: layer }, LAYERS[layer].name));
        this.appendToShadow(layers);
        layers.addEventListener('change', e => {
            this.#map.removeLayer(this.#currentLayer);
            const layer = LAYERS[e.target.value];
            this.#currentLayer = L.tileLayer(layer.layer, {
                minZoom: 0,
                maxZoom: 19,
                tileSize: 256,
                attribution: layer.attribution
            });
            this.#currentLayer.addTo(this.#map);
        });

        this.#anchors = null;

        this.#overlay = null;
        new ResizeObserver(() => this.#map.invalidateSize()).observe(mapDiv);
        document.getElementById('place').addEventListener('click', this.#placeFloorplan.bind(this));
        document.worldMap = this;
    }

    #initAnchors() {
        this.#anchors = [];
        for (let i = 0; i < 3; i++) {
            const anchor = L.marker({ lng: 0, lat: 0 }, {
                draggable: true,
                icon: L.divIcon({ className: 'anchor', iconSize: [24, 24], iconAnchor: [12, 12] })
            }).addTo(this.#map);
            anchor.on('drag', this.updateOverlay.bind(this));
            this.#anchors.push(anchor);
        }
    }

    #placeFloorplan() {
        if (this.#anchors === null)
            this.#initAnchors();

        const rect = this.getBoundingClientRect();
        const mapRect = this.#map.getBounds();
        const box = new BoundingBox2(new Point2(mapRect.getWest(), mapRect.getSouth()),
                                     new Point2(mapRect.getEast(), mapRect.getNorth()));

        // Here, we want to make it so that our box is a square in the user viewport. WGS84 can be a
        // bit tricky, as the box/viewport mapping is not constant across latitudes, so we have to
        // take that into account. We also downscale the viewport by 10%, to display a margin.
        let halfDeltaX, halfDeltaY;
        if (rect.width > rect.height) {
            halfDeltaX = box.width() * (.05 + .45 * (rect.width - rect.height) / rect.width);
            halfDeltaY = .05 * box.height();
        }
        else {
            halfDeltaX = .05 * box.width();
            halfDeltaY = box.height() * (.05 + .45 * (rect.height - rect.width) / rect.height);
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
        this.updateOverlay();
    }

    updateOverlay() {
        if (this.#anchors === null)
            return;

        const src = document.floorplanContainer.getAnchors();
        const dst = [];
        for (let i=0; i<3; i++) {
            const { lat, lng } = this.#anchors[i].getLatLng();
            dst.push(new Point2(lng, lat));
        }

        const transformation = this.#computeTransformation(src, dst);
        if (transformation === null) {
            return;
        }
        const rect = document.floorplanContainer.getBox();
        const corners = [
            new Point2(0, 0),
            new Point2(rect.width, 0),
            new Point2(0, rect.height),
        ].map(p => {
            const { x, y } = transformation[0].appliedTo(p).plus(transformation[1]);
            return L.latLng(y, x);
        });

        if (this.#overlay === null) {
            this.#overlay = L.imageOverlay.rotated(
                document.floorplanContainer.getAttribute('src'), ...corners, { opacity: .7 }
            ).addTo(this.#map);
        }
        else {
            this.#overlay.reposition(...corners);
        }
    }

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
}


try {
    customElements.define('world-map', WorldMap);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}
