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
            export { openQuickCapture } from './src/commands';
            export { attachDatePicker } from './src/ui/date-picker';
            export { buildMarkdownDocument } from './src/sync/markdown';
            export { DEFAULT_SETTINGS } from './src/settings';
            export { readSettings } from './src/settings';
            export { AuthSession, TOKEN_SECRET_ID } from './src/auth/session';
            export { t, setLocale, getLocale, formatTimestamp } from './src/i18n';
            export { en } from './src/i18n/locales/en';
            export { zhCn } from './src/i18n/locales/zh-cn';
            export { getPlannedDate, isPlannedTask, groupPlannedTasks } from './src/utils/planned-tasks';
            export { formatDisplayDate, formatShortDate } from './src/utils/task-dates';
        `,
        resolveDir: path.resolve(__dirname, '..'),
        loader: 'ts',
    },
    bundle: true, platform: 'node', mainFields: ['module', 'main'], format: 'cjs',
    external: ['obsidian', 'flatpickr', 'flatpickr/dist/l10n/zh'], write: false,
}).outputFiles[0].text;

class Element {
    constructor(options = {}) {
        this.classes = new Set((options.cls || '').split(' '));
        this.children = [];
        this.attrs = options.attr || {};
        this.listeners = {};
        this.value = '';
        this.text = options.text || '';
        this.ownerDocument = { body: {} };
        this.scrollTop = 0;
        this.style = {};
        this.animations = [];
    }
    createEl(tag, options) {
        const child = new Element(options);
        child.tagName = tag.toUpperCase();
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    createDiv(options) { return this.createEl('div', options); }
    createSpan(options) { return this.createEl('span', options); }
    empty() { this.children.forEach(child => { child.detached = true; }); this.children = []; }
    remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
    appendChild(child) { return this.insertBefore(child, null); }
    insertBefore(child, before) {
        child.remove();
        const index = before ? this.children.indexOf(before) : this.children.length;
        this.children.splice(index, 0, child);
        child.parentElement = this;
        child.detached = false;
        return child;
    }
    select() {}
    scrollIntoView() {}
    get offsetTop() { return (this.parentElement?.children.indexOf(this) || 0) * 40; }
    get offsetHeight() { return 40; }
    get nextElementSibling() { return this.parentElement?.children[this.parentElement.children.indexOf(this) + 1] || null; }
    animate(frames, options) { const animation = { frames, options, cancel() { this.cancelled = true; } }; this.animations.push(animation); return animation; }
    get isConnected() { return !this.detached && (this.parentElement?.isConnected ?? true); }
    setPointerCapture(id) { this.pointerId = id; }
    hasPointerCapture(id) { return this.pointerId === id; }
    releasePointerCapture() { this.pointerId = null; }
    getBoundingClientRect() {
        const row = this.hasClass('todo-step-row');
        const top = row ? this.offsetTop - (this.parentElement?.scrollTop || 0)
            + Number(this.style.transform?.match(/translateY\(([-\d.]+)px\)/)?.[1] || 0) : 0;
        const height = row ? 40 : 160;
        return { top, height, bottom: top + height };
    }
    setAttr(key, value) { this.attrs[key] = value; }
    getAttr(key) { return this.attrs[key]; }
    addClass(name) { this.classes.add(name); }
    removeClass(...names) { names.forEach(name => this.classes.delete(name)); }
    hasClass(name) { return this.classes.has(name); }
    toggleClass(name, enabled) { enabled ? this.addClass(name) : this.removeClass(name); }
    setText(value) { this.text = value; }
    setCssStyles(styles) { Object.assign(this.style, styles); }
    addEventListener(name, callback) { this.listeners[name] = callback; }
    emit(name, event = {}) { return this.listeners[name]?.(event); }
    focus() {}
    blur() {}
    closest() { return null; }
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
    const frames = new Map();
    const notices = [];
    const modals = [];
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
        children = [];
        cleanups = [];
        register(callback) { this.cleanups.push(callback); }
        registerDomEvent(el, name, callback) {
            el.addEventListener?.(name, callback);
            this.register(() => { if (el.listeners?.[name] === callback) delete el.listeners[name]; });
        }
        addChild(child) { this.children.push(child); return child; }
        removeChild(child) { this.children = this.children.filter(item => item !== child); child.unload(); return child; }
        unload() { this.children.forEach(child => child.unload()); this.cleanups.splice(0).forEach(callback => callback()); }
    }
    class Scope {
        handlers = [];
        register(_modifiers, key, callback) { this.handlers.push({ key, callback }); }
    }
    const pickers = [];
    const flatpickr = (input, config) => {
        const picker = {
            config, input, calendarContainer: new Element(), prevMonthNav: new Element(), nextMonthNav: new Element(), currentYearElement: new Element(),
            isOpen: false, destroyed: false,
            open() { this.isOpen = true; config.onOpen(); },
            close() { this.isOpen = false; config.onClose(); },
            toggle() { this.isOpen ? this.close() : this.open(); },
            destroy() { this.destroyed = true; },
            clear() { input.value = ''; input.onchange?.(); },
            setDate(date) { input.value = date.toISOString().slice(0, 10); input.onchange?.(); },
        };
        pickers.push(picker);
        return picker;
    };
    const obsidian = {
        Component, Scope,
        Plugin: class extends Component {
            commands = new Map();
            async loadData() { return options.data || {}; }
            async saveData(data) { this.saved = JSON.parse(JSON.stringify(data)); }
            addCommand(command) { this.commands.set(command.id, command); return command; }
            removeCommand(id) { this.commands.delete(id); }
        },
        ItemView: class extends Component { constructor() { super(); this.contentEl = new Element(); } },
        Modal: class {
            constructor(app) { this.app = app; this.scope = new Scope(); this.titleEl = new Element(); this.contentEl = new Element(); }
            open() { modals.push(this); this.onOpen?.(); }
            close() { this.closed = true; this.onClose?.(); }
        },
        PluginSettingTab: class {}, AbstractInputSuggest: class {},
        Notice: class { constructor(message) { notices.push(message); } },
        getLanguage: () => host.language, setIcon() {}, normalizePath: value => value,
        requestUrl: (...args) => network.request(...args),
    };
    const context = {
        Date: options.Date || Date,
        module: { exports: {} },
        require: name => {
            if (name === 'obsidian') return obsidian;
            if (name === 'flatpickr') return flatpickr;
            if (name === 'flatpickr/dist/l10n/zh') return { Mandarin: {} };
            throw new Error(name);
        },
        console: { warn() {}, error() {} },
        window: {
            open() {},
            matchMedia: () => ({ matches: !!options.reducedMotion }),
            requestAnimationFrame: callback => { const id = ++nextTimer; frames.set(id, callback); return id; },
            cancelAnimationFrame: id => frames.delete(id),
            setTimeout: callback => { const id = ++nextTimer; timers.set(id, callback); return id; },
            clearTimeout: id => timers.delete(id),
        },
        document: { activeElement: null }, HTMLInputElement: Element,
    };
    runInNewContext(source, context);
    const exports = context.module.exports;
    const plugin = new exports.MsTodoPlugin();
    plugin.manifest = { id: 'simple-microsoft-todo' };
    plugin.settings = { ...exports.DEFAULT_SETTINGS };
    const scopes = [];
    plugin.app = { workspace: { getLeavesOfType: () => leaves }, secretStorage: storage,
        keymap: { pushScope: scope => scopes.push(scope), popScope: scope => scopes.splice(scopes.indexOf(scope), 1) } };
    plugin.session = new exports.AuthSession(storage);
    if (options.signedIn !== false) plugin.session.restore('test-refresh');
    plugin.session.oauth.generateCodeVerifier = () => 'test-verifier';
    plugin.session.oauth.getAuthUrl = async () => 'https://example.test/login';
    plugin.session.oauth.refreshAccessToken = async () => ({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 3600 });
    const view = new exports.TodoView({}, plugin);
    view.app = plugin.app;
    leaves.push({ view });
    view.currentLists = [list];
    view.selectedListId = list.id;
    view.currentTasks = [structuredClone(task)];
    view.taskCache.set(list.id, { tasks: view.currentTasks, allLoaded: true, updatedAt: 0 });
    view.mainListArea = new Element();
    view.mainDetail = new Element();
    const api = new exports.MsTodoApi(plugin);
    return { ...exports, plugin, view, api, timers, notices, network, secrets, storage, host, pickers, scopes, frames, modals };
}

module.exports = { setup, deferred, Element, list, task };
