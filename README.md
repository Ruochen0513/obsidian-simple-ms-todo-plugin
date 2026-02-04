# Simple Microsoft To Do for Obsidian

这是一个为 [Obsidian](https://obsidian.md) 开发的非官方插件，允许您直接在 Obsidian 的侧边栏中集成和管理您的 **Microsoft To Do** 任务。

## ✨ 功能特性

- **侧边栏集成**：在 Obsidian 侧边栏中查看您的待办事项，无需切换窗口。
- **任务管理**：
    - ✅ **查看任务**：自动加载您的默认任务列表。
    - ➕ **添加任务**：通过底部的输入框快速创建新任务。
    - ☑️ **完成任务**：点击复选框即可标记任务完成（同步至 Microsoft To Do）。
- **安全登录**：使用微软官方 OAuth2 授权流程，支持自动刷新 Access Token，无需频繁登录。

## 🛠️ 安装方法

### 手动安装 (从 Release)

1. 从 GitHub Releases 页面下载最新的 `main.js`, `manifest.json`, 和 `styles.css` 文件。
2. 进入您的 Obsidian 仓库目录：`.obsidian/plugins/obsidian-microsoft-todo/`
3. 将下载的文件放入该文件夹中。
4. 重启 Obsidian，在 **设置** -> **第三方插件** 中启用 "Simple Microsoft To Do"。


## 📖 使用指南

1. **启用插件**后，Obsidian 界面左侧 Ribbon 栏（侧边条）会出现一个 ☑️  图标。
2. 点击图标，右侧侧边栏将打开 **Microsoft To Do** 视图。
3. 初次使用时，视图中会出现 **"Sign in Microsoft To Do"** 按钮。
4. 点击登录，浏览器将弹出微软授权页面，请登录您的微软账号并授权。
5. 授权成功后，浏览器会尝试唤起 Obsidian，插件将自动获取 Token 并加载您的任务列表。

### 常用操作

- **刷新列表**：点击 "Refresh" 按钮。
- **添加任务**：在视图底部的输入框输入内容，按下 `Enter` 键即可。
- **注销账号**：在视图顶部点击 "Sign out"，或在插件设置页点击注销。



## 📄 许可证

[MIT License](LICENSE)