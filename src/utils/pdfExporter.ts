import { ProjectState } from '../types/infrastructure';
import { APP_BUILD_HASH, APP_VERSION } from '../config/appInfo';
import {
  computePureDiagramBounds,
  DiagramBounds,
  generateCompositeBuildingSvgMarkup,
  generatePureSvgMarkup
} from './svgExport';
import { buildProjectLegendData, GeneratedLegendData } from './legendGenerator';
import { getRackStatistics, getAssetUHeight } from './rackGeometry';
import { sanitizeSafeImageUrl } from './security';
import { getHachihiLogoSvgMarkup } from './brandLogoSvg';
import {
  A4Orientation,
  A4ScaleBarSpec,
  A4ScaleMetrics,
  PdfPaperSizeUpper,
  computeA4ScaleMetrics,
  getPaperDimensionsMm
} from './pdfScale';

export type { A4Orientation, A4ScaleBarSpec, A4ScaleMetrics, PdfPaperSizeUpper };
export { computeA4ScaleMetrics, getPaperDimensionsMm };
export type PdfContentScope = '2d' | '3d' | 'both';

export interface Captured3DPageInput {
  preset: string;
  label: string;
  dataUrl: string;
  width: number;
  height: number;
  background?: 'light' | 'dark';
}

export interface ExportA4PdfOptions {
  orientation?: A4Orientation;
  drawingCode?: string;
  drawingScale?: string;
  includeLegendPanel?: boolean;
  legendScope?: 'all' | 'activeFloor';
  floorScope?: 'all' | 'active' | string;
  includeRackElevation?: boolean;
  includeTables?: boolean;
  pixelRatio?: number;
}

export interface ExportTechnicalPdfOptions extends ExportA4PdfOptions {
  contentScope?: PdfContentScope;
  paperSize?: PdfPaperSizeUpper;
  includeDiagram?: boolean;
  captures3D?: Captured3DPageInput[];
}

interface PdfFloorSheetSpec {
  floorScopeId: string;
  label: string;
  isComposite: boolean;
}

function resolvePdfFloorSheets(
  project: ProjectState,
  floorScope: string | undefined
): PdfFloorSheetSpec[] {
  const sortedFloors = [...(project.floors || [])].sort((a, b) => a.level - b.level);
  const isFloorBased = ['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode);

  if (floorScope === 'active') {
    const active = sortedFloors.find(f => f.id === project.activeFloorId);
    if (active) {
      return [{ floorScopeId: active.id, label: active.name, isComposite: false }];
    }
  } else if (floorScope && floorScope !== 'all' && floorScope !== '__ALL__') {
    const matched = sortedFloors.find(f => f.id === floorScope);
    if (matched) {
      return [{ floorScopeId: matched.id, label: matched.name, isComposite: false }];
    }
  }

  if (isFloorBased && sortedFloors.length > 1) {
    return [
      {
        floorScopeId: '__ALL__',
        label: `Toàn bộ tòa nhà (${sortedFloors.length} tầng)`,
        isComposite: true
      },
      ...sortedFloors.map(f => ({
        floorScopeId: f.id,
        label: f.name,
        isComposite: false
      }))
    ];
  }

  const single = sortedFloors[0];
  return [
    {
      floorScopeId: sortedFloors.length > 1 ? '__ALL__' : single?.id || '__ALL__',
      label:
        sortedFloors.length > 1
          ? `Toàn bộ tòa nhà (${sortedFloors.length} tầng)`
          : single?.name || 'Toàn bộ bản vẽ',
      isComposite: false
    }
  ];
}

export interface ExportA4PdfResult {
  filename: string;
  pageCount: number;
  scaleMetrics: A4ScaleMetrics;
}

export interface A4PdfArtifact extends ExportA4PdfResult {
  blob: Blob;
  uint8: Uint8Array;
}

export function fitBoxPreserveAspectRatio(
  srcW: number,
  srcH: number,
  boxW: number,
  boxH: number
): { width: number; height: number; offsetX: number; offsetY: number } {
  const safeSrcW = Math.max(1, srcW);
  const safeSrcH = Math.max(1, srcH);
  const safeBoxW = Math.max(1, boxW);
  const safeBoxH = Math.max(1, boxH);
  const ratio = Math.min(safeBoxW / safeSrcW, safeBoxH / safeSrcH);
  const width = Number((safeSrcW * ratio).toFixed(2));
  const height = Number((safeSrcH * ratio).toFixed(2));
  const offsetX = Number(((safeBoxW - width) / 2).toFixed(2));
  const offsetY = Number(((safeBoxH - height) / 2).toFixed(2));
  return { width, height, offsetX, offsetY };
}

const MM_TO_PX_96DPI = 96 / 25.4;

function mmToPx(mm: number): number {
  return Math.round(mm * MM_TO_PX_96DPI);
}

function escapeHtml(input: string): string {
  return String(input)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Strips Tailwind v4 stylesheets using modern CSS color functions (oklch, oklab, color-mix)
 * from html2canvas's cloned document so html2canvas never throws CSS parser errors.
 */
export function sanitizeClonedDocForHtml2Canvas(clonedDoc: Document): void {
  const styleNodes = Array.from(clonedDoc.querySelectorAll('style, link[rel="stylesheet"]'));
  for (const node of styleNodes) {
    if (node.tagName === 'STYLE') {
      const css = node.textContent || '';
      if (
        css.includes('oklch(') ||
        css.includes('oklab(') ||
        css.includes('color-mix(') ||
        css.includes('--tw-')
      ) {
        node.remove();
      }
    } else if (node.tagName === 'LINK') {
      const href = (node as HTMLLinkElement).href || '';
      if (!href.includes('fonts.googleapis.com')) {
        node.remove();
      }
    }
  }

  clonedDoc.documentElement.classList.remove('dark');
  clonedDoc.documentElement.style.backgroundColor = '#ffffff';
  clonedDoc.documentElement.style.color = '#0f172a';
  clonedDoc.body.style.backgroundColor = '#ffffff';
  clonedDoc.body.style.color = '#0f172a';
  clonedDoc.body.style.margin = '0';
  clonedDoc.body.style.padding = '0';
}

async function rasterizeSvgMarkupToPng(
  svgMarkup: string,
  bounds: DiagramBounds
): Promise<string> {
  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const urlApi = window.URL || window.webkitURL || window;
  const blobUrl = urlApi.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Không thể kết xuất SVG sang ảnh cho PDF.'));
      image.src = blobUrl;
    });

    const targetMaxDim = 2800;
    const scale = Math.min(3, Math.max(1.75, targetMaxDim / Math.max(bounds.width, bounds.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(480, Math.round(bounds.width * scale));
    canvas.height = Math.max(360, Math.round(bounds.height * scale));

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Trình duyệt không hỗ trợ 2D Canvas để tạo PDF.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  } finally {
    urlApi.revokeObjectURL(blobUrl);
  }
}

function buildLegendHtml(legendData: GeneratedLegendData, orientation: A4Orientation): string {
  const maxComponents = orientation === 'landscape' ? 14 : 8;
  const maxCables = orientation === 'landscape' ? 8 : 5;
  const visibleComponents = legendData.components.slice(0, maxComponents);
  const visibleCables = legendData.cables.slice(0, maxCables);
  const totalWatts = legendData.components.reduce((sum, c) => sum + c.totalWatts, 0);
  const totalMeters = legendData.cables.reduce((sum, c) => sum + c.totalMeters, 0);

  const compRows =
    visibleComponents.length === 0
      ? `<tr><td colspan="3" style="padding:8px 6px;color:#64748b;text-align:center;font-size:9px;">Chưa có thiết bị trên phạm vi chọn</td></tr>`
      : visibleComponents
          .map(item => {
            const safeImg = sanitizeSafeImageUrl(item.customImageUrl);
            const swatch = safeImg
              ? `<img src="${escapeHtml(safeImg)}" style="width:14px;height:14px;object-fit:contain;border-radius:2px;display:block;" />`
              : `<span style="display:inline-block;width:12px;height:12px;border-radius:3px;background:${escapeHtml(item.accentColor)};border:1px solid #cbd5e1;"></span>`;
            return `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:3.5px 4px;width:18px;vertical-align:middle;">${swatch}</td>
                <td style="padding:3.5px 4px;vertical-align:middle;">
                  <div style="font-size:9px;font-weight:700;color:#0f172a;line-height:1.2;">${escapeHtml(item.label)}</div>
                  <div style="font-size:8px;color:#475569;line-height:1.2;">${escapeHtml(item.subLabel.slice(0, 26))}</div>
                </td>
                <td style="padding:3.5px 4px;text-align:right;vertical-align:middle;font-family:'JetBrains Mono',monospace;font-size:9px;font-weight:700;color:#155eef;white-space:nowrap;">×${item.count}</td>
              </tr>
            `;
          })
          .join('');

  const cableRows =
    visibleCables.length === 0
      ? ''
      : visibleCables
          .map(cab => {
            return `
              <tr style="border-bottom:1px solid #e2e8f0;">
                <td style="padding:3px 4px;width:20px;vertical-align:middle;">
                  <span style="display:inline-block;width:14px;height:3px;background:${escapeHtml(cab.color)};border-radius:1px;"></span>
                </td>
                <td style="padding:3px 4px;font-size:8.5px;font-weight:600;color:#1e293b;vertical-align:middle;">${escapeHtml(cab.label)}</td>
                <td style="padding:3px 4px;text-align:right;font-family:'JetBrains Mono',monospace;font-size:8.5px;color:#334155;vertical-align:middle;white-space:nowrap;">×${cab.count} (${cab.totalMeters}m)</td>
              </tr>
            `;
          })
          .join('');

  return `
    <div style="border:1px solid #cbd5e1;background:#ffffff;display:flex;flex-direction:column;height:100%;box-sizing:border-box;">
      <div style="background:#14213d;color:#ffffff;padding:5px 8px;display:flex;align-items:center;justify-content:space-between;">
        <span style="font-size:9.5px;font-weight:700;letter-spacing:0.03em;">CHÚ GIẢI KÝ HIỆU (LEGEND)</span>
        <span style="font-size:8px;color:#cbd5e1;font-family:'JetBrains Mono',monospace;">${escapeHtml(legendData.scope === 'activeFloor' ? 'Tầng hiện tại' : 'Toàn dự án')}</span>
      </div>
      <div style="flex:1;overflow:hidden;padding:4px 6px;display:flex;flex-direction:column;gap:6px;">
        <div>
          <div style="font-size:8px;font-weight:700;color:#475569;margin-bottom:2px;letter-spacing:0.04em;">THIẾT BỊ (${legendData.totalDevices})</div>
          <table style="width:100%;border-collapse:collapse;">
            <tbody>${compRows}</tbody>
          </table>
          ${
            legendData.components.length > maxComponents
              ? `<div style="font-size:8px;color:#64748b;padding-top:2px;">+ ${legendData.components.length - maxComponents} nhóm thiết bị khác...</div>`
              : ''
          }
        </div>
        ${
          visibleCables.length > 0
            ? `<div>
                <div style="font-size:8px;font-weight:700;color:#475569;margin-bottom:2px;letter-spacing:0.04em;">TUYẾN CÁP (${legendData.totalCables})</div>
                <table style="width:100%;border-collapse:collapse;">
                  <tbody>${cableRows}</tbody>
                </table>
              </div>`
            : ''
        }
      </div>
      <div style="border-top:1px solid #cbd5e1;background:#f8fafc;padding:4px 8px;display:flex;justify-content:space-between;font-size:8.5px;font-family:'JetBrains Mono',monospace;color:#0f172a;">
        <span>Cáp: <strong>${totalMeters.toFixed(1)}m</strong></span>
        <span>Công suất: <strong>${totalWatts}W</strong></span>
      </div>
    </div>
  `;
}

function buildScaleBarHtml(metrics: A4ScaleMetrics, customDrawingScale?: string): string {
  const barPx = mmToPx(metrics.scaleBar.barWidthMm);
  const segPx = Math.max(14, Math.round(barPx / metrics.scaleBar.segments));
  const segsHtml = Array.from({ length: metrics.scaleBar.segments })
    .map((_, idx) => {
      const bg = idx % 2 === 0 ? '#0f172a' : '#ffffff';
      return `<div style="width:${segPx}px;height:6px;background:${bg};border-right:${idx < metrics.scaleBar.segments - 1 ? '1px solid #0f172a' : 'none'};box-sizing:border-box;"></div>`;
    })
    .join('');

  return `
    <div style="position:absolute;left:8px;bottom:8px;background:rgba(255,255,255,0.95);border:1px solid #cbd5e1;padding:5px 8px;box-sizing:border-box;">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:3px;">
        <span style="font-size:8.5px;font-weight:700;color:#0f172a;">THƯỚC TỶ LỆ (SCALE BAR)</span>
        <span style="font-size:8.5px;font-family:'JetBrains Mono',monospace;font-weight:700;color:#155eef;">${escapeHtml(metrics.scaleRatioLabel)}${customDrawingScale && customDrawingScale !== metrics.scaleRatioLabel ? ` · ${escapeHtml(customDrawingScale)}` : ''}</span>
      </div>
      <div style="display:flex;border:1px solid #0f172a;width:${segPx * metrics.scaleBar.segments}px;">
        ${segsHtml}
      </div>
      <div style="display:flex;justify-content:space-between;width:${segPx * metrics.scaleBar.segments}px;margin-top:2px;font-family:'JetBrains Mono',monospace;font-size:8px;color:#334155;">
        <span>0m</span>
        <span>${metrics.scaleBar.ticks[1]}m</span>
        <span>${metrics.scaleBar.ticks[2]}m</span>
      </div>
      <div style="margin-top:2px;font-size:7.5px;color:#64748b;font-family:'JetBrains Mono',monospace;">
        Khung: ${metrics.realWorldWidthMeters}m × ${metrics.realWorldHeightMeters}m · ${metrics.pxPerMeter}px/m
      </div>
    </div>
  `;
}

function buildTitleBlockHtml(
  project: ProjectState,
  metrics: A4ScaleMetrics,
  options: {
    drawingCode: string;
    drawingScale: string;
    orientation: A4Orientation;
    paperSize?: PdfPaperSizeUpper;
    pageNumber: number;
    totalPages: number;
    subtitle?: string;
  }
): string {
  const dateStr = new Date().toLocaleDateString('vi-VN');
  const paperLabel = options.paperSize || 'A4';
  const scaleText = options.drawingScale.trim()
    ? `${metrics.scaleRatioLabel} (${options.drawingScale.trim()})`
    : metrics.scaleRatioLabel;

  return `
    <table style="width:100%;border-collapse:collapse;border:1.5px solid #14213d;font-size:9px;background:#ffffff;color:#0f172a;">
      <tbody>
        <tr>
          <td rowspan="2" style="border:1px solid #14213d;padding:5px 8px;width:36%;vertical-align:middle;">
            <div style="display:flex;align-items:center;gap:8px;">
              ${getHachihiLogoSvgMarkup(24, 'light', `pdf_${options.pageNumber}`)}
              <div style="min-width:0;">
                <div style="font-size:8px;font-weight:700;color:#155eef;letter-spacing:0.04em;">HACHIHI NETWORK &amp; ELECTRICAL DESIGNER · hachihi.vn</div>
                <div style="font-size:11px;font-weight:800;color:#0f172a;margin-top:2px;">${escapeHtml(project.name)}</div>
                <div style="font-size:7.5px;color:#475569;margin-top:1px;">${options.subtitle ? `${escapeHtml(options.subtitle)} · ` : ''}Hotline: 093 384 2126 · App v${escapeHtml(APP_VERSION)} (${escapeHtml(APP_BUILD_HASH)})</div>
              </div>
            </div>
          </td>
          <td style="border:1px solid #14213d;padding:4px 7px;">
            <span style="color:#64748b;">Số hiệu:</span> <strong style="font-family:'JetBrains Mono',monospace;">${escapeHtml(options.drawingCode)}</strong>
          </td>
          <td style="border:1px solid #14213d;padding:4px 7px;">
            <span style="color:#64748b;">Tỷ lệ:</span> <strong style="font-family:'JetBrains Mono',monospace;">${escapeHtml(scaleText)}</strong>
          </td>
          <td style="border:1px solid #14213d;padding:4px 7px;">
            <span style="color:#64748b;">Khổ giấy:</span> <strong>ISO ${escapeHtml(paperLabel)} (${options.orientation === 'landscape' ? 'Ngang' : 'Dọc'})</strong>
          </td>
        </tr>
        <tr>
          <td style="border:1px solid #14213d;padding:4px 7px;">
            <span style="color:#64748b;">Kỹ sư:</span> <strong>${escapeHtml(project.author || 'Kỹ sư hệ thống')}</strong>
          </td>
          <td style="border:1px solid #14213d;padding:4px 7px;">
            <span style="color:#64748b;">Ngày xuất:</span> <strong style="font-family:'JetBrains Mono',monospace;">${dateStr}</strong>
          </td>
          <td style="border:1px solid #14213d;padding:4px 7px;">
            <span style="color:#64748b;">Phiên bản:</span> <strong style="font-family:'JetBrains Mono',monospace;">Tài liệu v${escapeHtml(project.version)} · Phần mềm v${escapeHtml(APP_VERSION)} · Trang ${options.pageNumber}/${options.totalPages}</strong>
          </td>
        </tr>
      </tbody>
    </table>
  `;
}

function createA4DrawingPageElement(
  project: ProjectState,
  diagramPngDataUrl: string,
  metrics: A4ScaleMetrics,
  legendData: GeneratedLegendData,
  options: {
    orientation: A4Orientation;
    paperSize?: PdfPaperSizeUpper;
    includeLegendPanel: boolean;
    drawingCode: string;
    drawingScale: string;
    pageNumber?: number;
    floorLabel?: string;
    totalPages: number;
  }
): HTMLDivElement {
  const paperLabel = options.paperSize || 'A4';
  const pagePxW = mmToPx(metrics.pageWidthMm);
  const pagePxH = mmToPx(metrics.pageHeightMm);
  const padPx = mmToPx(metrics.marginMm);
  const drawBoxW = mmToPx(metrics.drawAreaWidthMm);
  const drawBoxH = mmToPx(metrics.drawAreaHeightMm);
  const renderedW = mmToPx(metrics.renderedDrawWidthMm);
  const renderedH = mmToPx(metrics.renderedDrawHeightMm);

  const activeFloor = project.floors.find(f => f.id === project.activeFloorId);
  const floorBadge = options.floorLabel || (activeFloor ? activeFloor.name : 'Toàn bộ tầng');
  const pageNumber = options.pageNumber ?? 1;

  const pageEl = document.createElement('div');
  pageEl.style.width = `${pagePxW}px`;
  pageEl.style.height = `${pagePxH}px`;
  pageEl.style.padding = `${padPx}px`;
  pageEl.style.boxSizing = 'border-box';
  pageEl.style.background = '#ffffff';
  pageEl.style.color = '#0f172a';
  pageEl.style.fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
  pageEl.style.display = 'flex';
  pageEl.style.flexDirection = 'column';

  const flexDirection = options.orientation === 'landscape' ? 'row' : 'column';
  const legendPanelHtml = options.includeLegendPanel
    ? `<div style="${
        options.orientation === 'landscape'
          ? `width:${mmToPx(66)}px;height:${drawBoxH}px;flex-shrink:0;`
          : `width:100%;height:${mmToPx(54)}px;flex-shrink:0;`
      }">${buildLegendHtml(legendData, options.orientation)}</div>`
    : '';

  pageEl.innerHTML = `
    <div style="border:1.5px solid #14213d;flex:1;display:flex;flex-direction:column;padding:8px;box-sizing:border-box;gap:8px;background:#ffffff;">
      <!-- Top Sheet Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #155eef;padding-bottom:5px;flex-shrink:0;">
        <div>
          <div style="font-size:8.5px;font-weight:700;color:#155eef;letter-spacing:0.05em;">BẢN VẼ KỸ THUẬT HẠ TẦNG MẠNG &amp; ĐIỆN</div>
          <div style="font-size:13px;font-weight:800;color:#0f172a;margin-top:1px;">${escapeHtml(project.name)}</div>
        </div>
        <div style="text-align:right;font-size:9px;color:#475569;font-family:'JetBrains Mono',monospace;">
          <div>Chế độ: <strong style="color:#0f172a;">${escapeHtml(project.activeMode.toUpperCase())}</strong> · ${escapeHtml(floorBadge)}</div>
          <div>Chuẩn xuất: ISO ${escapeHtml(paperLabel)} ${metrics.pageWidthMm}×${metrics.pageHeightMm}mm · ${escapeHtml(metrics.scaleRatioLabel)}</div>
        </div>
      </div>

      <!-- Canvas Drawing + Optional Legend Details -->
      <div style="flex:1;display:flex;flex-direction:${flexDirection};gap:10px;min-height:0;align-items:stretch;">
        <div style="position:relative;width:${drawBoxW}px;height:${drawBoxH}px;border:1px solid #cbd5e1;background:#ffffff;display:flex;align-items:center;justify-content:center;overflow:hidden;box-sizing:border-box;flex:1;">
          <img src="${diagramPngDataUrl}" alt="Technical Diagram" style="width:${renderedW}px;height:${renderedH}px;display:block;object-fit:contain;" />
          ${buildScaleBarHtml(metrics, options.drawingScale)}
        </div>
        ${legendPanelHtml}
      </div>

      <!-- Bottom Engineering Title Block -->
      <div style="flex-shrink:0;">
        ${buildTitleBlockHtml(project, metrics, {
          drawingCode: options.drawingCode,
          drawingScale: options.drawingScale,
          orientation: options.orientation,
          paperSize: paperLabel,
          pageNumber,
          totalPages: options.totalPages,
          subtitle: `Sơ đồ ${project.activeMode.toUpperCase()} · ${floorBadge}`
        })}
      </div>
    </div>
  `;

  return pageEl;
}

function createA4AppendixPageElement(
  project: ProjectState,
  metrics: A4ScaleMetrics,
  options: {
    orientation: A4Orientation;
    paperSize?: PdfPaperSizeUpper;
    drawingCode: string;
    drawingScale: string;
    pageNumber: number;
    totalPages: number;
    title: string;
    bodyHtml: string;
  }
): HTMLDivElement {
  const pagePxW = mmToPx(metrics.pageWidthMm);
  const pagePxH = mmToPx(metrics.pageHeightMm);
  const padPx = mmToPx(metrics.marginMm);

  const pageEl = document.createElement('div');
  pageEl.style.width = `${pagePxW}px`;
  pageEl.style.height = `${pagePxH}px`;
  pageEl.style.padding = `${padPx}px`;
  pageEl.style.boxSizing = 'border-box';
  pageEl.style.background = '#ffffff';
  pageEl.style.color = '#0f172a';
  pageEl.style.fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
  pageEl.style.display = 'flex';
  pageEl.style.flexDirection = 'column';

  pageEl.innerHTML = `
    <div style="border:1.5px solid #14213d;flex:1;display:flex;flex-direction:column;padding:10px;box-sizing:border-box;gap:8px;background:#ffffff;">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #155eef;padding-bottom:5px;flex-shrink:0;">
        <div>
          <div style="font-size:8.5px;font-weight:700;color:#155eef;letter-spacing:0.05em;">PHỤ LỤC HỒ SƠ KỸ THUẬT</div>
          <div style="font-size:13px;font-weight:800;color:#0f172a;">${escapeHtml(options.title)}</div>
        </div>
        <div style="font-size:9px;color:#475569;font-family:'JetBrains Mono',monospace;">
          ${escapeHtml(project.name)} · Trang ${options.pageNumber}/${options.totalPages}
        </div>
      </div>

      <div style="flex:1;overflow:hidden;">
        ${options.bodyHtml}
      </div>

      <div style="flex-shrink:0;">
        ${buildTitleBlockHtml(project, metrics, {
          drawingCode: options.drawingCode,
          drawingScale: options.drawingScale,
          orientation: options.orientation,
          paperSize: options.paperSize,
          pageNumber: options.pageNumber,
          totalPages: options.totalPages,
          subtitle: options.title
        })}
      </div>
    </div>
  `;

  return pageEl;
}

function buildRackAppendixHtml(project: ProjectState): string {
  const cards = project.racks
    .slice(0, 4)
    .map(rack => {
      const stats = getRackStatistics(rack, project.assets);
      const frontEntries = Object.entries(rack.slots || {})
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .slice(0, 14);
      const rearEntries = Object.entries(rack.rearSlots || {})
        .sort((a, b) => Number(b[0]) - Number(a[0]))
        .slice(0, 14);

      const renderRows = (entries: Array<[string, string]>) => {
        if (entries.length === 0) {
          return `<tr><td colspan="2" style="padding:4px;text-align:center;color:#94a3b8;font-size:8.5px;">Trống</td></tr>`;
        }
        return entries
          .map(([uStr, assetId]) => {
            const asset = project.assets[assetId];
            const u = parseInt(uStr, 10);
            const h = asset ? getAssetUHeight(asset) : 1;
            const uLabel = h > 1 ? `U${u}-${u + h - 1}` : `U${u}`;
            return `
              <tr>
                <td style="border:1px solid #cbd5e1;padding:2.5px 5px;font-family:'JetBrains Mono',monospace;font-size:8.5px;width:44px;">${uLabel}</td>
                <td style="border:1px solid #cbd5e1;padding:2.5px 5px;font-size:8.5px;">${escapeHtml(asset?.name || assetId)}</td>
              </tr>
            `;
          })
          .join('');
      };

      return `
        <div style="border:1px solid #cbd5e1;padding:8px;background:#ffffff;box-sizing:border-box;">
          <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e2e8f0;padding-bottom:4px;margin-bottom:6px;">
            <div>
              <div style="font-size:10px;font-weight:700;color:#0f172a;">${escapeHtml(rack.name)} (${rack.totalUnits}U)</div>
              <div style="font-size:8.5px;color:#475569;">Trước: ${stats.frontUsedUnits}U · Sau: ${stats.rearUsedUnits}U · Trống trước: ${stats.frontFreeUnits}U</div>
            </div>
            <div style="text-align:right;font-family:'JetBrains Mono',monospace;font-size:8.5px;">
              <div style="font-weight:700;color:#155eef;">${stats.totalPowerWatts} W</div>
              <div style="color:#475569;">${stats.totalWeightKg.toFixed(1)}/${rack.maxLoadKg || 1000} kg</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div>
              <div style="font-size:8.5px;font-weight:700;color:#334155;margin-bottom:3px;">Mặt Trước (${frontEntries.length})</div>
              <table style="width:100%;border-collapse:collapse;"><tbody>${renderRows(frontEntries)}</tbody></table>
            </div>
            <div>
              <div style="font-size:8.5px;font-weight:700;color:#334155;margin-bottom:3px;">Mặt Sau (${rearEntries.length})</div>
              <table style="width:100%;border-collapse:collapse;"><tbody>${renderRows(rearEntries)}</tbody></table>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">${cards}</div>`;
}

function buildScheduleAppendixHtml(project: ProjectState): string {
  const assets = Object.values(project.assets).slice(0, 22);
  const cables = project.cables.slice(0, 22);

  const assetRows = assets
    .map(a => {
      const rackName = project.racks.find(r => r.id === a.rackId)?.name || '—';
      return `
        <tr>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;font-family:'JetBrains Mono',monospace;">${escapeHtml(a.assetTag)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;font-weight:600;">${escapeHtml(a.name)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;">${escapeHtml(`${a.vendor} ${a.model}`)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;font-family:'JetBrains Mono',monospace;">${escapeHtml(a.ipAddress || '—')}${a.vlan ? ` (V${escapeHtml(a.vlan)})` : ''}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;">${a.rackId ? escapeHtml(`${rackName} · U${a.rackUnitStart}`) : '—'}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;text-align:right;font-family:'JetBrains Mono',monospace;">${a.powerWatts || 0}W</td>
        </tr>
      `;
    })
    .join('');

  const cableRows = cables
    .map(c => {
      const src = project.nodes.find(n => n.id === c.sourceNodeId)?.label || c.sourceNodeId;
      const tgt = project.nodes.find(n => n.id === c.targetNodeId)?.label || c.targetNodeId;
      return `
        <tr>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;font-family:'JetBrains Mono',monospace;">${escapeHtml(c.cableCode)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;">${escapeHtml(src)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;">${escapeHtml(tgt)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;">${escapeHtml(c.cableType)}</td>
          <td style="border:1px solid #cbd5e1;padding:3px 5px;text-align:right;font-family:'JetBrains Mono',monospace;">${escapeHtml(c.bandwidth)} · ${c.lengthMeters || 0}m</td>
        </tr>
      `;
    })
    .join('');

  return `
    <div style="display:flex;flex-direction:column;gap:10px;font-size:8.5px;">
      <div>
        <div style="font-size:9.5px;font-weight:700;color:#0f172a;margin-bottom:4px;">1. Danh mục thiết bị (${Object.keys(project.assets).length})</div>
        <table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1;">
          <thead>
            <tr style="background:#f1f5f9;">
              <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Mã TS</th>
              <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Thiết bị</th>
              <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Model / Hãng</th>
              <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">IP / VLAN</th>
              <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Rack / U</th>
              <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:right;">Công suất</th>
            </tr>
          </thead>
          <tbody>${assetRows}</tbody>
        </table>
      </div>
      ${
        cables.length > 0
          ? `<div>
              <div style="font-size:9.5px;font-weight:700;color:#0f172a;margin-bottom:4px;">2. Danh bạ đấu nối cáp (${project.cables.length})</div>
              <table style="width:100%;border-collapse:collapse;border:1px solid #cbd5e1;">
                <thead>
                  <tr style="background:#f1f5f9;">
                    <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Mã cáp</th>
                    <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Nguồn</th>
                    <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Đích</th>
                    <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:left;">Chuẩn cáp</th>
                    <th style="border:1px solid #cbd5e1;padding:3.5px 5px;text-align:right;">Tốc độ / Dài</th>
                  </tr>
                </thead>
                <tbody>${cableRows}</tbody>
              </table>
            </div>`
          : ''
      }
    </div>
  `;
}

/**
 * Exports the current canvas state as a clean, A4-formatted technical PDF
 * using html2canvas + jsPDF, maintaining drawing scale and legend details.
 */
/**
 * Builds an ISO A4 technical drawing PDF artifact in memory (Blob + Uint8Array)
 * so callers can either download directly or bundle inside a handover ZIP package.
 */
export async function buildA4PdfArtifact(
  project: ProjectState,
  options?: ExportA4PdfOptions
): Promise<A4PdfArtifact> {
  const orientation: A4Orientation = options?.orientation || 'landscape';
  const includeLegendPanel = options?.includeLegendPanel ?? true;
  const includeRackElevation = options?.includeRackElevation ?? false;
  const includeTables = options?.includeTables ?? false;
  const drawingCode = options?.drawingCode?.trim() || 'NET-ELV-01';
  const drawingScale = options?.drawingScale?.trim() || '';
  const legendScope: 'all' | 'activeFloor' =
    options?.legendScope ||
    (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode) ? 'activeFloor' : 'all');

  const floorSheets = resolvePdfFloorSheets(project, options?.floorScope ?? 'active');
  const firstSheetScopeId = floorSheets[0]?.floorScopeId ?? '__ALL__';
  const bounds = computePureDiagramBounds(project, { floorScopeId: firstSheetScopeId });
  const scaleMetrics = computeA4ScaleMetrics(bounds, project.settings.scale, orientation, {
    includeLegendPanel
  });

  const hasRackPage = includeRackElevation && project.racks.length > 0;
  const hasSchedulePage =
    includeTables && (Object.keys(project.assets).length > 0 || project.cables.length > 0);
  const totalPages = floorSheets.length + (hasRackPage ? 1 : 0) + (hasSchedulePage ? 1 : 0);

  if (typeof document === 'undefined') {
    const { jsPDF } = await import('jspdf');
    const pdf = new jsPDF({ orientation, unit: 'mm', format: 'a4', compress: true });
    let pageIdx = 0;
    for (const sheet of floorSheets) {
      if (pageIdx > 0) pdf.addPage('a4', orientation);
      pageIdx++;
      pdf.setFontSize(13);
      pdf.text(`HACHIHI 2D CAD - ${sheet.label}`, 12, 16);
    }
    if (hasRackPage) {
      if (pageIdx > 0) pdf.addPage('a4', orientation);
      pageIdx++;
      pdf.text(`Rack Elevation Appendix (${project.racks.length})`, 12, 16);
    }
    if (hasSchedulePage) {
      if (pageIdx > 0) pdf.addPage('a4', orientation);
      pageIdx++;
      pdf.text(`Schedule Appendix`, 12, 16);
    }
    const safeName =
      (project.name || 'HACHIHI_Network_Design')
        .trim()
        .replace(/[^\p{L}\p{N}_-]+/gu, '_')
        .replace(/^_+|_+$/g, '') || 'HACHIHI_Technical_Drawing';
    const uint8 = new Uint8Array(pdf.output('arraybuffer'));
    return {
      blob: new Blob([uint8], { type: 'application/pdf' }),
      uint8,
      filename: `${safeName}_A4_Technical.pdf`,
      pageCount: pageIdx,
      scaleMetrics
    };
  }

  const pageElements: HTMLDivElement[] = [];
  let nextPage = 1;
  for (const sheet of floorSheets) {
    const sheetBounds = computePureDiagramBounds(project, { floorScopeId: sheet.floorScopeId });
    const sheetMetrics = computeA4ScaleMetrics(sheetBounds, project.settings.scale, orientation, {
      includeLegendPanel
    });
    const pureSvg = sheet.isComposite
      ? generateCompositeBuildingSvgMarkup(project, { darkTheme: false, includeTitleBlock: false })
      : generatePureSvgMarkup(project, {
          darkTheme: false,
          includeTitleBlock: false,
          floorScopeId: sheet.floorScopeId
        });
    const diagramPngDataUrl = await rasterizeSvgMarkupToPng(pureSvg, sheetBounds);
    const sheetProject: ProjectState =
      sheet.floorScopeId !== '__ALL__' && project.floors.some(f => f.id === sheet.floorScopeId)
        ? { ...project, activeFloorId: sheet.floorScopeId }
        : project;
    const sheetLegendData = buildProjectLegendData(sheetProject, {
      scope: sheet.isComposite ? 'all' : legendScope,
      includeCables: true
    });
    pageElements.push(
      createA4DrawingPageElement(sheetProject, diagramPngDataUrl, sheetMetrics, sheetLegendData, {
        orientation,
        includeLegendPanel,
        drawingCode,
        drawingScale,
        pageNumber: nextPage++,
        floorLabel: sheet.label,
        totalPages
      })
    );
  }

  if (hasRackPage) {
    pageElements.push(
      createA4AppendixPageElement(project, scaleMetrics, {
        orientation,
        drawingCode,
        drawingScale,
        pageNumber: nextPage++,
        totalPages,
        title: `Hồ sơ bố trí Tủ Rack (${project.racks.length} tủ)`,
        bodyHtml: buildRackAppendixHtml(project)
      })
    );
  }
  if (hasSchedulePage) {
    pageElements.push(
      createA4AppendixPageElement(project, scaleMetrics, {
        orientation,
        drawingCode,
        drawingScale,
        pageNumber: nextPage++,
        totalPages,
        title: 'Danh mục Thiết bị & Tuyến cáp',
        bodyHtml: buildScheduleAppendixHtml(project)
      })
    );
  }

  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf')
  ]);

  const stagingRoot = document.createElement('div');
  stagingRoot.style.position = 'fixed';
  stagingRoot.style.left = '-99999px';
  stagingRoot.style.top = '0';
  stagingRoot.style.zIndex = '-1';
  stagingRoot.style.background = '#ffffff';
  stagingRoot.setAttribute('aria-hidden', 'true');
  pageElements.forEach(el => stagingRoot.appendChild(el));
  document.body.appendChild(stagingRoot);

  try {
    // Allow image decode and layout flush before rasterizing
    await new Promise<void>(resolve => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });

    const pdf = new jsPDF({
      orientation,
      unit: 'mm',
      format: 'a4',
      compress: true
    });

    const pixelRatio = options?.pixelRatio ?? 2;
    const pagePxW = mmToPx(scaleMetrics.pageWidthMm);
    const pagePxH = mmToPx(scaleMetrics.pageHeightMm);

    for (let i = 0; i < pageElements.length; i++) {
      const canvas = await html2canvas(pageElements[i], {
        scale: pixelRatio,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        width: pagePxW,
        height: pagePxH,
        windowWidth: pagePxW,
        windowHeight: pagePxH,
        onclone: clonedDoc => sanitizeClonedDocForHtml2Canvas(clonedDoc)
      });

      const imgData = canvas.toDataURL('image/png');
      if (i > 0) {
        pdf.addPage('a4', orientation);
      }
      pdf.addImage(
        imgData,
        'PNG',
        0,
        0,
        scaleMetrics.pageWidthMm,
        scaleMetrics.pageHeightMm,
        undefined,
        'FAST'
      );
    }

    const safeName = (project.name || 'HACHIHI_Network_Design')
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .replace(/^_+|_+$/g, '') || 'HACHIHI_Technical_Drawing';
    const filename = `${safeName}_A4_Technical.pdf`;
    const arrayBuffer = pdf.output('arraybuffer');
    const uint8 = new Uint8Array(arrayBuffer);
    const blob = new Blob([uint8], { type: 'application/pdf' });

    return {
      blob,
      uint8,
      filename,
      pageCount: pageElements.length,
      scaleMetrics
    };
  } finally {
    stagingRoot.remove();
  }
}

/**
 * Generates and downloads an ISO A4 technical drawing PDF.
 */
export async function exportCanvasToA4Pdf(
  project: ProjectState,
  options?: ExportA4PdfOptions
): Promise<ExportA4PdfResult> {
  const artifact = await buildA4PdfArtifact(project, options);
  const urlApi = window.URL || window.webkitURL;
  const blobUrl = urlApi.createObjectURL(artifact.blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = artifact.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => urlApi.revokeObjectURL(blobUrl), 1500);
  return {
    filename: artifact.filename,
    pageCount: artifact.pageCount,
    scaleMetrics: artifact.scaleMetrics
  };
}

function create3DFramePageElement(
  project: ProjectState,
  capture: Captured3DPageInput,
  metrics: A4ScaleMetrics,
  legendData: GeneratedLegendData,
  options: {
    orientation: A4Orientation;
    paperSize: PdfPaperSizeUpper;
    includeLegendPanel: boolean;
    drawingCode: string;
    drawingScale: string;
    pageNumber: number;
    totalPages: number;
  }
): {
  pageEl: HTMLDivElement;
  imageBoxMm: { x: number; y: number; w: number; h: number };
} {
  const marginMm = metrics.marginMm;
  const headerTotalMm = 14;
  const titleBlockMm = 21;
  const padMm = 2.5;
  const legendReserveW = options.includeLegendPanel && options.orientation === 'landscape' ? 66 : 0;
  const legendReserveH = options.includeLegendPanel && options.orientation === 'portrait' ? 54 : 0;

  const boxXmm = marginMm + padMm;
  const boxYmm = marginMm + padMm + headerTotalMm + 2;
  const boxWmm = Math.max(60, metrics.pageWidthMm - marginMm * 2 - padMm * 2 - legendReserveW - (legendReserveW > 0 ? 3 : 0));
  const boxHmm = Math.max(60, metrics.pageHeightMm - marginMm * 2 - padMm * 2 - headerTotalMm - titleBlockMm - 4 - legendReserveH - (legendReserveH > 0 ? 3 : 0));

  const pagePxW = mmToPx(metrics.pageWidthMm);
  const pagePxH = mmToPx(metrics.pageHeightMm);
  const padPx = mmToPx(marginMm);
  const drawBoxW = mmToPx(boxWmm);
  const drawBoxH = mmToPx(boxHmm);

  const activeFloor = project.floors.find(f => f.id === project.activeFloorId);
  const floorBadge = activeFloor ? activeFloor.name : 'Toàn bộ tầng';

  const pageEl = document.createElement('div');
  pageEl.style.width = `${pagePxW}px`;
  pageEl.style.height = `${pagePxH}px`;
  pageEl.style.padding = `${padPx}px`;
  pageEl.style.boxSizing = 'border-box';
  pageEl.style.background = '#ffffff';
  pageEl.style.color = '#0f172a';
  pageEl.style.fontFamily = "'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";
  pageEl.style.display = 'flex';
  pageEl.style.flexDirection = 'column';

  const flexDirection = options.orientation === 'landscape' ? 'row' : 'column';
  const legendPanelHtml = options.includeLegendPanel
    ? `<div style="${
        options.orientation === 'landscape'
          ? `width:${mmToPx(66)}px;height:${drawBoxH}px;flex-shrink:0;`
          : `width:100%;height:${mmToPx(54)}px;flex-shrink:0;`
      }">${buildLegendHtml(legendData, options.orientation)}</div>`
    : '';

  const viewBgHex = capture.background === 'dark' ? '#0b1120' : '#ffffff';

  pageEl.innerHTML = `
    <div style="border:1.5px solid #14213d;flex:1;display:flex;flex-direction:column;padding:8px;box-sizing:border-box;gap:8px;background:#ffffff;">
      <div style="display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #155eef;padding-bottom:5px;flex-shrink:0;">
        <div>
          <div style="font-size:8.5px;font-weight:700;color:#155eef;letter-spacing:0.05em;">MÔ HÌNH KHÔNG GIAN 3D HẠ TẦNG · ${escapeHtml(capture.label.toUpperCase())}</div>
          <div style="font-size:13px;font-weight:800;color:#0f172a;margin-top:1px;">${escapeHtml(project.name)}</div>
        </div>
        <div style="text-align:right;font-size:9px;color:#475569;font-family:'JetBrains Mono',monospace;">
          <div>Chế độ: <strong style="color:#0f172a;">3D ${escapeHtml(project.activeMode.toUpperCase())}</strong> · ${escapeHtml(floorBadge)}</div>
          <div>Khổ giấy: ISO ${options.paperSize} (${options.orientation === 'landscape' ? 'Ngang' : 'Dọc'}) · Trang ${options.pageNumber}/${options.totalPages}</div>
        </div>
      </div>

      <div style="flex:1;display:flex;flex-direction:${flexDirection};gap:10px;min-height:0;align-items:stretch;">
        <div style="position:relative;width:${drawBoxW}px;height:${drawBoxH}px;border:1px solid #cbd5e1;background:${viewBgHex};box-sizing:border-box;flex:1;"></div>
        ${legendPanelHtml}
      </div>

      <div style="flex-shrink:0;">
        ${buildTitleBlockHtml(project, metrics, {
          drawingCode: options.drawingCode,
          drawingScale: options.drawingScale || '3D Perspective',
          orientation: options.orientation,
          paperSize: options.paperSize,
          pageNumber: options.pageNumber,
          totalPages: options.totalPages,
          subtitle: `${capture.label} · ${floorBadge}`
        })}
      </div>
    </div>
  `;

  return {
    pageEl,
    imageBoxMm: {
      x: boxXmm,
      y: boxYmm,
      w: boxWmm,
      h: boxHmm
    }
  };
}

/**
 * Builds a unified technical PDF supporting 2D CAD, 3D WebGL snapshots (one or multiple angles),
 * or combined 2D + 3D sheets plus optional Rack elevation and Equipment/Cable schedule appendices.
 */
export async function buildTechnicalPdfArtifact(
  project: ProjectState,
  options?: ExportTechnicalPdfOptions
): Promise<A4PdfArtifact> {
  const contentScope: PdfContentScope = options?.contentScope || '2d';
  const paperSize: PdfPaperSizeUpper = options?.paperSize || 'A4';
  const orientation: A4Orientation = options?.orientation || 'landscape';
  const includeDiagram = options?.includeDiagram ?? true;
  const includeLegendPanel = options?.includeLegendPanel ?? true;
  const includeRackElevation = options?.includeRackElevation ?? false;
  const includeTables = options?.includeTables ?? false;
  const drawingCode = options?.drawingCode?.trim() || 'NET-ELV-01';
  const drawingScale = options?.drawingScale?.trim() || '';
  const captures3D = options?.captures3D || [];

  if ((contentScope === '3d' || contentScope === 'both') && includeDiagram && captures3D.length === 0) {
    throw new Error('Không có ảnh chụp 3D hợp lệ để đưa vào tài liệu PDF.');
  }

  // Fast pure-A4 2D path stays identical when scope is 2D on A4
  if (contentScope === '2d' && paperSize === 'A4' && includeDiagram) {
    return buildA4PdfArtifact(project, options);
  }

  const paperDims = getPaperDimensionsMm(paperSize, orientation);
  const bounds = computePureDiagramBounds(project);
  const scaleMetrics = computeA4ScaleMetrics(bounds, project.settings.scale, orientation, {
    includeLegendPanel,
    paperSize
  });

  const legendScope: 'all' | 'activeFloor' =
    options?.legendScope ||
    (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode) ? 'activeFloor' : 'all');

  const safeName =
    (project.name || 'HACHIHI_Network_Design')
      .trim()
      .replace(/[^\p{L}\p{N}_-]+/gu, '_')
      .replace(/^_+|_+$/g, '') || 'HACHIHI_Technical_Drawing';
  const scopeSuffix = contentScope === '3d' ? '3D' : contentScope === 'both' ? '2D_3D' : '2D';
  const filename = `${safeName}_${paperSize}_${scopeSuffix}_Technical.pdf`;

  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({
    orientation,
    unit: 'mm',
    format: paperDims.format,
    compress: true
  });

  const include2DPage = includeDiagram && (contentScope === '2d' || contentScope === 'both');
  const floorSheets = include2DPage ? resolvePdfFloorSheets(project, options?.floorScope ?? 'all') : [];
  const captures3DToRender = includeDiagram && (contentScope === '3d' || contentScope === 'both') ? captures3D : [];
  const hasRackPage = includeRackElevation && project.racks.length > 0;
  const hasSchedulePage =
    includeTables && (Object.keys(project.assets).length > 0 || project.cables.length > 0);

  const totalPages =
    floorSheets.length +
    captures3DToRender.length +
    (hasRackPage ? 1 : 0) +
    (hasSchedulePage ? 1 : 0);

  if (totalPages === 0) {
    throw new Error('Vui lòng chọn ít nhất một nội dung (Sơ đồ, Tủ Rack hoặc Bảng thống kê) để xuất PDF.');
  }

  // Headless Node environment fallback (used by automated unit tests verifying binary PDF creation & aspect ratios)
  if (typeof document === 'undefined') {
    let pageIdx = 0;
    for (const sheet of floorSheets) {
      if (pageIdx > 0) pdf.addPage(paperDims.format, orientation);
      pageIdx++;
      pdf.setFontSize(13);
      pdf.text(`HACHIHI 2D CAD - ${safeName} (${sheet.label})`, 12, 16);
    }
    for (const cap of captures3DToRender) {
      if (pageIdx > 0) pdf.addPage(paperDims.format, orientation);
      pageIdx++;
      const fit = fitBoxPreserveAspectRatio(
        cap.width,
        cap.height,
        paperDims.widthMm - 20,
        paperDims.heightMm - 42
      );
      pdf.setFontSize(12);
      pdf.text(`HACHIHI 3D (${cap.preset.toUpperCase()}) - ${safeName}`, 12, 15);
      pdf.addImage(
        cap.dataUrl,
        'PNG',
        10 + fit.offsetX,
        22 + fit.offsetY,
        fit.width,
        fit.height,
        undefined,
        'FAST'
      );
    }
    if (hasRackPage) {
      if (pageIdx > 0) pdf.addPage(paperDims.format, orientation);
      pageIdx++;
      pdf.text(`Rack Elevation Appendix (${project.racks.length})`, 12, 16);
    }
    if (hasSchedulePage) {
      if (pageIdx > 0) pdf.addPage(paperDims.format, orientation);
      pageIdx++;
      pdf.text(`Schedule Appendix`, 12, 16);
    }
    const uint8 = new Uint8Array(pdf.output('arraybuffer'));
    return {
      blob: new Blob([uint8], { type: 'application/pdf' }),
      uint8,
      filename,
      pageCount: pageIdx,
      scaleMetrics
    };
  }

  const [{ default: html2canvas }] = await Promise.all([import('html2canvas')]);
  const legendData = buildProjectLegendData(project, {
    scope: legendScope,
    includeCables: true
  });

  type RenderJob =
    | { kind: 'dom'; element: HTMLDivElement }
    | {
        kind: '3d_frame';
        element: HTMLDivElement;
        capture: Captured3DPageInput;
        imageBoxMm: { x: number; y: number; w: number; h: number };
      };

  const jobs: RenderJob[] = [];
  let pageCursor = 1;

  for (const sheet of floorSheets) {
    const sheetBounds = computePureDiagramBounds(project, { floorScopeId: sheet.floorScopeId });
    const sheetMetrics = computeA4ScaleMetrics(sheetBounds, project.settings.scale, orientation, {
      includeLegendPanel,
      paperSize
    });
    const pureSvg = sheet.isComposite
      ? generateCompositeBuildingSvgMarkup(project, { darkTheme: false, includeTitleBlock: false })
      : generatePureSvgMarkup(project, {
          darkTheme: false,
          includeTitleBlock: false,
          floorScopeId: sheet.floorScopeId
        });
    const diagramPngDataUrl = await rasterizeSvgMarkupToPng(pureSvg, sheetBounds);
    const sheetProject: ProjectState =
      sheet.floorScopeId !== '__ALL__' && project.floors.some(f => f.id === sheet.floorScopeId)
        ? { ...project, activeFloorId: sheet.floorScopeId }
        : project;
    const sheetLegendData = buildProjectLegendData(sheetProject, {
      scope: sheet.isComposite ? 'all' : legendScope,
      includeCables: true
    });
    const el2d = createA4DrawingPageElement(sheetProject, diagramPngDataUrl, sheetMetrics, sheetLegendData, {
      orientation,
      paperSize,
      includeLegendPanel,
      drawingCode,
      drawingScale,
      pageNumber: pageCursor++,
      floorLabel: sheet.label,
      totalPages
    });
    jobs.push({ kind: 'dom', element: el2d });
  }

  for (const cap of captures3DToRender) {
    const { pageEl, imageBoxMm } = create3DFramePageElement(project, cap, scaleMetrics, legendData, {
      orientation,
      paperSize,
      includeLegendPanel,
      drawingCode,
      drawingScale,
      pageNumber: pageCursor++,
      totalPages
    });
    jobs.push({ kind: '3d_frame', element: pageEl, capture: cap, imageBoxMm });
  }

  if (hasRackPage) {
    jobs.push({
      kind: 'dom',
      element: createA4AppendixPageElement(project, scaleMetrics, {
        orientation,
        paperSize,
        drawingCode,
        drawingScale,
        pageNumber: pageCursor++,
        totalPages,
        title: `Hồ sơ bố trí Tủ Rack (${project.racks.length} tủ)`,
        bodyHtml: buildRackAppendixHtml(project)
      })
    });
  }

  if (hasSchedulePage) {
    jobs.push({
      kind: 'dom',
      element: createA4AppendixPageElement(project, scaleMetrics, {
        orientation,
        paperSize,
        drawingCode,
        drawingScale,
        pageNumber: pageCursor++,
        totalPages,
        title: 'Danh mục Thiết bị & Tuyến cáp',
        bodyHtml: buildScheduleAppendixHtml(project)
      })
    });
  }

  const stagingRoot = document.createElement('div');
  stagingRoot.style.position = 'fixed';
  stagingRoot.style.left = '-99999px';
  stagingRoot.style.top = '0';
  stagingRoot.style.zIndex = '-1';
  stagingRoot.style.background = '#ffffff';
  stagingRoot.setAttribute('aria-hidden', 'true');
  jobs.forEach(j => stagingRoot.appendChild(j.element));
  document.body.appendChild(stagingRoot);

  try {
    await new Promise<void>(resolve => {
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()));
    });

    const pixelRatio = options?.pixelRatio ?? 2;
    const pagePxW = mmToPx(scaleMetrics.pageWidthMm);
    const pagePxH = mmToPx(scaleMetrics.pageHeightMm);

    for (let i = 0; i < jobs.length; i++) {
      const job = jobs[i];
      const canvas = await html2canvas(job.element, {
        scale: pixelRatio,
        useCORS: true,
        allowTaint: false,
        backgroundColor: '#ffffff',
        logging: false,
        width: pagePxW,
        height: pagePxH,
        windowWidth: pagePxW,
        windowHeight: pagePxH,
        onclone: clonedDoc => sanitizeClonedDocForHtml2Canvas(clonedDoc)
      });

      const frameData = canvas.toDataURL('image/png');
      if (i > 0) {
        pdf.addPage(paperDims.format, orientation);
      }
      pdf.addImage(
        frameData,
        'PNG',
        0,
        0,
        scaleMetrics.pageWidthMm,
        scaleMetrics.pageHeightMm,
        undefined,
        'FAST'
      );

      if (job.kind === '3d_frame') {
        const fit = fitBoxPreserveAspectRatio(
          job.capture.width,
          job.capture.height,
          job.imageBoxMm.w - 2,
          job.imageBoxMm.h - 2
        );
        pdf.addImage(
          job.capture.dataUrl,
          'PNG',
          job.imageBoxMm.x + 1 + fit.offsetX,
          job.imageBoxMm.y + 1 + fit.offsetY,
          fit.width,
          fit.height,
          undefined,
          'FAST'
        );
      }
    }

    const arrayBuffer = pdf.output('arraybuffer');
    const uint8 = new Uint8Array(arrayBuffer);
    const blob = new Blob([uint8], { type: 'application/pdf' });

    return {
      blob,
      uint8,
      filename,
      pageCount: jobs.length,
      scaleMetrics
    };
  } finally {
    stagingRoot.remove();
  }
}

export async function exportTechnicalPdf(
  project: ProjectState,
  options?: ExportTechnicalPdfOptions
): Promise<ExportA4PdfResult> {
  const artifact = await buildTechnicalPdfArtifact(project, options);
  const urlApi = window.URL || window.webkitURL;
  const blobUrl = urlApi.createObjectURL(artifact.blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = artifact.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => urlApi.revokeObjectURL(blobUrl), 1500);
  return {
    filename: artifact.filename,
    pageCount: artifact.pageCount,
    scaleMetrics: artifact.scaleMetrics
  };
}
