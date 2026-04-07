const { app, BrowserWindow, ipcMain, nativeImage, dialog, protocol, net, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const fsp = fs.promises;

// 打包判断：开发环境下使用 Vite dev server，打包后加载本地文件
const isDev = !app.isPackaged;

// 全局配置：用于保存项目根目录、媒体根目录、当前项目名等
const userData = app.getPath('userData');
const CONFIG_PATH = path.join(userData, 'cineflow-settings.json');

let settings = {
  projectRoot: null,
  mediaRoot: null,
  // 移除默认占用的占位项目名
  currentProject: null,
  initialized: false,
};

async function loadSettings() {
  try {
    const raw = await fsp.readFile(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    settings = {
      ...settings,
      ...parsed,
    };
  } catch {
    // 如果没有配置文件，使用 userData 下的默认目录，但标记为未初始化
    settings = {
      ...settings,
      projectRoot: settings.projectRoot || path.join(userData, 'projects'),
      mediaRoot: settings.mediaRoot || path.join(userData, 'media-library'),
      initialized: false,
      // 不再给出默认当前项目，避免占用一个实际的项目目录
      currentProject: null,
    };
  }
  return settings;
}

async function saveSettings() {
  await fsp.mkdir(path.dirname(CONFIG_PATH), { recursive: true });
  await fsp.writeFile(CONFIG_PATH, JSON.stringify(settings, null, 2), 'utf-8');
}

function getProjectRoot() {
  return settings.projectRoot || path.join(userData, 'projects');
}

function getMediaRoot() {
  return settings.mediaRoot || path.join(userData, 'media-library');
}

function getProjectDir() {
  const projectName = settings.currentProject;
  if (!projectName) return null;
  return path.join(getProjectRoot(), projectName);
}

function getProjectMetaPath() {
  const dir = getProjectDir();
  if (!dir) return null;
  return path.join(dir, 'project.json');
}

async function ensureDirs() {
  await loadSettings();
  await fsp.mkdir(getProjectRoot(), { recursive: true });
  await fsp.mkdir(getMediaRoot(), { recursive: true });
  // 仅在存在当前项目时创建该项目目录
  const projDir = getProjectDir();
  if (projDir) {
    await fsp.mkdir(projDir, { recursive: true });
  }
}

async function readProjectMeta() {
  const metaPath = getProjectMetaPath();
  if (!metaPath) {
    return { name: settings.currentProject || '', mediaLinks: [] };
  }
  try {
    const raw = await fsp.readFile(metaPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { name: settings.currentProject || '', mediaLinks: [] };
  }
}

async function writeProjectMeta(meta) {
  const metaPath = getProjectMetaPath();
  if (!metaPath) return;
  await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
}

async function listMediaLibrary() {
  await ensureDirs();
  const mediaRoot = getMediaRoot();
  const entries = await fsp.readdir(mediaRoot, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => ({
      name: e.name,
      fullPath: path.join(mediaRoot, e.name),
    }));
}

async function listProjectFiles() {
  await ensureDirs();
  const dir = getProjectDir();
  if (!dir) {
    return { files: [], mediaLinks: [] };
  }
  let files = [];
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    files = entries
      .filter((e) => e.isFile() && e.name !== 'project.json')
      .map((e) => ({
        name: e.name,
        fullPath: path.join(dir, e.name),
      }));
  } catch {
    files = [];
  }

  const meta = await readProjectMeta();

  return {
    files,
    mediaLinks: meta.mediaLinks || [],
  };
}

async function copyWithUniqueName(srcPath, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  const base = path.basename(srcPath);
  const ext = path.extname(base);
  const name = path.basename(base, ext);

  let candidate = base;
  let index = 1;
  while (true) {
    try {
      await fsp.access(path.join(destDir, candidate));
      candidate = `${name}-${index}${ext}`;
      index += 1;
    } catch {
      break;
    }
  }

  const target = path.join(destDir, candidate);
  await fsp.copyFile(srcPath, target);
  return target;
}

// 左侧上传：复制到当前项目目录（保留原文件名，冲突时加后缀）
async function importFilesToProject(filePaths) {
  await ensureDirs();
  const projectDir = getProjectDir();
  if (!projectDir) return [];
  const imported = [];
  for (const src of filePaths) {
    const target = await copyWithUniqueName(src, projectDir);
    if (target) imported.push({ name: path.basename(target), fullPath: target });
  }
  return imported;
}

// 右侧上传：按“项目名称_素材”命名，复制到媒体根目录，并在当前项目中添加访问链接
async function importFilesToLibrary(filePaths) {
  await ensureDirs();
  const imported = [];
  const meta = await readProjectMeta();
  const mediaRoot = getMediaRoot();
  const projectDisplayName = meta.name || settings.currentProject || 'Project';

  for (const src of filePaths) {
    const ext = path.extname(src);
    const baseName = `${projectDisplayName}_素材`;
    await fsp.mkdir(mediaRoot, { recursive: true });
    let candidateBase = `${baseName}${ext}`;
    let index = 1;
    let target;
    while (true) {
      target = path.join(mediaRoot, candidateBase);
      try {
        await fsp.access(target);
        candidateBase = `${baseName}-${index}${ext}`;
        index += 1;
      } catch {
        await fsp.copyFile(src, target);
        break;
      }
    }
    const rel = path.relative(mediaRoot, target);
    const link = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: path.basename(target),
      libraryPath: rel,
      fullPath: target,
    };
    meta.mediaLinks.push(link);
    imported.push(link);
  }
  await writeProjectMeta(meta);
  return imported;
}

// 列出项目根目录下所有项目（按最近修改排序），用于左侧项目列表
async function listProjects() {
  await ensureDirs();
  const root = getProjectRoot();
  const entries = await fsp.readdir(root, { withFileTypes: true });

  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // 移除占用的默认占位目录名，确保不会作为实际项目显示
    if (entry.name === 'default') continue;
    const projectPath = path.join(root, entry.name);
    let stat;
    try {
      stat = await fsp.stat(projectPath);
    } catch {
      continue;
    }
    projects.push({
      name: entry.name,
      fullPath: projectPath,
      mtimeMs: stat.mtimeMs,
      isCurrent: entry.name === (settings.currentProject || 'default'),
    });
  }

  // 按修改时间降序排序，处理可能的 undefined 值
  projects.sort((a, b) => {
    const ma = a.mtimeMs ?? 0;
    const mb = b.mtimeMs ?? 0;
    return mb - ma;
  });
  return projects;
}

// Copy with optional conflict checking for duplicates in destination
// If a file with the same name exists, prompt the user to overwrite or skip
async function copyWithConflict(srcPath, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  const base = path.basename(srcPath);
  const target = path.join(destDir, base);
  try {
    await fsp.access(target);
    // 存在同名文件，弹出覆盖/跳过的对话框
    const result = dialog.showMessageBoxSync(BrowserWindow.getFocusedWindow(), {
      type: 'question',
      buttons: ['Overwrite', 'Skip'],
      defaultId: 0,
      message: `文件 ${base} 已存在于当前项目中，是否覆盖？`,
    });
    if (result === 0) {
      await fsp.copyFile(srcPath, target);
      return target;
    }
    return null;
  } catch {
    // 不存在同名文件，直接复制
    await fsp.copyFile(srcPath, target);
    return target;
  }
}

// 创建新项目：使用 YYYYMMDD_项目名 作为目录名，meta 中保存原始项目名
async function createProject(displayName) {
  await ensureDirs();
  const root = getProjectRoot();
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const safeName =
    (displayName || '').trim().replace(/[\\/:*?"<>|]+/g, '_') || 'Project';
  const baseFolderName = `${yyyy}${mm}${dd}_${safeName}`;

  let folderName = baseFolderName;
  let index = 1;
  while (true) {
    const full = path.join(root, folderName);
    try {
      await fsp.access(full);
      folderName = `${baseFolderName}-${index}`;
      index += 1;
    } catch {
      await fsp.mkdir(full, { recursive: true });
      break;
    }
  }

  settings.currentProject = folderName;
  await saveSettings();
  await ensureDirs();

  // 初始化该项目的 meta，记录原始项目名
  await writeProjectMeta({ name: safeName, mediaLinks: [] });

  const projectState = await listProjectFiles();
  const projects = await listProjects();
  return { settings, projectState, projects };
}

// 读取指定项目的 meta（用于删除前获取 mediaLinks）
async function getProjectMetaByFolder(folderName) {
  const projectDir = path.join(getProjectRoot(), folderName);
  const metaPath = path.join(projectDir, 'project.json');
  try {
    const raw = await fsp.readFile(metaPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { mediaLinks: [] };
  }
}

// 重命名项目（重命名文件夹，保留日期前缀或生成新的）
async function renameProject(oldFolderName, newDisplayName) {
  await ensureDirs();
  const root = getProjectRoot();
  const oldPath = path.join(root, oldFolderName);
  const safeName =
    (newDisplayName || '').trim().replace(/[\\/:*?"<>|]+/g, '_') || 'Project';

  const match = oldFolderName.match(/^(\d{8})_/);
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePrefix = match ? match[1] : `${yyyy}${mm}${dd}`;
  let newFolderName = `${datePrefix}_${safeName}`;

  let finalName = newFolderName;
  let index = 1;
  while (true) {
    const full = path.join(root, finalName);
    try {
      await fsp.access(full);
      finalName = `${datePrefix}_${safeName}-${index}`;
      index += 1;
    } catch {
      break;
    }
  }

  const newPath = path.join(root, finalName);
  await fsp.rename(oldPath, newPath);

  const wasCurrent = settings.currentProject === oldFolderName;
  if (wasCurrent) {
    settings.currentProject = finalName;
    await saveSettings();
  }

  const meta = await getProjectMetaByFolder(finalName);
  meta.name = safeName;
  await fsp.writeFile(
    path.join(newPath, 'project.json'),
    JSON.stringify(meta, null, 2),
    'utf-8',
  );

  const projectState = wasCurrent ? await listProjectFiles() : null;
  const projects = await listProjects();
  return { settings, projectState, projects };
}

// 删除项目，可选同时删除媒体库中该项目的链接素材
async function deleteProject(folderName, deleteLinkedMedia) {
  await ensureDirs();
  const root = getProjectRoot();
  const projectPath = path.join(root, folderName);
  const meta = await getProjectMetaByFolder(folderName);

  if (deleteLinkedMedia && meta.mediaLinks && meta.mediaLinks.length > 0) {
    for (const link of meta.mediaLinks) {
      try {
        await fsp.unlink(link.fullPath);
      } catch {
        // ignore
      }
    }
  }

  await fsp.rm(projectPath, { recursive: true, force: true });

  if (settings.currentProject === folderName) {
    const projects = await listProjects();
    settings.currentProject = projects[0]?.name || null;
    await saveSettings();
  }

  const projectState = settings.currentProject ? await listProjectFiles() : { files: [], mediaLinks: [] };
  const projects = await listProjects();
  const library = await listMediaLibrary();
  return { settings, projectState, projects, mediaLibrary: library };
}

// 重命名项目文件
async function renameProjectFile(filePath, newName) {
  await ensureDirs();
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const safe = (newName || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
  const base = safe ? path.basename(safe, path.extname(safe)) || safe : 'file';
  const finalName = path.extname(safe) ? safe : `${base}${ext}`;
  const newPath = path.join(dir, finalName);
  await fsp.rename(filePath, newPath);
  return { name: finalName, fullPath: newPath };
}

// 删除项目文件
async function deleteProjectFile(filePath) {
  await ensureDirs();
  await fsp.unlink(filePath);
}

// 媒体库文件重命名（同时更新所有项目中的引用）
async function renameMediaFile(filePath, newName) {
  await ensureDirs();
  const mediaRoot = getMediaRoot();
  const dir = path.dirname(filePath);
  if (path.resolve(dir) !== path.resolve(mediaRoot)) return null;
  const ext = path.extname(filePath);
  const safe = (newName || '').trim().replace(/[\\/:*?"<>|]+/g, '_');
  const base = safe ? path.basename(safe, path.extname(safe)) || safe : 'file';
  const finalName = path.extname(safe) ? safe : `${base}${ext}`;
  const newPath = path.join(mediaRoot, finalName);
  await fsp.rename(filePath, newPath);

  const projectRoot = getProjectRoot();
  const entries = await fsp.readdir(projectRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(projectRoot, entry.name, 'project.json');
    let meta;
    try {
      const raw = await fsp.readFile(metaPath, 'utf-8');
      meta = JSON.parse(raw);
    } catch { continue; }
    if (!meta.mediaLinks) continue;
    let changed = false;
    for (const link of meta.mediaLinks) {
      if (link.fullPath === filePath) {
        link.fullPath = newPath;
        link.name = finalName;
        link.libraryPath = path.relative(mediaRoot, newPath);
        changed = true;
      }
    }
    if (changed) await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
  }
  return { name: finalName, fullPath: newPath };
}

// 媒体库文件删除（同时移除所有项目中的引用）
async function deleteMediaFile(filePath) {
  await ensureDirs();
  const mediaRoot = getMediaRoot();
  const dir = path.dirname(filePath);
  if (path.resolve(dir) !== path.resolve(mediaRoot)) return;
  await fsp.unlink(filePath);

  const projectRoot = getProjectRoot();
  const entries = await fsp.readdir(projectRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(projectRoot, entry.name, 'project.json');
    let meta;
    try {
      const raw = await fsp.readFile(metaPath, 'utf-8');
      meta = JSON.parse(raw);
    } catch { continue; }
    if (!meta.mediaLinks) continue;
    const before = meta.mediaLinks.length;
    meta.mediaLinks = meta.mediaLinks.filter((l) => l.fullPath !== filePath);
    if (meta.mediaLinks.length !== before) {
      await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
    }
  }
}

async function createWindow() {
  await ensureDirs();

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    // macOS 使用 .icns 图标，Windows 使用 .ico；保持跨平台兼容
    icon: process.platform === 'darwin'
      ? path.join(__dirname, 'assets/icon.icns')
      : path.join(__dirname, 'assets/icon.ico'), // Windows / 其他
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      // 为了允许在 http://localhost:5173 页面中直接通过 file:// 访问本地媒体文件，
      // 这里关闭 webSecurity（仅建议在桌面应用场景使用）。
      webSecurity: false,
    },
  });

  if (isDev) {
    await win.loadURL('http://localhost:5173');
    //默认打开开发者工具
    //win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// 注册 local-file 协议，用于在渲染进程中安全加载本地媒体文件
function registerLocalFileProtocol() {
  protocol.handle('local-file', (request) => {
    const raw = request.url.slice('local-file://'.length);
    const pathStr = decodeURIComponent(raw.replace(/^\/+/, ''));
    const normalized = pathStr.replace(/\\/g, '/');
    const fileUrl = normalized.match(/^[a-zA-Z]:/) ? `file:///${normalized}` : `file://${normalized}`;
    return net.fetch(fileUrl);
  });
}

app.whenReady().then(async () => {
  registerLocalFileProtocol();
  await loadSettings();
  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// 关闭前自动同步：清理各项目中已不存在的媒体链接
async function syncBeforeQuit() {
  try {
    await loadSettings();
    const root = getProjectRoot();
    const entries = await fsp.readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(root, entry.name, 'project.json');
      let meta;
      try {
        const raw = await fsp.readFile(metaPath, 'utf-8');
        meta = JSON.parse(raw);
      } catch {
        continue;
      }
      if (!meta.mediaLinks || !Array.isArray(meta.mediaLinks)) continue;
      const valid = [];
      for (const link of meta.mediaLinks) {
        try {
          await fsp.access(link.fullPath);
          valid.push(link);
        } catch {
          // 文件不存在，跳过
        }
      }
      if (valid.length !== meta.mediaLinks.length) {
        meta.mediaLinks = valid;
        await fsp.writeFile(metaPath, JSON.stringify(meta, null, 2), 'utf-8');
      }
    }
  } catch (err) {
    console.error('同步失败', err);
  }
}

let isQuitting = false;
app.on('before-quit', async (event) => {
  if (!isQuitting) {
    event.preventDefault();
    isQuitting = true;
    await syncBeforeQuit();
    app.quit();
  }
});

ipcMain.handle('media:list', async () => {
  return listMediaLibrary();
});

ipcMain.handle('project:list', async () => {
  return listProjectFiles();
});

// 配置相关：获取 / 更新根目录、当前项目
ipcMain.handle('settings:get', async () => {
  await loadSettings();
  return settings;
});

ipcMain.handle('settings:updateRoots', async (event, { projectRoot, mediaRoot }) => {
  if (projectRoot) {
    settings.projectRoot = projectRoot;
  }
  if (mediaRoot) {
    settings.mediaRoot = mediaRoot;
  }
  settings.initialized = Boolean(settings.projectRoot && settings.mediaRoot);
  await saveSettings();
  await ensureDirs();
  return settings;
});

ipcMain.handle('settings:setProject', async (event, { name }) => {
  if (name && typeof name === 'string') {
    settings.currentProject = name.trim() || 'default';
    await saveSettings();
    await ensureDirs();
  }
  const projectState = await listProjectFiles();
  return { settings, projectState };
});

ipcMain.handle('settings:pickDir', async (event, { title }) => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win || null, {
    title: title || '选择目录',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
    return null;
  }
  return result.filePaths[0];
});

// 项目列表
ipcMain.handle('projects:list', async () => {
  return listProjects();
});

// 创建项目（目录名自动加 YYYYMMDD_ 前缀）
ipcMain.handle('projects:create', async (event, { name }) => {
  return createProject(name);
});

// 重命名项目
ipcMain.handle('projects:rename', async (event, { folderName, newName }) => {
  return renameProject(folderName, newName);
});

// 删除项目，deleteLinkedMedia 为 true 时同时删除媒体库中该项目的链接素材
ipcMain.handle('projects:delete', async (event, { folderName, deleteLinkedMedia }) => {
  return deleteProject(folderName, !!deleteLinkedMedia);
});

// 获取项目 meta（用于删除确认时显示链接素材数量）
ipcMain.handle('projects:getMeta', async (event, { folderName }) => {
  return getProjectMetaByFolder(folderName);
});

// 项目文件重命名
ipcMain.handle('projectFile:rename', async (event, { filePath, newName }) => {
  return renameProjectFile(filePath, newName);
});

// 项目文件删除
ipcMain.handle('projectFile:delete', async (event, { filePath }) => {
  await deleteProjectFile(filePath);
  return listProjectFiles();
});

// 媒体库文件重命名/删除
ipcMain.handle('mediaFile:rename', async (event, { filePath, newName }) => {
  return renameMediaFile(filePath, newName);
});

ipcMain.handle('mediaFile:delete', async (event, { filePath }) => {
  await deleteMediaFile(filePath);
  const library = await listMediaLibrary();
  const projectState = await listProjectFiles();
  return { mediaLibrary: library, projectState };
});

// 打开路径（文件用默认应用，文件夹用资源管理器）
ipcMain.handle('shell:openPath', async (event, { targetPath }) => {
  return shell.openPath(targetPath);
});

ipcMain.handle('shell:showItemInFolder', async (event, { targetPath }) => {
  shell.showItemInFolder(targetPath);
});

ipcMain.handle('project:import', async (event, { target, filePaths }) => {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return { files: [], mediaLinks: [] };

  if (target === 'project') {
    await importFilesToProject(filePaths);
  } else if (target === 'library') {
    await importFilesToLibrary(filePaths);
  }

  const projectState = await listProjectFiles();
  const libraryState = await listMediaLibrary();
  return {
    ...projectState,
    mediaLibrary: libraryState,
  };
});

// ipcMain.on('drag:start', (event, filePath) => {
//   event.returnValue = null;
//   if (!filePath) return;
//   const absolutePath = path.resolve(filePath);
//   const icon = nativeImage.createFromPath(absolutePath);
//   const opts = { file: absolutePath };
//   if (!icon.isEmpty()) opts.icon = icon;
//   try {
//     event.sender.startDrag(opts);
//   } catch (err) {
//     console.error('startDrag failed', err);
//   }
// });

ipcMain.on('drag:start', (event, filePath) => {
  event.returnValue = null;
  if (!filePath) return;

  try {
    const absolutePath = path.resolve(filePath);
    let icon = nativeImage.createFromPath(absolutePath);
    
    // 优化：视频用自定义图标，图片用自身图标
    if (icon.isEmpty()) {
      // 替换为你项目中视频图标的绝对路径（比如 main.js 同目录的 video-icon.png）
      const videoIconPath = path.join(__dirname, 'video-icon.png');
      icon = nativeImage.createFromPath(videoIconPath);
    }
    icon = icon.resize({ 
      width: 32,  // 固定宽度32px
      height: 32, // 固定高度32px，实现1:1
      quality: 'best' // 保持图标清晰度
    });

    event.sender.startDrag({
      file: absolutePath,
      icon: icon
    });
  } catch (err) {
    console.error('startDrag failed', err);
  }
});
