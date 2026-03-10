import React, { useEffect, useState, useCallback, useMemo } from 'react';

const { electronAPI } = window;

// 将本地文件路径转为可安全加载的 URL（直接使用 file:// 协议）
function toLocalFileUrl(filePath) {
  if (!filePath) return '';
  const normalized = filePath.replace(/\\/g, '/');
  return `file:///${normalized}`;
}

function useAsyncData(loader, deps) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loader()
      .then((res) => {
        if (!cancelled) {
          setData(res);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          console.error(err);
          setError(err);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error, reload: () => loader().then(setData) };
}

function App() {
  const [projectState, setProjectState] = useState({ files: [], mediaLinks: [] });
  const [mediaLibrary, setMediaLibrary] = useState([]);
  const [settings, setSettings] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [pendingProjectRoot, setPendingProjectRoot] = useState('');
  const [pendingMediaRoot, setPendingMediaRoot] = useState('');
  const [projects, setProjects] = useState([]);
  const [activeTab, setActiveTab] = useState('project'); // 'project' | 'library'
  const [showCreateProject, setShowCreateProject] = useState(false);
  const [createProjectName, setCreateProjectName] = useState('');
  const [isDragOverLeft, setIsDragOverLeft] = useState(false);
  const [isDragOverRight, setIsDragOverRight] = useState(false);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryFilter, setLibraryFilter] = useState('all'); // 'all' | 'video' | 'image' | 'other'
  const [editProject, setEditProject] = useState(null);
  const [editProjectName, setEditProjectName] = useState('');
  const [deleteProjectConfirm, setDeleteProjectConfirm] = useState(null);
  const [deleteProjectAlsoMedia, setDeleteProjectAlsoMedia] = useState(false);
  const [editFile, setEditFile] = useState(null);
  const [editFileName, setEditFileName] = useState('');
  const [deleteFileConfirm, setDeleteFileConfirm] = useState(null);
  const [editMediaFile, setEditMediaFile] = useState(null);
  const [editMediaFileName, setEditMediaFileName] = useState('');
  const [deleteMediaConfirm, setDeleteMediaConfirm] = useState(null);

  const refreshAll = useCallback(async () => {
    const [project, library, projectList] = await Promise.all([
      electronAPI.listProject(),
      electronAPI.listMedia(),
      electronAPI.listProjects(),
    ]);
    setProjectState(project);
    setMediaLibrary(library);
    setProjects(projectList);
  }, []);

  const loadInitialSettings = useCallback(async () => {
    const s = await electronAPI.getSettings();
    setSettings(s);
    setPendingProjectRoot(s.projectRoot || '');
    setPendingMediaRoot(s.mediaRoot || '');
    const projectList = await electronAPI.listProjects();
    setProjects(projectList);

    if (!s.initialized || projectList.length === 0) {
      setShowSettings(true);
    } else {
      const latest = projectList[0];
      if (latest && latest.name !== s.currentProject) {
        const res = await electronAPI.setCurrentProject(latest.name);
        setSettings(res.settings);
        setProjectState(res.projectState);
      }
      await refreshAll();
    }
  }, [refreshAll]);

  useEffect(() => {
    loadInitialSettings();
  }, [loadInitialSettings]);

  const handleDrop = async (event, target) => {
    event.preventDefault();
    setIsDragOverLeft(false);
    setIsDragOverRight(false);
    const fileList = Array.from(event.dataTransfer.files || []);
    const paths = fileList.map((f) => f.path).filter(Boolean);
    if (paths.length === 0) return;

    const res =
      target === 'project'
        ? await electronAPI.importToProject(paths)
        : await electronAPI.importToLibrary(paths);

    setProjectState({ files: res.files, mediaLinks: res.mediaLinks });
    setMediaLibrary(res.mediaLibrary);
  };

  const preventDefault = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleStartDrag = (e, filePath) => {
    if (!filePath || !electronAPI?.startFileDrag) return;
    e.preventDefault();
    e.dataTransfer.effectAllowed = 'copy';
    electronAPI.startFileDrag(filePath);
  };

  const handleOpenSettings = () => {
    setShowSettings(true);
  };

  const handlePickProjectRoot = async () => {
    const dir = await electronAPI.pickDirectory('选择项目根目录');
    if (dir) {
      setPendingProjectRoot(dir);
    }
  };

  const handlePickMediaRoot = async () => {
    const dir = await electronAPI.pickDirectory('选择媒体根目录');
    if (dir) {
      setPendingMediaRoot(dir);
    }
  };

  const handleSaveSettings = async () => {
    const updated = await electronAPI.updateRoots(pendingProjectRoot, pendingMediaRoot);
    setSettings(updated);
    setShowSettings(false);
    const projectList = await electronAPI.listProjects();
    setProjects(projectList);
    await refreshAll();
  };

  const handleCreateProject = async () => {
    const name = (createProjectName || '').trim();
    if (!name) return;
    const res = await electronAPI.createProject(name);
    setSettings(res.settings);
    setProjectState(res.projectState);
    setProjects(res.projects);
    setShowCreateProject(false);
    setCreateProjectName('');
    await refreshAll();
  };

  const renderMediaThumb = (item, source) => {
    const ext = (item.name || '').toLowerCase();
    const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(ext);
    const isVideo = /\.(mp4|mov|webm|avi|mkv)$/i.test(ext);
    const isAudio = /\.(mp3|wav|ogg|flac)$/i.test(ext);

    let badgeText = '';
    if (source === 'project-file') badgeText = '项目文件';
    if (source === 'linked') badgeText = '链接素材';
    if (source === 'library') badgeText = '素材库';

    const showFileActions = source === 'project-file';
    const showMediaActions = source === 'library' || source === 'linked';

    return (
      <div
        key={item.fullPath || item.id}
        className="group relative rounded-lg border border-slate-800 bg-slate-900/80 overflow-hidden cursor-pointer hover:border-sky-500 hover:bg-slate-900"
        draggable
        onDragStart={(ev) => handleStartDrag(ev, item.fullPath)}
        onDoubleClick={() => electronAPI?.openPath && electronAPI.openPath(item.fullPath)}
        title={item.fullPath}
      >
        <div className="aspect-video w-full bg-slate-950 flex items-center justify-center overflow-hidden">
          {isImage ? (
            <img
              src={toLocalFileUrl(item.fullPath)}
              alt={item.name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
            />
          ) : isVideo ? (
            <video
              src={toLocalFileUrl(item.fullPath)}
              className="w-full h-full object-cover bg-black"
              muted
              loop
              playsInline
              preload="metadata"
            />
          ) : (
            <div className="flex flex-col items-center justify-center text-[10px] text-slate-400">
              <div className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center mb-1">
                <span className="text-[11px]">
                  {isAudio ? '🎵' : '📄'}
                </span>
              </div>
              <span className="uppercase">{ext.replace('.', '') || 'file'}</span>
            </div>
          )}
        </div>
        <div className="px-2 py-1.5">
          <div className="flex items-center justify-between gap-1 mb-0.5">
            <div className="truncate text-[11px] text-slate-100">{item.name}</div>
            {(showFileActions || showMediaActions) && (
              <div className="flex gap-0.5 shrink-0 opacity-0 group-hover:opacity-100">
                <button
                  type="button"
                  className="px-1 py-0.5 text-[9px] rounded bg-slate-700 hover:bg-slate-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (showFileActions) {
                      setEditFile(item);
                      setEditFileName(item.name);
                    } else {
                      setEditMediaFile(item);
                      setEditMediaFileName(item.name);
                    }
                  }}
                >
                  重命名
                </button>
                <button
                  type="button"
                  className="px-1 py-0.5 text-[9px] rounded bg-red-900/60 hover:bg-red-700"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (showFileActions) {
                      setDeleteFileConfirm(item);
                    } else {
                      setDeleteMediaConfirm(item);
                    }
                  }}
                >
                  删除
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-slate-500 truncate max-w-[70%]">
              {item.fullPath}
            </span>
            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700">
              {badgeText}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const handleRenameProject = async () => {
    if (!editProject || !editProjectName.trim() || !electronAPI?.renameProject) return;
    try {
      const res = await electronAPI.renameProject(editProject.name, editProjectName.trim());
      setSettings(res.settings);
      if (res.projectState) setProjectState(res.projectState);
      setProjects(res.projects);
      setEditProject(null);
      setEditProjectName('');
      await refreshAll();
    } catch (err) {
      console.error('重命名项目失败', err);
    }
  };

  const handleDeleteProject = async () => {
    if (!deleteProjectConfirm || !electronAPI?.deleteProject) return;
    try {
      const res = await electronAPI.deleteProject(
        deleteProjectConfirm.name,
        deleteProjectAlsoMedia,
      );
      setSettings(res.settings);
      setProjectState(res.projectState);
      setProjects(res.projects);
      if (res.mediaLibrary) setMediaLibrary(res.mediaLibrary);
      setDeleteProjectConfirm(null);
      setDeleteProjectAlsoMedia(false);
      await refreshAll();
    } catch (err) {
      console.error('删除项目失败', err);
    }
  };

  const handleRenameFile = async () => {
    if (!editFile || !editFileName.trim() || !electronAPI?.renameProjectFile) return;
    try {
      const updated = await electronAPI.renameProjectFile(editFile.fullPath, editFileName.trim());
      setProjectState((p) => ({
        ...p,
        files: p.files.map((f) =>
          f.fullPath === editFile.fullPath ? updated : f,
        ),
      }));
      setEditFile(null);
      setEditFileName('');
      await refreshAll();
    } catch (err) {
      console.error('重命名文件失败', err);
    }
  };

  const handleDeleteFile = async () => {
    if (!deleteFileConfirm || !electronAPI?.deleteProjectFile) return;
    try {
      const res = await electronAPI.deleteProjectFile(deleteFileConfirm.fullPath);
      setProjectState(res);
      setDeleteFileConfirm(null);
      await refreshAll();
    } catch (err) {
      console.error('删除文件失败', err);
    }
  };

  const handleRenameMediaFile = async () => {
    if (!editMediaFile || !editMediaFileName.trim() || !electronAPI?.renameMediaFile) return;
    try {
      await electronAPI.renameMediaFile(editMediaFile.fullPath, editMediaFileName.trim());
      setEditMediaFile(null);
      setEditMediaFileName('');
      await refreshAll();
    } catch (err) {
      console.error('重命名媒体失败', err);
    }
  };

  const handleDeleteMediaFile = async () => {
    if (!deleteMediaConfirm || !electronAPI?.deleteMediaFile) return;
    try {
      const res = await electronAPI.deleteMediaFile(deleteMediaConfirm.fullPath);
      setMediaLibrary(res.mediaLibrary);
      setProjectState(res.projectState);
      setDeleteMediaConfirm(null);
      await refreshAll();
    } catch (err) {
      console.error('删除媒体失败', err);
    }
  };

  const renderProjectItem = (project) => (
    <div
      key={project.fullPath}
      className={`group flex items-center justify-between gap-1 px-2 py-1 rounded text-xs cursor-pointer ${
        project.isCurrent
          ? 'bg-emerald-600/60 text-white'
          : 'bg-slate-800/70 hover:bg-slate-700 text-slate-100'
      }`}
      onClick={async () => {
        const res = await electronAPI.setCurrentProject(project.name);
        setSettings(res.settings);
        setProjectState(res.projectState);
        await refreshAll();
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        electronAPI?.openPath?.(project.fullPath);
      }}
    >
      <span className="truncate flex-1" title={project.fullPath}>
        {project.name}
      </span>
      <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-slate-600/80 text-[10px]"
          title="重命名"
          onClick={() => {
            setEditProject(project);
            setEditProjectName(project.name.replace(/^\d{8}_/, ''));
          }}
        >
          编辑
        </button>
        <button
          type="button"
          className="p-0.5 rounded hover:bg-red-600/80 text-[10px]"
          title="删除"
          onClick={async () => {
            const meta = await electronAPI.getProjectMeta(project.name);
            setDeleteProjectConfirm({ ...project, linkCount: meta?.mediaLinks?.length || 0 });
          }}
        >
          删除
        </button>
      </div>
    </div>
  );

  const getMediaType = (name) => {
    const ext = (name || '').toLowerCase();
    if (/\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(ext)) return 'video';
    if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(ext)) return 'image';
    return 'other';
  };

  const filteredMediaLibrary = useMemo(() => {
    let list = mediaLibrary.slice();
    if (libraryFilter !== 'all') {
      list = list.filter((m) => getMediaType(m.name) === libraryFilter);
    }
    const kw = (librarySearch || '').trim().toLowerCase();
    if (kw) {
      list = list
        .map((m) => {
          const name = (m.name || '').toLowerCase();
          const idx = name.indexOf(kw);
          const score = idx >= 0 ? 1000 - idx : 0;
          const matchCount = (name.match(new RegExp(kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
          return { ...m, _score: score + matchCount * 100 };
        })
        .filter((m) => m._score > 0)
        .sort((a, b) => b._score - a._score)
        .map(({ _score, ...rest }) => rest);
    }
    return list;
  }, [mediaLibrary, libraryFilter, librarySearch]);

  const renderCreateProjectModal = () => {
    if (!showCreateProject) return null;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => { setShowCreateProject(false); setCreateProjectName(''); }}>
        <div className="w-[360px] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-4 relative z-10 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
          <div className="text-sm font-semibold text-slate-100 mb-2">创建项目</div>
          <div className="text-[11px] text-slate-400 mb-3">
            输入项目名称，将自动创建 YYYYMMDD_项目名 格式的目录
          </div>
          <input
            className="w-full px-2 py-1.5 rounded border border-slate-700 bg-slate-800/60 text-xs focus:outline-none focus:border-sky-500 mb-4"
            value={createProjectName}
            onChange={(e) => setCreateProjectName(e.target.value)}
            placeholder="例如：电影A"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateProject()}
            autoFocus
          />
          <div className="flex justify-end gap-2 text-xs">
            <button
              type="button"
              className="px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 cursor-pointer"
              onClick={() => {
                setShowCreateProject(false);
                setCreateProjectName('');
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
              onClick={handleCreateProject}
            >
              创建
            </button>
          </div>
        </div>
      </div>
    );
  };

  const renderSettingsModal = () => {
    if (!showSettings) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowSettings(false)}>
        <div className="w-[520px] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-4 relative z-10 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
          <div className="mb-3">
            <div className="text-sm font-semibold text-slate-100 mb-1">根目录设置</div>
            <div className="text-xs text-slate-400">
              第一次使用时需要设置项目根目录和媒体根目录，之后可以通过右上角按钮重新修改。
            </div>
          </div>

          <div className="space-y-3 text-xs">
            <div>
              <div className="text-slate-300 mb-1">项目根目录</div>
              <div className="flex gap-2">
                <input
                  className="flex-1 px-2 py-1 rounded border border-slate-700 bg-slate-800/60 text-xs focus:outline-none focus:border-sky-500"
                  value={pendingProjectRoot}
                  onChange={(e) => setPendingProjectRoot(e.target.value)}
                  placeholder="选择一个用于存放项目的文件夹"
                />
                <button
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600"
                  onClick={handlePickProjectRoot}
                >
                  选择...
                </button>
              </div>
            </div>

            <div>
              <div className="text-slate-300 mb-1">媒体根目录</div>
              <div className="flex gap-2">
                <input
                  className="flex-1 px-2 py-1 rounded border border-slate-700 bg-slate-800/60 text-xs focus:outline-none focus:border-sky-500"
                  value={pendingMediaRoot}
                  onChange={(e) => setPendingMediaRoot(e.target.value)}
                  placeholder="选择一个用于存放媒体库文件的文件夹"
                />
                <button
                  className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600"
                  onClick={handlePickMediaRoot}
                >
                  选择...
                </button>
              </div>
            </div>

          </div>

          <div className="mt-4 flex justify-end gap-2 text-xs">
            {settings?.initialized && (
              <button
                type="button"
                className="px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 cursor-pointer"
                onClick={() => setShowSettings(false)}
              >
                取消
              </button>
            )}
            <button
              type="button"
              className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
              onClick={handleSaveSettings}
            >
              保存设置
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-screen w-screen bg-slate-900 text-slate-100 flex flex-col">
      <header className="px-4 py-2 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
        <div className="flex items-center gap-2">
          <span className="font-semibold tracking-wide">CineFlow 媒体管理</span>
          <span className="text-xs text-slate-500">@xujmzd Version: 0.1.0</span>
          {settings && (
            <span className="text-[11px] text-slate-400 ml-2">
              项目根：{settings.projectRoot || '未设置'} | 媒体根：
              {settings.mediaRoot || '未设置'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
            onClick={refreshAll}
          >
            刷新
          </button>
          <button
            className="text-xs px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 border border-slate-700"
            onClick={handleOpenSettings}
          >
            设置根目录
          </button>
        </div>
      </header>

      <main className="flex-1 grid grid-cols-[0.7fr_2.3fr] gap-3 p-3">
        {/* 左侧：项目列表 + 拖拽上传到当前项目目录 */}
        <section
          className={`flex flex-col rounded-xl border-2 border-dashed transition-colors ${
            isDragOverLeft
              ? 'border-emerald-500 bg-emerald-500/10'
              : 'border-slate-700 bg-slate-900/70'
          }`}
          onDrop={(e) => handleDrop(e, 'project')}
          onDragOver={(e) => {
            preventDefault(e);
            setIsDragOverLeft(true);
            setIsDragOverRight(false);
          }}
          onDragLeave={() => setIsDragOverLeft(false)}
          onDragEnter={(e) => {
            preventDefault(e);
            setIsDragOverLeft(true);
            setIsDragOverRight(false);
          }}
        >
          <div className="px-3 py-2 border-b border-slate-800">
            <div className="text-xs font-medium text-slate-100">项目列表</div>
            <div className="text-[11px] text-slate-500">
              拖拽文件到此处 → 保存到当前项目目录
            </div>
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1 text-xs">
            <button
              className="w-full px-2 py-1.5 rounded border border-dashed border-slate-600 text-slate-400 hover:border-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/5 text-[11px]"
              onClick={() => setShowCreateProject(true)}
            >
              + 创建项目
            </button>
            {projects.length === 0 && (
              <div className="py-4 text-center text-slate-500 text-[11px]">
                暂无项目，点击上方按钮创建
              </div>
            )}
            {projects.map((p) => renderProjectItem(p))}
          </div>
        </section>
        {/* 右侧：项目管理 / 全局素材库 标签页 + 拖拽上传到媒体库 */}
        <section
          className={`flex flex-col rounded-xl border-2 border-dashed transition-colors ${
            isDragOverRight
              ? 'border-sky-500 bg-sky-500/10'
              : 'border-slate-700 bg-slate-900/70'
          }`}
          onDrop={(e) => handleDrop(e, 'library')}
          onDragOver={(e) => {
            preventDefault(e);
            setIsDragOverLeft(false);
            setIsDragOverRight(true);
          }}
          onDragLeave={() => setIsDragOverRight(false)}
          onDragEnter={(e) => {
            preventDefault(e);
            setIsDragOverLeft(false);
            setIsDragOverRight(true);
          }}
        >
          <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
            <div className="flex items-center gap-2 text-xs">
              <button
                className={`px-3 py-1 rounded-full border ${
                  activeTab === 'project'
                    ? 'bg-sky-600 border-sky-500 text-white'
                    : 'bg-slate-900 border-slate-600 text-slate-300'
                }`}
                onClick={() => setActiveTab('project')}
              >
                项目管理
              </button>
              <button
                className={`px-3 py-1 rounded-full border ${
                  activeTab === 'library'
                    ? 'bg-sky-600 border-sky-500 text-white'
                    : 'bg-slate-900 border-slate-600 text-slate-300'
                }`}
                onClick={() => setActiveTab('library')}
              >
                全局素材库
              </button>
            </div>
            <div className="text-[11px] text-slate-500">
              拖拽文件到此处 → 保存到媒体库并添加到当前项目
            </div>
          </div>

          <div className="flex-1 flex flex-col">
            {activeTab === 'project' ? (
              <>
                <div className="px-3 pt-2 pb-1 text-[11px] text-slate-400">
                  项目媒体库：展示当前项目文件夹下的媒体/其他文件，以及该项目在全局素材库中的链接媒体
                </div>
                <div className="flex-1 overflow-auto px-3 pb-3">
                  <div className="mb-2 text-[11px] text-slate-400">当前项目文件夹内容</div>
                  {projectState.files.length === 0 && (
                    <div className="mb-3 text-[11px] text-slate-500">
                      当前项目文件夹中暂无文件。你可以手动在项目目录中放入文件，或通过其他方式生成。
                    </div>
                  )}
                  {projectState.files.length > 0 && (
                    <div className="grid grid-cols-4 gap-3 mb-4">
                      {projectState.files.map((f) => renderMediaThumb(f, 'project-file'))}
                    </div>
                  )}

                  <div className="mt-1 mb-2 text-[11px] text-slate-400">
                    当前项目在全局素材库中的链接媒体
                  </div>
                  {projectState.mediaLinks.length === 0 && (
                    <div className="text-[11px] text-slate-500">
                      当前项目还没有链接任何素材。将文件拖拽到本区域即可导入并建立链接。
                    </div>
                  )}
                  {projectState.mediaLinks.length > 0 && (
                    <div className="grid grid-cols-4 gap-3">
                      {projectState.mediaLinks.map((link) =>
                        renderMediaThumb(link, 'linked'),
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="px-3 pt-2 pb-2 flex flex-wrap items-center gap-2">
                  <input
                    className="px-2 py-1 rounded border border-slate-700 bg-slate-800/60 text-xs w-40 focus:outline-none focus:border-sky-500"
                    value={librarySearch}
                    onChange={(e) => setLibrarySearch(e.target.value)}
                    placeholder="关键词搜索..."
                  />
                  <div className="flex gap-1 text-[11px]">
                    {[
                      { id: 'all', label: '全部' },
                      { id: 'video', label: '视频' },
                      { id: 'image', label: '图片' },
                      { id: 'other', label: '其他' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        className={`px-2 py-0.5 rounded ${
                          libraryFilter === f.id
                            ? 'bg-sky-600 text-white'
                            : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                        }`}
                        onClick={() => setLibraryFilter(f.id)}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex-1 overflow-auto px-3 pb-3">
                  {mediaLibrary.length === 0 && (
                    <div className="h-full flex items-center justify-center text-slate-500 text-[11px]">
                      素材库为空，将素材拖拽到此区域即可建立统一素材库。
                    </div>
                  )}
                  {mediaLibrary.length > 0 && filteredMediaLibrary.length === 0 && (
                    <div className="h-full flex items-center justify-center text-slate-500 text-[11px]">
                      无匹配结果，尝试其他关键词或筛选条件
                    </div>
                  )}
                  {filteredMediaLibrary.length > 0 && (
                    <div className="grid grid-cols-5 gap-3">
                      {filteredMediaLibrary.map((m) => renderMediaThumb(m, 'library'))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </section>
      </main>
      {renderSettingsModal()}
      {renderCreateProjectModal()}
      {editProject && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[360px] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-4 relative z-10" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-100 mb-2">重命名项目</div>
            <input
              className="w-full px-2 py-1.5 rounded border border-slate-700 bg-slate-800/60 text-xs focus:outline-none focus:border-sky-500 mb-4"
              value={editProjectName}
              onChange={(e) => setEditProjectName(e.target.value)}
              placeholder="新项目名称"
              onKeyDown={(e) => e.key === 'Enter' && handleRenameProject()}
              autoFocus
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                className="px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 cursor-pointer"
                onClick={() => { setEditProject(null); setEditProjectName(''); }}
              >
                取消
              </button>
              <button
                type="button"
                className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
                onClick={handleRenameProject}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteProjectConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[400px] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-4 relative z-10" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-100 mb-2">
              确定删除项目「{deleteProjectConfirm.name}」？
            </div>
            <div className="text-[11px] text-slate-400 mb-3">
              此操作将删除项目文件夹及其中所有文件，且不可恢复。
            </div>
            {deleteProjectConfirm.linkCount > 0 && (
              <label className="flex items-center gap-2 text-[11px] text-slate-300 mb-4 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deleteProjectAlsoMedia}
                  onChange={(e) => setDeleteProjectAlsoMedia(e.target.checked)}
                />
                同时删除该项目在媒体库中链接的 {deleteProjectConfirm.linkCount} 个素材文件
              </label>
            )}
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                className="px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 cursor-pointer"
                onClick={() => { setDeleteProjectConfirm(null); setDeleteProjectAlsoMedia(false); }}
              >
                取消
              </button>
              <button
                type="button"
                className="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white cursor-pointer"
                onClick={handleDeleteProject}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
      {editFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[360px] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-4 relative z-10" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-100 mb-2">重命名文件</div>
            <input
              className="w-full px-2 py-1.5 rounded border border-slate-700 bg-slate-800/60 text-xs focus:outline-none focus:border-sky-500 mb-4"
              value={editFileName}
              onChange={(e) => setEditFileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRenameFile()}
              autoFocus
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                className="px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 cursor-pointer"
                onClick={() => { setEditFile(null); setEditFileName(''); }}
              >
                取消
              </button>
              <button
                type="button"
                className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
                onClick={handleRenameFile}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteFileConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[400px] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-4 relative z-10" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-100 mb-2">
              确定删除文件「{deleteFileConfirm.name}」？
            </div>
            <div className="text-[11px] text-slate-400 mb-4">
              此操作不可恢复。
            </div>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                className="px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 cursor-pointer"
                onClick={() => setDeleteFileConfirm(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white cursor-pointer"
                onClick={handleDeleteFile}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
      {editMediaFile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[360px] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-4 relative z-10" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-100 mb-2">重命名媒体文件</div>
            <input
              className="w-full px-2 py-1.5 rounded border border-slate-700 bg-slate-800/60 text-xs focus:outline-none focus:border-sky-500 mb-4"
              value={editMediaFileName}
              onChange={(e) => setEditMediaFileName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRenameMediaFile()}
              autoFocus
            />
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                className="px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 cursor-pointer"
                onClick={() => { setEditMediaFile(null); setEditMediaFileName(''); }}
              >
                取消
              </button>
              <button
                type="button"
                className="px-3 py-1 rounded bg-sky-600 hover:bg-sky-500 text-white cursor-pointer"
                onClick={handleRenameMediaFile}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
      {deleteMediaConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="w-[400px] rounded-xl bg-slate-900 border border-slate-700 shadow-2xl p-4 relative z-10" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-100 mb-2">
              确定删除媒体文件「{deleteMediaConfirm.name}」？
            </div>
            <div className="text-[11px] text-slate-400 mb-4">
              此操作将同时移除所有项目中的引用，且不可恢复。
            </div>
            <div className="flex justify-end gap-2 text-xs">
              <button
                type="button"
                className="px-3 py-1 rounded border border-slate-600 text-slate-300 hover:bg-slate-800 cursor-pointer"
                onClick={() => setDeleteMediaConfirm(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="px-3 py-1 rounded bg-red-600 hover:bg-red-500 text-white cursor-pointer"
                onClick={handleDeleteMediaFile}
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;

