const { buildSync } = require('esbuild');
const { runInNewContext } = require('node:vm');
const path = require('node:path');

const source = buildSync({
    stdin: {
        contents: `
            export { default as MsTodoPlugin } from './src/main';
            export { TodoView } from './src/ui/todo-view';
            export { MsTodoApi } from './src/api/ms-todo-api';
            export { QuickCaptureModal } from './src/ui/quick-capture-modal';
            export { buildMarkdownDocument } from './src/sync/markdown';
            export { DEFAULT_SETTINGS } from './src/settings';
        `,
        resolveDir: path.resolve(__dirname, '..'),
        loader: 'ts',
    },
    bundle: true, platform: 'node', format: 'cjs', external: ['obsidian'], write: false,
}).outputFiles[0].text;

class Element {
    constructor(options = {}) {
        this.classes = new Set((options.cls || '').split(' '));
        this.children = [];
        this.attrs = options.attr || {};
        this.listeners = {};
        this.value = '';
        this.text = options.text || '';
    }
    createEl(tag, options) {
        const child = new Element(options);
        child.tagName = tag.toUpperCase();
        this.children.push(child);
        return child;
    }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    empty() { this.children = []; }
    remove() {}
    setAttr(key, value) { this.attrs[key] = value; }
    getAttr(key) { return this.attrs[key]; }
    addClass(name) { this.classes.add(name); }
    removeClass(...names) { names.forEach(name => this.classes.delete(name)); }
    hasClass(name) { return this.classes.has(name); }
    toggleClass(name, enabled) { enabled ? this.addClass(name) : this.removeClass(name); }
    setText(value) { this.text = value; }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    emit(name, event = {}) { return this.listeners[name]?.(event); }
    focus() {}
    blur() {}
    querySelectorAll(selector) {
        return this.children.flatMap(child => [
            ...(child.hasClass(selector.slice(1)) ? [child] : []),
            ...child.querySelectorAll(selector),
        ]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
}

function deferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

const list = { id: 'list-a', displayName: 'Test list', wellknownListName: 'defaultList' };
const task = { id: 'task-a', title: 'Needle', status: 'notStarted', body: { contentType: 'text', content: 'Original note' } };

function setup() {
    const timers = new Map();
    const notices = [];
    const leaves = [];
    let nextTimer = 0;
    const network = { request: async () => { throw new Error('Unexpected request'); } };
    class Component {
        register() {}
        registerDomEvent() {}
    }
    const obsidian = {
        Plugin: class extends Component { async saveData(data) { this.saved = JSON.parse(JSON.stringify(data)); } },
        ItemView: class extends Component { constructor() { super(); this.contentEl = new Element(); } },
        Modal: class { close() { this.closed = true; } },
        PluginSettingTab: class {}, AbstractInputSuggest: class {},
        Notice: class { constructor(message) { notices.push(message); } },
        getLanguage: () => 'en', setIcon() {}, normalizePath: value => value,
        requestUrl: (...args) => network.request(...args),
    };
    const context = {
        module: { exports: {} },
        require: name => { if (name !== 'obsidian') throw new Error(name); return obsidian; },
        console: { warn() {}, error() {} },
        window: {
            setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
            clearTimeout: id => timers.delete(id),
        },
        document: { activeElement: null }, HTMLInputElement: Element,
    };
    runInNewContext(source, context);
    const exports = context.module.exports;
    const plugin = new exports.MsTodoPlugin();
    plugin.settings = { ...exports.DEFAULT_SETTINGS, accessToken: 'test-access', refreshToken: 'test-refresh', tokenExpiresAt: Date.now() + 3600000 };
    plugin.app = { workspace: { getLeavesOfType: () => leaves } };
    const view = new exports.TodoView({}, plugin);
    leaves.push({ view });
    view.currentLists = [list];
    view.selectedListId = list.id;
    view.currentTasks = [structuredClone(task)];
    view.taskCache.set(list.id, { tasks: view.currentTasks, allLoaded: true, updatedAt: 0 });
    view.mainListArea = new Element();
    view.mainDetail = new Element();
    const api = new exports.MsTodoApi(plugin);
    return { ...exports, plugin, view, api, timers, notices, network };
}

module.exports = { setup, deferred, Element, list, task };
