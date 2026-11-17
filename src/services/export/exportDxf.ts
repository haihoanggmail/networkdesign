import { ProjectState } from '../../types/infrastructure';
import { exportProjectToDxf } from '../../utils/dxfExporter';
import { ExportContentScope, sanitizeExportBaseName } from './exportTypes';

export function runExportDxf(
  project: ProjectState,
  contentScope: ExportContentScope = '2d'
): { filename: string } {
  if (contentScope === '3d') {
    throw new Error(
      'Định dạng AutoCAD DXF chỉ áp dụng cho bản vẽ mặt bằng 2D CAD. Vui lòng chọn "Bản vẽ 2D" hoặc "Cả 2D và 3D".'
    );
  }

  exportProjectToDxf(project);
  const baseName = sanitizeExportBaseName(project.name);
  return { filename: `${baseName}_AutoCAD_R12.dxf` };
}
