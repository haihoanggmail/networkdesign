import { ProjectState } from '../../types/infrastructure';
import { exportHandoverZipBundle } from '../../utils/handoverBundle';
import { buildExportPdfForBundle } from './exportPdf';
import { ExportBundleConfig, sanitizeExportBaseName } from './exportTypes';

export async function runExportBundle(
  project: ProjectState,
  config: ExportBundleConfig
): Promise<{ filename: string; totalBytes: number; entries: string[] }> {
  const baseName = sanitizeExportBaseName(project.name);

  const { pdfArtifact, captures3D } = await buildExportPdfForBundle(project, {
    contentScope: config.contentScope,
    paperSize: 'A4',
    orientation: config.orientation,
    drawingCode: config.drawingCode,
    drawingScale: config.drawingScale,
    includeDiagram: true,
    includeLegendPanel: config.includeLegendPanel,
    includeRackElevation: config.includeRackElevation,
    includeTables: config.includeTables,
    background3D: config.background3D,
    cameraAngles3D: config.cameraAngles3D,
    capture3D: config.capture3D
  });

  const captured3DImages = captures3D.map(cap => ({
    filename: `${baseName}_3D_${cap.preset.toUpperCase()}.png`,
    bytes: cap.bytes
  }));

  return exportHandoverZipBundle(project, {
    drawingCode: config.drawingCode,
    drawingScale: config.drawingScale,
    orientation: config.orientation,
    includeLegendPanel: config.includeLegendPanel,
    includeRackElevation: config.includeRackElevation,
    includeTables: config.includeTables,
    customPdfArtifact: {
      uint8: pdfArtifact.uint8,
      filename: pdfArtifact.filename
    },
    captured3DImages,
    viewerOptions: {
      contentScope: config.contentScope,
      background3D: config.background3D
    }
  });
}
