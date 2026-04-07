# CineFlow 媒体管理桌面应用

基于 **Electron + React + Tailwind CSS** 的多项目媒体管理工具，用于集中管理视频、图片、音频等素材，并支持跨项目复用、拖拽导出。

---

## 一、总体功能概览

- **多项目管理**
  - 支持多个项目并存，项目目录命名规则：`YYYYMMDD_项目名`（如 `20260309_电影A`）。
  - 左侧列表列出所有项目，可快速切换 / 重命名 / 删除。
  - 双击项目可在系统资源管理器中直接打开该项目文件夹。

- **项目媒体库**
  - 「项目管理」视图中：
    - 展示当前项目目录下的所有文件（项目文件）。
    - 展示当前项目在全局媒体库中的链接素材（链接素材）。
  - 项目文件与链接素材支持：
    - 缩略图展示（图片 / 视频 / 其他类型）。
    - 重命名 / 删除。
    - 拖拽到桌面或其他软件完成导出。
    - 双击使用系统默认应用打开。

- **全局媒体库**
  - 所有项目共享的媒体文件统一存放在一个「媒体根目录」下。
  - 支持：
    - 关键字搜索（按文件名匹配并按相关性排序）。
    - 类型筛选：全部 / 视频 / 图片 / 其他。
    - 重命名 / 删除媒体文件（会同步更新所有项目中的引用）。
    - 拖拽导出、双击打开。

- **拖拽导入**
  - 拖拽文件到 **左侧项目区域**：
    - 文件复制到当前项目目录。
  - 拖拽文件到 **右侧任意区域**：
    - 文件复制到媒体根目录，命名为 `项目名_素材[ -1...].ext`。
    - 当前项目中增加对应的链接记录，可在「项目管理」视图中看到。

- **自动同步与清理**
  - 应用退出前自动扫描所有项目：
    - 清理 `project.json` 中已经不存在的媒体文件链接（断链）。

---

## 二、技术栈与依赖

- **Electron**
  - 负责桌面窗口、主进程逻辑、文件系统访问、原生拖拽导出（`webContents.startDrag`）。
- **React + Vite**
  - 单页面前端应用，负责 UI 与状态管理。
- **Tailwind CSS**
  - 响应式布局和样式库，用于快速构建现代界面。
- **Node.js 文件系统 API**
  - 通过 `fs` / `fs.promises` 对项目根目录、媒体根目录进行文件读写与维护。

主要开发依赖可在 `package.json` 中查看。

---

## 三、目录结构

核心文件与目录：

- `electron/main.js`
  - Electron 主进程入口。
  - 负责：
    - 读取 / 保存全局设置（项目根目录、媒体根目录、当前项目）。
    - 创建项目目录、重命名 / 删除项目。
    - 导入文件到项目目录 / 媒体库目录。
    - 重命名 / 删除项目文件和媒体库文件，并同步项目引用。
    - 提供 IPC 接口（`ipcMain.handle` / `ipcMain.on`）。
    - 处理拖拽导出（`webContents.startDrag`）。
    - 应用退出前的自动同步与清理。

- `electron/preload.js`
  - 通过 `contextBridge.exposeInMainWorld` 暴露安全的 `window.electronAPI`，供 React 前端调用。
  - 所有与主进程交互的功能都集中在这里，例如：
    - `listMedia`, `listProject`, `importToProject`, `importToLibrary`
    - `createProject`, `renameProject`, `deleteProject`
    - `renameProjectFile`, `deleteProjectFile`
    - `renameMediaFile`, `deleteMediaFile`
    - `openPath`, `showItemInFolder`
    - `startFileDrag`

- `src/App.jsx`
  - 前端主界面组件：
    - 左侧项目列表（切换 / 创建 / 重命名 / 删除 / 双击打开）。
    - 右侧标签页：
      - 「项目管理」：当前项目文件夹内容 + 当前项目链接的媒体。
      - 「全局素材库」：所有媒体文件 + 搜索 / 筛选 / 重命名 / 删除。
    - 各种弹窗（根目录设置、创建项目、重命名 / 删除项目 / 文件 / 媒体）。
    - 拖拽导入 / 导出逻辑。

- 其它文件
  - `vite.config.mjs`：Vite + React 配置。
  - `tailwind.config.cjs` / `postcss.config.cjs`：Tailwind / PostCSS 配置。
  - `src/main.jsx`：React 应用入口。
  - `src/index.css`：全局样式与 Tailwind 引入。

---

## 四、数据结构与存储设计

### 4.1 全局设置（`cineflow-settings.json`）

存放路径：`app.getPath('userData')/cineflow-settings.json`

字段说明：

- `projectRoot`：项目根目录（所有项目文件夹所在的目录）。
- `mediaRoot`：媒体根目录（所有媒体文件所在的目录）。
- `currentProject`：当前选中的项目文件夹名称（例如 `20260309_电影A`）。
- `initialized`：是否完成过根目录设置。

> 注意：`currentProject` 是目录名（带日期前缀），而不是项目显示名称。

### 4.2 项目描述文件（`project.json`）

每个项目目录下都有一个 `project.json`，例如：

- 路径：`<projectRoot>/<YYYYMMDD_项目名>/project.json`

结构：

```json
{
  "name": "电影A",
  "mediaLinks": [
    {
      "id": "时间戳-随机",
      "name": "电影A_素材.mp4",
      "libraryPath": "电影A_素材.mp4",
      "fullPath": "D:/MediaLibrary/电影A_素材.mp4"
    }
  ]
}
```

- `name`：项目显示名称（不含日期前缀），用于命名导入到媒体库的素材。
- `mediaLinks`：当前项目引用的媒体库文件（**不会复制到项目目录，而是统一放在媒体根目录中**）。

### 4.3 项目目录与媒体目录

- 项目根目录（`projectRoot`）下：
  - 每个项目为一个子目录：`YYYYMMDD_项目名`。
  - 子目录中包含：
    - `project.json`：项目信息与媒体引用。
    - 其它所有文件：项目级别的本地文件。

- 媒体根目录（`mediaRoot`）下：
  - 所有媒体文件（视频 / 图片 / 音频 / 其他）。
  - 导入到媒体库时，会使用 `项目名_素材` 为前缀，自动生成不重复名称。

---

## 五、主进程实现逻辑（`electron/main.js`）

### 5.1 路径与设置管理

- `loadSettings()` / `saveSettings()`：负责从 `cineflow-settings.json` 读取 / 写入设置。
- `getProjectRoot()` / `getMediaRoot()`：根据设置或默认值返回路径。
- `getProjectDir()`：返回当前项目目录（`projectRoot/currentProject`）。
- `ensureDirs()`：确保项目根目录、媒体根目录、当前项目目录存在。

### 5.2 项目管理

- `createProject(displayName)`：
  - 根据当前日期和传入的项目显示名生成目录名：`YYYYMMDD_displayName`。
  - 处理重名冲突（后缀 `-1`、`-2`...）。
  - 更新 `settings.currentProject`，并初始化 `project.json`。

- `renameProject(oldFolderName, newDisplayName)`：
  - 保留原有日期前缀（若不存在则使用当前日期）。
  - 生成新的目录名，处理冲突。
  - 若被重命名的是当前项目，则更新 `currentProject`。
  - 更新对应 `project.json` 中的 `name` 字段（显示名）。

- `deleteProject(folderName, deleteLinkedMedia)`：
  - 读取该项目的 `mediaLinks`。
  - 若 `deleteLinkedMedia = true`，同时删除媒体库内对应的文件。
  - 删除整个项目目录。
  - 若删除的是当前项目，则选择最新项目或清空当前项目。
  - 返回更新后的项目列表与媒体库列表。

### 5.3 文件导入与媒体库管理

- `importFilesToProject(filePaths)`：
  - 将传入的源文件复制到当前项目目录。
  - 保留源文件名，存在同名时自动添加 `-1` 等后缀。

- `importFilesToLibrary(filePaths)`：
  - 将源文件复制到媒体根目录。
  - 目标文件名以 `项目显示名_素材` 为基础，处理重名。
  - 在当前项目的 `mediaLinks` 中增加对应链接信息。

- `renameProjectFile(filePath, newName)` / `deleteProjectFile(filePath)`：
  - 对当前项目目录中的普通文件进行重命名 / 删除。

- `renameMediaFile(filePath, newName)` / `deleteMediaFile(filePath)`：
  - 对媒体库中的文件进行重命名 / 删除。
  - 遍历所有项目目录的 `project.json`，同步更新或清理相关 `mediaLinks`。

### 5.4 自动同步（退出时清理断链）

- `syncBeforeQuit()`：
  - 遍历所有项目目录的 `project.json`。
  - 对每个 `mediaLinks` 条目检查 `fullPath` 是否存在：
    - 存在：保留。
    - 不存在：从 `mediaLinks` 中移除。
  - 写回更新后的 `project.json`。

应用通过 `before-quit` 事件触发该同步逻辑。

### 5.5 拖拽导出

- 渲染进程通过 `ipcRenderer.send('drag:start', filePath)` 发送拖拽请求。
- 主进程在 `ipcMain.on('drag:start')` 中：
  - 将传入路径解析为绝对路径。
  - 尝试从文件创建拖拽图标（若失败则可省略图标）。
  - 调用 `event.sender.startDrag({ file: absolutePath, icon? })` 发起原生拖拽。

拖拽行为实际由操作系统接管，因此可以拖拽到桌面、资源管理器或其它支持文件拖拽的应用。

---

## 六、渲染进程实现逻辑（`src/App.jsx`）

### 6.1 状态划分

- 项目与媒体数据：
  - `projectState`：当前项目状态 `{ files, mediaLinks }`。
  - `mediaLibrary`：全局媒体库文件列表。
  - `projects`：项目列表（包含 `name`, `fullPath`, `isCurrent` 等）。

- 设置与根目录：
  - `settings`：主进程返回的全局设置。
  - `pendingProjectRoot` / `pendingMediaRoot`：设置面板中的输入值。

- UI 状态：
  - `activeTab`：当前右侧视图标签（`project` / `library`）。
  - `showSettings` / `showCreateProject`：弹窗可见状态。
  - 拖拽视觉反馈：`isDragOverLeft` / `isDragOverRight`。

- 编辑与删除弹窗：
  - 项目：`editProject`, `editProjectName`, `deleteProjectConfirm`, `deleteProjectAlsoMedia`。
  - 项目文件：`editFile`, `editFileName`, `deleteFileConfirm`。
  - 媒体库文件：`editMediaFile`, `editMediaFileName`, `deleteMediaConfirm`。

### 6.2 关键交互函数

- 根目录与项目初始化
  - `loadInitialSettings()`：获取设置与项目列表，决定是否弹出根目录设置弹窗，并自动选择最新项目。
  - `handleSaveSettings()`：更新设置、重新获取项目列表与媒体库。
  - `handleCreateProject()`：通过 `electronAPI.createProject` 创建新项目并切换。

- 拖拽导入
  - `handleDrop(event, target)`：
    - 从 `event.dataTransfer.files` 中读取文件路径。
    - 若 `target === 'project'`：调用 `importToProject()`。
    - 若 `target === 'library'`：调用 `importToLibrary()`。
    - 更新 `projectState` 与 `mediaLibrary`。

- 拖拽导出
  - `handleStartDrag(e, filePath)`：
    - 校验路径与 API 是否存在。
    - 可选：在 `dataTransfer` 中设置文本（兼容性增强）。
    - 通过 `electronAPI.startFileDrag(filePath)` 通知主进程发起原生拖拽。

- 列表与缩略图渲染
  - `renderProjectItem(project)`：项目列表项，负责：
    - 点击切换当前项目。
    - 双击打开项目目录。
    - 悬停显示「编辑 / 删除」按钮。
  - `renderMediaThumb(item, source)`：统一的媒体缩略图组件：
    - 按扩展名判断是否为图片 / 视频 / 音频 / 其他。
    - 图片：使用 `<img src="file://...">` 预览。
    - 视频：使用 `<video src="file://...">` 预览首帧（或循环播放短片段）。
    - 其他类型：显示图标与扩展名。
    - 悬停显示「重命名 / 删除」按钮（文件或媒体）。
    - 支持拖拽导出与双击打开。

---

## 七、如何运行与打包

### 7.1 运行开发环境

1. 安装依赖：

```bash
npm install
```

2. 启动开发模式（Vite + Electron）：

```bash
npm run dev
```

3. Electron 窗口会自动打开，Vite 前端通过 `http://localhost:5173` 加载。

### 7.2 打包（可选）

```bash
npm run build
```

### 7.3 Mac 打包与兼容性
- 说明：当前应用已支持在 macOS 上打包。确保 macOS 机器上有 Xcode 命令行工具，并已配置 Apple Developer 签名（如需签名）。
- 构建前提：icon.icns 已放置在 assets 目录下（你已完成此步骤）。
- 常用打包命令（在 macOS 机上执行，或在 CI 的 macOS 环境执行）：
- 1) 安装依赖
   ```bash
   npm install
   ```
- 2) 构建 renderer 和 Electron 打包
   ```bash
   npm run build
   ```
- 3) 直接打包 macOS DMG（如果你在本地 macOS 上）
   说明：build 脚本在当前平台打包为对应平台的应用，若在 macOS 上运行则会生成 macOS 的 DMG；若在 Windows/Linux 上运行需要在对应的 CI/虚拟机上进行 macOS 构建。
- 4) 如需签名，请在环境变量中配置 Apple Developer ID 并使用 macOS 的签名流程。
- 5) 常见问题：若遇到签名错误、权限问题，请确保在 macOS 的系统偏好设置中允许应用访问指定目录，或通过命令行工具进行签名。 
- 6) 版本与图标：已统一使用 icon.icns 作为 macOS 图标，确保应用在 Dock/Launchpad 的外观一致。

## VIII. 拖拽导入的冲突处理（新）
- 新增同名文件冲突处理：在将媒体文件拖入当前项目目录时，若目标目录中已存在同名文件，将弹出覆盖确认框（使用 Electron 的对话框实现）。用户选择“覆盖”则覆盖，否则跳过该文件。
- 逻辑实现位置：在 electron/main.js 的 importFilesToProject(copy 时) 使用 copyWithConflict 的策略进行确认，避免无意覆盖或重复导入。


---

## 八、常见问题与排查建议
  1. **项目或媒体重命名 / 删除后列表未更新**
   - 确认前端没有报错。
   - 点击右上角「刷新」按钮手动重新拉取状态。

---

## 九、二次开发建议

- 所有与文件系统相关的操作都集中在 `electron/main.js`，建议不要从前端直接访问 Node API。
- 与主进程的通信统一通过 `electron/preload.js` 中的 `electronAPI` 完成，方便维护与权限控制。
- 若要扩展功能（标签、打分、时间轴、批量操作等），推荐：
  - 在 `project.json` 中增加字段。
  - 在主进程封装对应的读写函数。
  - 最后通过 `electronAPI` 暴露给前端。

