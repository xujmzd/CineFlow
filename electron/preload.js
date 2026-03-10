const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  listMedia: () => ipcRenderer.invoke('media:list'),
  listProject: () => ipcRenderer.invoke('project:list'),
  importToProject: (filePaths) =>
    ipcRenderer.invoke('project:import', { target: 'project', filePaths }),
  importToLibrary: (filePaths) =>
    ipcRenderer.invoke('project:import', { target: 'library', filePaths }),
  startFileDrag: (filePath) => ipcRenderer.sendSync('drag:start', filePath),
  // 设置相关
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateRoots: (projectRoot, mediaRoot) =>
    ipcRenderer.invoke('settings:updateRoots', { projectRoot, mediaRoot }),
  pickDirectory: (title) => ipcRenderer.invoke('settings:pickDir', { title }),
  setCurrentProject: (name) => ipcRenderer.invoke('settings:setProject', { name }),
  listProjects: () => ipcRenderer.invoke('projects:list'),
  createProject: (displayName) => ipcRenderer.invoke('projects:create', { name: displayName }),
  renameProject: (folderName, newName) =>
    ipcRenderer.invoke('projects:rename', { folderName, newName }),
  deleteProject: (folderName, deleteLinkedMedia) =>
    ipcRenderer.invoke('projects:delete', { folderName, deleteLinkedMedia }),
  getProjectMeta: (folderName) =>
    ipcRenderer.invoke('projects:getMeta', { folderName }),
  renameProjectFile: (filePath, newName) =>
    ipcRenderer.invoke('projectFile:rename', { filePath, newName }),
  deleteProjectFile: (filePath) =>
    ipcRenderer.invoke('projectFile:delete', { filePath }),
  renameMediaFile: (filePath, newName) =>
    ipcRenderer.invoke('mediaFile:rename', { filePath, newName }),
  deleteMediaFile: (filePath) =>
    ipcRenderer.invoke('mediaFile:delete', { filePath }),
  openPath: (targetPath) =>
    ipcRenderer.invoke('shell:openPath', { targetPath }),
  showItemInFolder: (targetPath) => {
    ipcRenderer.invoke('shell:showItemInFolder', { targetPath });
  },
});

