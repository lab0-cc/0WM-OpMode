// This module provides the different map data sources available

const OSM = {
    name: 'OpenStreetMap',
    layer: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}

const CARTODB = {
    name: 'CartoDB',
    layer: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
    attribution: '© <a href="http://cartodb.com/attributions">CartoDB</a>',
}

const IGN = {
    name: 'IGN',
    layer: 'https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&format=image/png&style=normal',
    attribution: '© IGN-F / Géoportail',
}

const IGNSAT = {
    name: 'IGN Satellite',
    layer: 'https://data.geopf.fr/wmts?service=WMTS&request=GetTile&version=1.0.0&tilematrixset=PM&tilematrix={z}&tilecol={x}&tilerow={y}&layer=ORTHOIMAGERY.ORTHOPHOTOS&format=image/jpeg&style=normal',
    attribution: '© IGN-F / Géoportail',
}

export const LAYERS = { osm: OSM, cartodb: CARTODB, ign: IGN, ignsat: IGNSAT }
