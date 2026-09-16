'use strict';

(function() {
    function loadComponent(name) {
        import(`/js/components/${name}.mjs`);
    }

    loadComponent('floorplan-container');
    loadComponent('floorplan-editor');
    loadComponent('floorplan-viewer');
    loadComponent('tab-container');
    loadComponent('world-map');
})();
