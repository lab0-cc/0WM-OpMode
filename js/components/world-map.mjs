// This module implements a map viewer allowing to position floor plans

import { LAYERS } from '/js/components/datasources.mjs';
import { Matrix2, Point2, Vector2 } from '/js/linalg.mjs';
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

        const mapRect = this.#map.getBounds();
        const boxNE = new Point2(mapRect.getEast(), mapRect.getNorth());
        const boxSW = new Point2(mapRect.getWest(), mapRect.getSouth());
        const mapWidth = boxNE.x - boxSW.x;
        const mapHeight = boxNE.y - boxSW.y;
        if (mapWidth > mapHeight) {
            const halfDelta = (mapWidth - mapHeight) / 2;
            boxNE.x -= halfDelta;
            boxSW.x += halfDelta;
        }
        else {
            const halfDelta = (mapHeight - mapWidth) / 2;
            boxNE.y -= halfDelta;
            boxSW.y += halfDelta;
        }

        const boxWidth = boxNE.x - boxSW.x;
        const boxHeight = boxNE.y - boxSW.y;
        const floorplanRect = document.floorplanContainer.getBox();
        const floorplanAnchors = document.floorplanContainer.getAnchors();
        for (let i = 0; i < 3; i++) {
            this.#anchors[i].setLatLng({
                lng: boxSW.x + .05 * boxWidth + .9 * floorplanAnchors[i].x * boxWidth / floorplanRect.width,
                lat: boxNE.y - .05 * boxHeight - .9 * floorplanAnchors[i].y * boxHeight / floorplanRect.height
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
