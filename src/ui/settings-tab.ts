import { AbstractInputSuggest, App, PluginSettingTab, Setting, TFolder } from 'obsidian';
import type MsTodoPlugin from '../main';
import { DEFAULT_SETTINGS } from '../settings';
import { syncTasksToMarkdown } from '../commands';
import { t, type LocalePreference } from '../i18n';

class FolderPathSuggest extends AbstractInputSuggest<string> {
    private onChoose: (folderPath: string) => void;

    constructor(app: App, inputEl: HTMLInputElement, onChoose: (folderPath: string) => void) {
        super(app, inputEl);
        this.onChoose = onChoose;
    }

    getSuggestions(query: string): string[] {
        const lower = query.trim().toLowerCase();
        const folders: string[] = [];
        this.app.vault.getAllLoadedFiles().forEach((file) => {
            if (file instanceof TFolder && file.path !== '/') folders.push(file.path);
        });
        const filtered = lower
            ? folders.filter((path) => path.toLowerCase().includes(lower))
            : folders;
        return filtered.slice(0, 20);
    }

    renderSuggestion(folderPath: string, el: HTMLElement) {
        el.setText(folderPath);
    }

    selectSuggestion(folderPath: string, evt: MouseEvent | KeyboardEvent) {
        super.selectSuggestion(folderPath, evt);
        this.onChoose(folderPath);
    }
}

export class MsTodoSettingTab extends PluginSettingTab {
    plugin: MsTodoPlugin;

    constructor(app: App, plugin: MsTodoPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl)
            .setName('Microsoft To Do')
            .setHeading();

        if (this.plugin.session.signedIn) {
            new Setting(containerEl)
                .setName(t('settings.accountStatus'))
                .setDesc(t('settings.signedIn'))
                .addButton(btn => btn
                    .setButtonText(t('common.signOut'))
                    .setWarning()
                    .onClick(async () => {
                        await this.plugin.clearData();
                        this.display();
                    })
                );
        } else {
            new Setting(containerEl)
                .setName(t('settings.accountStatus'))
                .setDesc(t('settings.notSignedIn'))
                .addButton(btn => btn
                    .setButtonText(t('common.signIn'))
                    .setCta()
                    .onClick(() => {
                        void this.plugin.login();
                    })
                );
        }

        new Setting(containerEl)
            .setName(t('account.storage'))
            .setDesc(t('account.storageDesc'));

        new Setting(containerEl)
            .setName(t('settings.language'))
            .setDesc(t('settings.languageDesc'))
            .addDropdown(dropdown => dropdown
                .addOption('auto', t('settings.languageAuto'))
                .addOption('en', t('settings.languageEn'))
                .addOption('zh-cn', t('settings.languageZhCn'))
                .setValue(this.plugin.settings.locale)
                .onChange(async (value) => {
                    await this.plugin.setPluginLocale(value as LocalePreference);
                    this.display();
                }));

        new Setting(containerEl)
            .setName(t('settings.markdownSync'))
            .setDesc(t('settings.markdownSyncDesc'))
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.markdownSyncEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.markdownSyncEnabled = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.markdownSyncEnabled) {
            let syncPathInput: HTMLInputElement | null = null;
            const applySyncPath = async (value: string) => {
                this.plugin.settings.markdownSyncPath = value.trim() || DEFAULT_SETTINGS.markdownSyncPath;
                await this.plugin.saveSettings();
            };
            new Setting(containerEl)
                .setName(t('settings.markdownSyncFile'))
                .setDesc(t('settings.markdownSyncFileDesc'))
                .addSearch(search => {
                    syncPathInput = search.inputEl;
                    search
                        .setPlaceholder('Microsoft To Do.md')
                        .setValue(this.plugin.settings.markdownSyncPath)
                        .onChange((value) => { void applySyncPath(value); });
                });
            if (syncPathInput) {
                new FolderPathSuggest(this.app, syncPathInput, (folderPath) => {
                    const current = this.plugin.settings.markdownSyncPath.trim();
                    const currentName = current.split('/').pop() || 'Microsoft To Do.md';
                    const folder = folderPath.replace(/^\/+|\/+$/g, '');
                    const next = folder ? `${folder}/${currentName}` : currentName;
                    if (syncPathInput) syncPathInput.value = next;
                    void applySyncPath(next);
                });
            }

            new Setting(containerEl)
                .setName(t('settings.syncAfterLogin'))
                .setDesc(t('settings.syncAfterLoginDesc'))
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.syncAfterLogin)
                    .onChange(async (value) => {
                        this.plugin.settings.syncAfterLogin = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName(t('settings.syncOnStartup'))
                .setDesc(t('settings.syncOnStartupDesc'))
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.syncOnStartup)
                    .onChange(async (value) => {
                        this.plugin.settings.syncOnStartup = value;
                        await this.plugin.saveSettings();
                    }));

            new Setting(containerEl)
                .setName(t('settings.manualSync'))
                .setDesc(t('settings.manualSyncDesc'))
                .addButton(btn => btn
                    .setButtonText(t('settings.syncNow'))
                    .setCta()
                    .onClick(() => {
                        void syncTasksToMarkdown(this.plugin);
                    }));
        }
    }
}
