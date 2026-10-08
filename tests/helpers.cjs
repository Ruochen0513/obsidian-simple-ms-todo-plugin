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
            export { readSettings } from './src/settings';
            export { AuthSession, TOKEN_SECRET_ID } from './src/auth/session';
            export { t, setLocale, getLocale, formatTimestamp } from './src/i18n';
            export { en } from './src/i18n/locales/en';
            export { zhCn } from './src/i18n/locales/zh-cn';
            export { formatDisplayDate, formatShortDate } from './src/utils/task-dates';
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

function setup(options = {}) {
    const timers = new Map();
    const notices = [];
    const leaves = [];
    const secrets = new Map();
    const storage = {
        getSecret: id => secrets.get(id) || null,
        setSecret: (id, value) => { secrets.set(id, value); },
    };
    const host = { language: options.language || 'en' };
    let nextTimer = 0;
    const network = { request: async () => { throw new Error('Unexpected request'); } };
    class Component {
        register() {}
        registerDomEvent() {}
    }
    const obsidian = {
        Plugin: class extends Component {
            commands = new Map();
            async loadData() { return options.data || {}; }
            async saveData(data) { this.saved = JSON.parse(JSON.stringify(data)); }
            addCommand(command) { this.commands.set(command.id, command); return command; }
            removeCommand(id) { this.commands.delete(id); }
        },
        ItemView: class extends Component { constructor() { super(); this.contentEl = new Element(); } },
        Modal: class { close() { this.closed = true; } },
        PluginSettingTab: class {}, AbstractInputSuggest: class {},
        Notice: class { constructor(message) { notices.push(message); } },
        getLanguage: () => host.language, setIcon() {}, normalizePath: value => value,
        requestUrl: (...args) => network.request(...args),
    };
    const context = {
        module: { exports: {} },
        require: name => { if (name !== 'obsidian') throw new Error(name); return obsidian; },
        console: { warn() {}, error() {} },
        window: {
            open() {},
            setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
            clearTimeout: id => timers.delete(id),
        },
        document: { activeElement: null }, HTMLInputElement: Element,
    };
    runInNewContext(source, context);
    const exports = context.module.exports;
    const plugin = new exports.MsTodoPlugin();
    plugin.settings = { ...exports.DEFAULT_SETTINGS };
    plugin.app = { workspace: { getLeavesOfType: () => leaves }, secretStorage: storage };
    plugin.session = new exports.AuthSession(storage);
    if (options.signedIn !== false) plugin.session.restore('test-refresh');
    plugin.session.oauth.generateCodeVerifier = () => 'test-verifier';
    plugin.session.oauth.getAuthUrl = async () => 'https://example.test/login';
    plugin.session.oauth.refreshAccessToken = async () => ({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 });
    const view = new exports.TodoView({}, plugin);
    leaves.push({ view });
    view.currentLists = [list];
    view.selectedListId = list.id;
    view.currentTasks = [structuredClone(task)];
    view.taskCache.set(list.id, { tasks: view.currentTasks, allLoaded: true, updatedAt: 0 });
    view.mainListArea = new Element();
    view.mainDetail = new Element();
    const api = new exports.MsTodoApi(plugin);
    return { ...exports, plugin, view, api, timers, notices, network, secrets, storage, host };
}

module.exports = { setup, deferred, Element, list, task };
