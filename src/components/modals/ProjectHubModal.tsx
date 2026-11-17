import React, { useRef, useState } from 'react';
import { ProjectSummary, ProjectState } from '../../types/infrastructure';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  X,
  FolderPlus,
  LayoutTemplate,
  Upload,
  Trash2,
  RotateCcw,
  Copy,
  FolderOpen,
  Download,
  Radar,
  ShieldAlert,
  Check,
  Info,
  MessageSquarePlus
} from 'lucide-react';
import { exportAllProjectsBundle, migrateAndValidateProject } from '../../utils/projectStorage';
import {
  APP_PRODUCT_NAME,
  APP_VERSION,
  BRAND_INFO,
  buildFeedbackFormUrl,
  isFeedbackFormConfigured
} from '../../config/appInfo';
import { HachihiLogo } from '../HachihiLogo';

interface ProjectHubModalProps {
  isOpen: boolean;
  isWelcomeMode?: boolean;
  currentProjectId: string;
  projectList: ProjectSummary[];
  lastBackupAt: string | null;
  onClose: () => void;
  onCreateBlank: (name: string) => void;
  onOpenTemplates: () => void;
  onSwitchProject: (id: string) => void;
  onDuplicateCurrent: () => void;
  onTrashProject: (id: string) => void;
  onRestoreProject: (id: string) => void;
  onDeletePermanently: (id: string) => void;
  onImportProjectJson: (raw: unknown) => { ok: boolean; error?: string };
  onRequestPackageImport?: (file: File) => Promise<void> | void;
  onImportScannerFile: (file: File, options?: { diffMerge?: boolean }) => Promise<void>;
  onRecordFullBackup: () => Promise<void>;
  onOpenAbout?: () => void;
}

export const ProjectHubModal: React.FC<ProjectHubModalProps> = ({
  isOpen,
  isWelcomeMode = false,
  currentProjectId,
  projectList,
  lastBackupAt,
  onClose,
  onCreateBlank,
  onOpenTemplates,
  onSwitchProject,
  onDuplicateCurrent,
  onTrashProject,
  onRestoreProject,
  onDeletePermanently,
  onImportProjectJson,
  onRequestPackageImport,
  onImportScannerFile,
  onRecordFullBackup,
  onOpenAbout
}) => {
  const [activeTab, setActiveTab] = useState<'active' | 'trash'>('active');
  const [newName, setNewName] = useState('');
  const [scannerDiffMerge, setScannerDiffMerge] = useState(true);
  const [banner, setBanner] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, onClose);

  if (!isOpen) return null;

  const activeProjects = projectList.filter(p => !p.isTrashed);
  const trashedProjects = projectList.filter(p => p.isTrashed);

  const daysSinceBackup = (() => {
    if (!lastBackupAt) return 999;
    return (Date.now() - new Date(lastBackupAt).getTime()) / (1000 * 60 * 60 * 24);
  })();

  const handleBackupAll = async () => {
    try {
      const bundle = await exportAllProjectsBundle();
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `HACHIHI_All_Projects_Backup_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      await onRecordFullBackup();
      setBanner({ type: 'success', text: `Đã sao lưu ${bundle.projects.length} dự án thành tệp JSON!` });
    } catch (err) {
      setBanner({ type: 'error', text: `Lỗi sao lưu: ${err instanceof Error ? err.message : String(err)}` });
    }
  };

  const handleJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    try {
      const { checkImportPayloadSize, MAX_BUNDLE_PROJECTS, MAX_IMPORT_JSON_BYTES } = await import('../../utils/security');
      const sizeCheck = checkImportPayloadSize(file, MAX_IMPORT_JSON_BYTES, file.name);
      if (!sizeCheck.ok) {
        setBanner({ type: 'error', text: sizeCheck.error });
        return;
      }

      if (onRequestPackageImport) {
        onClose();
        await onRequestPackageImport(file);
        return;
      }

      const text = await file.text();
      const parsed: unknown = JSON.parse(text);
      // Multi-project workspace bundle restores directly across projects
      if (
        parsed &&
        typeof parsed === 'object' &&
        'projects' in parsed &&
        Array.isArray((parsed as { projects: unknown[] }).projects)
      ) {
        const list = (parsed as { projects: ProjectState[] }).projects;
        if (list.length > MAX_BUNDLE_PROJECTS) {
          setBanner({ type: 'error', text: `Gói sao lưu vượt quá giới hạn (${MAX_BUNDLE_PROJECTS} dự án).` });
          return;
        }
        let imported = 0;
        for (const proj of list) {
          const mig = migrateAndValidateProject(proj);
          if (mig.ok) {
            onImportProjectJson(mig.project);
            imported++;
          }
        }
        setBanner({ type: 'success', text: `Đã khôi phục ${imported} dự án từ gói sao lưu!` });
        return;
      }

      const res = onImportProjectJson(parsed);
      if (res.ok) {
        onClose();
      } else {
        setBanner({ type: 'error', text: res.error || 'Tệp JSON không hợp lệ.' });
      }
    } catch {
      setBanner({ type: 'error', text: 'Không thể đọc tệp .hachihi.json / .json.' });
    }
  };

  const handleScannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await onImportScannerFile(file, { diffMerge: scannerDiffMerge });
      onClose();
    } catch (err) {
      setBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      e.target.value = '';
    }
  };

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 no-print" role="dialog" aria-modal="true" aria-label="Quản lý dự án & sao lưu">
      <div className="w-full h-dvh sm:h-auto sm:max-w-4xl sm:max-h-[92dvh] flex flex-col bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-slate-800 dark:text-slate-100 text-xs pb-safe">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/50 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <HachihiLogo size={36} />
            <div className="min-w-0">
              <h2 className="text-sm sm:text-base font-bold text-slate-900 dark:text-white truncate">
                {isWelcomeMode ? 'Chào mừng đến với HACHIHI Network & Electrical Designer' : 'Quản Lý Nhiều Bản Vẽ & Sao Lưu'}
              </h2>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                Lưu trữ cục bộ an toàn bằng IndexedDB · Hỗ trợ nhiều dự án, thùng rác khôi phục & nhập quét mạng
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Đóng quản lý dự án"
            className="touch-target p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 shrink-0"
            title="Đóng"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Backup Reminder Banner */}
        {daysSinceBackup >= 7 && activeProjects.length > 0 && (
          <div className="px-6 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-medium">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>
                {lastBackupAt
                  ? `Đã hơn ${Math.floor(daysSinceBackup)} ngày kể từ lần sao lưu toàn bộ gần nhất. Dữ liệu chỉ lưu tại trình duyệt này.`
                  : 'Chưa có bản sao lưu toàn bộ nào. Hãy tải file JSON dự phòng định kỳ để tránh mất dữ liệu khi xóa bộ nhớ trình duyệt.'}
              </span>
            </div>
            <button
              onClick={handleBackupAll}
              className="px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white font-semibold whitespace-nowrap shrink-0 flex items-center gap-1"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Sao lưu ngay</span>
            </button>
          </div>
        )}

        {banner && (
          <div
            className={`px-6 py-2 border-b font-medium flex items-center gap-2 ${
              banner.type === 'error'
                ? 'bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-900'
                : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-900'
            }`}
          >
            <Check className="w-4 h-4 shrink-0" />
            <span>{banner.text}</span>
          </div>
        )}

        <div className="p-6 overflow-y-auto space-y-5">
          {/* Quick Start Actions */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-2">
              <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                <FolderPlus className="w-4 h-4 text-blue-600" />
                <span>Bản vẽ trống mới</span>
              </div>
              <input
                type="text"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="Tên dự án mới..."
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus:border-blue-500"
              />
              <button
                onClick={() => {
                  onCreateBlank(newName.trim() || 'HACHIHI Dự án Mới');
                  setNewName('');
                  onClose();
                }}
                className="w-full py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold"
              >
                Tạo bản vẽ trống
              </button>
            </div>

            <button
              onClick={() => {
                onClose();
                onOpenTemplates();
              }}
              className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500 bg-slate-50/70 dark:bg-slate-800/40 text-left flex flex-col justify-between transition-colors"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <LayoutTemplate className="w-4 h-4 text-indigo-600" />
                  <span>Tạo từ Mẫu chuyên ngành</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Mạng văn phòng, Tòa nhà 5 tầng, Phòng Server Rack, CCTV &amp; Wi-Fi.
                </p>
              </div>
              <span className="text-[11px] font-semibold text-blue-600 mt-2">Mở thư viện mẫu &rarr;</span>
            </button>

            <label className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 bg-slate-50/70 dark:bg-slate-800/40 text-left flex flex-col justify-between cursor-pointer transition-colors">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <Upload className="w-4 h-4 text-emerald-600" />
                  <span>Nhập Gói / JSON dự án</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Mở Gói dự án (.hachihi.json), tệp JSON sao lưu đơn lẻ, gói toàn bộ dự án hoặc bản V3.
                </p>
              </div>
              <span className="text-[11px] font-semibold text-emerald-600 mt-2">Chọn .hachihi.json / .json &rarr;</span>
              <input type="file" accept=".hachihi.json,.json" onChange={handleJsonUpload} className="hidden" />
            </label>

            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-sky-500 bg-slate-50/70 dark:bg-slate-800/40 text-left flex flex-col justify-between transition-colors">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                  <Radar className="w-4 h-4 text-sky-600" />
                  <span>Nhập từ NetworkScanner</span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Dựng nhanh sơ đồ từ kết quả quét IP/MAC/Vendor (CSV hoặc JSON).
                </p>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer pt-0.5">
                  <input
                    type="checkbox"
                    checked={scannerDiffMerge}
                    onChange={e => setScannerDiffMerge(e.target.checked)}
                    className="rounded accent-sky-600"
                  />
                  <span>Gộp đối chiếu (tránh trùng MAC/IP)</span>
                </label>
              </div>
              <label className="text-[11px] font-semibold text-sky-600 mt-2 cursor-pointer hover:underline inline-block">
                <span>Chọn file quét (.csv/.json) &rarr;</span>
                <input type="file" accept=".csv,.json" onChange={handleScannerUpload} className="hidden" />
              </label>
            </div>
          </div>

          {/* Saved Projects List & Trash Tabs */}
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
              <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg">
                <button
                  onClick={() => setActiveTab('active')}
                  className={`px-3 py-1 rounded-md font-semibold text-xs ${
                    activeTab === 'active' ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-xs' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Bản vẽ đang lưu ({activeProjects.length})
                </button>
                <button
                  onClick={() => setActiveTab('trash')}
                  className={`px-3 py-1 rounded-md font-semibold text-xs ${
                    activeTab === 'trash' ? 'bg-white dark:bg-slate-900 text-rose-600 shadow-xs' : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Thùng rác ({trashedProjects.length})
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={onDuplicateCurrent}
                  className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold flex items-center gap-1.5"
                >
                  <Copy className="w-3.5 h-3.5 text-blue-600" />
                  <span>Nhân bản bản đang mở</span>
                </button>
                <button
                  onClick={handleBackupAll}
                  className="px-3 py-1.5 rounded-md bg-slate-900 dark:bg-blue-600 hover:opacity-90 text-white font-semibold flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Sao lưu toàn bộ (.json)</span>
                </button>
              </div>
            </div>

            {activeTab === 'active' ? (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {activeProjects.length === 0 ? (
                  <div className="p-6 text-center text-slate-400">Chưa có dự án nào được lưu.</div>
                ) : (
                  activeProjects.map(p => {
                    const isCurrent = p.id === currentProjectId;
                    return (
                      <div
                        key={p.id}
                        className={`px-4 py-3 flex items-center justify-between gap-3 ${
                          isCurrent ? 'bg-blue-50/70 dark:bg-blue-950/30' : 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/40'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-slate-900 dark:text-white truncate">
                            {p.name} {isCurrent ? '· Đang mở' : ''}
                          </div>
                          <div className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums mt-0.5">
                            {p.assetCount} Thiết bị · {p.cableCount} Cáp · {p.rackCount} Rack · Cập nhật {new Date(p.lastModified).toLocaleString('vi-VN')}
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {!isCurrent && (
                            <button
                              onClick={() => {
                                onSwitchProject(p.id);
                                onClose();
                              }}
                              className="px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold flex items-center gap-1"
                            >
                              <FolderOpen className="w-3.5 h-3.5" />
                              <span>Mở</span>
                            </button>
                          )}
                          <button
                            onClick={() => onTrashProject(p.id)}
                            className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                            title="Chuyển vào thùng rác"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-200 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                {trashedProjects.length === 0 ? (
                  <div className="p-6 text-center text-slate-400">Thùng rác trống.</div>
                ) : (
                  trashedProjects.map(p => (
                    <div key={p.id} className="px-4 py-3 flex items-center justify-between gap-3 bg-white dark:bg-slate-900">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-slate-800 dark:text-slate-200 truncate">{p.name}</div>
                        <div className="text-[11px] text-slate-400 font-mono">
                          {p.assetCount} Thiết bị · Xóa lúc {p.trashedAt ? new Date(p.trashedAt).toLocaleString('vi-VN') : '—'}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => onRestoreProject(p.id)}
                          className="px-3 py-1.5 rounded-md border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 font-semibold flex items-center gap-1"
                        >
                          <RotateCcw className="w-3.5 h-3.5 text-emerald-600" />
                          <span>Khôi phục</span>
                        </button>
                        <button
                          onClick={() => onDeletePermanently(p.id)}
                          className="px-3 py-1.5 rounded-md bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                        >
                          Xóa vĩnh viễn
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
          <span>
            {APP_PRODUCT_NAME} v{APP_VERSION} · {BRAND_INFO.websiteLabel} · Hotline {BRAND_INFO.hotlineDisplay}
          </span>
          <div className="flex items-center gap-3">
            {onOpenAbout && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenAbout();
                }}
                className="inline-flex items-center gap-1 font-semibold text-[#155EEF] dark:text-blue-400 hover:underline"
              >
                <Info className="w-3.5 h-3.5" />
                <span>Giới thiệu &amp; Hỗ trợ</span>
              </button>
            )}
            {isFeedbackFormConfigured() ? (
              <a
                href={buildFeedbackFormUrl() || '#'}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-slate-700 dark:text-slate-200 hover:text-[#155EEF] hover:underline"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>Góp ý</span>
              </a>
            ) : (
              <span className="inline-flex items-center gap-1 text-slate-400" title="Liên kết biểu mẫu góp ý đang được bổ sung">
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>Góp ý (Sắp có)</span>
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
