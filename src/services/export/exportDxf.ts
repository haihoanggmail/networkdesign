import { ProjectState } from '../../types/infrastructure';
import { exportProjectToDxf } from '../../utils/dxfExporter';
import { ExportContentScope, ExportFloorScope, sanitizeExportBaseName } from './exportTypes';
import { trackExport } from '../../services/tracker';

export function runExportDxf(
  project: ProjectState,
  contentScope: ExportContentScope = '2d',
  floorScope: ExportFloorScope = 'all'
): { filename: string } {
  if (contentScope === '3d') {
    throw new Error(
      'Định dạng AutoCAD DXF chỉ áp dụng cho bản vẽ mặt bằng 2D CAD. Vui lòng chọn "Bản vẽ 2D" hoặc "Cả 2D và 3D".'
    );
  }

  exportProjectToDxf(project, { floorScope });
  const baseName = sanitizeExportBaseName(project.name);
  trackExport('dxf');
  return { filename: `${baseName}_AutoCAD_R12.dxf` };
}
