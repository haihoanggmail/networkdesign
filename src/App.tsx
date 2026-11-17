import React, { useState, useRef, useEffect, useCallback, useMemo, Suspense, lazy } from 'react';
import { useProjectStore } from './store/useProjectStore';
import { TopBar } from './components/topbar/TopBar';
import { LeftLibrary, LibraryDragPayload } from './components/sidebar/LeftLibrary';
import { DesignCanvas, Canvas2DDropApi } from './components/canvas/DesignCanvas';
import { PropertiesPanel } from './components/properties/PropertiesPanel';
import { StatusBar } from './components/statusbar/StatusBar';
import { QuickAccessBar } from './components/toolbar/QuickAccessBar';
import { QUICK_TOUR_STORAGE_KEY } from './components/modals/QuickTourOverlay';
import { DESIGN_MODES, DESIGN_MODE_GROUPS } from './utils/designModes';
import {
  WorkspacePresetId,
  getWorkspacePresetMeta,
  computeNextHiddenLayersForPreset,
  loadSavedWorkspacePresetId,
  saveWorkspacePresetId
} from './utils/workspacePresets';
import { ErrorBoundary } from './components/modals/ErrorBoundary';
import { runEngineeringAudit, AuditIssue } from './utils/engineeringValidator';
import { importNetworkScannerData, diffMergeNetworkScannerData } from './utils/scannerImport';
import { ProjectState, DesignMode, CanvasLayerId, SelectionState } from './types/infrastructure';
import {
  resolveCanonicalSelection,
  resolveSelectionFloorId,
  resolveTargetSelectionForAssetOrNode
} from './utils/selectionSync';
import { useWorkspaceLayout, BottomSheetSnap } from './hooks/useWorkspaceLayout';
import { useShortcutKeymap, useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import {
  LAYER_CATALOG,
  canAddDevicesInScene,
  resolveSelectableTargetForLayer
} from './utils/layerPolicy';
import { DEVICE_CATALOG, loadCustomDevicePresets } from './data/deviceCatalog';
import { renderDeviceVisualIcon } from './utils/deviceIcons';
import { layoutRackNodesForElevationMode } from './utils/rackGeometry';
import { ViewportProvider, useViewport } from './contexts/ViewportContext';
import { ViewportController } from './components/viewport/ViewportController';
import { LayerPanel } from './components/layers/LayerPanel';
import { ExportService } from './services/export/exportService';
import {
  RecentActionEntry,
  ReplayableActionId,
  clearRecentActionsStorage,
  loadRecentActions,
  pushRecentAction,
  saveRecentActions
} from './utils/recentActions';
import {
  inspectProjectImportPayload,
  PackagePreviewInspection
} from './utils/projectPackage';
import {
  Layers,
  ShieldCheck,
  Download,
  GripHorizontal,
  X,
  PenTool,
  PlusSquare,
  SlidersHorizontal,
  MoreHorizontal,
  MousePointer,
  Hand,
  GitBranch,
  Square,
  Type,
  Table2,
  Ruler,
  FolderOpen,
  FolderKanban,
  Sun,
  Moon,
  Compass,
  FileArchive,
  Lock,
  Unlock,
  Info,
  MessageSquarePlus,
  ClipboardList,
  Sparkles,
  CheckCircle2,
  Cuboid
} from 'lucide-react';
import {
  APP_VERSION,
  CHANGELOG_HIGHLIGHTS_310,
  buildFeedbackFormUrl,
  isFeedbackFormConfigured
} from './config/appInfo';
import { useOnlineStatus } from './hooks/useOnlineStatus';

interface LaunchQueueFileHandleLike {
  name?: string;
  getFile?: () => Promise<File>;
}

interface LaunchParamsLike {
  files?: LaunchQueueFileHandleLike[];
}

interface WindowWithLaunchQueue extends Window {
  launchQueue?: {
    setConsumer: (consumer: (launchParams: LaunchParamsLike) => void | Promise<void>) => void;
  };
}

// Lazy-loaded heavy modules & modals for optimal bundle splitting
const Network3DScene = lazy(() =>
  import('./components/canvas/Network3DScene').then(m => ({ default: m.Network3DScene }))
);
const NetworkAssistantChat = lazy(() =>
  import('./components/chat/NetworkAssistantChat').then(m => ({ default: m.NetworkAssistantChat }))
);
const BuildingGeneratorModal = lazy(() =>
  import('./components/modals/BuildingGeneratorModal').then(m => ({ default: m.BuildingGeneratorModal }))
);
const TemplateGalleryModal = lazy(() =>
  import('./components/modals/TemplateGalleryModal').then(m => ({ default: m.TemplateGalleryModal }))
);
const ExportModal = lazy(() =>
  import('./components/modals/ExportModal').then(m => ({ default: m.ExportModal }))
);
const DeepInspectModal = lazy(() =>
  import('./components/modals/DeepInspectModal').then(m => ({ default: m.DeepInspectModal }))
);
const GuideModal = lazy(() =>
  import('./components/modals/GuideModal').then(m => ({ default: m.GuideModal }))
);
const ProjectHubModal = lazy(() =>
  import('./components/modals/ProjectHubModal').then(m => ({ default: m.ProjectHubModal }))
);
const EngineeringAuditModal = lazy(() =>
  import('./components/modals/EngineeringAuditModal').then(m => ({ default: m.EngineeringAuditModal }))
);
const CommandPaletteModal = lazy(() =>
  import('./components/modals/CommandPaletteModal').then(m => ({ default: m.CommandPaletteModal }))
);
const ShortcutSettingsModal = lazy(() =>
  import('./components/modals/ShortcutSettingsModal').then(m => ({ default: m.ShortcutSettingsModal }))
);
const InfrastructureDirectoryModal = lazy(() =>
  import('./components/modals/InfrastructureDirectoryModal').then(m => ({
    default: m.InfrastructureDirectoryModal
  }))
);
const QuickTourOverlay = lazy(() =>
  import('./components/modals/QuickTourOverlay').then(m => ({ default: m.QuickTourOverlay }))
);
const PackageImportModal = lazy(() =>
  import('./components/modals/PackageImportModal').then(m => ({ default: m.PackageImportModal }))
);
const BomStatisticsModal = lazy(() =>
  import('./components/modals/BomStatisticsModal').then(m => ({ default: m.BomStatisticsModal }))
);
const AboutModal = lazy(() =>
  import('./components/modals/AboutModal').then(m => ({ default: m.AboutModal }))
);
const ExcelTreeImportModal = lazy(() =>
  import('./components/modals/ExcelTreeImportModal').then(m => ({ default: m.ExcelTreeImportModal }))
);

type ProjectStore = ReturnType<typeof useProjectStore>;

export default function App() {
  const store = useProjectStore();
  return (
    <ViewportProvider defaultViewAllFloors={store.project.floors.length > 1}>
      <AppContent store={store} />
    </ViewportProvider>
  );
}

function AppContent({ store }: { store: ProjectStore }) {
  const viewport = useViewport();
  const workspaceShellRef = useRef<HTMLDivElement>(null);
  const canvasHostRef = useRef<HTMLElement>(null);
  const layout = useWorkspaceLayout(workspaceShellRef);

  // Modals state
  const [isBuildingModalOpen, setIsBuildingModalOpen] = useState(false);
  const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isBomModalOpen, setIsBomModalOpen] = useState(false);
  const [isGuideModalOpen, setIsGuideModalOpen] = useState(false);
  const [isProjectHubOpen, setIsProjectHubOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutModalOpen, setIsShortcutModalOpen] = useState(false);
  const [isDirectoryOpen, setIsDirectoryOpen] = useState(false);
  const [isQuickTourOpen, setIsQuickTourOpen] = useState(false);
  const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);
  const [isExcelTreeModalOpen, setIsExcelTreeModalOpen] = useState(false);
  const [showWhatsNewModal, setShowWhatsNewModal] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(false);
  const [narrowSubDrawer, setNarrowSubDrawer] = useState<'none' | 'draw' | 'more'>('none');
  const isOnline = useOnlineStatus();

  const { keymap, updateShortcut, resetShortcuts } = useShortcutKeymap();

  // Viewport & Layout modes (shared 2D/3D viewport state lives in ViewportContext)
  const [isLeftCollapsed, setIsLeftCollapsed] = useState(false);
  const [isPropertiesCollapsed, setIsPropertiesCollapsed] = useState(false);
  const [activePresetId, setActivePresetId] = useState<WorkspacePresetId>(() => loadSavedWorkspacePresetId());
  const [requestedPropertiesTab, setRequestedPropertiesTab] = useState<
    { tab: 'inspector' | 'power'; nonce: number } | undefined
  >(undefined);
  const [isZenMode, setIsZenMode] = useState(false);
  const [isReadOnlyMode, setIsReadOnlyMode] = useState(false);
  const [showMinimap, setShowMinimap] = useState(true);
  const [showBgMenu, setShowBgMenu] = useState(false);
  const [isAiChatOpen, setIsAiChatOpen] = useState(false);
  const [isQuickExporting, setIsQuickExporting] = useState(false);
  const [draggedPresetName, setDraggedPresetName] = useState<string | null>(null);
  const [activeLibraryDrag, setActiveLibraryDrag] = useState<{
    payload: LibraryDragPayload;
    clientX: number;
    clientY: number;
    isOverTarget: boolean;
    canDrop: boolean;
    hint: string;
  } | null>(null);
  const [toast, setToast] = useState<{ text: string; type: 'success' | 'error' | 'info' } | null>(null);
  const [packagePreview, setPackagePreview] = useState<PackagePreviewInspection | null>(null);
  const [isFileDragOver, setIsFileDragOver] = useState(false);
  const [recentActions, setRecentActions] = useState<RecentActionEntry[]>(() => loadRecentActions());
  const [deepInspectRackView, setDeepInspectRackView] = useState<'2d' | '3d'>('2d');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const packageFileInputRef = useRef<HTMLInputElement>(null);
  const canvas2DDropApiRef = useRef<Canvas2DDropApi | null>(null);
  const addRackActionRef = useRef<(() => void) | null>(null);
  const activeLibraryDragRef = useRef<{
    payload: LibraryDragPayload;
    clientX: number;
    clientY: number;
    isOverTarget: boolean;
    canDrop: boolean;
    hint: string;
  } | null>(null);
  const fileDragDepthRef = useRef(0);
  const toastTimerRef = useRef<number | null>(null);
  const prevTierRef = useRef(layout.layoutTier);
  const prevOrientationRef = useRef<'landscape' | 'portrait'>(
    layout.containerSize.width >= layout.containerSize.height ? 'landscape' : 'portrait'
  );
  const sheetDragStartRef = useRef<{ y: number; snap: BottomSheetSnap } | null>(null);

  const showToast = useCallback((text: string, type: 'success' | 'error' | 'info' = 'info', durationMs = 3500) => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    setToast({ text, type });
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, durationMs);
  }, []);

  const openDeepInspect = useCallback((id: string, rackView: '2d' | '3d' = '2d') => {
    setDeepInspectRackView(rackView);
    store.setDeepInspectId(id);
  }, [store]);

  const recordAction = useCallback((actionId: ReplayableActionId, customLabel?: string) => {
    setRecentActions(prev => {
      const next = pushRecentAction(prev, actionId, customLabel);
      saveRecentActions(next);
      return next;
    });
  }, []);

  const handleClearRecentActions = useCallback(() => {
    clearRecentActionsStorage();
    setRecentActions([]);
    showToast('Đã xóa lịch sử thao tác gần đây.', 'info', 2000);
  }, [showToast]);

  // Check AI assistant backend configuration once on mount
  useEffect(() => {
    let cancelled = false;
    fetch('/api/health')
      .then(res => {
        const contentType = res.headers.get('content-type') || '';
        return res.ok && contentType.includes('application/json') ? res.json() : null;
      })
      .then((data: { aiConfigured?: boolean } | null) => {
        if (!cancelled) {
          setAiConfigured(Boolean(data?.aiConfigured));
        }
      })
      .catch(() => {
        if (!cancelled) setAiConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const isAiAvailable = aiConfigured && isOnline;

  useEffect(() => {
    if (!isAiAvailable && isAiChatOpen) {
      setIsAiChatOpen(false);
    }
  }, [isAiAvailable, isAiChatOpen]);

  // Show 60-second onboarding tour once on first visit, or one-time What's New banner on upgrade
  useEffect(() => {
    if (store.showWelcomeModal) return;
    try {
      if (localStorage.getItem(QUICK_TOUR_STORAGE_KEY) !== '1') {
        const id = window.setTimeout(() => setIsQuickTourOpen(true), 250);
        return () => window.clearTimeout(id);
      }
      const seenVersionKey = 'hachihi_last_seen_version';
      if (localStorage.getItem(seenVersionKey) !== APP_VERSION) {
        const id = window.setTimeout(() => setShowWhatsNewModal(true), 300);
        return () => window.clearTimeout(id);
      }
    } catch {
      // ignore storage access issues
    }
  }, [store.showWelcomeModal]);

  // Sync dark mode class and native color-scheme onto <html> for modals, scrollbars, and charts
  useEffect(() => {
    const isDark = Boolean(store.project.settings.isDarkMode);
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
  }, [store.project.settings.isDarkMode]);

  // Open mobile properties bottom sheet to half height when selecting an element
  useEffect(() => {
    if (layout.layoutTier === 'narrow') {
      if (store.selection.type !== 'none' && store.selection.type !== 'canvas' && store.selection.id) {
        if (layout.bottomSheetSnap === 'collapsed') {
          layout.setBottomSheetSnap('half');
        }
      }
    }
  }, [layout.layoutTier, store.selection.type, store.selection.id]);

  // Fit active design to actual visible canvas area
  const handleFitToScreen = useCallback(() => {
    const mode = store.project.activeMode;
    const floorId = store.project.activeFloorId;
    const rawVisNodes = store.project.nodes.filter(n => {
      if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(mode) && n.floorId && floorId && n.floorId !== floorId) {
        return false;
      }
      if (mode === 'topology' && n.diagramMode === 'rack') return false;
      if (mode === 'rack' && n.type !== 'rack') return false;
      return true;
    });
    const visNodes =
      mode === 'rack' ? layoutRackNodesForElevationMode(rawVisNodes, store.project.racks) : rawVisNodes;
    const visRooms = mode === 'rack' ? [] : store.project.rooms.filter(r => !floorId || r.floorId === floorId);

    if (visNodes.length === 0 && visRooms.length === 0) {
      store.setZoom(1);
      store.setPan({ x: 40, y: 40 });
      return;
    }

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of visNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + n.height);
    }
    for (const r of visRooms) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }

    const hostRect = canvasHostRef.current?.getBoundingClientRect();
    const viewW = Math.max(260, hostRect?.width || layout.containerSize.width);
    const viewH = Math.max(240, hostRect?.height || layout.containerSize.height - 100);
    const padding = layout.layoutTier === 'narrow' ? 32 : 56;
    const contentW = Math.max(120, maxX - minX);
    const contentH = Math.max(120, maxY - minY);

    const nextZoom = Math.min(1.35, Math.max(0.25, Math.min((viewW - padding * 2) / contentW, (viewH - padding * 2) / contentH)));
    const roundedZoom = Number(nextZoom.toFixed(2));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    store.setZoom(roundedZoom);
    store.setPan({
      x: Math.round(viewW / 2 - cx * roundedZoom),
      y: Math.round(viewH / 2 - cy * roundedZoom)
    });
  }, [store, layout.containerSize.width, layout.containerSize.height, layout.layoutTier]);

  // Auto-fit diagram gracefully on device rotation / layout tier change
  useEffect(() => {
    const orientation: 'landscape' | 'portrait' =
      layout.containerSize.width >= layout.containerSize.height ? 'landscape' : 'portrait';
    const tierChanged = prevTierRef.current !== layout.layoutTier;
    const orientationChanged = prevOrientationRef.current !== orientation;
    prevTierRef.current = layout.layoutTier;
    prevOrientationRef.current = orientation;

    if ((tierChanged || orientationChanged) && (store.project.nodes.length > 0 || store.project.rooms.length > 0)) {
      const id = window.setTimeout(() => {
        handleFitToScreen();
      }, 120);
      return () => window.clearTimeout(id);
    }
  }, [layout.layoutTier, layout.containerSize.width, layout.containerSize.height, handleFitToScreen, store.project.nodes.length, store.project.rooms.length]);

  // 2D Viewport Snapshot & Handlers registered into shared ViewportContext
  const getViewportSnapshot = useCallback(() => {
    const rect = canvasHostRef.current?.getBoundingClientRect();
    const fallbackW = Math.max(
      300,
      layout.containerSize.width - (layout.layoutTier === 'wide' ? layout.leftWidth + layout.rightWidth : 0)
    );
    const fallbackH = Math.max(240, layout.containerSize.height - 100);
    return {
      pan: store.pan,
      zoom: store.zoom,
      viewportSize: {
        w: Math.max(1, Math.round(rect?.width || fallbackW)),
        h: Math.max(1, Math.round(rect?.height || fallbackH))
      }
    };
  }, [
    store.pan,
    store.zoom,
    layout.containerSize.width,
    layout.containerSize.height,
    layout.layoutTier,
    layout.leftWidth,
    layout.rightWidth
  ]);

  const handleZoomIn2D = useCallback(() => {
    store.setZoom(Math.min(store.zoom + 0.15, 3.0));
  }, [store]);

  const handleZoomOut2D = useCallback(() => {
    store.setZoom(Math.max(store.zoom - 0.15, 0.2));
  }, [store]);

  const handleResetZoom2D = useCallback(() => {
    store.setZoom(1);
    store.setPan({ x: 50, y: 50 });
  }, [store]);

  useEffect(() => {
    viewport.update2DHandlers({
      zoomIn: handleZoomIn2D,
      zoomOut: handleZoomOut2D,
      resetZoom: handleResetZoom2D,
      fitToScreen: handleFitToScreen,
      getViewportSnapshot
    });
  }, [
    viewport.update2DHandlers,
    handleZoomIn2D,
    handleZoomOut2D,
    handleResetZoom2D,
    handleFitToScreen,
    getViewportSnapshot
  ]);

  // Delete current selected item(s) — supports multi-select nodes
  const handleDeleteSelected = useCallback(() => {
    if (store.selection.type === 'node' && store.selection.id) {
      const allIds = [store.selection.id, ...(store.selection.additionalIds || [])];
      store.deleteNodes(allIds);
    } else if (store.selection.type === 'edge' && store.selection.id) {
      store.deleteCable(store.selection.id);
    } else if (store.selection.type === 'room' && store.selection.id) {
      store.deleteRoom(store.selection.id);
    } else if (store.selection.type === 'rack' && store.selection.id) {
      store.deleteRack(store.selection.id);
    }
  }, [store]);

  const handleUserFitToScreen = useCallback(() => {
    recordAction('fit_screen');
    viewport.fitToScreen();
  }, [recordAction, viewport]);

  // Auto-Route single & batch cable wrappers with feedback toast
  const handleAutoRouteCable = useCallback((cableId: string) => {
    store.autoRouteCable(cableId);
    showToast('Đã tự động định tuyến dây cáp tránh vật cản!', 'success', 2000);
  }, [store, showToast]);

  const handleAutoRouteAllCables = useCallback(() => {
    recordAction('auto_route_all');
    const { routedCount } = store.autoRouteAllCables();
    if (routedCount > 0) {
      showToast(`Đã Auto-Route thông minh ${routedCount} tuyến cáp tránh vật cản!`, 'success', 2600);
    } else {
      showToast('Không có tuyến cáp khả dụng trên chế độ/tầng hiện tại.', 'info', 2200);
    }
  }, [recordAction, store, showToast]);

  const handleAutoAssignIps = useCallback(
    (options?: { preserveExistingValid?: boolean }) => {
      recordAction('auto_assign_ip');
      const res = store.autoAssignIps(options);
      if (!res.ok) {
        showToast(res.error || 'Không thể gán IP tự động.', 'error', 4000);
      } else if (res.totalAssignable === 0) {
        showToast('Chưa có thiết bị mạng nào cần gán IP trên sơ đồ.', 'info', 2600);
      } else {
        const suffix =
          res.unassignedCount > 0 ? ` (${res.unassignedCount} thiết bị thiếu IP do hết dải)` : '';
        showToast(
          `Đã gán ${res.assignedCount} IP mới${
            res.preservedCount > 0 ? `, giữ ${res.preservedCount} IP hợp lệ` : ''
          } theo topology (${res.cidrNotation})${suffix}!`,
          res.unassignedCount > 0 ? 'info' : 'success',
          3400
        );
      }
      return res;
    },
    [recordAction, store, showToast]
  );

  const handleQuickExportA4Pdf = useCallback(async () => {
    recordAction('export_pdf_a4');
    showToast(
      viewport.is3DView
        ? 'Đang chụp góc nhìn 3D hiện tại và xuất PDF A4...'
        : 'Đang kết xuất bản vẽ PDF A4 (giữ tỷ lệ & chú giải)...',
      'info',
      3000
    );
    try {
      const res = await ExportService.exportPdf(store.project, {
        contentScope: viewport.is3DView ? '3d' : '2d',
        paperSize: 'A4',
        orientation: 'landscape',
        drawingCode: 'NET-01',
        drawingScale: 'NTS',
        includeDiagram: true,
        includeLegendPanel: true,
        includeRackElevation: true,
        includeTables: true,
        background3D: 'light',
        capture3D: viewport.capture3DImage
      });
      showToast(
        `Đã xuất ${res.filename} (${res.pageCount} trang A4 · ${res.scaleMetrics.scaleRatioLabel})!`,
        'success',
        3200
      );
    } catch (err: unknown) {
      showToast(
        'Lỗi xuất PDF A4: ' + (err instanceof Error ? err.message : String(err)),
        'error',
        5000
      );
    }
  }, [recordAction, viewport.is3DView, viewport.capture3DImage, store.project, showToast]);

  const handleExportRouterTreeExcel = useCallback(async () => {
    try {
      const { exportProjectRouterTreeToExcel } = await import('./utils/excelTreeImporter');
      await exportProjectRouterTreeToExcel(store.project);
      recordAction('export_excel_tree');
      showToast('Đã xuất sơ đồ Cây Router Cha–Con (.xlsx) từ dự án hiện tại!', 'success', 3200);
    } catch (err: unknown) {
      showToast(
        'Không thể xuất cây Router Excel: ' + (err instanceof Error ? err.message : String(err)),
        'error',
        4200
      );
    }
  }, [store.project, recordAction, showToast]);

  const handleQuickExportViewPng = useCallback(async () => {
    if (isQuickExporting || viewport.isCapturing3D) return;
    setIsQuickExporting(true);
    try {
      const res = await ExportService.exportPng(store.project, {
        contentScope: viewport.is3DView ? '3d' : '2d',
        quickView: true,
        whiteBackground2D: true,
        background3D: 'light',
        viewport2D: getViewportSnapshot(),
        capture3D: viewport.capture3DImage
      });
      showToast(
        viewport.is3DView
          ? `Đã chụp nhanh ảnh PNG 3D (${res.exportedFiles[0]})!`
          : `Đã xuất nhanh ảnh PNG góc nhìn hiện tại (${res.exportedFiles[0]})!`,
        'success',
        2800
      );
    } catch (err: unknown) {
      showToast(
        'Lỗi xuất ảnh PNG: ' + (err instanceof Error ? err.message : String(err)),
        'error',
        4500
      );
    } finally {
      setIsQuickExporting(false);
    }
  }, [
    isQuickExporting,
    viewport.isCapturing3D,
    viewport.is3DView,
    viewport.capture3DImage,
    store.project,
    getViewportSnapshot,
    showToast
  ]);

  // Drag-resize handlers for Wide desktop sidebars
  const startSplitterDrag = useCallback(
    (side: 'left' | 'right', e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = side === 'left' ? layout.leftWidth : layout.rightWidth;
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        if (side === 'left') {
          layout.setLeftWidth(startW + dx);
        } else {
          layout.setRightWidth(startW - dx);
        }
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [layout]
  );

  // Customizable Global Keyboard Shortcuts
  const shortcutHandlers = useMemo(
    () => ({
      tool_select: () => {
        if (viewport.is3DView && viewport.is3DDragLocked) return;
        store.setActiveTool('select');
      },
      tool_pan: () => {
        if (viewport.is3DView && viewport.is3DDragLocked) return;
        store.setActiveTool('pan');
      },
      tool_connect: () => {
        if (viewport.is3DView && viewport.is3DDragLocked) return;
        store.setActiveTool('connect');
      },
      tool_text: () => {
        if (viewport.is3DView) return;
        store.setActiveTool('text');
        showToast('Nhấp lên bản vẽ để đặt ghi chú văn bản', 'info', 1800);
      },
      tool_room: () => {
        if (viewport.is3DView) return;
        store.setActiveTool('room');
      },
      tool_measure: () => {
        if (viewport.is3DView) return;
        store.setActiveTool('measure');
        showToast('Kéo trên bản vẽ để đo khoảng cách thực tế (m / px)', 'info', 2000);
      },
      action_legend: () => {
        if (viewport.is3DView) return;
        store.generateOrUpdateLegendNode();
        recordAction('generate_legend');
        showToast('Đã tạo / đồng bộ Bảng chú giải lên trang vẽ!', 'success', 2200);
      },
      action_add_rack: () => {
        addRackActionRef.current?.();
      },
      undo: () => {
        if (store.historyIndex > 0) {
          recordAction('undo');
          store.undo();
        }
      },
      redo: () => {
        if (store.historyIndex < store.history.length - 1) {
          recordAction('redo');
          store.redo();
        }
      },
      duplicate: () => {
        if (store.selection.type === 'node' && store.selection.id) {
          const allIds = [store.selection.id, ...(store.selection.additionalIds || [])];
          store.duplicateNodes(allIds);
          showToast(`Đã nhân bản ${allIds.length} thiết bị`, 'info', 1800);
        }
      },
      save: () => {
        recordAction('save_now');
        void store.markSaved().then(() => {
          showToast('Đã lưu dự án vào IndexedDB!', 'success', 2200);
        });
      },
      delete: () => {
        if (store.selection.type !== 'none') {
          handleDeleteSelected();
        }
      },
      select_all: () => {
        const mode = store.project.activeMode;
        const floorId = store.project.activeFloorId;
        const visibleIds = store.project.nodes
          .filter(n => {
            if (n.hidden) return false;
            if (n.type === 'rack') return false;
            if (mode === 'rack') return false;
            if (mode === 'topology' && n.diagramMode === 'rack') return false;
            if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(mode) && n.floorId && floorId && n.floorId !== floorId) {
              return false;
            }
            return true;
          })
          .map(n => n.id);
        if (visibleIds.length > 0) {
          store.selectMultipleNodes(visibleIds);
        }
      },
      group: () => {
        if (store.selection.type === 'node' && store.selection.id) {
          const allIds = [store.selection.id, ...(store.selection.additionalIds || [])];
          if (allIds.length >= 2) {
            store.groupNodes(allIds);
            showToast(`Đã nhóm ${allIds.length} đối tượng`, 'info', 1800);
          }
        }
      },
      ungroup: () => {
        if (store.selection.type === 'node' && store.selection.id) {
          const allIds = [store.selection.id, ...(store.selection.additionalIds || [])];
          store.ungroupNodes(allIds);
          showToast('Đã tách nhóm đối tượng', 'info', 1800);
        }
      },
      zoom_in: () => viewport.zoomIn(),
      zoom_out: () => viewport.zoomOut(),
      zoom_reset: () => viewport.resetZoom(),
      command_palette: () => setIsCommandPaletteOpen(prev => !prev),
      onEscape: () => {
        if (isShortcutModalOpen) {
          setIsShortcutModalOpen(false);
        } else if (isCommandPaletteOpen) {
          setIsCommandPaletteOpen(false);
        } else if (layout.activeDrawer !== 'none') {
          layout.setActiveDrawer('none');
        } else if (store.connectingSource) {
          store.setConnectingSource(null);
        } else if (store.activeTool !== 'select') {
          store.setActiveTool('select');
        } else {
          store.clearSelection();
        }
      }
    }),
    [
      store,
      viewport,
      handleDeleteSelected,
      showToast,
      recordAction,
      isCommandPaletteOpen,
      isShortcutModalOpen,
      layout
    ]
  );

  useKeyboardShortcuts(keymap, shortcutHandlers, isShortcutModalOpen);

  const focus3DTargetDeferred = useCallback(
    (focusType: 'node' | 'rack' | 'edge', focusId: string) => {
      if (!viewport.is3DView) return;
      if (viewport.focus3DSelection(focusType, focusId)) return;
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          viewport.focus3DSelection(focusType, focusId);
        });
      });
    },
    [viewport]
  );

  // Jump to node/asset/rack from TopBar search, Command Palette, Inspector, Audit, or BOM
  const handleJumpToNode = useCallback(
    (nodeOrAssetId: string) => {
      const resolved = resolveTargetSelectionForAssetOrNode(nodeOrAssetId, store.project);
      if (!resolved) return;

      const targetFloorId = resolved.floorId;
      if (targetFloorId && targetFloorId !== store.project.activeFloorId) {
        store.setActiveFloor(targetFloorId, { preserveSelection: true });
      }

      const targetMode = resolved.node?.diagramMode;
      if (targetMode && targetMode !== store.project.activeMode) {
        store.setDesignMode(targetMode, { preserveSelection: true });
      }

      if (resolved.node && !viewport.is3DView) {
        const hostRect = canvasHostRef.current?.getBoundingClientRect();
        const viewportW =
          hostRect?.width ||
          Math.max(
            300,
            layout.containerSize.width -
              (layout.layoutTier === 'wide' ? layout.leftWidth + layout.rightWidth : 0)
          );
        const viewportH =
          hostRect?.height || Math.max(240, layout.containerSize.height - 100);
        const targetPanX = Math.round(
          viewportW / 2 - (resolved.node.x + resolved.node.width / 2) * store.zoom
        );
        const targetPanY = Math.round(
          viewportH / 2 - (resolved.node.y + resolved.node.height / 2) * store.zoom
        );
        store.setPan({ x: targetPanX, y: targetPanY });
      }

      store.selectItem(resolved.selection.type, resolved.selection.id);

      if (layout.layoutTier === 'wide') {
        setIsPropertiesCollapsed(false);
      }

      if (viewport.is3DView && resolved.selection.id) {
        const focusType: 'node' | 'rack' =
          resolved.selection.type === 'rack' ? 'rack' : 'node';
        const focusId =
          focusType === 'rack'
            ? resolved.selection.id
            : resolved.node?.id || resolved.selection.id;
        focus3DTargetDeferred(focusType, focusId);
      }
    },
    [
      store,
      viewport.is3DView,
      focus3DTargetDeferred,
      layout.containerSize.height,
      layout.containerSize.width,
      layout.layoutTier,
      layout.leftWidth,
      layout.rightWidth
    ]
  );

  const handleJumpToCable = useCallback(
    (cableId: string) => {
      const cable = store.project.cables.find(c => c.id === cableId);
      if (!cable) return;

      const floorId = resolveSelectionFloorId({ type: 'edge', id: cableId }, store.project);
      if (floorId && floorId !== store.project.activeFloorId) {
        store.setActiveFloor(floorId, { preserveSelection: true });
      }

      if (!viewport.is3DView) {
        const src = store.project.nodes.find(n => n.id === cable.sourceNodeId);
        const tgt = store.project.nodes.find(n => n.id === cable.targetNodeId);
        if (src && tgt) {
          const midX = (src.x + src.width / 2 + tgt.x + tgt.width / 2) / 2;
          const midY = (src.y + src.height / 2 + tgt.y + tgt.height / 2) / 2;
          const hostRect = canvasHostRef.current?.getBoundingClientRect();
          const viewportW =
            hostRect?.width ||
            Math.max(
              300,
              layout.containerSize.width -
                (layout.layoutTier === 'wide' ? layout.leftWidth + layout.rightWidth : 0)
            );
          const viewportH =
            hostRect?.height || Math.max(240, layout.containerSize.height - 100);
          store.setPan({
            x: Math.round(viewportW / 2 - midX * store.zoom),
            y: Math.round(viewportH / 2 - midY * store.zoom)
          });
        }
      }

      store.selectItem('edge', cableId);

      if (layout.layoutTier === 'wide') {
        setIsPropertiesCollapsed(false);
      }

      if (viewport.is3DView) {
        focus3DTargetDeferred('edge', cableId);
      }
    },
    [
      store,
      viewport.is3DView,
      focus3DTargetDeferred,
      layout.containerSize.height,
      layout.containerSize.width,
      layout.layoutTier,
      layout.leftWidth,
      layout.rightWidth
    ]
  );

  const handleSelectFrom3D = useCallback(
    (type: SelectionState['type'], id?: string) => {
      store.selectItem(type, id);
      if (type !== 'none' && type !== 'canvas' && id) {
        const canonical = resolveCanonicalSelection(type, id, store.project);
        const floorId = resolveSelectionFloorId(canonical, store.project);
        if (floorId && floorId !== store.project.activeFloorId) {
          store.setActiveFloor(floorId, { preserveSelection: true });
        }
        if (layout.layoutTier === 'wide') {
          setIsPropertiesCollapsed(false);
        }
      }
    },
    [store, layout.layoutTier]
  );

  const handleToggleNodeSelectionFrom3D = useCallback(
    (nodeId: string) => {
      store.toggleNodeSelection(nodeId);
      if (layout.layoutTier === 'wide') {
        setIsPropertiesCollapsed(false);
      }
    },
    [store, layout.layoutTier]
  );

  // Center of viewport in canvas coordinates for quick addition
  const canvasCenter = {
    x: Math.round((-store.pan.x + (canvasHostRef.current?.clientWidth || 720) * 0.45) / store.zoom),
    y: Math.round((-store.pan.y + (canvasHostRef.current?.clientHeight || 480) * 0.45) / store.zoom)
  };

  const auditReport = useMemo(() => runEngineeringAudit(store.project), [store.project]);

  const handleNavigateToAuditTarget = useCallback(
    (targetType: AuditIssue['targetType'], targetId: string) => {
      if (targetType === 'node' || targetType === 'rack') {
        handleJumpToNode(targetId);
      } else if (targetType === 'edge') {
        handleJumpToCable(targetId);
      }
    },
    [handleJumpToNode, handleJumpToCable]
  );

  // Handle direct Excel upload from toolbar using lazy import for ExcelJS splitting
  const handleExcelQuickUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const { parseExcelDevices } = await import('./utils/excelService');
      const result = await parseExcelDevices(file, store.project);
      store.updateProject(prev => ({
        ...prev,
        assets: result.newAssets,
        nodes: result.newNodes,
        racks: result.updatedRacks
      }));
      showToast(`Đã nhập ${result.importedCount ?? Object.keys(result.newAssets).length} thiết bị từ Excel!`, 'success');
    } catch (err: unknown) {
      showToast('Lỗi nhập Excel: ' + (err instanceof Error ? err.message : String(err)), 'error', 5000);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // Handle NetworkScanner CSV/JSON import from ProjectHubModal
  const handleImportScannerFile = useCallback(async (file: File, options?: { diffMerge?: boolean }) => {
    const { checkImportPayloadSize, MAX_SCANNER_FILE_BYTES } = await import('./utils/security');
    const sizeCheck = checkImportPayloadSize(file, MAX_SCANNER_FILE_BYTES, file.name);
    if (!sizeCheck.ok) {
      throw new Error(sizeCheck.error);
    }
    const text = await file.text();
    if (options?.diffMerge && Object.keys(store.project.assets).length > 0) {
      const res = diffMergeNetworkScannerData(text, store.project);
      store.updateProject(prev => ({
        ...prev,
        assets: res.assets,
        nodes: res.nodes,
        cables: res.cables
      }));
      showToast(
        `Đã đối chiếu NetworkScanner: ${res.addedCount} mới, ${res.updatedCount} cập nhật, ${res.unchangedCount} giữ nguyên.`,
        'success'
      );
      return;
    }
    const res = importNetworkScannerData(text, store.project);
    store.updateProject(prev => ({
      ...prev,
      assets: res.assets,
      nodes: res.nodes,
      cables: res.cables
    }));
    showToast(`Đã nhập ${res.importedCount} thiết bị & tự nối sơ đồ từ NetworkScanner!`, 'success');
  }, [store, showToast]);

  // Unified handler for `.hachihi.json` project packages, raw project JSON, or workspace bundles
  const handleRequestPackageImport = useCallback(
    async (file: File) => {
      try {
        const { checkImportPayloadSize, MAX_IMPORT_JSON_BYTES } = await import('./utils/security');
        const sizeCheck = checkImportPayloadSize(file, MAX_IMPORT_JSON_BYTES, file.name);
        if (!sizeCheck.ok) {
          showToast(sizeCheck.error, 'error', 5000);
          return;
        }
        const text = await file.text();
        const inspection = await inspectProjectImportPayload(text, store.projectList, file.name);
        if (!inspection.ok) {
          showToast(inspection.error, 'error', 5000);
          return;
        }
        if (inspection.kind === 'workspace_bundle') {
          let importedCount = 0;
          for (const proj of inspection.projects) {
            const res = store.importValidatedProject(proj);
            if (res.ok) importedCount++;
          }
          if (importedCount > 0) {
            const failNote =
              inspection.failedCount > 0 ? ` (${inspection.failedCount} mục lỗi bị bỏ qua)` : '';
            showToast(
              `Đã khôi phục ${importedCount}/${inspection.projects.length} dự án từ gói sao lưu${failNote}!`,
              'success',
              4500
            );
          } else {
            showToast('Không thể nhập dự án nào từ gói sao lưu này.', 'error', 5000);
          }
          return;
        }
        setPackagePreview(inspection);
      } catch (err: unknown) {
        showToast(
          'Không thể đọc tệp gói dự án: ' + (err instanceof Error ? err.message : String(err)),
          'error',
          5000
        );
      }
    },
    [store, showToast]
  );

  const handlePackageQuickUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file) return;
      await handleRequestPackageImport(file);
    },
    [handleRequestPackageImport]
  );

  // Global drag-and-drop support for `.hachihi.json` / `.json` files (without interfering with device catalog drag)
  useEffect(() => {
    const hasFilesTransfer = (e: DragEvent) =>
      Array.from(e.dataTransfer?.types || []).includes('Files');

    const onDragEnter = (e: DragEvent) => {
      if (!hasFilesTransfer(e)) return;
      e.preventDefault();
      fileDragDepthRef.current += 1;
      setIsFileDragOver(true);
    };

    const onDragOver = (e: DragEvent) => {
      if (!hasFilesTransfer(e)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
    };

    const onDragLeave = (e: DragEvent) => {
      if (!hasFilesTransfer(e)) return;
      fileDragDepthRef.current = Math.max(0, fileDragDepthRef.current - 1);
      if (fileDragDepthRef.current === 0) {
        setIsFileDragOver(false);
      }
    };

    const onDrop = (e: DragEvent) => {
      if (!hasFilesTransfer(e)) return;
      e.preventDefault();
      fileDragDepthRef.current = 0;
      setIsFileDragOver(false);
      const files = Array.from(e.dataTransfer?.files || []);
      const target = files.find(f => /\.(hachihi\.json|json)$/i.test(f.name));
      if (!target) {
        showToast('Chỉ hỗ trợ kéo thả tệp gói dự án .hachihi.json hoặc .json.', 'info', 3500);
        return;
      }
      void handleRequestPackageImport(target);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [handleRequestPackageImport, showToast]);

  // PWA File Handling API: open `.hachihi.json` files directly via OS double-click when installed
  useEffect(() => {
    const win = window as WindowWithLaunchQueue;
    if (!win.launchQueue?.setConsumer) return;
    win.launchQueue.setConsumer(async (launchParams: LaunchParamsLike) => {
      const handles = launchParams?.files;
      if (!handles || handles.length === 0) return;
      const targetHandle =
        handles.find(h => typeof h.name === 'string' && /\.(hachihi\.json|json)$/i.test(h.name)) ||
        handles[0];
      if (!targetHandle?.getFile) return;
      try {
        const file = await targetHandle.getFile();
        await handleRequestPackageImport(file);
      } catch {
        showToast('Không thể mở tệp được truyền từ hệ điều hành.', 'error', 4000);
      }
    });
  }, [handleRequestPackageImport, showToast]);



  const handleAutoLayerDevices = useCallback(() => {
    if (isReadOnlyMode) return;
    recordAction('auto_layer');
    const summary = store.autoAssignDeviceLayers();
    if (summary.updatedCount > 0) {
      showToast(
        `Đã phân lớp ${summary.updatedCount} đối tượng (${summary.counts.network} Network, ${summary.counts.iot} IoT, ${summary.counts.electrical} Điện).`,
        'success',
        3400
      );
    } else {
      showToast('Tất cả thiết bị đã nằm đúng lớp Network / IoT / Điện.', 'info', 2600);
    }
  }, [isReadOnlyMode, recordAction, store, showToast]);

  const handleSelectLayerObjects = useCallback(
    (layerId: CanvasLayerId) => {
      const resolved = resolveSelectableTargetForLayer(store.project, layerId);
      const layerLabel = LAYER_CATALOG.find(item => item.id === layerId)?.label || layerId;
      if (resolved.type === 'none') {
        showToast(`Không có đối tượng hiển thị nào thuộc lớp "${layerLabel}".`, 'info', 2200);
        return;
      }
      if (resolved.type === 'node' && resolved.id) {
        const allIds = [resolved.id, ...(resolved.additionalIds || [])];
        if (allIds.length > 1) {
          store.selectMultipleNodes(allIds);
        } else {
          store.selectItem('node', resolved.id);
        }
        showToast(`Đã chọn ${allIds.length} đối tượng thuộc lớp "${layerLabel}".`, 'info', 2000);
        return;
      }
      if (resolved.id) {
        store.selectItem(resolved.type, resolved.id);
        showToast(`Đã chọn đối tượng đại diện thuộc lớp "${layerLabel}".`, 'info', 2000);
      }
    },
    [store, showToast]
  );

  const handleGenerateLegend = useCallback(() => {
    store.generateOrUpdateLegendNode();
    recordAction('generate_legend');
    showToast('Đã tạo / đồng bộ Bảng chú giải lên trang vẽ!', 'success', 2400);
  }, [store, recordAction, showToast]);

  const handleSaveNow = useCallback(() => {
    recordAction('save_now');
    void store.markSaved().then(() => {
      showToast('Đã lưu dự án vào IndexedDB!', 'success', 2200);
    });
  }, [recordAction, store, showToast]);

  const handleUndo = useCallback(() => {
    if (store.historyIndex > 0) {
      recordAction('undo');
      store.undo();
    }
  }, [recordAction, store]);

  const handleRedo = useCallback(() => {
    if (store.historyIndex < store.history.length - 1) {
      recordAction('redo');
      store.redo();
    }
  }, [recordAction, store]);

  const handleDuplicateSelected = useCallback(() => {
    if (store.selection.type === 'node' && store.selection.id) {
      const allIds = [store.selection.id, ...(store.selection.additionalIds || [])];
      store.duplicateNodes(allIds);
      showToast(`Đã nhân bản ${allIds.length} thiết bị`, 'info', 1800);
    }
  }, [store, showToast]);

  const handleSelectAll = useCallback(() => {
    const mode = store.project.activeMode;
    const floorId = store.project.activeFloorId;
    const visibleIds = store.project.nodes
      .filter(n => {
        if (n.hidden) return false;
        if (n.type === 'rack') return false;
        if (mode === 'rack') return false;
        if (mode === 'topology' && n.diagramMode === 'rack') return false;
        if (
          ['floorplan', 'cctv', 'wifi', 'fiber'].includes(mode) &&
          n.floorId &&
          floorId &&
          n.floorId !== floorId
        ) {
          return false;
        }
        return true;
      })
      .map(n => n.id);
    if (visibleIds.length > 0) {
      store.selectMultipleNodes(visibleIds);
    }
  }, [store]);

  const handleCopySelectedStyle = useCallback(() => {
    if (store.selection.type === 'node' && store.selection.id) {
      if (store.copyNodeStyle(store.selection.id)) {
        showToast('Đã sao chép kiểu đối tượng!', 'info', 1800);
      }
    }
  }, [store, showToast]);

  const handlePasteSelectedStyle = useCallback(() => {
    if (store.selection.type === 'node' && store.selection.id) {
      const allIds = [store.selection.id, ...(store.selection.additionalIds || [])];
      if (store.pasteNodeStyle(allIds)) {
        showToast('Đã dán kiểu cho đối tượng!', 'success', 1800);
      }
    }
  }, [store, showToast]);

  const handleFocusDeviceLibrary = useCallback(() => {
    if (layout.layoutTier === 'wide') {
      setIsLeftCollapsed(false);
    } else {
      layout.setActiveDrawer('library');
    }
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('hachihi:focus-library'));
    }, 60);
  }, [layout]);

  const handleToggle3D = useCallback(() => {
    recordAction('toggle_3d');
    viewport.toggleMode();
  }, [recordAction, viewport]);

  const handleToggleTheme = useCallback(() => {
    recordAction('toggle_theme');
    store.updateSettings({ isDarkMode: !store.project.settings.isDarkMode });
  }, [recordAction, store]);

  const handleToggleGrid = useCallback(() => {
    store.updateSettings({ showGrid: !store.project.settings.showGrid });
  }, [store]);

  const handleToggleSnap = useCallback(() => {
    store.updateSettings({ snapToGrid: !store.project.settings.snapToGrid });
  }, [store]);

  const handleApplyWorkspacePreset = useCallback(
    (presetId: WorkspacePresetId) => {
      saveWorkspacePresetId(presetId);
      setActivePresetId(presetId);
      const preset = getWorkspacePresetMeta(presetId);
      if (preset.targetMode && preset.targetMode !== store.project.activeMode) {
        viewport.setMode('2d');
        store.setDesignMode(preset.targetMode);
      }
      const nextHiddenLayers = computeNextHiddenLayersForPreset(
        store.project.settings.hiddenLayers,
        preset
      );
      store.updateSettings({
        hiddenLayers: nextHiddenLayers,
        ...(typeof preset.showGrid === 'boolean' ? { showGrid: preset.showGrid } : {}),
        ...(typeof preset.showIpAddresses === 'boolean' ? { showIpAddresses: preset.showIpAddresses } : {}),
        ...(typeof preset.showCableCodes === 'boolean' ? { showCableCodes: preset.showCableCodes } : {})
      });
      setIsLeftCollapsed(preset.leftCollapsed);
      setIsPropertiesCollapsed(preset.rightCollapsed);
      setRequestedPropertiesTab({ tab: preset.preferredRightTab, nonce: Date.now() });
      showToast(`Đã áp dụng bố cục "${preset.label}"`, 'info', 2200);
    },
    [store, viewport, showToast]
  );

  const resolveLibraryInsertionPoint = useCallback(
    (fallbackX?: number, fallbackY?: number) => {
      if (viewport.is3DView) {
        const pt3d = viewport.get3DInsertionPoint();
        if (pt3d) return pt3d;
      }
      return {
        x: typeof fallbackX === 'number' ? fallbackX : canvasCenter.x,
        y: typeof fallbackY === 'number' ? fallbackY : canvasCenter.y
      };
    },
    [viewport, canvasCenter.x, canvasCenter.y]
  );

  const handleAddRack = useCallback(
    (rackName = 'Tủ Server Rack 42U', x?: number, y?: number) => {
      if (isReadOnlyMode) return;
      let targetX = x;
      let targetY = y;
      if (typeof targetX !== 'number' || typeof targetY !== 'number') {
        const cursorPos = viewport.is3DView
          ? viewport.get3DInsertionPoint()
          : canvas2DDropApiRef.current?.getCursorCanvasPos();
        if (cursorPos) {
          targetX = cursorPos.x;
          targetY = cursorPos.y;
        } else {
          targetX = canvasCenter.x;
          targetY = canvasCenter.y;
        }
      }
      recordAction('add_rack');
      store.addRack(rackName, 42, targetX, targetY);
    },
    [isReadOnlyMode, viewport, canvasCenter.x, canvasCenter.y, recordAction, store]
  );

  useEffect(() => {
    addRackActionRef.current = () => {
      handleAddRack('Tủ Server Rack 42U');
    };
  }, [handleAddRack]);

  const handleDropCatalogOrCustomDevice = useCallback(
    (presetName: string, x: number, y: number, customPresetId?: string) => {
      if (customPresetId) {
        const customPreset = loadCustomDevicePresets().find(p => p.id === customPresetId);
        if (customPreset) {
          store.addCustomDevicePresetToCanvas(customPreset, x, y);
          return;
        }
      }
      if (
        presetName === 'Tủ Rack Phân Phối IDF' ||
        (presetName.toLowerCase().includes('rack') && !DEVICE_CATALOG.some(d => d.name === presetName))
      ) {
        handleAddRack(presetName, x, y);
        return;
      }
      store.addDeviceFromCatalog(presetName, x, y);
    },
    [store, handleAddRack]
  );

  const updateLibraryDragPreview = useCallback(
    (payload: LibraryDragPayload, clientX: number, clientY: number) => {
      if (viewport.is3DView) {
        const canInsert = canAddDevicesInScene({
          isReadOnlyMode,
          is3DView: true,
          is3DDragLocked: viewport.is3DDragLocked
        });
        if (!canInsert) {
          viewport.clear3DLibraryDropPreview();
          return {
            isOverTarget: false,
            canDrop: false,
            hint: 'Đang khóa 3D — Nhấn Mở khóa để thêm thiết bị'
          };
        }
        const hit = viewport.preview3DLibraryDrop(clientX, clientY, {
          width: payload.width,
          height: payload.height,
          isRack: payload.action === 'rack'
        });
        if (hit) {
          return {
            isOverTarget: true,
            canDrop: true,
            hint: `Thả để đặt vào ${hit.floorName}`
          };
        }
        return {
          isOverTarget: false,
          canDrop: false,
          hint: 'Kéo vào khung nhìn 3D để đặt'
        };
      }

      const preview = canvas2DDropApiRef.current?.previewLibraryDrop(clientX, clientY, payload.presetName, {
        width: payload.width,
        height: payload.height,
        isRack: payload.action === 'rack',
        customPresetId: payload.customPresetId
      });
      if (preview?.rackHitU) {
        return {
          isOverTarget: true,
          canDrop: true,
          hint: preview.rackHitValid
            ? `Đặt vào ${preview.rackHitName || 'Tủ Rack'} · ${preview.rackHitU}U`
            : `Vị trí ${preview.rackHitU}U đã kín (sẽ tự chọn ô trống)`
        };
      }
      if (preview) {
        return {
          isOverTarget: true,
          canDrop: true,
          hint: 'Thả để đặt lên bản vẽ 2D'
        };
      }
      return {
        isOverTarget: false,
        canDrop: false,
        hint: 'Kéo ra vùng bản vẽ để đặt'
      };
    },
    [viewport, isReadOnlyMode]
  );

  const clearAllLibraryDropState = useCallback(() => {
    viewport.clear3DLibraryDropPreview();
    canvas2DDropApiRef.current?.clearLibraryDropPreview();
    activeLibraryDragRef.current = null;
    setActiveLibraryDrag(null);
  }, [viewport]);

  useEffect(() => {
    if (activeLibraryDragRef.current) {
      clearAllLibraryDropState();
    }
  }, [viewport.is3DView, isReadOnlyMode, clearAllLibraryDropState]);

  const handleStartPointerDrag = useCallback(
    (payload: LibraryDragPayload, clientX: number, clientY: number) => {
      const status = updateLibraryDragPreview(payload, clientX, clientY);
      const next = { payload, clientX, clientY, ...status };
      activeLibraryDragRef.current = next;
      setActiveLibraryDrag(next);
    },
    [updateLibraryDragPreview]
  );

  const handleMovePointerDrag = useCallback(
    (clientX: number, clientY: number) => {
      const current = activeLibraryDragRef.current;
      if (!current) return;
      const status = updateLibraryDragPreview(current.payload, clientX, clientY);
      const next = { payload: current.payload, clientX, clientY, ...status };
      activeLibraryDragRef.current = next;
      setActiveLibraryDrag(next);
    },
    [updateLibraryDragPreview]
  );

  const handleEndPointerDrag = useCallback(
    (clientX: number, clientY: number) => {
      const current = activeLibraryDragRef.current;
      if (!current) return;
      const { payload } = current;
      let committed = false;

      if (viewport.is3DView) {
        const canInsert = canAddDevicesInScene({
          isReadOnlyMode,
          is3DView: true,
          is3DDragLocked: viewport.is3DDragLocked
        });
        if (canInsert) {
          const hit = viewport.preview3DLibraryDrop(clientX, clientY, {
            width: payload.width,
            height: payload.height,
            isRack: payload.action === 'rack'
          });
          if (hit) {
            if (payload.action === 'rack') {
              handleAddRack(payload.presetName, hit.x, hit.y);
            } else {
              handleDropCatalogOrCustomDevice(payload.presetName, hit.x, hit.y, payload.customPresetId);
            }
            committed = true;
          }
        }
      } else {
        committed = Boolean(
          canvas2DDropApiRef.current?.commitLibraryDrop(clientX, clientY, payload.presetName, {
            width: payload.width,
            height: payload.height,
            isRack: payload.action === 'rack',
            customPresetId: payload.customPresetId
          })
        );
      }

      clearAllLibraryDropState();
      if (committed && layout.activeDrawer === 'library') {
        layout.setActiveDrawer('none');
      }
    },
    [
      viewport,
      isReadOnlyMode,
      handleAddRack,
      handleDropCatalogOrCustomDevice,
      clearAllLibraryDropState,
      layout
    ]
  );

  const handleCancelPointerDrag = useCallback(() => {
    clearAllLibraryDropState();
  }, [clearAllLibraryDropState]);

  const handleBlockedInsertAttempt = useCallback(() => {
    showToast(
      'Đang khóa không gian 3D — Nhấn Mở khóa cạnh nút 2D / 3D để thêm hoặc kéo thả thiết bị.',
      'info',
      2800
    );
  }, [showToast]);

  const openAuditModal = useCallback(() => {
    recordAction('open_audit');
    setIsAuditModalOpen(true);
  }, [recordAction]);

  const openBomModal = useCallback(() => {
    recordAction('open_bom');
    setIsBomModalOpen(true);
  }, [recordAction]);

  const openExportModal = useCallback(() => {
    recordAction('open_export');
    setIsExportModalOpen(true);
  }, [recordAction]);

  const openExcelTreeModal = useCallback(() => {
    recordAction('open_excel_tree');
    setIsExcelTreeModalOpen(true);
  }, [recordAction]);

  const openTemplateModal = useCallback(() => {
    recordAction('open_templates');
    setIsTemplateModalOpen(true);
  }, [recordAction]);

  const openBuildingModal = useCallback(() => {
    recordAction('open_building');
    setIsBuildingModalOpen(true);
  }, [recordAction]);

  const openGuideModal = useCallback(() => {
    recordAction('open_guide');
    setIsGuideModalOpen(true);
  }, [recordAction]);

  const openShortcutsModal = useCallback(() => {
    recordAction('open_shortcuts');
    setIsShortcutModalOpen(true);
  }, [recordAction]);

  const openDirectoryModal = useCallback(() => {
    recordAction('open_directory');
    setIsDirectoryOpen(true);
  }, [recordAction]);

  const replayRecentAction = useCallback(
    (entry: RecentActionEntry) => {
      switch (entry.id) {
        case 'auto_route_all':
          handleAutoRouteAllCables();
          break;
        case 'fit_screen':
          handleUserFitToScreen();
          break;
        case 'generate_legend':
          handleGenerateLegend();
          break;
        case 'auto_assign_ip':
          handleAutoAssignIps({ preserveExistingValid: true });
          break;
        case 'auto_layer':
          handleAutoLayerDevices();
          break;
        case 'open_audit':
          openAuditModal();
          break;
        case 'open_bom':
          openBomModal();
          break;
        case 'open_export':
          openExportModal();
          break;
        case 'export_pdf_a4':
          void handleQuickExportA4Pdf();
          break;
        case 'open_excel_tree':
          openExcelTreeModal();
          break;
        case 'export_excel_tree':
          void handleExportRouterTreeExcel();
          break;
        case 'toggle_3d':
          handleToggle3D();
          break;
        case 'toggle_theme':
          handleToggleTheme();
          break;
        case 'add_rack':
          handleAddRack();
          break;
        case 'open_directory':
          openDirectoryModal();
          break;
        case 'open_shortcuts':
          openShortcutsModal();
          break;
        case 'open_guide':
          openGuideModal();
          break;
        case 'open_templates':
          openTemplateModal();
          break;
        case 'open_building':
          openBuildingModal();
          break;
        case 'save_now':
          handleSaveNow();
          break;
        case 'undo':
          handleUndo();
          break;
        case 'redo':
          handleRedo();
          break;
      }
    },
    [
      handleAutoRouteAllCables,
      handleUserFitToScreen,
      handleGenerateLegend,
      handleAutoAssignIps,
      handleAutoLayerDevices,
      openAuditModal,
      openBomModal,
      openExportModal,
      handleQuickExportA4Pdf,
      openExcelTreeModal,
      handleExportRouterTreeExcel,
      handleToggle3D,
      handleToggleTheme,
      handleAddRack,
      openDirectoryModal,
      openShortcutsModal,
      openGuideModal,
      openTemplateModal,
      openBuildingModal,
      handleSaveNow,
      handleUndo,
      handleRedo
    ]
  );

  // Properties Panel shared props builder
  const propertiesPanelProps = {
    project: store.project,
    selection: store.selection,
    auditIssues: auditReport.issues,
    is3DView: viewport.is3DView,
    isReadOnlyMode,
    onUpdateAsset: store.updateDeviceAsset,
    onUpdateNode: store.updateNode,
    onSetNodeIconOrLogo: store.setNodeIconOrLogo,
    onToggleNodeLock: store.toggleNodeLock,
    onToggleNodeVisibility: store.toggleNodeVisibility,
    onSelectCable: handleJumpToCable,
    onSelectNode: handleJumpToNode,
    onUpdateCable: store.updateCable,
    onSetCableColor: store.setCableColor,
    onSetCablesColorByType: store.setCablesColorByType,
    onReconnectCableEndpoint: store.reconnectCableEndpoint,
    onUpdateRoom: store.updateRoom,
    onUpdateRack: store.updateRack,
    onAssignDeviceToRackSlot: store.assignDeviceToRackSlot,
    onRemoveDeviceFromRackSlot: store.removeDeviceFromRackSlot,
    onUpdateFloor: (flId: string, partial: Partial<ProjectState['floors'][number]>) => {
      store.updateProject(prev => ({
        ...prev,
        floors: prev.floors.map(f => (f.id === flId ? { ...f, ...partial } : f))
      }));
    },
    onUpdateSettings: store.updateSettings,
    onAutoAssignIps: handleAutoAssignIps,
    onUpdateProjectMeta: store.updateProjectMeta,
    onDuplicateProject: () => {
      void store.duplicateProject().then(() => {
        showToast('Đã nhân bản thành dự án mới!', 'success');
      });
    },
    onDeleteNode: store.deleteNode,
    onDeleteNodes: store.deleteNodes,
    onDuplicateNodes: store.duplicateNodes,
    onGroupNodes: store.groupNodes,
    onUngroupNodes: store.ungroupNodes,
    onAlignNodes: store.alignNodes,
    onDistributeNodes: store.distributeNodes,
    onAutoAlignSnapToGrid: store.autoAlignNodesSnapToGrid,
    onDeleteCable: store.deleteCable,
    onDeleteRoom: store.deleteRoom,
    onDeleteRack: store.deleteRack,
    onOpenDeepInspect: openDeepInspect,
    onCloneFloor: store.cloneFloor,
    onResizeLegendToFit: store.resizeLegendToFit,
    onAutoRouteCable: handleAutoRouteCable,
    onAutoRouteAllCables: handleAutoRouteAllCables,
    hasCopiedStyle: store.hasCopiedStyle,
    onCopyNodeStyle: (id: string) => {
      if (store.copyNodeStyle(id)) {
        showToast('Đã sao chép kiểu đối tượng!', 'info', 1800);
      }
    },
    onPasteNodeStyle: (ids: string[]) => {
      if (store.pasteNodeStyle(ids)) {
        showToast('Đã dán kiểu cho đối tượng!', 'success', 1800);
      }
    },
    layoutTier: layout.layoutTier,
    density: layout.density,
    highContrast: layout.highContrast,
    reducedMotion: layout.reducedMotion,
    onToggleDensity: layout.toggleDensity,
    onToggleHighContrast: layout.toggleHighContrast,
    onToggleReducedMotion: layout.toggleReducedMotion,
    onOpenBomModal: openBomModal,
    onAutoLayerDevices: handleAutoLayerDevices,
    requestedTab: requestedPropertiesTab
  };

  const sheetHeightClass =
    layout.bottomSheetSnap === 'full'
      ? 'h-[86dvh]'
      : layout.bottomSheetSnap === 'half'
      ? 'h-[48dvh]'
      : 'h-[48px]';

  const cycleBottomSheetSnap = () => {
    const order: BottomSheetSnap[] = ['collapsed', 'half', 'full'];
    const next = order[(order.indexOf(layout.bottomSheetSnap) + 1) % order.length];
    layout.setBottomSheetSnap(next);
  };

  return (
    <ErrorBoundary>
      <div
        ref={workspaceShellRef}
        className={`workspace-shell w-screen h-dvh flex flex-col overflow-hidden bg-slate-100 dark:bg-slate-950 text-slate-900 dark:text-slate-100 ${
          store.project.settings.isDarkMode ? 'dark' : ''
        } ${layout.density === 'comfortable' ? 'density-comfortable' : ''} ${
          layout.highContrast ? 'high-contrast' : ''
        } ${layout.reducedMotion ? 'reduce-motion' : ''}`}
      >
        {/* Hidden Excel File Input for quick toolbar button */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleExcelQuickUpload}
          className="hidden"
        />
        {/* Hidden JSON / .hachihi.json Package File Input for top-left Tệp menu */}
        <input
          ref={packageFileInputRef}
          type="file"
          accept=".hachihi.json,.json"
          onChange={handlePackageQuickUpload}
          className="hidden"
        />

        {/* Global File Drag-and-Drop Overlay */}
        {isFileDragOver && (
          <div
            className="fixed inset-0 z-50 bg-[#155EEF]/15 dark:bg-[#155EEF]/25 backdrop-blur-xs flex items-center justify-center p-6 pointer-events-none no-print"
            aria-hidden="true"
          >
            <div className="bg-white dark:bg-slate-900 border-2 border-dashed border-[#155EEF] rounded-2xl px-8 py-7 shadow-2xl flex flex-col items-center text-center gap-2.5 max-w-md">
              <div className="w-12 h-12 rounded-xl bg-[#155EEF]/10 text-[#155EEF] dark:text-blue-400 flex items-center justify-center">
                <FileArchive className="w-6 h-6" />
              </div>
              <div className="text-base font-bold text-slate-900 dark:text-white">
                Thả tệp gói dự án để xem trước & nhập
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                Hỗ trợ <span className="font-semibold text-[#155EEF]">.hachihi.json</span> (kèm SHA-256 & tài nguyên nhúng) hoặc tệp sao lưu <span className="font-semibold">.json</span>.
              </p>
            </div>
          </div>
        )}

        {/* 1. ADAPTIVE TOP BAR */}
        {!isZenMode && (
          <TopBar
            project={store.project}
            hasUnsavedChanges={store.hasUnsavedChanges}
            isSaving={store.isSaving}
            storageError={store.storageError}
            lastSavedAt={store.lastSavedAt}
            auditIssueCount={auditReport.issues.length}
            isAiAvailable={isAiAvailable}
            activePresetId={activePresetId}
            canUndo={store.historyIndex > 0}
            canRedo={store.historyIndex < store.history.length - 1}
            hasSelection={store.selection.type !== 'none'}
            hasNodeSelection={store.selection.type === 'node' && Boolean(store.selection.id)}
            hasCopiedStyle={store.hasCopiedStyle}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onDuplicateSelected={handleDuplicateSelected}
            onDeleteSelected={handleDeleteSelected}
            onSelectAll={handleSelectAll}
            onCopySelectedStyle={handleCopySelectedStyle}
            onPasteSelectedStyle={handlePasteSelectedStyle}
            onApplyWorkspacePreset={handleApplyWorkspacePreset}
            onSaveNow={handleSaveNow}
            onDuplicateProject={() => {
              void store.duplicateProject().then(() => {
                showToast('Đã nhân bản thành dự án mới!', 'success');
              });
            }}
            onSetMode={store.setDesignMode}
            onAutoAssignIps={() => handleAutoAssignIps({ preserveExistingValid: true })}
            onOpenProjectHub={() => setIsProjectHubOpen(true)}
            onOpenEngineeringAudit={openAuditModal}
            onOpenPowerTab={() => {
              setIsPropertiesCollapsed(false);
              setRequestedPropertiesTab({ tab: 'power', nonce: Date.now() });
            }}
            onOpenTemplates={openTemplateModal}
            onOpenBuildingGenerator={openBuildingModal}
            onOpenExport={openExportModal}
            onOpenBomModal={openBomModal}
            onOpenGuide={openGuideModal}
            onOpenQuickTour={() => setIsQuickTourOpen(true)}
            onOpenAbout={() => setIsAboutModalOpen(true)}
            onAddRack={() => handleAddRack('Tủ Server Rack 42U')}
            onNewProject={() => {
              void store.resetCanvas().then(() => {
                showToast('Đã tạo bản vẽ trống mới', 'info');
              });
            }}
            onOpenExcelImport={openExcelTreeModal}
            onOpenJsonImport={() => packageFileInputRef.current?.click()}
            onOpenPackageImport={() => packageFileInputRef.current?.click()}
            isDarkMode={store.project.settings.isDarkMode}
            onToggleTheme={handleToggleTheme}
            is3DView={viewport.is3DView}
            onToggle3DView={handleToggle3D}
            isAiChatOpen={isAiChatOpen}
            onToggleAiChat={isAiAvailable ? () => setIsAiChatOpen(v => !v) : undefined}
            onAutoRouteAllCables={handleAutoRouteAllCables}
            onAutoLayerDevices={handleAutoLayerDevices}
            onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
            onOpenShortcuts={openShortcutsModal}
            onExportA4Pdf={() => void handleQuickExportA4Pdf()}
            onOpenDirectory={openDirectoryModal}
            isReadOnlyMode={isReadOnlyMode}
            layoutTier={layout.layoutTier}
            onShowToast={(msg, type) => showToast(msg, type || 'info', 2800)}
            onToggleLeftDrawer={() => {
              setNarrowSubDrawer('none');
              layout.setActiveDrawer(d => (d === 'library' ? 'none' : 'library'));
            }}
            onToggleRightDrawer={() => {
              setNarrowSubDrawer('none');
              if (layout.layoutTier === 'narrow') {
                layout.setBottomSheetSnap(s => (s === 'collapsed' ? 'half' : 'collapsed'));
              } else {
                layout.setActiveDrawer(d => (d === 'properties' ? 'none' : 'properties'));
              }
            }}
          />
        )}

        {/* 1b. QUICK ACCESS BAR (Frequent Tools, Mode Context & Consolidated Nâng cao) */}
        {!isZenMode && layout.layoutTier !== 'narrow' && (
          <QuickAccessBar
            project={store.project}
            activeTool={store.activeTool}
            canUndo={store.historyIndex > 0}
            canRedo={store.historyIndex < store.history.length - 1}
            hasUnsavedChanges={store.hasUnsavedChanges}
            isSaving={store.isSaving}
            is3DView={viewport.is3DView}
            is3DDragLocked={viewport.is3DDragLocked}
            isReadOnlyMode={isReadOnlyMode}
            recentActions={recentActions}
            onSetTool={store.setActiveTool}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onSaveNow={handleSaveNow}
            onAddDeviceFocus={handleFocusDeviceLibrary}
            onOpenExcelTree={openExcelTreeModal}
            onAutoRouteAllCables={handleAutoRouteAllCables}
            onAutoAssignIps={() => handleAutoAssignIps({ preserveExistingValid: true })}
            onAddRack={() => handleAddRack('Tủ Server Rack 42U')}
            onOpenPowerTab={() => {
              setIsPropertiesCollapsed(false);
              setRequestedPropertiesTab({ tab: 'power', nonce: Date.now() });
            }}
            onToggleCoverageOverlay={() =>
              store.updateSettings({ showCoverageRadius: !store.project.settings.showCoverageRadius })
            }
            onToggleReadOnly={() => setIsReadOnlyMode(v => !v)}
            onAutoLayerDevices={handleAutoLayerDevices}
            onReplayRecentAction={replayRecentAction}
            onClearRecentActions={handleClearRecentActions}
          />
        )}

        {/* MAIN WORKSPACE CONTAINER (Adaptive 3-Tier Layout) */}
        <div className="flex-1 flex overflow-hidden relative">
          {/* WIDE TIER: Docked Resizable Left Library */}
          {!isZenMode && layout.layoutTier === 'wide' && (
            <>
              <LeftLibrary
                project={store.project}
                is3DView={viewport.is3DView}
                is3DDragLocked={viewport.is3DDragLocked}
                isReadOnlyMode={isReadOnlyMode}
                onAddDevice={(presetName, x, y) => {
                  const pt = resolveLibraryInsertionPoint(x, y);
                  store.addDeviceFromCatalog(presetName, pt.x, pt.y);
                }}
                onAddCustomDevice={(preset, x, y) => {
                  const pt = resolveLibraryInsertionPoint(x, y);
                  store.addCustomDevicePresetToCanvas(preset, pt.x, pt.y);
                }}
                onAddTextNode={(x, y) => {
                  store.addTextNode(x, y);
                }}
                onAddShapeNode={(kind, x, y) => {
                  store.addShapeNode(kind, x, y);
                }}
                onGenerateLegend={handleGenerateLegend}
                onAddRack={() => {
                  if (viewport.is3DView) {
                    const pt = resolveLibraryInsertionPoint();
                    handleAddRack('Tủ Rack Phân Phối IDF', pt.x, pt.y);
                  } else {
                    handleAddRack('Tủ Rack Phân Phối IDF');
                  }
                }}
                onDragPresetChange={setDraggedPresetName}
                onStartPointerDrag={handleStartPointerDrag}
                onMovePointerDrag={handleMovePointerDrag}
                onEndPointerDrag={handleEndPointerDrag}
                onCancelPointerDrag={handleCancelPointerDrag}
                onBlockedInsertAttempt={handleBlockedInsertAttempt}
                canvasCenter={canvasCenter}
                widthPx={layout.leftWidth}
                isCollapsed={isLeftCollapsed}
                onToggleCollapse={setIsLeftCollapsed}
              />
              {!isLeftCollapsed && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Kéo đổi chiều rộng thư viện"
                  onPointerDown={e => startSplitterDrag('left', e)}
                  className="w-1.5 h-full cursor-col-resize hover:bg-blue-500/40 active:bg-blue-600/60 transition-colors shrink-0 no-print z-10"
                />
              )}
            </>
          )}

          {/* MEDIUM & NARROW TIERS: Slide-Over Left Library Drawer */}
          {!isZenMode && layout.layoutTier !== 'wide' && layout.activeDrawer === 'library' && (
            <>
              <div
                onClick={() => layout.setActiveDrawer('none')}
                className={`fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] transition-opacity no-print ${
                  activeLibraryDrag && activeLibraryDrag.clientX > 280
                    ? 'opacity-10 pointer-events-none'
                    : 'opacity-100'
                }`}
                aria-hidden="true"
              />
              <div
                className={`fixed inset-y-0 left-0 z-40 pt-safe pb-safe shadow-2xl transition-opacity no-print ${
                  activeLibraryDrag && activeLibraryDrag.clientX > 280
                    ? 'opacity-15 pointer-events-none'
                    : 'opacity-100'
                }`}
              >
                <LeftLibrary
                  project={store.project}
                  is3DView={viewport.is3DView}
                  is3DDragLocked={viewport.is3DDragLocked}
                  isReadOnlyMode={isReadOnlyMode}
                  onAddDevice={(presetName, x, y) => {
                    const pt = resolveLibraryInsertionPoint(x, y);
                    store.addDeviceFromCatalog(presetName, pt.x, pt.y);
                    layout.setActiveDrawer('none');
                  }}
                  onAddCustomDevice={(preset, x, y) => {
                    const pt = resolveLibraryInsertionPoint(x, y);
                    store.addCustomDevicePresetToCanvas(preset, pt.x, pt.y);
                    layout.setActiveDrawer('none');
                  }}
                  onAddTextNode={(x, y) => {
                    store.addTextNode(x, y);
                    layout.setActiveDrawer('none');
                  }}
                  onAddShapeNode={(kind, x, y) => {
                    store.addShapeNode(kind, x, y);
                    layout.setActiveDrawer('none');
                  }}
                  onGenerateLegend={() => {
                    store.generateOrUpdateLegendNode();
                    layout.setActiveDrawer('none');
                    showToast('Đã tạo / đồng bộ Bảng chú giải lên trang vẽ!', 'success', 2400);
                  }}
                  onAddRack={() => {
                    if (viewport.is3DView) {
                      const pt = resolveLibraryInsertionPoint();
                      handleAddRack('Tủ Rack Phân Phối IDF', pt.x, pt.y);
                    } else {
                      handleAddRack('Tủ Rack Phân Phối IDF');
                    }
                    layout.setActiveDrawer('none');
                  }}
                  onDragPresetChange={setDraggedPresetName}
                  onStartPointerDrag={handleStartPointerDrag}
                  onMovePointerDrag={handleMovePointerDrag}
                  onEndPointerDrag={handleEndPointerDrag}
                  onCancelPointerDrag={handleCancelPointerDrag}
                  onBlockedInsertAttempt={handleBlockedInsertAttempt}
                  canvasCenter={canvasCenter}
                  widthPx={296}
                  isOverlayDrawer
                  onCloseDrawer={() => layout.setActiveDrawer('none')}
                />
              </div>
            </>
          )}

          {/* CENTRAL DESIGN CANVAS */}
          <main ref={canvasHostRef} className="flex-1 h-full relative overflow-hidden bg-[#F1F5F9] dark:bg-[#0B1120]">
            {toast && (
              <div
                role="status"
                aria-live="polite"
                className={`absolute top-14 right-4 z-40 px-3.5 py-2 rounded-lg text-white text-xs font-semibold shadow-lg transition-all no-print ${
                  toast.type === 'error'
                    ? 'bg-rose-600'
                    : toast.type === 'success'
                    ? 'bg-emerald-600'
                    : 'bg-blue-600'
                }`}
              >
                {toast.text}
              </div>
            )}

            {viewport.is3DView ? (
              <Suspense
                fallback={
                  <div className="w-full h-full flex items-center justify-center bg-slate-950 text-slate-200 text-sm font-medium">
                    Đang tải mô hình không gian 3D...
                  </div>
                }
              >
                <Network3DScene
                  ref={viewport.register3DHandle}
                  project={store.project}
                  selection={store.selection}
                  activeTool={store.activeTool}
                  isReadOnlyMode={isReadOnlyMode}
                  isSceneDragLocked={viewport.is3DDragLocked}
                  view3DOptions={viewport.view3DOptions}
                  onChangeView3DOptions={viewport.setView3DOptions}
                  onContextLostChange={viewport.setIs3DContextLost}
                  onSelect={handleSelectFrom3D}
                  onToggleNodeSelection={handleToggleNodeSelectionFrom3D}
                  onSetTool={store.setActiveTool}
                  onToggleNodeLock={store.toggleNodeLock}
                  onUpdateNode={store.updateNode}
                  onAddCable={store.addCable}
                  onUpdateCable={store.updateCable}
                  onAutoRouteCable={handleAutoRouteCable}
                  onAutoRouteAllCables={handleAutoRouteAllCables}
                  onDeleteCable={store.deleteCable}
                  onBeginDragSnapshot={store.beginDragSnapshot}
                  onMoveNodesTransient={store.moveNodesTransient}
                  onSnapNodesAndCommitDrag={store.snapNodesAndCommitDrag}
                  onOpenDeepInspect={(id) => store.setDeepInspectId(id)}
                  onExit3D={() => viewport.setMode('2d')}
                  draggedPresetName={draggedPresetName}
                  onDropDevice={handleDropCatalogOrCustomDevice}
                />
              </Suspense>
            ) : (
                <DesignCanvas
                  project={store.project}
                  selection={store.selection}
                  activeTool={store.activeTool}
                  zoom={store.zoom}
                  pan={store.pan}
                  connectingSource={store.connectingSource}
                  draggedPresetName={draggedPresetName}
                  isReadOnlyMode={isReadOnlyMode}
                  onRegister2DDropApi={api => {
                    canvas2DDropApiRef.current = api;
                  }}
                  onSelect={store.selectItem}
                  onToggleNodeSelection={store.toggleNodeSelection}
                  onSelectMultipleNodes={store.selectMultipleNodes}
                  onBeginDragSnapshot={store.beginDragSnapshot}
                  onMoveNodesTransient={store.moveNodesTransient}
                  onSnapNodesAndCommitDrag={store.snapNodesAndCommitDrag}
                  onMoveNode={store.moveNode}
                  onResizeNodeTransient={store.resizeNodeTransient}
                  onSnapNodeResizeAndCommit={store.snapNodeResizeAndCommit}
                  onMoveRoomTransient={store.moveRoomTransient}
                  onResizeRoomTransient={store.resizeRoomTransient}
                  onSnapRoomAndCommit={store.snapRoomAndCommit}
                  onUpdateNode={store.updateNode}
                  onSetNodeIconOrLogo={store.setNodeIconOrLogo}
                  onDuplicateNodes={store.duplicateNodes}
                  onToggleNodeLock={store.toggleNodeLock}
                  onToggleNodeVisibility={store.toggleNodeVisibility}
                  onAddTextNode={(x, y) => store.addTextNode(x, y)}
                  onAddRackAtCursor={(x, y) => handleAddRack('Tủ Server Rack 42U', x, y)}
                  onSetTool={store.setActiveTool}
                  onAddCable={store.addCable}
                  onUpdateCableControlPoints={store.updateCableControlPointsTransient}
                  onUpdateCable={store.updateCable}
                  onSetCableColor={store.setCableColor}
                  onReconnectCableEndpoint={store.reconnectCableEndpoint}
                  onSetConnectingSource={store.setConnectingSource}
                  onPanChange={store.setPan}
                  onZoomChange={store.setZoom}
                  onOpenDeepInspect={(id) => store.setDeepInspectId(id)}
                  onAddRoom={store.addRoom}
                  onDeleteSelected={handleDeleteSelected}
                  onDropDevice={handleDropCatalogOrCustomDevice}
                  onDropDeviceIntoRack={(presetName, rackId, preferredU, side) => {
                    store.addDeviceFromCatalogToRack(presetName, rackId, preferredU, side);
                  }}
                  onAssignDeviceToRackSlot={store.assignDeviceToRackSlot}
                  onRemoveDeviceFromRackSlot={store.removeDeviceFromRackSlot}
                  onUpdateSettings={store.updateSettings}
                  onUpdateWifiCoverageRadiusTransient={store.updateWifiCoverageRadiusTransient}
                  onResizeLegendToFit={store.resizeLegendToFit}
                  onAutoRouteCable={handleAutoRouteCable}
                  onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
                  onOpenTemplates={openTemplateModal}
                  onAddQuickDevice={() => {
                    store.addDeviceFromCatalog('Access Switch 24-PoE+', canvasCenter.x, canvasCenter.y);
                  }}
                  onOpenBuildingGenerator={openBuildingModal}
                  onSetActiveFloor={store.setActiveFloor}
                  onCloneFloor={store.cloneFloor}
                  onNudgeNodes={store.nudgeNodes}
                  showMinimap={showMinimap}
                  showBgMenu={showBgMenu}
                  onSetShowBgMenu={setShowBgMenu}
                />
            )}

            {/* Shared Floating Viewport Controller (Unified 2D & 3D HUD) */}
            <ViewportController
              containerRef={canvasHostRef}
              project={store.project}
              zoom2D={store.zoom}
              isReadOnlyMode={isReadOnlyMode}
              isZenMode={isZenMode}
              onToggleZenMode={() => setIsZenMode(v => !v)}
              isAiAvailable={isAiAvailable}
              isAiChatOpen={isAiChatOpen}
              onToggleAiChat={isAiAvailable ? () => setIsAiChatOpen(v => !v) : undefined}
              isQuickExporting={isQuickExporting}
              onQuickExportPng={() => void handleQuickExportViewPng()}
              showBgMenu={showBgMenu}
              onToggleBgMenu={() => setShowBgMenu(v => !v)}
              onCloseBgMenu={() => setShowBgMenu(false)}
              showMinimap={showMinimap}
              onToggleMinimap={() => setShowMinimap(v => !v)}
              onToggleLayerVisibility={store.toggleLayerVisibility}
              onToggleLayerLock={store.toggleLayerLock}
              onSelectLayerObjects={handleSelectLayerObjects}
              onAutoLayerDevices={handleAutoLayerDevices}
              onToggleAutoLayering={() =>
                store.updateSettings({
                  autoLayeringEnabled: !store.project.settings.autoLayeringEnabled
                })
              }
              onUpdateSettings={store.updateSettings}
              onOpenMobileLayers={() => layout.setActiveDrawer('layers')}
            />
          </main>

          {/* WIDE TIER: Resizable Docked Right Properties Panel */}
          {!isZenMode && layout.layoutTier === 'wide' && (
            <>
              {!isPropertiesCollapsed && (
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Kéo đổi chiều rộng bảng thuộc tính"
                  onPointerDown={e => startSplitterDrag('right', e)}
                  className="w-1.5 h-full cursor-col-resize hover:bg-blue-500/40 active:bg-blue-600/60 transition-colors shrink-0 no-print z-10"
                />
              )}
              <div
                style={{ width: isPropertiesCollapsed ? 48 : layout.rightWidth }}
                className="h-full shrink-0 transition-[width] duration-150 no-print"
              >
                <PropertiesPanel
                  {...propertiesPanelProps}
                  isCollapsed={isPropertiesCollapsed}
                  onToggleCollapse={() => setIsPropertiesCollapsed(!isPropertiesCollapsed)}
                />
              </div>
            </>
          )}

          {/* MEDIUM TIER: Slide-Over Properties Drawer */}
          {!isZenMode && layout.layoutTier === 'medium' && layout.activeDrawer === 'properties' && (
            <>
              <div
                onClick={() => layout.setActiveDrawer('none')}
                className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px] no-print"
                aria-hidden="true"
              />
              <div className="fixed inset-y-0 right-0 z-40 w-[340px] max-w-[92vw] h-full shadow-2xl pt-safe pb-safe no-print">
                <PropertiesPanel
                  {...propertiesPanelProps}
                  isCollapsed={false}
                  onClosePanel={() => layout.setActiveDrawer('none')}
                />
              </div>
            </>
          )}

          {/* NARROW TIER: Mobile Unified Layer Sheet */}
          {!isZenMode && layout.layoutTier === 'narrow' && layout.activeDrawer === 'layers' && (
            <>
              <div
                onClick={() => layout.setActiveDrawer('none')}
                className="fixed inset-0 z-30 bg-black/40 no-print"
                aria-hidden="true"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Lớp hiển thị bản vẽ"
                className="fixed inset-x-0 bottom-14 z-40 mx-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-3 max-h-[68dvh] overflow-y-auto no-print"
              >
                <LayerPanel
                  variant="sheet"
                  project={store.project}
                  is3DView={viewport.is3DView}
                  isReadOnlyMode={isReadOnlyMode}
                  onToggleLayerVisibility={store.toggleLayerVisibility}
                  onToggleLayerLock={store.toggleLayerLock}
                  onSelectLayerObjects={handleSelectLayerObjects}
                  onAutoLayerDevices={handleAutoLayerDevices}
                  onToggleAutoLayering={() =>
                    store.updateSettings({
                      autoLayeringEnabled: !store.project.settings.autoLayeringEnabled
                    })
                  }
                  onUpdateSettings={store.updateSettings}
                  view3DOptions={viewport.view3DOptions}
                  onChangeView3DOptions={viewport.setView3DOptions}
                  onClose={() => layout.setActiveDrawer('none')}
                />
              </div>
            </>
          )}

          {/* NARROW TIER: Mobile "Vẽ" Tools Drawer */}
          {!isZenMode && layout.layoutTier === 'narrow' && narrowSubDrawer === 'draw' && (
            <>
              <div
                onClick={() => setNarrowSubDrawer('none')}
                className="fixed inset-0 z-30 bg-black/40 no-print"
                aria-hidden="true"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Công cụ vẽ bản vẽ"
                className="fixed inset-x-0 bottom-14 z-40 mx-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-3 space-y-2 no-print"
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="font-semibold text-xs text-slate-900 dark:text-white">
                    Công cụ vẽ {viewport.is3DView ? '(3D)' : '(2D)'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setNarrowSubDrawer('none')}
                    aria-label="Đóng công cụ vẽ"
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {[
                    { id: 'select' as const, label: 'Chọn', icon: MousePointer },
                    { id: 'pan' as const, label: 'Kéo', icon: Hand },
                    { id: 'connect' as const, label: 'Nối dây', icon: GitBranch },
                    { id: 'room' as const, label: 'Phòng', icon: Square },
                    { id: 'text' as const, label: 'Chữ', icon: Type },
                    { id: 'measure' as const, label: 'Đo', icon: Ruler }
                  ].map(tool => {
                    const Icon = tool.icon;
                    const supportsUnlocked3D =
                      tool.id === 'select' || tool.id === 'pan' || tool.id === 'connect';
                    const unlockedIn3D =
                      viewport.is3DView && !viewport.is3DDragLocked && supportsUnlocked3D;
                    const active = store.activeTool === tool.id && (!viewport.is3DView || unlockedIn3D);
                    const disabled =
                      (viewport.is3DView && !unlockedIn3D) ||
                      (isReadOnlyMode &&
                        tool.id !== 'select' &&
                        tool.id !== 'pan' &&
                        tool.id !== 'measure');
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          store.setActiveTool(tool.id);
                          setNarrowSubDrawer('none');
                        }}
                        className={`py-2.5 px-1 rounded-xl border flex flex-col items-center gap-1 text-xs font-medium disabled:opacity-35 disabled:cursor-not-allowed ${
                          active
                            ? 'bg-[#155EEF] text-white border-[#155EEF] font-semibold'
                            : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                        }`}
                      >
                        <Icon className="w-4 h-4" />
                        <span>{tool.label}</span>
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    disabled={isReadOnlyMode || viewport.is3DView}
                    onClick={() => {
                      store.generateOrUpdateLegendNode();
                      setNarrowSubDrawer('none');
                      showToast('Đã tạo / đồng bộ Bảng chú giải lên trang vẽ!', 'success', 2200);
                    }}
                    className="py-2.5 px-1 rounded-xl border bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 flex flex-col items-center gap-1 text-xs font-medium disabled:opacity-35 disabled:cursor-not-allowed"
                  >
                    <Table2 className="w-4 h-4" />
                    <span>Chú giải</span>
                  </button>
                </div>
              </div>
            </>
          )}

          {/* NARROW TIER: Mobile "Khác" Menu Drawer (Kiểm tra, Xuất, Dự án, Chế độ, Lớp, Sáng/Tối) */}
          {!isZenMode && layout.layoutTier === 'narrow' && narrowSubDrawer === 'more' && (
            <>
              <div
                onClick={() => setNarrowSubDrawer('none')}
                className="fixed inset-0 z-30 bg-black/40 no-print"
                aria-hidden="true"
              />
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Tính năng & Hồ sơ dự án"
                className="fixed inset-x-0 bottom-14 z-40 mx-2 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl p-3 space-y-2.5 max-h-[70dvh] overflow-y-auto no-print"
              >
                <div className="flex items-center justify-between pb-1.5 border-b border-slate-100 dark:border-slate-800">
                  <span className="font-semibold text-xs text-slate-900 dark:text-white">
                    Dự án &amp; Công cụ khác
                  </span>
                  <button
                    type="button"
                    onClick={() => setNarrowSubDrawer('none')}
                    aria-label="Đóng menu khác"
                    className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="space-y-1">
                  <label className="text-xs font-medium text-slate-500 dark:text-slate-400 block">
                    Chế độ thiết kế
                  </label>
                  <select
                    value={store.project.activeMode}
                    onChange={e => {
                      store.setDesignMode(e.target.value as DesignMode);
                      setNarrowSubDrawer('none');
                    }}
                    className="w-full h-9 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-medium text-slate-800 dark:text-slate-100"
                  >
                    {DESIGN_MODE_GROUPS.map(group => (
                      <optgroup key={group.id} label={group.label}>
                        {DESIGN_MODES.filter(m => m.group === group.id).map(m => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsBomModalOpen(true);
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
                  >
                    <ClipboardList className="w-4 h-4 text-[#155EEF]" />
                    <span>Vật tư (BOM)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsAuditModalOpen(true);
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100"
                  >
                    <ShieldCheck className="w-4 h-4 text-[#155EEF]" />
                    <span>Kiểm tra ({auditReport.issues.length})</span>
                  </button>
                  {viewport.is3DView && (
                    <button
                      type="button"
                      onClick={() => {
                        viewport.setIs3DDragLocked(v => !v);
                      }}
                      aria-pressed={!viewport.is3DDragLocked}
                      aria-label={viewport.is3DDragLocked ? 'Mở khóa kéo thả 3D' : 'Khóa kéo thả 3D'}
                      className={`col-span-2 px-3 py-2.5 rounded-xl border flex items-center justify-center gap-2 text-xs font-semibold ${
                        viewport.is3DDragLocked
                          ? 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-300'
                          : 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300'
                      }`}
                    >
                      {viewport.is3DDragLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
                      <span>{viewport.is3DDragLocked ? 'Khóa kéo 3D (Nhấn mở khóa)' : 'Đã mở khóa kéo thả 3D'}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      handleToggle3D();
                    }}
                    aria-pressed={viewport.is3DView}
                    aria-label="Chuyển đổi 2D / 3D"
                    className="col-span-2 px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center justify-center gap-2 text-xs font-mono"
                  >
                    <Cuboid className="w-4 h-4 text-[#155EEF] dark:text-blue-400" />
                    <span className={!viewport.is3DView ? 'font-bold text-[#155EEF] dark:text-blue-400 opacity-100' : 'text-slate-400 opacity-45'}>
                      2D
                    </span>
                    <span className="text-slate-300 dark:text-slate-600">/</span>
                    <span className={viewport.is3DView ? 'font-bold text-[#155EEF] dark:text-blue-400 opacity-100' : 'text-slate-400 opacity-45'}>
                      3D
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsExportModalOpen(true);
                    }}
                    className="col-span-2 px-3 py-2.5 rounded-xl bg-[#155EEF] text-white flex items-center justify-center gap-2 text-xs font-semibold"
                  >
                    <Download className="w-4 h-4" />
                    <span>Xuất hồ sơ bản vẽ</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsProjectHubOpen(true);
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    <FolderKanban className="w-4 h-4 text-slate-500" />
                    <span>Trung tâm dự án</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsTemplateModalOpen(true);
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    <FolderOpen className="w-4 h-4 text-slate-500" />
                    <span>Thư viện mẫu</span>
                  </button>
                  {!viewport.is3DView && (
                    <button
                      type="button"
                      onClick={() => {
                        setNarrowSubDrawer('none');
                        layout.setActiveDrawer('layers');
                      }}
                      className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                    >
                      <Layers className="w-4 h-4 text-slate-500" />
                      <span>Lớp hiển thị</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      store.updateSettings({ isDarkMode: !store.project.settings.isDarkMode });
                      setNarrowSubDrawer('none');
                    }}
                    className="px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    {store.project.settings.isDarkMode ? (
                      <Sun className="w-4 h-4 text-amber-500" />
                    ) : (
                      <Moon className="w-4 h-4 text-slate-500" />
                    )}
                    <span>{store.project.settings.isDarkMode ? 'Giao diện Sáng' : 'Giao diện Tối'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsQuickTourOpen(true);
                    }}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-[#155EEF] dark:text-blue-400"
                  >
                    <Compass className="w-4 h-4" />
                    <span>Hướng dẫn 60s</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setNarrowSubDrawer('none');
                      setIsAboutModalOpen(true);
                    }}
                    className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-200"
                  >
                    <Info className="w-4 h-4 text-[#155EEF]" />
                    <span>Giới thiệu v{APP_VERSION}</span>
                  </button>
                  {isFeedbackFormConfigured() ? (
                    <a
                      href={buildFeedbackFormUrl({ activeMode: store.project.activeMode }) || '#'}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => {
                        if (!isOnline) {
                          e.preventDefault();
                          showToast('Cần kết nối Internet để mở biểu mẫu góp ý trực tuyến.', 'info');
                        }
                        setNarrowSubDrawer('none');
                      }}
                      className="col-span-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center justify-center gap-2 text-xs font-semibold text-[#155EEF] dark:text-blue-400"
                    >
                      <MessageSquarePlus className="w-4 h-4" />
                      <span>Gửi góp ý sản phẩm</span>
                    </a>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="col-span-2 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/50 flex items-center justify-center gap-2 text-xs font-medium text-slate-400 cursor-not-allowed"
                    >
                      <MessageSquarePlus className="w-4 h-4" />
                      <span>Góp ý (Sắp có)</span>
                    </button>
                  )}
                </div>
              </div>
            </>
          )}

          {/* NARROW TIER: 3-Snap Draggable Bottom Sheet for Properties */}
          {!isZenMode && layout.layoutTier === 'narrow' && (
            <div
              className={`fixed inset-x-0 bottom-12 z-30 ${sheetHeightClass} bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-t-2xl shadow-2xl flex flex-col overflow-hidden transition-[height] duration-200 no-print`}
            >
              {/* Drag / Tap Header Bar */}
              <div
                onPointerDown={e => {
                  sheetDragStartRef.current = { y: e.clientY, snap: layout.bottomSheetSnap };
                }}
                onPointerUp={e => {
                  const start = sheetDragStartRef.current;
                  sheetDragStartRef.current = null;
                  if (!start) return;
                  const dy = e.clientY - start.y;
                  if (dy < -40) {
                    layout.setBottomSheetSnap(start.snap === 'collapsed' ? 'half' : 'full');
                  } else if (dy > 40) {
                    layout.setBottomSheetSnap(start.snap === 'full' ? 'half' : 'collapsed');
                  } else {
                    cycleBottomSheetSnap();
                  }
                }}
                className="h-12 px-4 flex items-center justify-between border-b border-slate-100 dark:border-slate-800 cursor-pointer shrink-0 select-none"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <GripHorizontal className="w-4 h-4 text-slate-400 shrink-0" />
                  <span className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">
                    {store.selection.type === 'node'
                      ? 'Thuộc tính thiết bị'
                      : store.selection.type === 'edge'
                      ? 'Thuộc tính dây cáp'
                      : store.selection.type === 'rack'
                      ? 'Thuộc tính tủ Rack'
                      : 'Thuộc tính & Cấu hình'}
                  </span>
                </div>
                <span className="text-xs font-semibold text-[#155EEF] dark:text-blue-400 shrink-0">
                  {layout.bottomSheetSnap === 'collapsed'
                    ? 'Mở bảng'
                    : layout.bottomSheetSnap === 'half'
                    ? 'Mở rộng'
                    : 'Thu gọn'}
                </span>
              </div>
              {layout.bottomSheetSnap !== 'collapsed' && (
                <div className="flex-1 overflow-hidden">
                  <PropertiesPanel
                    {...propertiesPanelProps}
                    isCollapsed={false}
                    onClosePanel={() => layout.setBottomSheetSnap('collapsed')}
                  />
                </div>
              )}
            </div>
          )}

          {/* Lazy-Loaded AI Engineering Assistant */}
          {isAiChatOpen && isAiAvailable && (
            <Suspense fallback={null}>
              <NetworkAssistantChat
                project={store.project}
                isOpen={isAiChatOpen}
                onClose={() => setIsAiChatOpen(false)}
              />
            </Suspense>
          )}
        </div>

        {/* WIDE & MEDIUM TIERS: Desktop Status Bar */}
        {!isZenMode && (
          <StatusBar
            project={store.project}
            selection={store.selection}
            is3DView={viewport.is3DView}
            lastSavedAt={store.lastSavedAt}
            hasUnsavedChanges={store.hasUnsavedChanges}
            isSaving={store.isSaving}
            storageError={store.storageError}
            auditIssueCount={auditReport.issues.length}
            onOpenAbout={() => setIsAboutModalOpen(true)}
            onToggleSnap={handleToggleSnap}
            onToggleGrid={handleToggleGrid}
          />
        )}

        {/* NARROW TIER: 4-Tab Mobile Bottom Navigation Bar (Vẽ | Thêm | Thuộc tính | Khác) */}
        {!isZenMode && layout.layoutTier === 'narrow' && (
          <nav
            aria-label="Thanh điều hướng nhanh"
            className="h-12 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 grid grid-cols-4 items-center shrink-0 z-40 pb-safe no-print"
          >
            <button
              type="button"
              onClick={() => {
                layout.setActiveDrawer('none');
                layout.setBottomSheetSnap('collapsed');
                setNarrowSubDrawer(d => (d === 'draw' ? 'none' : 'draw'));
              }}
              aria-label="Công cụ vẽ"
              aria-pressed={narrowSubDrawer === 'draw'}
              className={`h-full flex flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                narrowSubDrawer === 'draw'
                  ? 'text-[#155EEF] dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <PenTool className="w-4 h-4" />
              <span>Vẽ</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setNarrowSubDrawer('none');
                layout.setBottomSheetSnap('collapsed');
                layout.setActiveDrawer(d => (d === 'library' ? 'none' : 'library'));
              }}
              aria-label="Thêm thiết bị từ thư viện"
              aria-pressed={layout.activeDrawer === 'library'}
              className={`h-full flex flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                layout.activeDrawer === 'library'
                  ? 'text-[#155EEF] dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <PlusSquare className="w-4 h-4" />
              <span>Thêm</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setNarrowSubDrawer('none');
                layout.setActiveDrawer('none');
                layout.setBottomSheetSnap(s => (s === 'collapsed' ? 'half' : 'collapsed'));
              }}
              aria-label="Mở bảng thuộc tính"
              aria-pressed={layout.bottomSheetSnap !== 'collapsed'}
              className={`h-full flex flex-col items-center justify-center gap-0.5 text-xs font-semibold ${
                layout.bottomSheetSnap !== 'collapsed'
                  ? 'text-[#155EEF] dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              <span>Thuộc tính</span>
            </button>

            <button
              type="button"
              onClick={() => {
                layout.setActiveDrawer('none');
                layout.setBottomSheetSnap('collapsed');
                setNarrowSubDrawer(d => (d === 'more' ? 'none' : 'more'));
              }}
              aria-label="Kiểm tra, Xuất và Dự án"
              aria-pressed={narrowSubDrawer === 'more'}
              className={`h-full flex flex-col items-center justify-center gap-0.5 text-xs font-semibold relative ${
                narrowSubDrawer === 'more'
                  ? 'text-[#155EEF] dark:text-blue-400'
                  : 'text-slate-600 dark:text-slate-300'
              }`}
            >
              <MoreHorizontal className="w-4 h-4" />
              <span>Khác</span>
              {auditReport.issues.length > 0 && (
                <span className="absolute top-1 right-4 w-2 h-2 rounded-full bg-rose-600" />
              )}
            </button>
          </nav>
        )}

        {/* LAZY-LOADED MODALS */}
        <Suspense fallback={null}>
          {(store.showWelcomeModal || isProjectHubOpen) && (
            <ProjectHubModal
              isOpen={store.showWelcomeModal || isProjectHubOpen}
              isWelcomeMode={store.showWelcomeModal}
              currentProjectId={store.project.id}
              projectList={store.projectList}
              lastBackupAt={store.lastBackupAt}
              onClose={() => {
                setIsProjectHubOpen(false);
                if (store.showWelcomeModal) {
                  void store.dismissWelcomeModal();
                }
              }}
              onCreateBlank={(name) => {
                void store.createBlankProject(name).then(() => {
                  showToast(`Đã tạo dự án "${name}"`, 'success');
                });
              }}
              onOpenTemplates={() => setIsTemplateModalOpen(true)}
              onSwitchProject={(id) => {
                void store.switchProject(id);
              }}
              onDuplicateCurrent={() => {
                void store.duplicateProject().then(() => {
                  showToast('Đã nhân bản dự án hiện tại!', 'success');
                });
              }}
              onTrashProject={(id) => {
                void store.trashProject(id);
              }}
              onRestoreProject={(id) => {
                void store.restoreProject(id);
              }}
              onDeletePermanently={(id) => {
                void store.deleteProjectPermanently(id);
              }}
              onImportProjectJson={store.importValidatedProject}
              onRequestPackageImport={handleRequestPackageImport}
              onImportScannerFile={handleImportScannerFile}
              onRecordFullBackup={store.recordFullBackup}
              onOpenAbout={() => setIsAboutModalOpen(true)}
            />
          )}

          {isAuditModalOpen && (
            <EngineeringAuditModal
              isOpen={isAuditModalOpen}
              project={store.project}
              onClose={() => setIsAuditModalOpen(false)}
              onNavigateToTarget={handleNavigateToAuditTarget}
            />
          )}

          {isBuildingModalOpen && (
            <BuildingGeneratorModal
              existingBuilding={store.project.buildings[0]}
              isOpen={isBuildingModalOpen}
              onClose={() => setIsBuildingModalOpen(false)}
              onGenerate={store.generateOrUpdateBuilding}
            />
          )}

          {isTemplateModalOpen && (
            <TemplateGalleryModal
              isOpen={isTemplateModalOpen}
              onClose={() => setIsTemplateModalOpen(false)}
              onSelectTemplate={(tplId) => {
                void store.loadTemplate(tplId).then(() => {
                  showToast('Đã tải mẫu thiết kế thành công!', 'success');
                });
              }}
            />
          )}

          {isExportModalOpen && (
            <ExportModal
              project={store.project}
              isOpen={isExportModalOpen}
              is3DView={viewport.is3DView}
              isCapturing3D={viewport.isCapturing3D}
              onCapture3D={viewport.capture3DImage}
              onClose={() => setIsExportModalOpen(false)}
              onOpenBomModal={openBomModal}
              onAfterExportRouterTree={() => recordAction('export_excel_tree')}
              onRequestPackageImport={handleRequestPackageImport}
              onLoadProjectJson={(importedProj: ProjectState) => {
                const res = store.importValidatedProject(importedProj);
                if (!res.ok) {
                  showToast(res.error, 'error', 5000);
                } else {
                  showToast('Khôi phục dự án JSON thành công!', 'success');
                }
              }}
              onMergeExcelDevices={(data) => {
                store.updateProject(prev => ({
                  ...prev,
                  assets: data.newAssets,
                  nodes: data.newNodes,
                  racks: data.updatedRacks
                }));
                showToast(`Đã nhập ${data.importedCount ?? Object.keys(data.newAssets).length} thiết bị từ Excel!`, 'success');
              }}
            />
          )}

          {isBomModalOpen && (
            <BomStatisticsModal
              project={store.project}
              isOpen={isBomModalOpen}
              onClose={() => setIsBomModalOpen(false)}
              onShowToast={(msg, type) => showToast(msg, type || 'info', 2800)}
              onSelectOnCanvas={({ type, ids, label }) => {
                if (type === 'floor' && ids[0]) {
                  store.setActiveFloor(ids[0]);
                  showToast(`Đã chuyển bản vẽ sang ${label}.`, 'info', 2600);
                  return;
                }
                if (type === 'node' && ids.length > 0) {
                  handleJumpToNode(ids[0]);
                  if (ids.length > 1) {
                    store.selectMultipleNodes(ids);
                  }
                  showToast(`Đã chọn ${ids.length} đối tượng "${label}" trên bản vẽ.`, 'info', 2800);
                  return;
                }
                if (type === 'edge' && ids.length > 0) {
                  handleJumpToCable(ids[0]);
                  showToast(`Đã chọn tuyến cáp thuộc nhóm "${label}" (${ids.length} tuyến).`, 'info', 2800);
                }
              }}
            />
          )}

          {Boolean(store.deepInspectId) && (
            <DeepInspectModal
              inspectId={store.deepInspectId}
              project={store.project}
              isOpen={Boolean(store.deepInspectId)}
              onClose={() => store.setDeepInspectId(null)}
              onUpdateAsset={store.updateDeviceAsset}
              onUpdateRack={store.updateRack}
              onAssignDeviceToRackSlot={store.assignDeviceToRackSlot}
              onRemoveDeviceFromRackSlot={store.removeDeviceFromRackSlot}
              onDropPresetIntoRack={store.addDeviceFromCatalogToRack}
              initialRackView={deepInspectRackView}
              isDark={Boolean(store.project.settings.isDarkMode)}
            />
          )}

          {isGuideModalOpen && (
            <GuideModal
              isOpen={isGuideModalOpen}
              keymap={keymap}
              onClose={() => setIsGuideModalOpen(false)}
              onOpenTemplates={() => {
                setIsGuideModalOpen(false);
                openTemplateModal();
              }}
              onOpenBuildingGenerator={() => {
                setIsGuideModalOpen(false);
                openBuildingModal();
              }}
              onOpenExcelTree={() => {
                setIsGuideModalOpen(false);
                openExcelTreeModal();
              }}
              onOpenBomModal={() => {
                setIsGuideModalOpen(false);
                openBomModal();
              }}
              onOpenShortcuts={() => {
                setIsGuideModalOpen(false);
                openShortcutsModal();
              }}
            />
          )}

          {isCommandPaletteOpen && (
            <CommandPaletteModal
              isOpen={isCommandPaletteOpen}
              project={store.project}
              density={layout.density}
              highContrast={layout.highContrast}
              reducedMotion={layout.reducedMotion}
              is3DView={viewport.is3DView}
              isAiAvailable={isAiAvailable}
              isReadOnlyMode={isReadOnlyMode}
              recentActions={recentActions}
              onReplayRecentAction={replayRecentAction}
              keymap={keymap}
              onClose={() => setIsCommandPaletteOpen(false)}
              onAutoRouteAllCables={handleAutoRouteAllCables}
              onFitToScreen={handleUserFitToScreen}
              onGenerateLegend={handleGenerateLegend}
              onOpenAudit={openAuditModal}
              onOpenExport={openExportModal}
              onOpenBomModal={openBomModal}
              onToggle3D={handleToggle3D}
              onToggleAiChat={() => setIsAiChatOpen(v => !v)}
              onToggleTheme={handleToggleTheme}
              onToggleDensity={layout.toggleDensity}
              onToggleHighContrast={layout.toggleHighContrast}
              onToggleReducedMotion={layout.toggleReducedMotion}
              onToggleReadOnly={() => setIsReadOnlyMode(v => !v)}
              onOpenDirectory={openDirectoryModal}
              onSaveNow={handleSaveNow}
              onJumpToNode={handleJumpToNode}
              onSelectCable={handleJumpToCable}
              onOpenShortcuts={openShortcutsModal}
              onExportA4Pdf={() => void handleQuickExportA4Pdf()}
              onAutoAssignIps={() => handleAutoAssignIps({ preserveExistingValid: true })}
              onAutoLayerDevices={handleAutoLayerDevices}
              onOpenExcelTree={openExcelTreeModal}
              onOpenTemplates={openTemplateModal}
              onOpenBuildingGenerator={openBuildingModal}
              onDuplicateSelected={handleDuplicateSelected}
              onSelectAll={handleSelectAll}
              onOpenAbout={() => setIsAboutModalOpen(true)}
              onOpenGuide={openGuideModal}
            />
          )}

          {isShortcutModalOpen && (
            <ShortcutSettingsModal
              isOpen={isShortcutModalOpen}
              onClose={() => setIsShortcutModalOpen(false)}
              keymap={keymap}
              onUpdateShortcut={updateShortcut}
              onResetShortcuts={resetShortcuts}
            />
          )}

          {isDirectoryOpen && (
            <InfrastructureDirectoryModal
              isOpen={isDirectoryOpen}
              project={store.project}
              revisions={store.revisions}
              isReadOnlyMode={isReadOnlyMode}
              onClose={() => setIsDirectoryOpen(false)}
              onUpsertVlan={store.upsertVlan}
              onDeleteVlan={store.deleteVlan}
              onUpsertSubnet={store.upsertSubnet}
              onDeleteSubnet={store.deleteSubnet}
              onUpsertPatchLink={store.upsertPatchLink}
              onDeletePatchLink={store.deletePatchLink}
              onCreateRevision={store.createNamedRevision}
              onRestoreRevision={store.restoreNamedRevision}
              onDeleteRevision={store.deleteNamedRevision}
              onApplyBulkStaticIps={(updatedAssets) => {
                store.updateProject(prev => ({ ...prev, assets: updatedAssets }));
                showToast('Đã cập nhật IP tĩnh hàng loạt!', 'success');
              }}
              onSelectTarget={(targetType, targetId) => {
                setIsDirectoryOpen(false);
                if (targetType === 'node') handleJumpToNode(targetId);
                else handleJumpToCable(targetId);
              }}
            />
          )}

          {isQuickTourOpen && (
            <QuickTourOverlay
              isOpen={isQuickTourOpen}
              onClose={(markCompleted) => {
                setIsQuickTourOpen(false);
                if (markCompleted) {
                  try {
                    localStorage.setItem(QUICK_TOUR_STORAGE_KEY, '1');
                    localStorage.setItem('hachihi_last_seen_version', APP_VERSION);
                  } catch {
                    // ignore
                  }
                }
              }}
            />
          )}

          {isAboutModalOpen && (
            <AboutModal
              isOpen={isAboutModalOpen}
              activeMode={store.project.activeMode}
              onClose={() => setIsAboutModalOpen(false)}
              onOpenQuickGuide={() => setIsQuickTourOpen(true)}
            />
          )}

          {isExcelTreeModalOpen && (
            <ExcelTreeImportModal
              isOpen={isExcelTreeModalOpen}
              existingProject={store.project}
              onClose={() => setIsExcelTreeModalOpen(false)}
              onAfterExportProjectTree={() => recordAction('export_excel_tree')}
              onApplyProject={(nextProject, summary) => {
                if (summary.applyMode === 'new_project') {
                  const res = store.importValidatedProject(nextProject);
                  if (!res.ok) {
                    showToast(res.error, 'error', 4500);
                    return;
                  }
                  showToast(
                    `Đã tạo sơ đồ mới gồm ${summary.createdNodesCount} thiết bị và ${summary.createdCablesCount} tuyến cáp trên ${summary.floorCount} tầng!`,
                    'success',
                    4200
                  );
                } else {
                  store.updateProject(() => nextProject);
                  showToast(
                    `Đã gộp ${summary.createdNodesCount} thiết bị và ${summary.createdCablesCount} tuyến cáp vào bản vẽ hiện tại!`,
                    'success',
                    4200
                  );
                }
                window.requestAnimationFrame(() => handleFitToScreen());
              }}
            />
          )}

          {Boolean(packagePreview) && (
            <PackageImportModal
              isOpen={Boolean(packagePreview)}
              inspection={packagePreview}
              onClose={() => setPackagePreview(null)}
              onCommitProject={async (proj) => {
                await store.commitImportedProject(proj);
              }}
              onImportCompleted={(outcome) => {
                void store.refreshRevisions();
                setIsProjectHubOpen(false);
                setIsExportModalOpen(false);
                const verb = outcome.mode === 'new' ? 'Nhập bản mới' : 'Ghi đè';
                const extraParts: string[] = [];
                if (outcome.restoredCustomDevices > 0) {
                  extraParts.push(`${outcome.restoredCustomDevices} thiết bị mẫu`);
                }
                if (outcome.restoredRevisions > 0) {
                  extraParts.push(`${outcome.restoredRevisions} mốc lịch sử`);
                }
                const extraNote = extraParts.length > 0 ? ` (+ ${extraParts.join(', ')})` : '';
                showToast(`${verb} "${outcome.projectName}" thành công${extraNote}!`, 'success', 4200);
              }}
            />
          )}
        </Suspense>

        {/* One-time What's New v3.1.0 notice for returning users */}
        {showWhatsNewModal && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Có gì mới trên phiên bản ${APP_VERSION}`}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-xs p-4 no-print"
          >
            <div className="w-full max-w-lg bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-2xl overflow-hidden text-slate-800 dark:text-slate-100">
              <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-[#155EEF] text-white flex items-center justify-center">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-bold text-slate-900 dark:text-white">
                      Có gì mới trên HACHIHI v{APP_VERSION}
                    </h2>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      Nâng cấp điều hướng gọn, dự toán BOM &amp; thương hiệu HACHIHI
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowWhatsNewModal(false);
                    try {
                      localStorage.setItem('hachihi_last_seen_version', APP_VERSION);
                    } catch {
                      // ignore
                    }
                  }}
                  aria-label="Đóng thông báo phiên bản mới"
                  className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="p-5 space-y-2.5">
                {CHANGELOG_HIGHLIGHTS_310.map((line, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-xs text-slate-700 dark:text-slate-200 leading-relaxed">
                    <CheckCircle2 className="w-4 h-4 text-[#16A34A] shrink-0 mt-0.5" />
                    <span>{line}</span>
                  </div>
                ))}
              </div>
              <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowWhatsNewModal(false);
                    try {
                      localStorage.setItem('hachihi_last_seen_version', APP_VERSION);
                    } catch {
                      // ignore
                    }
                    setIsAboutModalOpen(true);
                  }}
                  className="px-3 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:border-[#155EEF]"
                >
                  Giới thiệu HACHIHI
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowWhatsNewModal(false);
                    try {
                      localStorage.setItem('hachihi_last_seen_version', APP_VERSION);
                    } catch {
                      // ignore
                    }
                  }}
                  className="px-4 py-1.5 rounded-md bg-[#155EEF] hover:bg-[#124CC7] text-white text-xs font-semibold"
                >
                  Bắt đầu thiết kế
                </button>
              </div>
            </div>
          </div>
        )}
        {/* Floating Ghost Card for Unified Pointer Drag-and-Drop (2D & 3D) */}
        {activeLibraryDrag && (
          <div
            aria-hidden="true"
            style={{
              left: `${Math.min(
                typeof window !== 'undefined' ? window.innerWidth - 230 : activeLibraryDrag.clientX + 14,
                activeLibraryDrag.clientX + 14
              )}px`,
              top: `${Math.min(
                typeof window !== 'undefined' ? window.innerHeight - 90 : activeLibraryDrag.clientY + 14,
                activeLibraryDrag.clientY + 14
              )}px`
            }}
            className={`fixed z-[100] pointer-events-none w-56 rounded-lg border shadow-2xl px-2.5 py-2 backdrop-blur-md transition-colors no-print ${
              activeLibraryDrag.canDrop
                ? 'bg-white/95 dark:bg-slate-900/95 border-[#155EEF] ring-2 ring-[#155EEF]/25'
                : 'bg-white/90 dark:bg-slate-900/90 border-slate-300 dark:border-slate-700 opacity-90'
            }`}
          >
            <div className="flex items-center gap-2">
              <div
                style={{ backgroundColor: activeLibraryDrag.payload.accentColor }}
                className="w-7 h-7 rounded-md flex items-center justify-center text-white shrink-0 shadow-xs"
              >
                {renderDeviceVisualIcon({
                  category: activeLibraryDrag.payload.category,
                  className: 'w-4 h-4 text-white'
                })}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-semibold text-slate-900 dark:text-white truncate">
                  {activeLibraryDrag.payload.label}
                </div>
                <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 truncate">
                  {activeLibraryDrag.payload.specLine}
                </div>
              </div>
            </div>
            <div
              className={`mt-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-sm truncate ${
                activeLibraryDrag.canDrop
                  ? 'bg-[#EEF4FF] text-[#155EEF] dark:bg-blue-950/70 dark:text-blue-300'
                  : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              {activeLibraryDrag.hint}
            </div>
          </div>
        )}
      </div>
    </ErrorBoundary>
  );
}
