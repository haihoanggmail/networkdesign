import { ProjectState } from '../../types/infrastructure';
import {
  computePureDiagramBounds,
  computeViewportDiagramBounds,
  exportCurrentViewToPng,
  exportProjectToPng,
  generatePureSvgMarkup
} from '../../utils/svgExport';
import { resolveCanvasAppearance } from '../../utils/canvasBackgrounds';
import type { Export2DViewportRect } from './exportTypes';

export interface Export2DPngResult {
  blob: Blob;
  filename: string;
}

export function generate2DSvgString(
  project: ProjectState,
  options?: { darkTheme?: boolean; includeTitleBlock?: boolean }
): string {
  return generatePureSvgMarkup(project, {
    darkTheme: options?.darkTheme ?? project.settings.isDarkMode,
    includeTitleBlock: options?.includeTitleBlock ?? true
  });
}

export function download2DHighResPng(project: ProjectState): Promise<void> {
  return new Promise((resolve, reject) => {
    exportProjectToPng(
      project,
      () => resolve(),
      errMsg => reject(new Error(errMsg))
    );
  });
}

export function download2DQuickViewPng(
  project: ProjectState,
  viewport?: Export2DViewportRect,
  whiteBackground = true
): Promise<void> {
  return new Promise((resolve, reject) => {
    exportCurrentViewToPng(
      project,
      viewport,
      { whiteBackground, includeTitleBlock: false },
      () => resolve(),
      errMsg => reject(new Error(errMsg))
    );
  });
}

/**
 * Renders the 2D diagram to a crisp PNG Blob (for combined ZIP or multi-file exports).
 */
export async function render2DPngBlob(
  project: ProjectState,
  options?: {
    viewport?: Export2DViewportRect;
    whiteBackground?: boolean;
    includeTitleBlock?: boolean;
  }
): Promise<Blob> {
  const whiteBackground = options?.whiteBackground ?? false;
  const bounds =
    (options?.viewport
      ? computeViewportDiagramBounds(
          options.viewport.pan,
          options.viewport.zoom,
          options.viewport.viewportSize
        )
      : undefined) || computePureDiagramBounds(project);

  const svgMarkup = generatePureSvgMarkup(project, {
    darkTheme: whiteBackground ? false : project.settings.isDarkMode,
    includeTitleBlock: options?.includeTitleBlock ?? true,
    boundsOverride: bounds,
    whiteBackground
  });

  const appearance = resolveCanvasAppearance(project.settings, project.settings.isDarkMode);
  const bgColor = whiteBackground ? '#ffffff' : appearance.backgroundColor;

  const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
  const urlApi = window.URL || window.webkitURL || window;
  const blobUrl = urlApi.createObjectURL(svgBlob);

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Không thể kết xuất hình ảnh PNG từ bản vẽ 2D.'));
      image.src = blobUrl;
    });

    const scale = Math.min(3, Math.max(1.5, 2200 / Math.max(bounds.width, bounds.height)));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(480, Math.round(bounds.width * scale));
    canvas.height = Math.max(360, Math.round(bounds.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Trình duyệt không hỗ trợ 2D Canvas để tạo ảnh PNG.');
    }
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(b => resolve(b), 'image/png', 1)
    );
    if (!blob) {
      throw new Error('Không thể chuyển đổi bản vẽ 2D sang PNG Blob.');
    }
    return blob;
  } finally {
    urlApi.revokeObjectURL(blobUrl);
  }
}
