import type {
  CameraPresetId,
  Capture3DBackground,
  Capture3DRequestOptions,
  Capture3DResult
} from '../../contexts/ViewportContext';
import type { A4Orientation } from '../../utils/pdfExporter';

export type ExportContentScope = '2d' | '3d' | 'both';
export type ExportFormat = 'png' | 'svg' | 'dxf' | 'pdf' | 'bundle' | 'html';
export type PdfPaperSize = 'A4' | 'A3' | 'A2' | 'A1';

export interface Export2DViewportRect {
  pan: { x: number; y: number };
  zoom: number;
  viewportSize: { w: number; h: number };
}

export interface Captured3DSnapshotInput {
  preset: CameraPresetId;
  label: string;
  dataUrl: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  background: Capture3DBackground;
}

export interface ExportPngConfig {
  contentScope: ExportContentScope;
  background3D?: Capture3DBackground;
  viewport2D?: Export2DViewportRect;
  quickView?: boolean;
  whiteBackground2D?: boolean;
  capture3D?: (options?: Capture3DRequestOptions) => Promise<Capture3DResult>;
}

export interface ExportPdfConfig {
  contentScope: ExportContentScope;
  paperSize?: PdfPaperSize;
  orientation: A4Orientation;
  drawingCode: string;
  drawingScale: string;
  includeDiagram: boolean;
  includeLegendPanel: boolean;
  includeRackElevation: boolean;
  includeTables: boolean;
  background3D?: Capture3DBackground;
  cameraAngles3D?: CameraPresetId[];
  capture3D?: (options?: Capture3DRequestOptions) => Promise<Capture3DResult>;
}

export interface ExportBundleConfig {
  contentScope: ExportContentScope;
  orientation: A4Orientation;
  drawingCode: string;
  drawingScale: string;
  includeLegendPanel: boolean;
  includeRackElevation: boolean;
  includeTables: boolean;
  background3D?: Capture3DBackground;
  cameraAngles3D?: CameraPresetId[];
  capture3D?: (options?: Capture3DRequestOptions) => Promise<Capture3DResult>;
}

export const CAMERA_PRESET_LABELS: Record<CameraPresetId, string> = {
  iso: 'Góc nhìn Isometric 3D',
  top: 'Mặt bằng trên xuống (Top 3D)',
  front: 'Mặt đứng trực diện (Front 3D)',
  side: 'Mặt cắt bên hông (Side 3D)'
};

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const urlApi = window.URL || window.webkitURL;
  const url = urlApi.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => urlApi.revokeObjectURL(url), 1500);
}

export function sanitizeExportBaseName(name: string): string {
  const cleaned = (name || 'HACHIHI_Project')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'HACHIHI_Project';
}
