import { ProjectState } from '../../types/infrastructure';
import { generate2DSvgString } from './capture2D';
import {
  ExportContentScope,
  sanitizeExportBaseName,
  triggerBlobDownload
} from './exportTypes';

export function runExportSvg(
  project: ProjectState,
  contentScope: ExportContentScope = '2d'
): { filename: string } {
  if (contentScope === '3d') {
    throw new Error(
      'Định dạng Vector SVG chỉ hỗ trợ bản vẽ 2D CAD. Vui lòng chọn Phạm vi nội dung "Bản vẽ 2D" hoặc "Cả 2D và 3D", hoặc chọn xuất PNG / PDF cho mô hình 3D.'
    );
  }

  const svgData = generate2DSvgString(project, {
    darkTheme: project.settings.isDarkMode,
    includeTitleBlock: true
  });
  const baseName = sanitizeExportBaseName(project.name);
  const filename = `${baseName}.svg`;
  triggerBlobDownload(new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' }), filename);
  return { filename };
}
