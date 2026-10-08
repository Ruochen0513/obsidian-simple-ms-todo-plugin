[English](#simple-microsoft-to-do-for-obsidian) | [简体中文](#simple-microsoft-to-do-for-obsidian-中文说明)

# Simple Microsoft To Do for Obsidian

An unofficial plugin for [Obsidian](https://obsidian.md) that allows you to integrate and manage your **Microsoft To Do** tasks directly within the Obsidian sidebar.

## ✨ Features

- **Sidebar Integration**: View your to-dos in the Obsidian sidebar without switching windows.
- **Task Management**:
    - ✅ **View Tasks**: Select and view tasks from any Microsoft To Do list, not only the default list.
    - 🗂️ **Manage Lists**: Create custom lists and delete non-default lists from the sidebar.
    - ➕ **Add Tasks**: Quickly create new tasks in the selected list via the input box at the bottom.
    - ☑️ **Complete Tasks**: Click the checkbox to mark tasks as completed or reopen completed tasks.
    - 🗓️ **Due Dates & Importance**: Edit due dates and mark tasks as important from the task detail panel.
    - 📝 **Notes & Markdown export**: Edit task notes in Obsidian, and write all lists, tasks, notes, and checklist steps into an Obsidian note.
- **Microsoft sign-in**: Uses Microsoft OAuth with PKCE and automatically refreshes your sign-in session.

## 🛠️ Installation

Requires **Obsidian 1.11.5 or later**.

### Manual Installation (From Release)

1. Download the latest `main.js`, `manifest.json`, and `styles.css` files from the GitHub Releases page.
2. Go to your Obsidian vault directory: `.obsidian/plugins/simple-microsoft-todo/` (create the folder if it doesn't exist).
3. Place the downloaded files into this folder.
4. Restart Obsidian and enable "Simple Microsoft To Do" in **Settings** -> **Community Plugins**.

## 📖 Usage Guide

1. After **enabling the plugin**, a ☑️ icon will appear in the Obsidian Ribbon (left sidebar).
2. Click the icon to open the **Microsoft To Do** view in the right sidebar.
3. For the first use, you will see a **Sign in to Microsoft To Do** button.
4. Click to sign in. A browser window will open for Microsoft authorization. Please sign in and authorize.
5. After successful authorization, the browser will attempt to redirect back to Obsidian. The plugin will automatically fetch the Token and load your task list.

### Common Operations

- **Select list**: Use the view selector at the top. **Due today** shows tasks whose due date is today; **Overdue** shows earlier due dates.
- **Manage lists**: Select **Create list** in the view selector. To delete a non-default list, select **More → Delete current list**.
- **Refresh List**: Click the "Refresh" button.
- **Add Task**: Type in the input box at the bottom of the selected list and press `Enter`.
- **Edit Details**: Select a task to edit its title, notes, due date, and important/star status.
- **Completed tasks**: Expand **Completed** to view or reopen completed tasks.
- **Export to note**: Enable **Export to Markdown** in settings, then select **More → Export to note** or run **Export Microsoft To Do to Markdown**. The default file is `Microsoft To Do.md`. Each export replaces its contents; edits to this file are not sent back to Microsoft.
- **Sign out**: Select **More → Sign out**, or sign out in plugin settings. Your language and export preferences are kept.

## Sign-in storage and privacy

The refresh token is stored under `simple-microsoft-todo-refresh-token` in [Obsidian Keychain](https://docs.obsidian.md/plugins/guides/secret-storage). Access tokens stay in memory. Neither token is saved in the plugin's `data.json`.

On upgrade, the plugin first copies the old refresh token to Keychain and verifies it can be read. Only then does it remove the token fields from `data.json`. If Keychain is unavailable, migration stops and the original file is left intact; there is no plaintext fallback. Earlier backups may still contain the old token fields.

Keychain is local to this device and vault, so sign in separately on each device. Desktop encryption depends on the operating system's credential storage. Keychain is shared with other enabled plugins; it is not a sandbox between plugins. Signing out clears this plugin's stored token and task cache.

The plugin contacts Microsoft sign-in endpoints and Microsoft Graph to authenticate and manage your tasks. Task titles, notes, dates and checklist changes are sent to Microsoft when you edit them. `data.json` still contains ordinary preferences and a local task cache; exported notes contain task content. There is no telemetry.

## Local development

Use a current Node.js LTS release (tested with Node 24):

```sh
npm ci
npm test
npm run build
```

`src/main.ts` handles plugin lifecycle. `src/auth/` owns the sign-in session and credential storage; `src/api/` owns Graph requests; `src/commands/` owns command actions. Settings, task details and dialogs live in separate `src/ui/` modules. Both locales use the same flat translation keys, with tests for keys and template variables.

## 📄 License

[MIT License](LICENSE)

---

<div id="simple-microsoft-to-do-for-obsidian-中文说明"></div>

# Simple Microsoft To Do for Obsidian (中文说明)

这是一个为 [Obsidian](https://obsidian.md) 开发的非官方插件，允许您直接在 Obsidian 的侧边栏中集成和管理您的 **Microsoft To Do** 任务。

## ✨ 功能特性

- **侧边栏集成**：在 Obsidian 侧边栏中查看您的待办事项，无需切换窗口。
- **任务管理**：
    - ✅ **查看任务**：可以选择并查看任意 Microsoft To Do 清单，不再只读取默认清单。
    - 🗂️ **管理清单**：可在侧边栏创建自定义清单，并删除非默认清单。
    - ➕ **添加任务**：通过底部输入框把任务创建到当前选中的清单。
    - ☑️ **完成任务**：点击复选框即可标记任务完成，也可以重新打开已完成任务。
    - 🗓️ **截止日期与重要标记**：在任务详情面板编辑截止日期，并将任务标记为重要。
    - 📝 **备注与导出到文档**：可在 Obsidian 里编辑任务备注，并将全部清单、任务、详细备注和检查步骤写入 Obsidian 笔记。
- **微软登录**：使用微软 OAuth 与 PKCE 授权流程，并自动刷新登录会话。

## 🛠️ 安装方法

需要 **Obsidian 1.11.5 或更新版本**。

### 手动安装 (从 Release)

1. 从 GitHub Releases 页面下载最新的 `main.js`, `manifest.json`, 和 `styles.css` 文件。
2. 进入您的 Obsidian 仓库目录：`.obsidian/plugins/simple-microsoft-todo/`
3. 将下载的文件放入该文件夹中。
4. 重启 Obsidian，在 **设置** -> **第三方插件** 中启用 "Simple Microsoft To Do"。

## 📖 使用指南

1. **启用插件**后，Obsidian 界面左侧 Ribbon 栏（侧边条）会出现一个 ☑️  图标。
2. 点击图标，右侧侧边栏将打开 **Microsoft To Do** 视图。
3. 初次使用时，视图中会出现 **登录 Microsoft To Do** 按钮。
4. 点击登录，浏览器将弹出微软授权页面，请登录您的微软账号并授权。
5. 授权成功后，浏览器会尝试唤起 Obsidian，插件将自动获取 Token 并加载您的任务列表。

### 常用操作

- **选择清单**：使用顶部的视图选择器。**今天到期**显示截止日期为今天的任务，**逾期**显示截止日期早于今天的任务。
- **管理清单**：在视图选择器中选择**新建清单**。删除非默认清单时，选择**更多 → 删除当前清单**。
- **刷新列表**：选择顶部的**刷新**按钮。
- **添加任务**：在当前清单底部的输入框输入内容，按下 `Enter` 键即可。
- **编辑详情**：选择任务后，可以编辑标题、备注、截止日期和重要状态。
- **已完成任务**：展开**已完成**分组，查看或重新打开任务。
- **导出到笔记**：先在设置中开启**导出到 Markdown**，然后选择**更多 → 导出到笔记**，或运行命令**导出 Microsoft To Do 到 Markdown**。默认文件是 `Microsoft To Do.md`，每次导出会替换其内容；对该文件的修改不会回传给微软。
- **退出登录**：选择**更多 → 退出登录**，或在插件设置页退出。语言和导出偏好会保留。

## 登录信息与隐私

刷新令牌保存在 [Obsidian Keychain（密钥存储）](https://docs.obsidian.md/plugins/guides/secret-storage) 中，名称为 `simple-microsoft-todo-refresh-token`。访问令牌只保存在内存中，两者都不会写入插件的 `data.json`。

升级时，插件会先将旧刷新令牌写入密钥存储并确认可读取，再从 `data.json` 中移除令牌字段。如果密钥存储不可用，迁移会停止，原文件保持不变，不会改用明文存储。此前的备份可能仍包含旧令牌字段。

密钥存储按本机和仓库隔离，每台设备需分别登录。桌面端加密依赖操作系统提供的凭据存储能力。其他已启用的插件也能访问这个共享存储，它不是插件之间的安全隔离机制。退出登录会清空本插件保存的令牌和任务缓存。

插件通过微软登录服务和 Microsoft Graph 完成授权与任务管理。编辑任务时，任务名称、备注、日期和检查步骤会发送给微软。`data.json` 仍保存普通偏好和本地任务缓存，导出的笔记也包含任务内容。插件不收集遥测数据。

## 本地开发

使用当前 Node.js LTS 版本（已在 Node 24 下验证）：

```sh
npm ci
npm test
npm run build
```

`src/main.ts` 负责插件生命周期，`src/auth/` 管理登录会话和凭据，`src/api/` 处理 Graph 请求，`src/commands/` 实现命令操作。设置页、任务详情和弹窗分别位于 `src/ui/` 的独立模块。中英文使用相同的扁平词条结构，测试会检查词条和占位变量是否一致。

## 📄 许可证

[MIT License](LICENSE)
