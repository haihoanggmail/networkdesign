import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ProjectState, DeviceAsset, DiagramNode, ServerRack } from '../../types/infrastructure';
import {
  X,
  Download,
  Image,
  FileCode,
  Printer,
  Table,
  Upload,
  Check,
  FileSpreadsheet,
  AlertCircle,
  FileText,
  Compass,
  Globe,
  Loader2,
  FileDown,
  Archive,
  ClipboardList,
  GitFork,
  Cuboid
} from 'lucide-react';
import { migrateAndValidateProject } from '../../utils/projectStorage';
import { createProjectPackage } from '../../utils/projectPackage';
import { getRackStatistics, getAssetUHeight } from '../../utils/rackGeometry';
import { exportProjectBomCsv } from '../../utils/bomCsvExporter';
import { computeProjectCableSummary } from '../../utils/cableRouting';
import { computePureDiagramBounds, generatePureSvgMarkup } from '../../utils/svgExport';
import { computeA4ScaleMetrics } from '../../utils/pdfExporter';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import type {
  CameraPresetId,
  Capture3DBackground,
  Capture3DRequestOptions,
  Capture3DResult
} from '../../contexts/ViewportContext';
import {
  CAMERA_PRESET_LABELS,
  ExportContentScope,
  ExportService
} from '../../services/export/exportService';

export type PaperSize = 'A4' | 'A3' | 'A2' | 'A1';
export type PrintOrientation = 'landscape' | 'portrait';
export type PrintScaleMode = 'fit' | 'tile2x2';

interface ExportModalProps {
  project: ProjectState;
  isOpen: boolean;
  is3DView?: boolean;
  isCapturing3D?: boolean;
  onCapture3D?: (options?: Capture3DRequestOptions) => Promise<Capture3DResult>;
  onClose: () => void;
  onLoadProjectJson: (jsonState: ProjectState) => void;
  onRequestPackageImport?: (file: File) => Promise<void> | void;
  onOpenBomModal?: () => void;
  onAfterExportRouterTree?: () => void;
  onMergeExcelDevices?: (data: {
    newAssets: Record<string, DeviceAsset>;
    newNodes: DiagramNode[];
    updatedRacks: ServerRack[];
    importedCount?: number;
  }) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  project,
  isOpen,
  is3DView = false,
  isCapturing3D = false,
  onCapture3D,
  onClose,
  onLoadProjectJson,
  onRequestPackageImport,
  onOpenBomModal,
  onAfterExportRouterTree,
  onMergeExcelDevices
}) => {
  const [statusBanner, setStatusBanner] = useState<{ type: 'info' | 'success' | 'error'; text: string } | null>(null);

  // Content Scope & 3D Export Settings
  const [contentScope, setContentScope] = useState<ExportContentScope>(is3DView ? '3d' : '2d');
  const [background3D, setBackground3D] = useState<Capture3DBackground>('light');
  const [selected3DAngles, setSelected3DAngles] = useState<CameraPresetId[]>(['iso']);

  // PDF / Technical Print Settings & CAD Title Block
  const [paperSize, setPaperSize] = useState<PaperSize>('A4');
  const [orientation, setOrientation] = useState<PrintOrientation>('landscape');
  const [scaleMode, setScaleMode] = useState<PrintScaleMode>('fit');
  const [drawingCode, setDrawingCode] = useState('NET-ELV-01');
  const [drawingScale, setDrawingScale] = useState('1:100 / NTS');
  const [includeDiagram, setIncludeDiagram] = useState(true);
  const [includeLegendPanel, setIncludeLegendPanel] = useState(true);
  const [includeRackElevation, setIncludeRackElevation] = useState(true);
  const [includeTables, setIncludeTables] = useState(true);
  const [isPrinting, setIsPrinting] = useState(false);
  const [isExportingPng, setIsExportingPng] = useState(false);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [isExportingBundle, setIsExportingBundle] = useState(false);
  const [isExportingPackage, setIsExportingPackage] = useState(false);
  const [pkgIncludeRevisions, setPkgIncludeRevisions] = useState(true);
  const [pkgIncludeCustomLibrary, setPkgIncludeCustomLibrary] = useState(true);
  const [svgTileBlobUrls, setSvgTileBlobUrls] = useState<Array<{ label: string; blobUrl: string }>>([]);
  const dialogRef = useRef<HTMLDivElement>(null);

  useFocusTrap(dialogRef, isOpen && !isPrinting, onClose);

  useEffect(() => {
    if (isOpen) {
      setContentScope(is3DView ? '3d' : '2d');
      setStatusBanner(null);
    }
  }, [isOpen, is3DView]);

  const toggle3DAngle = (preset: CameraPresetId) => {
    setSelected3DAngles(prev => {
      if (prev.includes(preset)) {
        return prev.length > 1 ? prev.filter(p => p !== preset) : prev;
      }
      return [...prev, preset];
    });
  };

  const revokeTileUrls = useCallback((tiles: Array<{ label: string; blobUrl: string }>) => {
    const urlApi = window.URL || window.webkitURL;
    tiles.forEach(t => {
      try {
        urlApi.revokeObjectURL(t.blobUrl);
      } catch {
        // ignore
      }
    });
  }, []);

  const bounds = useMemo(() => computePureDiagramBounds(project), [project]);
  const a4ScalePreview = useMemo(
    () =>
      computeA4ScaleMetrics(bounds, project.settings.scale, orientation, {
        includeLegendPanel
      }),
    [bounds, project.settings.scale, orientation, includeLegendPanel]
  );

  useEffect(() => {
    if (!isPrinting) return;

    const handleAfterPrint = () => {
      document.body.classList.remove('hachihi-printing');
      const existingStyle = document.getElementById('hachihi-dynamic-page-style');
      if (existingStyle) existingStyle.remove();
      setIsPrinting(false);
      setSvgTileBlobUrls(prev => {
        revokeTileUrls(prev);
        return [];
      });
    };

    window.addEventListener('afterprint', handleAfterPrint);
    const timer = window.setTimeout(() => {
      window.print();
    }, 140);

    return () => {
      window.removeEventListener('afterprint', handleAfterPrint);
      window.clearTimeout(timer);
    };
  }, [isPrinting, revokeTileUrls]);

  // Safety cleanup if component unmounts mid-print
  useEffect(() => {
    return () => {
      document.body.classList.remove('hachihi-printing');
      const existingStyle = document.getElementById('hachihi-dynamic-page-style');
      if (existingStyle) existingStyle.remove();
      setSvgTileBlobUrls(prev => {
        revokeTileUrls(prev);
        return [];
      });
    };
  }, [revokeTileUrls]);

  if (!isOpen && !isPrinting) return null;

  // 1. Export High-Res PNG (2D Vector SVG, 3D WebGL Capture, or Both) via ExportService
  const handleExportPng = async () => {
    if (isExportingPng || isCapturing3D) return;
    setIsExportingPng(true);
    setStatusBanner({
      type: 'info',
      text:
        contentScope === '3d'
          ? 'Đang chụp ảnh mô hình 3D WebGL độ phân giải cao...'
          : contentScope === 'both'
          ? 'Đang kết xuất ảnh PNG 2D CAD và mô hình 3D...'
          : 'Đang kết xuất ảnh PNG 2D độ phân giải cao...'
    });
    try {
      const result = await ExportService.exportPng(project, {
        contentScope,
        background3D,
        capture3D: onCapture3D
      });
      setStatusBanner({
        type: 'success',
        text: `Đã xuất ${result.exportedFiles.length} tệp ảnh PNG (${result.exportedFiles.join(', ')}) thành công!`
      });
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsExportingPng(false);
    }
  };

  // 2. Export Pure Vector SVG (2D CAD only)
  const handleExportSvg = () => {
    try {
      const res = ExportService.exportSvg(project, contentScope);
      setStatusBanner({ type: 'success', text: `Đã xuất Vector SVG chuẩn CAD (${res.filename}) thành công!` });
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // 2b. Export AutoCAD DXF (2D CAD only)
  const handleExportDxf = () => {
    try {
      const res = ExportService.exportDxf(project, contentScope);
      setStatusBanner({ type: 'success', text: `Đã xuất tệp AutoCAD DXF đa lớp (${res.filename}) thành công!` });
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  // 2c. Export Standalone Offline Interactive HTML Viewer (3D WebGL + 2D CAD + BOM)
  const handleExportHtmlViewer = () => {
    const res = ExportService.exportHtmlViewer(project, {
      contentScope,
      background3D
    });
    const scopeLabel =
      contentScope === '3d'
        ? '3D WebGL xoay 360° đa hướng'
        : contentScope === 'both'
        ? '3D WebGL + Sơ đồ 2D & BOM'
        : 'Sơ đồ 2D + 3D WebGL & BOM';
    setStatusBanner({
      type: 'success',
      text: `Đã xuất trình xem HTML độc lập ${scopeLabel} (${res.filename}) — mở trực tiếp bằng trình duyệt, không cần cài phần mềm!`
    });
  };

  // 2d. Export BOM CSV (Assets, Cable Lengths, & Rack Components)
  const handleExportBomCsv = () => {
    try {
      const { filename, summary } = exportProjectBomCsv(project);
      setStatusBanner({
        type: 'success',
        text: `Đã xuất ${filename} (${summary.assetCount} thiết bị, ${summary.totalCableMeters}m cáp, ${summary.rackComponentCount} thành phần Rack)!`
      });
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        text: `Lỗi xuất BOM CSV: ${err instanceof Error ? err.message : String(err)}`
      });
    }
  };

  // 3. Handle Excel Import
  const handleExcelFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setStatusBanner({ type: 'info', text: 'Đang đọc dữ liệu Excel...' });
      const { parseExcelDevices } = await import('../../utils/excelService');
      const result = await parseExcelDevices(file, project);
      if (onMergeExcelDevices) {
        onMergeExcelDevices(result);
        const count = result.importedCount ?? Object.keys(result.newAssets).length;
        setStatusBanner({ type: 'success', text: `Đã nhập thành công ${count} thiết bị từ Excel!` });
        setTimeout(() => {
          setStatusBanner(null);
          onClose();
        }, 1200);
      }
    } catch (err: unknown) {
      setStatusBanner({ type: 'error', text: `Lỗi nhập Excel: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      e.target.value = '';
    }
  };

  // 4. Export Self-Contained Project Package (.hachihi.json)
  const handleExportPackage = async () => {
    if (isExportingPackage) return;
    setIsExportingPackage(true);
    setStatusBanner({
      type: 'info',
      text: 'Đang đóng gói Gói dự án (.hachihi.json), nhúng tài nguyên ảnh & tạo mã SHA-256...'
    });
    try {
      const { pkg, jsonString, warnings } = await createProjectPackage(project, {
        includeRevisions: pkgIncludeRevisions,
        includeFullCustomLibrary: pkgIncludeCustomLibrary,
        embedExternalImages: true
      });
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.name.replace(/\s+/g, '_')}.hachihi.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      const extras: string[] = [];
      if (pkg.manifest.counts.embeddedImages > 0) extras.push(`${pkg.manifest.counts.embeddedImages} ảnh nhúng`);
      if (pkg.manifest.counts.customDevices > 0) extras.push(`${pkg.manifest.counts.customDevices} TB tùy chỉnh`);
      if (pkg.manifest.counts.revisions > 0) extras.push(`${pkg.manifest.counts.revisions} mốc phiên bản`);
      const extrasText = extras.length > 0 ? ` (${extras.join(', ')})` : '';
      const warnText = warnings.length > 0 ? ` · Lưu ý: ${warnings[0]}` : '';
      setStatusBanner({
        type: 'success',
        text: `Đã xuất Gói dự án .hachihi.json kèm mã SHA-256${extrasText}!${warnText}`
      });
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        text: `Lỗi xuất Gói dự án: ${err instanceof Error ? err.message : String(err)}`
      });
    } finally {
      setIsExportingPackage(false);
    }
  };

  // 5. Import Package (.hachihi.json) or JSON (routes to preview modal when available)
  const handleImportJson = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';

    const { checkImportPayloadSize, MAX_IMPORT_JSON_BYTES } = await import('../../utils/security');
    const sizeCheck = checkImportPayloadSize(file, MAX_IMPORT_JSON_BYTES, file.name);
    if (!sizeCheck.ok) {
      setStatusBanner({ type: 'error', text: sizeCheck.error });
      return;
    }

    if (onRequestPackageImport) {
      onClose();
      await onRequestPackageImport(file);
      return;
    }

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed: unknown = JSON.parse(ev.target?.result as string);
        const migrated = migrateAndValidateProject(parsed);
        if (!migrated.ok) {
          setStatusBanner({ type: 'error', text: migrated.error });
          return;
        }
        onLoadProjectJson(migrated.project);
        const warnText = migrated.warnings.length > 0 ? ` (${migrated.warnings.join('; ')})` : '';
        setStatusBanner({ type: 'success', text: `Khôi phục dự án thành công!${warnText}` });
        setTimeout(() => {
          setStatusBanner(null);
          onClose();
        }, 900);
      } catch (err: unknown) {
        setStatusBanner({ type: 'error', text: `Lỗi đọc tệp JSON: ${err instanceof Error ? err.message : String(err)}` });
      }
    };
    reader.readAsText(file);
  };

  // 6. Export Technical PDF (A4-A1, supports 2D, 3D multi-angle & Both)
  const handleExportTechnicalPdf = async () => {
    if (isExportingPdf || isCapturing3D) return;
    setIsExportingPdf(true);
    setStatusBanner({
      type: 'info',
      text:
        contentScope === '2d'
          ? `Đang kết xuất bản vẽ kỹ thuật PDF ${paperSize} (giữ tỷ lệ & chú giải)...`
          : `Đang chụp góc nhìn 3D và đóng gói bản vẽ PDF ${paperSize}...`
    });
    try {
      const result = await ExportService.exportPdf(project, {
        contentScope,
        paperSize,
        orientation,
        drawingCode,
        drawingScale,
        includeDiagram,
        includeLegendPanel,
        includeRackElevation,
        includeTables,
        background3D,
        cameraAngles3D: selected3DAngles,
        capture3D: onCapture3D
      });
      setStatusBanner({
        type: 'success',
        text: `Đã xuất ${result.filename} (${result.pageCount} trang ${paperSize} · ${result.scaleMetrics.scaleRatioLabel})!`
      });
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsExportingPdf(false);
    }
  };

  // 6b. 1-Click Unified Handover ZIP Bundle (PDF + Excel + DXF + SVG + HTML + CSV + JSON + optional 3D PNGs)
  const handleExportHandoverBundle = async () => {
    if (isExportingBundle || isCapturing3D) return;
    setIsExportingBundle(true);
    setStatusBanner({
      type: 'info',
      text:
        contentScope === '2d'
          ? 'Đang đóng gói Gói Bàn Giao (PDF + Excel 6 Sheet + AutoCAD DXF + SVG + HTML Viewer + Schedule CSV)...'
          : 'Đang chụp ảnh 3D và đóng gói Gói Bàn Giao tổng hợp (.zip)...'
    });
    try {
      const res = await ExportService.exportBundle(project, {
        contentScope,
        drawingCode,
        drawingScale,
        orientation,
        includeLegendPanel,
        includeRackElevation,
        includeTables,
        background3D,
        cameraAngles3D: selected3DAngles,
        capture3D: onCapture3D
      });
      const sizeKb = Math.max(1, Math.round(res.totalBytes / 1024));
      setStatusBanner({
        type: 'success',
        text: `Đã tạo ${res.filename} (${res.entries.length} tệp · ${sizeKb} KB)!`
      });
    } catch (err: unknown) {
      setStatusBanner({
        type: 'error',
        text: err instanceof Error ? err.message : String(err)
      });
    } finally {
      setIsExportingBundle(false);
    }
  };

  // Build Diagram Tiles for PDF Print
  const diagramTiles = (() => {
    if (scaleMode === 'fit') {
      return [
        {
          label: 'Toàn cảnh sơ đồ (Fit 1 trang)',
          viewBox: `${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`
        }
      ];
    }
    const cols = 2;
    const rows = 2;
    const tileW = bounds.width / cols;
    const tileH = bounds.height / rows;
    const overlapX = tileW * 0.05;
    const overlapY = tileH * 0.05;
    const tiles: Array<{ label: string; viewBox: string }> = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const vx = bounds.minX + c * tileW - (c > 0 ? overlapX : 0);
        const vy = bounds.minY + r * tileH - (r > 0 ? overlapY : 0);
        const vw = tileW + overlapX;
        const vh = tileH + overlapY;
        tiles.push({
          label: `Mảnh ${r + 1}-${c + 1} (${cols}×${rows})`,
          viewBox: `${vx} ${vy} ${vw} ${vh}`
        });
      }
    }
    return tiles;
  })();

  // 7. Trigger Technical Multi-Page Browser Print (renders safe SVG Blob URLs inside <img>)
  const handleStartPdfPrint = () => {
    if (!includeDiagram && !includeRackElevation && !includeTables) {
      setStatusBanner({ type: 'error', text: 'Vui lòng chọn ít nhất một mục để xuất PDF.' });
      return;
    }

    const pureSvg = generatePureSvgMarkup(project, { darkTheme: false, includeTitleBlock: false });
    const urlApi = window.URL || window.webkitURL;
    const nextBlobTiles = diagramTiles.map(tile => {
      const tileSvg = pureSvg.replace(/viewBox="[^"]*"/i, `viewBox="${tile.viewBox}"`);
      const blob = new Blob([tileSvg], { type: 'image/svg+xml;charset=utf-8' });
      return {
        label: tile.label,
        blobUrl: urlApi.createObjectURL(blob)
      };
    });

    setSvgTileBlobUrls(prev => {
      revokeTileUrls(prev);
      return nextBlobTiles;
    });

    const existingStyle = document.getElementById('hachihi-dynamic-page-style');
    if (existingStyle) existingStyle.remove();

    const styleEl = document.createElement('style');
    styleEl.id = 'hachihi-dynamic-page-style';
    styleEl.textContent = `@page { size: ${paperSize} ${orientation}; margin: 10mm; }`;
    document.head.appendChild(styleEl);

    document.body.classList.add('hachihi-printing');
    setIsPrinting(true);
  };

  const allAssets = Object.values(project.assets);
  const bomCableSummary = useMemo(() => computeProjectCableSummary(project.cables || []), [project.cables]);
  const bomRackComponentCount = useMemo(
    () =>
      (project.racks || []).reduce((acc, r) => {
        const frontCount = Object.values(r.slots || {}).filter(id => Boolean(id && project.assets[id])).length;
        const rearCount = Object.values(r.rearSlots || {}).filter(id => Boolean(id && project.assets[id])).length;
        return acc + frontCount + rearCount;
      }, 0),
    [project.racks, project.assets]
  );

  return (
    <>
      {isOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Xuất bản vẽ, PDF kỹ thuật và nhập xuất Excel"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4 no-print"
        >
          <div
            ref={dialogRef}
            tabIndex={-1}
            className="w-full h-dvh sm:h-auto sm:max-w-4xl sm:max-h-[92dvh] flex flex-col bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden text-slate-800 dark:text-slate-200 text-xs pb-safe outline-none"
          >
            {/* Header */}
            <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 shrink-0">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Download className="w-5 h-5 text-blue-600 shrink-0" />
                  <span>Xuất Bản Vẽ, PDF Kỹ Thuật & Nhập Xuất Excel</span>
                </h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Hỗ trợ Workbook Excel 6 sheet, In/Xuất PDF đa khổ giấy A4–A1, Ảnh PNG nét cao & Vector CAD SVG
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Đóng hộp thoại xuất bản vẽ"
                className="min-h-[40px] min-w-[40px] flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-400"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {statusBanner && (
              <div
                className={`px-6 py-2.5 border-b font-medium flex items-center gap-2 shrink-0 ${
                  statusBanner.type === 'error'
                    ? 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-900 text-rose-700 dark:text-rose-300'
                    : statusBanner.type === 'success'
                    ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-900 text-emerald-700 dark:text-emerald-300'
                    : 'bg-blue-50 dark:bg-blue-950/50 border-blue-200 dark:border-blue-900 text-blue-800 dark:text-blue-300'
                }`}
              >
                {statusBanner.type === 'error' ? (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                ) : (
                  <Check className="w-4 h-4 shrink-0" />
                )}
                <span>{statusBanner.text}</span>
              </div>
            )}

            {/* Scrollable Body */}
            <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
              {/* Content Scope Selector (2D / 3D / Both) */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/40 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-slate-900 dark:text-white flex items-center gap-1.5">
                      <Cuboid className="w-4 h-4 text-[#155EEF]" />
                      <span>Phạm vi nội dung xuất (Content Scope)</span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Chọn xuất bản vẽ 2D CAD, mô hình không gian 3D WebGL hoặc gộp cả hai vào hồ sơ bàn giao
                    </p>
                  </div>
                  <div
                    role="group"
                    aria-label="Chọn phạm vi xuất dữ liệu"
                    className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5 gap-0.5"
                  >
                    {(
                      [
                        { id: '2d', label: 'Bản vẽ 2D' },
                        { id: '3d', label: 'Mô hình 3D' },
                        { id: 'both', label: 'Cả 2D và 3D' }
                      ] as const
                    ).map(opt => (
                      <button
                        key={opt.id}
                        type="button"
                        data-testid={`export-scope-${opt.id}`}
                        onClick={() => setContentScope(opt.id)}
                        aria-pressed={contentScope === opt.id}
                        className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                          contentScope === opt.id
                            ? 'bg-[#155EEF] text-white shadow-2xs'
                            : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {contentScope !== '2d' && (
                  <div className="pt-2.5 border-t border-slate-200/80 dark:border-slate-700/70 space-y-2.5">
                    {!is3DView && (
                      <div className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 text-amber-800 dark:text-amber-200 text-[11px] font-medium flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
                        <span>
                          Hiện bạn đang ở chế độ 2D CAD. Để chụp &amp; xuất hình 3D WebGL sắc nét, hãy chuyển sang chế độ 3D trước khi bấm xuất (hệ thống không thay thế bằng hình 2D).
                        </span>
                      </div>
                    )}

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                          Nền kết xuất 3D
                        </div>
                        <div className="grid grid-cols-2 gap-1">
                          <button
                            type="button"
                            onClick={() => setBackground3D('light')}
                            className={`py-1.5 px-2 rounded-md border text-[11px] font-semibold transition-colors ${
                              background3D === 'light'
                                ? 'bg-[#155EEF] text-white border-[#155EEF]'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            Nền sáng (Chuẩn in)
                          </button>
                          <button
                            type="button"
                            onClick={() => setBackground3D('dark')}
                            className={`py-1.5 px-2 rounded-md border text-[11px] font-semibold transition-colors ${
                              background3D === 'dark'
                                ? 'bg-[#155EEF] text-white border-[#155EEF]'
                                : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
                            }`}
                          >
                            Nền tối (Studio)
                          </button>
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                          Góc camera 3D xuất PDF / ZIP
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {(['iso', 'top', 'front', 'side'] as CameraPresetId[]).map(preset => {
                            const checked = selected3DAngles.includes(preset);
                            return (
                              <button
                                key={preset}
                                type="button"
                                onClick={() => toggle3DAngle(preset)}
                                aria-pressed={checked}
                                title={CAMERA_PRESET_LABELS[preset]}
                                className={`px-2 py-1 rounded-md border text-[11px] font-semibold transition-colors ${
                                  checked
                                    ? 'bg-blue-50 dark:bg-blue-950/60 border-[#155EEF] text-[#155EEF] dark:text-blue-300'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                                }`}
                              >
                                {preset === 'iso'
                                  ? 'Isometric'
                                  : preset === 'top'
                                  ? 'Trên xuống'
                                  : preset === 'front'
                                  ? 'Trực diện'
                                  : 'Bên hông'}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 1-Click Unified Handover Bundle Banner */}
              <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/70 dark:bg-blue-950/30 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-lg bg-[#155EEF] text-white flex items-center justify-center shrink-0">
                    <Archive className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                      Gói Bàn Giao 1 Nút (.zip)
                    </h3>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-0.5">
                      {contentScope === '2d'
                        ? 'Đóng gói đồng bộ: PDF kỹ thuật + Workbook Excel 6 sheet + AutoCAD DXF + SVG + Trình xem HTML + Bảng cáp CSV + JSON sao lưu.'
                        : 'Đóng gói đồng bộ: PDF (kèm ảnh 3D đa góc nhìn) + Ảnh PNG 3D + Workbook Excel 6 sheet + AutoCAD DXF + SVG + JSON sao lưu.'}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void handleExportHandoverBundle()}
                  disabled={isExportingBundle || isCapturing3D}
                  aria-label="Tải gói bàn giao hồ sơ ZIP tổng hợp"
                  className="px-4 py-2 bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-60 text-white rounded-lg font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition-colors"
                >
                  {isExportingBundle ? <Loader2 className="w-4 h-4 animate-spin" /> : <Archive className="w-4 h-4" />}
                  <span>{isExportingBundle ? 'Đang nén gói ZIP...' : 'Tải Gói Bàn Giao (.zip)'}</span>
                </button>
              </div>

              {/* Export Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* Option 1: Full Excel .xlsx Workbook (6 sheets) */}
                <div
                  onClick={async () => {
                    try {
                      setStatusBanner({ type: 'info', text: 'Đang nạp bộ xuất Excel & đóng gói 6 sheet...' });
                      const { exportProjectToExcel } = await import('../../utils/excelService');
                      await exportProjectToExcel(project);
                      setStatusBanner({ type: 'success', text: 'Đã xuất Workbook Excel 6 sheet thành công!' });
                    } catch (err: unknown) {
                      setStatusBanner({ type: 'error', text: `Lỗi xuất Excel: ${err instanceof Error ? err.message : String(err)}` });
                    }
                  }}
                  className="p-4 rounded-xl border-2 border-emerald-500/80 hover:border-emerald-600 bg-emerald-50/30 hover:bg-emerald-50/60 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40 transition-all cursor-pointer flex items-start gap-3 shadow-xs"
                >
                  <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <FileSpreadsheet className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-slate-900 dark:text-white">
                      Xuất Excel Kỹ Thuật (.xlsx – 6 Sheet)
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                      Gồm: Tổng Quan, BOM Vật Tư, Thiết Bị, Danh Bạ Cáp, Chi Tiết Tủ Rack (Trước/Sau) &amp; Theo Khu Vực
                    </div>
                    <div className="text-xs text-emerald-700 dark:text-emerald-400 font-bold mt-1.5">
                      Tải Workbook Excel (.xlsx) &rarr;
                    </div>
                  </div>
                </div>

                {/* Option 2: Export Parent-Child Router Tree (.xlsx) */}
                <div
                  onClick={async () => {
                    try {
                      setStatusBanner({ type: 'info', text: 'Đang trích xuất cây Router Cha–Con ra Excel...' });
                      const { exportProjectRouterTreeToExcel } = await import('../../utils/excelTreeImporter');
                      await exportProjectRouterTreeToExcel(project);
                      setStatusBanner({ type: 'success', text: 'Đã xuất Cây Router Cha–Con (.xlsx) thành công!' });
                      onAfterExportRouterTree?.();
                    } catch (err: unknown) {
                      setStatusBanner({
                        type: 'error',
                        text: `Lỗi xuất cây Router: ${err instanceof Error ? err.message : String(err)}`
                      });
                    }
                  }}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 bg-slate-50/50 hover:bg-emerald-50/20 dark:bg-slate-800/30 transition-all cursor-pointer flex items-start gap-3"
                >
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                    <GitFork className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-slate-900 dark:text-white">
                      Xuất Cây Router Cha–Con (.xlsx)
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Xuất cấu trúc phân cấp thiết bị, Router Cha (Uplink), IP/VLAN, Cổng &amp; Loại cáp tương thích nhập ngược lại
                    </div>
                    <div className="text-[10px] text-emerald-600 font-semibold mt-1.5">
                      Tải file Cây Router (.xlsx) &rarr;
                    </div>
                  </div>
                </div>

                {/* Option 2B: Download Excel Template */}
                <div
                  onClick={async () => {
                    try {
                      const { downloadExcelTemplate } = await import('../../utils/excelService');
                      await downloadExcelTemplate();
                      setStatusBanner({ type: 'success', text: 'Đã tải xuống tệp Excel mẫu!' });
                    } catch (err: unknown) {
                      setStatusBanner({ type: 'error', text: `Lỗi tải mẫu: ${err instanceof Error ? err.message : String(err)}` });
                    }
                  }}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-emerald-500 bg-slate-50/50 hover:bg-emerald-50/20 dark:bg-slate-800/30 transition-all cursor-pointer flex items-start gap-3"
                >
                  <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 flex items-center justify-center shrink-0">
                    <Table className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-slate-900 dark:text-white">Tải Mẫu Excel Nhập Liệu</div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Chuẩn cột Ultimate: Mã tài sản, Model, IP, VLAN, Tủ Rack, Vị trí U, Số U &amp; Mặt tủ (Trước/Sau)
                    </div>
                    <div className="text-[10px] text-emerald-600 font-semibold mt-1.5">
                      Tải file mẫu Excel (.xlsx) &rarr;
                    </div>
                  </div>
                </div>

                {/* Option 3: High-res PNG (2D / 3D / Both) */}
                <button
                  type="button"
                  onClick={() => void handleExportPng()}
                  disabled={isExportingPng || isCapturing3D}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500 bg-slate-50/50 hover:bg-blue-50/30 dark:bg-slate-800/30 transition-all cursor-pointer flex items-start gap-3 text-left disabled:opacity-50 disabled:cursor-wait"
                >
                  <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 flex items-center justify-center shrink-0">
                    {isExportingPng ? <Loader2 className="w-5 h-5 animate-spin" /> : <Image className="w-5 h-5" />}
                  </div>
                  <div>
                    <div className="font-bold text-sm text-slate-900 dark:text-white">
                      {contentScope === '3d'
                        ? 'Ảnh PNG Mô Hình 3D Nét Cao'
                        : contentScope === 'both'
                        ? 'Ảnh PNG (2D CAD + Mô Hình 3D)'
                        : 'Ảnh PNG Toàn Cảnh Nét Cao'}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      {contentScope === '3d'
                        ? `Kết xuất trực tiếp từ Three.js WebGL (${background3D === 'light' ? 'nền trắng chuẩn in' : 'nền tối Studio'})`
                        : contentScope === 'both'
                        ? 'Tải cả ảnh vector 2D 2x và ảnh chụp WebGL 3D hiện tại'
                        : 'Kết xuất vector thuần độ phân giải 2x (không bị lỗi mất chữ/mất biểu tượng)'}
                    </div>
                    <div className="text-[10px] text-blue-600 font-semibold mt-1.5">
                      {isExportingPng ? 'Đang kết xuất PNG...' : 'Tải file PNG →'}
                    </div>
                  </div>
                </button>

                {/* Option 4: Vector SVG (2D CAD only; dimmed when scope is 3d) */}
                <button
                  type="button"
                  disabled={contentScope === '3d'}
                  onClick={handleExportSvg}
                  title={contentScope === '3d' ? 'Vector SVG chỉ hỗ trợ bản vẽ 2D CAD' : 'Tải Vector SVG chuẩn CAD'}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-blue-500 bg-slate-50/50 hover:bg-blue-50/30 dark:bg-slate-800/30 transition-all cursor-pointer flex items-start gap-3 text-left disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:border-slate-200"
                >
                  <div className="w-10 h-10 rounded-lg bg-sky-100 dark:bg-sky-900/40 text-sky-600 flex items-center justify-center shrink-0">
                    <FileCode className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-white">Vector SVG Chuẩn CAD</span>
                      {contentScope === '3d' && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                          Chỉ 2D
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Định dạng vector sắc nét vô hạn, tương thích Visio, Corel, Illustrator
                    </div>
                    <div className="text-[10px] text-sky-600 font-semibold mt-1.5">
                      {contentScope === '3d' ? 'Không áp dụng cho phạm vi 3D' : 'Tải file SVG →'}
                    </div>
                  </div>
                </button>

                {/* Option 5: AutoCAD DXF (2D CAD only; dimmed when scope is 3d) */}
                <button
                  type="button"
                  disabled={contentScope === '3d'}
                  onClick={handleExportDxf}
                  title={contentScope === '3d' ? 'AutoCAD DXF chỉ hỗ trợ bản vẽ 2D CAD' : 'Tải AutoCAD DXF đa lớp'}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-indigo-500 bg-slate-50/50 hover:bg-indigo-50/30 dark:bg-slate-800/30 transition-all cursor-pointer flex items-start gap-3 text-left disabled:opacity-35 disabled:cursor-not-allowed disabled:hover:border-slate-200"
                >
                  <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-900/40 text-indigo-600 flex items-center justify-center shrink-0">
                    <Compass className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-white">AutoCAD DXF Đa Lớp (.dxf)</span>
                      {contentScope === '3d' && (
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                          Chỉ 2D
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Xuất tệp CAD R12 tách lớp riêng ROOMS, RACKS, DEVICES, CABLES &amp; LABELS
                    </div>
                    <div className="text-[10px] text-indigo-600 font-semibold mt-1.5">
                      {contentScope === '3d' ? 'Không áp dụng cho phạm vi 3D' : 'Tải file AutoCAD DXF →'}
                    </div>
                  </div>
                </button>

                {/* Option 6: Standalone Interactive HTML Viewer (3D WebGL 360° + 2D CAD + BOM) */}
                <button
                  type="button"
                  onClick={handleExportHtmlViewer}
                  title={
                    contentScope === '3d'
                      ? 'Tải trình xem HTML 3D tương tác: xoay ngang dọc 360°, chuyển 7 hướng camera & xem thông số thiết bị offline'
                      : 'Tải trình xem HTML độc lập gồm mô hình 3D WebGL xoay 360° + sơ đồ 2D CAD & bảng BOM'
                  }
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 hover:border-teal-500 bg-slate-50/50 hover:bg-teal-50/30 dark:bg-slate-800/30 transition-all cursor-pointer flex items-start gap-3 text-left"
                >
                  <div className="w-10 h-10 rounded-lg bg-teal-100 dark:bg-teal-900/40 text-teal-600 flex items-center justify-center shrink-0">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-bold text-sm text-slate-900 dark:text-white">Trình Xem HTML Độc Lập (.html)</span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 shrink-0">
                        {contentScope === '3d' ? '3D Xoay 360°' : '2D + 3D WebGL'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      {contentScope === '3d'
                        ? 'Mô hình 3D WebGL xoay ngang dọc 360°, 7 hướng camera, giãn tầng & kiểm tra thiết bị offline'
                        : 'Sơ đồ 2D CAD + Mô hình 3D WebGL xoay 360° đa hướng & bảng BOM chạy offline'}
                    </div>
                    <div className="text-[10px] text-teal-600 font-semibold mt-1.5">
                      {contentScope === '3d' ? 'Tải file HTML Viewer 3D →' : 'Tải file HTML Viewer (3D + 2D) →'}
                    </div>
                  </div>
                </button>

                {/* Option 7: Export BOM CSV & Open BOM Dashboard */}
                <div className="md:col-span-2 p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/40 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/50 text-[#155EEF] dark:text-blue-300 flex items-center justify-center shrink-0">
                      <ClipboardList className="w-5 h-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          Bảng Kê Vật Tư &amp; Dự Toán (BOM)
                        </span>
                        <span className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {allAssets.length} thiết bị · {bomCableSummary.totalMeters}m cáp · {bomRackComponentCount} thành phần Rack
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Xem bảng tổng hợp trực quan theo tầng/nhóm, sao chép sang Excel hoặc tải tệp CSV chuẩn cột UTF-8 BOM.
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-2.5">
                        {onOpenBomModal && (
                          <button
                            type="button"
                            onClick={() => {
                              onClose();
                              onOpenBomModal();
                            }}
                            className="px-3 py-1.5 rounded-lg bg-[#155EEF] hover:bg-[#124CC7] text-white font-semibold text-xs flex items-center gap-1.5 transition-colors"
                          >
                            <ClipboardList className="w-3.5 h-3.5" />
                            <span>Xem Thống kê Vật tư (BOM)</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleExportBomCsv}
                          aria-label="Export BOM CSV summarizing assets, cable lengths, and rack components"
                          className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 font-semibold text-xs flex items-center gap-1.5 transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>Tải CSV BOM (.csv)</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* PDF / Multi-Page Blueprint Print Config */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/30 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-[#155EEF] text-white flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-slate-900 dark:text-white">
                        Print to PDF · Xuất Bản Vẽ Kỹ Thuật A4
                      </h3>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                        Tỷ lệ A4: {a4ScalePreview.scaleRatioLabel} · Thước {a4ScalePreview.scaleBar.totalMeters}m · Khung {a4ScalePreview.realWorldWidthMeters}×{a4ScalePreview.realWorldHeightMeters}m
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleExportTechnicalPdf()}
                      disabled={isExportingPdf || isCapturing3D}
                      className="px-3.5 py-2 bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-60 text-white rounded-lg font-semibold flex items-center gap-1.5 shadow-sm transition-colors whitespace-nowrap"
                    >
                      {isExportingPdf ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <FileDown className="w-4 h-4" />
                      )}
                      <span>
                        {isExportingPdf
                          ? `Đang tạo PDF ${paperSize}...`
                          : contentScope === '3d'
                          ? `Tải PDF 3D (${paperSize})`
                          : contentScope === 'both'
                          ? `Tải PDF 2D + 3D (${paperSize})`
                          : `Tải PDF ${paperSize} (Chuẩn CAD)`}
                      </span>
                    </button>

                    <button
                      type="button"
                      disabled={contentScope === '3d'}
                      onClick={handleStartPdfPrint}
                      title={
                        contentScope === '3d'
                          ? 'In trình duyệt chỉ áp dụng cho bản vẽ 2D CAD. Hãy chọn Tải PDF 3D ở bên cạnh.'
                          : `Mở hộp thoại in trình duyệt khổ ${paperSize}`
                      }
                      className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap disabled:opacity-35 disabled:cursor-not-allowed"
                    >
                      <Printer className="w-4 h-4" />
                      <span>In trình duyệt ({paperSize})</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                      Khổ giấy (Paper Size)
                    </label>
                    <div className="grid grid-cols-4 gap-1">
                      {(['A4', 'A3', 'A2', 'A1'] as PaperSize[]).map(sz => (
                        <button
                          key={sz}
                          onClick={() => setPaperSize(sz)}
                          className={`py-1.5 rounded border font-bold text-[11px] transition-colors ${
                            paperSize === sz
                              ? 'bg-blue-600 text-white border-blue-600'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-blue-400'
                          }`}
                        >
                          {sz}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                      Hướng giấy (Orientation)
                    </label>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        onClick={() => setOrientation('landscape')}
                        className={`py-1.5 rounded border font-semibold text-[11px] ${
                          orientation === 'landscape'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Ngang (Landscape)
                      </button>
                      <button
                        onClick={() => setOrientation('portrait')}
                        className={`py-1.5 rounded border font-semibold text-[11px] ${
                          orientation === 'portrait'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Dọc (Portrait)
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                      Tỉ lệ trang bản vẽ
                    </label>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        onClick={() => setScaleMode('fit')}
                        className={`py-1.5 rounded border font-semibold text-[11px] ${
                          scaleMode === 'fit'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Vừa 1 Trang
                      </button>
                      <button
                        onClick={() => setScaleMode('tile2x2')}
                        className={`py-1.5 rounded border font-semibold text-[11px] ${
                          scaleMode === 'tile2x2'
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                        }`}
                      >
                        Chia 4 Mảnh (2×2)
                      </button>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                      Số hiệu bản vẽ (Khung tên)
                    </label>
                    <input
                      type="text"
                      value={drawingCode}
                      onChange={e => setDrawingCode(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[11px]"
                      placeholder="NET-ELV-01"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400 mb-1">
                      Tỷ lệ bản vẽ (Scale)
                    </label>
                    <input
                      type="text"
                      value={drawingScale}
                      onChange={e => setDrawingScale(e.target.value)}
                      className="w-full px-2.5 py-1.5 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono text-[11px]"
                      placeholder="1:100 / NTS"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 pt-1 text-[11px]">
                  <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                    <input
                      type="checkbox"
                      checked={includeDiagram}
                      onChange={e => setIncludeDiagram(e.target.checked)}
                      className="rounded text-[#155EEF]"
                    />
                    <span>Bản vẽ sơ đồ hạ tầng</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                    <input
                      type="checkbox"
                      checked={includeLegendPanel}
                      onChange={e => setIncludeLegendPanel(e.target.checked)}
                      className="rounded text-[#155EEF]"
                    />
                    <span>Bảng Chú giải &amp; Thước tỷ lệ A4</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                    <input
                      type="checkbox"
                      checked={includeRackElevation}
                      onChange={e => setIncludeRackElevation(e.target.checked)}
                      className="rounded text-[#155EEF]"
                    />
                    <span>Hồ sơ Tủ Rack (Mặt Trước & Sau)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer font-medium">
                    <input
                      type="checkbox"
                      checked={includeTables}
                      onChange={e => setIncludeTables(e.target.checked)}
                      className="rounded text-[#155EEF]"
                    />
                    <span>Bảng tổng hợp thiết bị & Cáp ({allAssets.length} TB / {project.cables.length} Cáp)</span>
                  </label>
                </div>
              </div>
            </div>

            {/* Portable Project Package (.hachihi.json) & Excel Import Strip */}
            <div className="px-6 py-4 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-200 dark:border-slate-800 space-y-3 shrink-0">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  Gói dự án di động (.hachihi.json · tự nhúng ảnh, thiết bị đang dùng &amp; SHA-256)
                </span>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={pkgIncludeRevisions}
                      onChange={e => setPkgIncludeRevisions(e.target.checked)}
                      className="rounded accent-[#155EEF]"
                    />
                    <span>Kèm lịch sử phiên bản</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={pkgIncludeCustomLibrary}
                      onChange={e => setPkgIncludeCustomLibrary(e.target.checked)}
                      className="rounded accent-[#155EEF]"
                    />
                    <span>Kèm thư viện thiết bị tùy chỉnh</span>
                  </label>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md font-semibold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Nhập từ File Excel (.xlsx / .csv)</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={handleExcelFileUpload}
                      className="hidden"
                    />
                  </label>

                  <button
                    type="button"
                    disabled={isExportingPackage}
                    onClick={() => void handleExportPackage()}
                    className="px-3.5 py-2 bg-[#155EEF] hover:bg-[#124CC7] disabled:opacity-60 text-white rounded-md font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>{isExportingPackage ? 'Đang đóng gói...' : 'Xuất Gói dự án (.hachihi.json)'}</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <label className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 rounded-md font-semibold flex items-center gap-1.5 cursor-pointer transition-colors">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Nhập Gói / JSON (.hachihi.json)</span>
                    <input
                      type="file"
                      accept=".hachihi.json,.json"
                      onChange={handleImportJson}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PRINT PORTAL DOCUMENT (#hachihi-print-sheet) */}
      {isPrinting &&
        createPortal(
          <div id="hachihi-print-sheet" className="bg-white text-slate-900 font-sans">
            {/* 1. Diagram Pages */}
            {includeDiagram &&
              svgTileBlobUrls.map((tile, idx) => (
                <section key={`diag_page_${idx}`} className="hachihi-print-page p-4 flex flex-col">
                  <div className="flex items-center justify-between border-b-2 border-blue-700 pb-2 mb-3">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                        HACHIHI NETWORK DESIGNER · BẢN VẼ KỸ THUẬT HẠ TẦNG
                      </div>
                      <h1 className="text-lg font-bold text-slate-900">{project.name}</h1>
                    </div>
                    <div className="text-right text-[10px] text-slate-600 font-mono">
                      <div>Chế độ: {project.activeMode.toUpperCase()} · {tile.label}</div>
                      <div>Khổ giấy: {paperSize} ({orientation}) · Phiên bản: {project.version}</div>
                    </div>
                  </div>

                  <div className="border border-slate-300 rounded bg-slate-50 overflow-hidden flex-1 flex items-center justify-center">
                    <img
                      src={tile.blobUrl}
                      alt={`${project.name} — ${tile.label}`}
                      referrerPolicy="no-referrer"
                      className="w-full h-[490px] object-contain"
                    />
                  </div>

                  {/* CAD Engineering Title Block (Khung Tên Bản Vẽ) */}
                  <table className="w-full border-collapse border border-slate-800 text-[9.5px] mt-2">
                    <tbody>
                      <tr>
                        <td className="border border-slate-800 px-2 py-1 font-bold text-blue-800 w-1/3" rowSpan={2}>
                          HACHIHI NETWORK &amp; ELECTRICAL DESIGNER
                          <div className="text-slate-900 text-[11px] mt-0.5">{project.name}</div>
                        </td>
                        <td className="border border-slate-800 px-2 py-0.5">
                          <span className="text-slate-500">Số hiệu bản vẽ:</span> <strong className="font-mono">{drawingCode}</strong>
                        </td>
                        <td className="border border-slate-800 px-2 py-0.5">
                          <span className="text-slate-500">Tỷ lệ:</span> <strong className="font-mono">{drawingScale}</strong>
                        </td>
                        <td className="border border-slate-800 px-2 py-0.5">
                          <span className="text-slate-500">Khổ giấy:</span> <strong>{paperSize} ({orientation})</strong>
                        </td>
                      </tr>
                      <tr>
                        <td className="border border-slate-800 px-2 py-0.5">
                          <span className="text-slate-500">Kỹ sư thiết kế:</span> <strong>{project.author}</strong>
                        </td>
                        <td className="border border-slate-800 px-2 py-0.5">
                          <span className="text-slate-500">Ngày xuất:</span> <strong className="font-mono">{new Date().toLocaleDateString('vi-VN')}</strong>
                        </td>
                        <td className="border border-slate-800 px-2 py-0.5">
                          <span className="text-slate-500">Phiên bản:</span> <strong className="font-mono">{project.version}</strong> · Trang {idx + 1}/{diagramTiles.length}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </section>
              ))}

            {/* 2. Rack Elevation Pages (Front & Rear) */}
            {includeRackElevation && project.racks.length > 0 && (
              <section className="hachihi-print-page p-4 space-y-4">
                <div className="flex items-center justify-between border-b-2 border-blue-700 pb-2">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                      HỒ SƠ BỐ TRÍ TỦ RACK (FRONT &amp; REAR ELEVATION)
                    </div>
                    <h2 className="text-base font-bold text-slate-900">{project.name} · {project.racks.length} Tủ Rack</h2>
                  </div>
                  <div className="text-[10px] font-mono text-slate-600">{paperSize} · {new Date().toLocaleDateString('vi-VN')}</div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {project.racks.map(rack => {
                    const stats = getRackStatistics(rack, project.assets);
                    const frontEntries = Object.entries(rack.slots || {}).sort((a, b) => Number(b[0]) - Number(a[0]));
                    const rearEntries = Object.entries(rack.rearSlots || {}).sort((a, b) => Number(b[0]) - Number(a[0]));

                    return (
                      <div key={rack.id} className="border border-slate-300 rounded-lg p-3 break-inside-avoid">
                        <div className="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2">
                          <div>
                            <div className="font-bold text-xs text-slate-900">{rack.name}</div>
                            <div className="text-[10px] text-slate-500">
                              {rack.totalUnits}U · Trước: {stats.frontUsedUnits}U · Sau: {stats.rearUsedUnits}U · Còn trống trước: {stats.frontFreeUnits}U
                            </div>
                          </div>
                          <div className="text-right font-mono text-[10px]">
                            <div className="font-bold text-blue-700">{stats.totalPowerWatts} W</div>
                            <div className="text-slate-600">{stats.totalWeightKg.toFixed(1)}/{rack.maxLoadKg || 1000} kg</div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <div className="font-bold text-slate-700 mb-1">Mặt Trước ({frontEntries.length} TB)</div>
                            <table className="w-full border-collapse border border-slate-200">
                              <thead>
                                <tr className="bg-slate-100">
                                  <th className="border border-slate-200 px-1 py-0.5 text-left">Vị trí</th>
                                  <th className="border border-slate-200 px-1 py-0.5 text-left">Thiết bị</th>
                                </tr>
                              </thead>
                              <tbody>
                                {frontEntries.length === 0 ? (
                                  <tr><td colSpan={2} className="p-1 text-center text-slate-400">Trống</td></tr>
                                ) : (
                                  frontEntries.map(([uStr, assetId]) => {
                                    const asset = project.assets[assetId];
                                    const h = asset ? getAssetUHeight(asset) : 1;
                                    const u = parseInt(uStr, 10);
                                    return (
                                      <tr key={uStr}>
                                        <td className="border border-slate-200 px-1 py-0.5 font-mono">
                                          {h > 1 ? `U${u}-${u + h - 1}` : `U${u}`}
                                        </td>
                                        <td className="border border-slate-200 px-1 py-0.5 truncate max-w-[140px]">
                                          {asset?.name || assetId}
                                        </td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>

                          <div>
                            <div className="font-bold text-slate-700 mb-1">Mặt Sau ({rearEntries.length} TB)</div>
                            <table className="w-full border-collapse border border-slate-200">
                              <thead>
                                <tr className="bg-slate-100">
                                  <th className="border border-slate-200 px-1 py-0.5 text-left">Vị trí</th>
                                  <th className="border border-slate-200 px-1 py-0.5 text-left">Thiết bị</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rearEntries.length === 0 ? (
                                  <tr><td colSpan={2} className="p-1 text-center text-slate-400">Trống</td></tr>
                                ) : (
                                  rearEntries.map(([uStr, assetId]) => {
                                    const asset = project.assets[assetId];
                                    const h = asset ? getAssetUHeight(asset) : 1;
                                    const u = parseInt(uStr, 10);
                                    return (
                                      <tr key={uStr}>
                                        <td className="border border-slate-200 px-1 py-0.5 font-mono">
                                          {h > 1 ? `U${u}-${u + h - 1}` : `U${u}`}
                                        </td>
                                        <td className="border border-slate-200 px-1 py-0.5 truncate max-w-[140px]">
                                          {asset?.name || assetId}
                                        </td>
                                      </tr>
                                    );
                                  })
                                )}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* 3. Equipment & Cable Summary Tables */}
            {includeTables && (
              <section className="hachihi-print-page p-4 space-y-4">
                <div className="flex items-center justify-between border-b-2 border-blue-700 pb-2">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-700">
                      BẢNG TỔNG HỢP THIẾT BỊ &amp; ĐẤU NỐI CÁP KỸ THUẬT
                    </div>
                    <h2 className="text-base font-bold text-slate-900">{project.name}</h2>
                  </div>
                  <div className="text-[10px] font-mono text-slate-600">
                    {allAssets.length} Thiết bị · {project.cables.length} Tuyến cáp
                  </div>
                </div>

                <div>
                  <h3 className="font-bold text-xs text-slate-800 mb-1.5">1. Danh sách Thiết bị ({allAssets.length})</h3>
                  <table className="w-full border-collapse border border-slate-300 text-[10px]">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="border border-slate-300 px-1.5 py-1 text-left">Mã TS</th>
                        <th className="border border-slate-300 px-1.5 py-1 text-left">Tên thiết bị</th>
                        <th className="border border-slate-300 px-1.5 py-1 text-left">Model / Hãng</th>
                        <th className="border border-slate-300 px-1.5 py-1 text-left">IP / VLAN</th>
                        <th className="border border-slate-300 px-1.5 py-1 text-left">Rack / U</th>
                        <th className="border border-slate-300 px-1.5 py-1 text-right">Công suất</th>
                      </tr>
                    </thead>
                    <tbody>
                      {allAssets.slice(0, 120).map(a => {
                        const rackName = project.racks.find(r => r.id === a.rackId)?.name || '—';
                        return (
                          <tr key={a.id}>
                            <td className="border border-slate-300 px-1.5 py-0.5 font-mono">{a.assetTag}</td>
                            <td className="border border-slate-300 px-1.5 py-0.5 font-semibold">{a.name}</td>
                            <td className="border border-slate-300 px-1.5 py-0.5">{a.vendor} {a.model}</td>
                            <td className="border border-slate-300 px-1.5 py-0.5 font-mono">
                              {a.ipAddress || '—'}{a.vlan ? ` (VLAN ${a.vlan})` : ''}
                            </td>
                            <td className="border border-slate-300 px-1.5 py-0.5">
                              {a.rackId ? `${rackName} · U${a.rackUnitStart} (${a.rackSide === 'rear' ? 'Sau' : 'Trước'})` : '—'}
                            </td>
                            <td className="border border-slate-300 px-1.5 py-0.5 text-right font-mono">{a.powerWatts || 0}W</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {project.cables.length > 0 && (
                  <div>
                    <h3 className="font-bold text-xs text-slate-800 mb-1.5">2. Danh bạ Đấu nối Cáp ({project.cables.length})</h3>
                    <table className="w-full border-collapse border border-slate-300 text-[10px]">
                      <thead>
                        <tr className="bg-slate-100">
                          <th className="border border-slate-300 px-1.5 py-1 text-left">Mã cáp</th>
                          <th className="border border-slate-300 px-1.5 py-1 text-left">Thiết bị Nguồn</th>
                          <th className="border border-slate-300 px-1.5 py-1 text-left">Thiết bị Đích</th>
                          <th className="border border-slate-300 px-1.5 py-1 text-left">Chuẩn cáp</th>
                          <th className="border border-slate-300 px-1.5 py-1 text-left">Tốc độ / Dài</th>
                        </tr>
                      </thead>
                      <tbody>
                        {project.cables.slice(0, 120).map(c => {
                          const src = project.nodes.find(n => n.id === c.sourceNodeId)?.label || c.sourceNodeId;
                          const tgt = project.nodes.find(n => n.id === c.targetNodeId)?.label || c.targetNodeId;
                          return (
                            <tr key={c.id}>
                              <td className="border border-slate-300 px-1.5 py-0.5 font-mono">{c.cableCode}</td>
                              <td className="border border-slate-300 px-1.5 py-0.5">{src}</td>
                              <td className="border border-slate-300 px-1.5 py-0.5">{tgt}</td>
                              <td className="border border-slate-300 px-1.5 py-0.5">{c.cableType}</td>
                              <td className="border border-slate-300 px-1.5 py-0.5 font-mono">
                                {c.bandwidth} · {c.lengthMeters || 0}m
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            )}
          </div>,
          document.body
        )}
    </>
  );
};
