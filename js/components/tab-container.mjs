// This module implements a tab container

import { DynamicShadow, Stylable } from '/js/mixins.mjs';


class TabContainer extends DynamicShadow(Stylable(HTMLElement)) {
    #currentTab;
    #tabs;
    #inputs;
    #submitBtn;

    constructor() {
        super();
        this.addStylesheet('style.css');
        this.addStylesheet('components/tab-container.css');
        this.#currentTab = null;
        this.#tabs = [];
        this.#inputs = [];
        this.addHandler(e => {
            if (e.classList.contains('tab')) {
                e.addEventListener('click', () => this.selectTab(e));
                if (this.#currentTab === null)
                    this.selectTab(e);
                e.ok = true;
                this.#tabs.push(e);
                this.#refreshTabState(e, document.getElementById(e.dataset.target));
            }
            else if (e.classList.contains('submit')) {
                this.#submitBtn = e;
            }
            else if (e instanceof HTMLInputElement) {
                this.#inputs.push(e);
            }
        });

        document.addEventListener('statuschange', e => this.#refreshPaneState(e.target));
        this.shadowRoot.addEventListener('statuschange', this.#refreshContainerState.bind(this));
    }

    // Select the given tab
    selectTab(e) {
        if (this.#currentTab !== null) {
            this.#currentTab.classList.remove('selected');
            document.getElementById(this.#currentTab.dataset.target).style.removeProperty('visibility');
        }
        this.#currentTab = e;
        this.#currentTab.classList.add('selected');
        const target = document.getElementById(this.#currentTab.dataset.target);
        target.style.visibility = 'visible';
        [...target.children].forEach(e => e.refresh?.());
    }

    // Explore a pane and update the tab state
    #refreshPaneState(e) {
        let refreshedTab = null;
        let pane = null;
        for (const tab of this.#tabs) {
            const node = document.getElementById(tab.dataset.target);
            if (node.contains(e)) {
                refreshedTab = tab;
                pane = node;
                break;
            }
        }

        this.#refreshTabState(refreshedTab, pane);
    }

    // Update the tab state given its pane
    #refreshTabState(tab, pane) {
        if (tab !== null && pane !== null) {
            tab.classList.remove('warning', 'error');
            switch (Math.max(...[...pane.querySelectorAll('*')].map(e => e.getStatus?.() ?? 0))) {
                case 1:
                    tab.classList.add('warning');
                    tab.ok = false;
                    break;
                case 2:
                    tab.classList.add('error');
                    tab.ok = false;
                    break;
                default:
                    tab.ok = true;
            }
        }

        this.#refreshContainerState();
    }

    #refreshContainerState() {
        if (this.#tabs.every(e => e.ok) && this.#inputs.every(e => e.checkValidity()))
            this.#submitBtn?.removeAttribute('disabled');
        else
            this.#submitBtn?.setAttribute('disabled', 'disabled');
    }
}


try {
    customElements.define('tab-container', TabContainer);
}
catch (e) {
  if (!(e instanceof DOMException))
    throw e;
}
