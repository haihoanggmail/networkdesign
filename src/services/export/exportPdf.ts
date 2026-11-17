import { ProjectState } from '../../types/infrastructure';
import {
  buildTechnicalPdfArtifact,
  exportTechnicalPdf,
  ExportA4PdfResult
} from '../../utils/pdfExporter';
import { capture3DAnglesStrict, capture3DSnapshotStrict } from './capture3D';
import { ExportPdfConfig } from './exportTypes';

export async function runExportPdf(
  project: ProjectState,
  config: ExportPdfConfig
): Promise<ExportA4PdfResult> {
  const needs3D = config.includeDiagram && (config.contentScope === '3d' || config.contentScope === 'both');

  let captures3D = undefined;
  if (needs3D) {
    const angles = config.cameraAngles3D && config.cameraAngles3D.length > 0 ? config.cameraAngles3D : [];
    captures3D =
      angles.length > 0
        ? await capture3DAnglesStrict(config.capture3D, angles, {
            width: 1920,
            height: 1080,
            background: config.background3D ?? 'light'
          })
        : [
            await capture3DSnapshotStrict(config.capture3D, {
              width: 1920,
              height: 1080,
              background: config.background3D ?? 'light'
            })
          ];
  }

  return exportTechnicalPdf(project, {
    contentScope: config.contentScope,
    paperSize: config.paperSize || 'A4',
    orientation: config.orientation,
    drawingCode: config.drawingCode,
    drawingScale: config.drawingScale,
    includeDiagram: config.includeDiagram,
    includeLegendPanel: config.includeLegendPanel,
    includeRackElevation: config.includeRackElevation,
    includeTables: config.includeTables,
    captures3D
  });
}

export async function buildExportPdfForBundle(
  project: ProjectState,
  config: ExportPdfConfig
) {
  const needs3D = config.includeDiagram && (config.contentScope === '3d' || config.contentScope === 'both');

  const captures3D = needs3D
    ? config.cameraAngles3D && config.cameraAngles3D.length > 0
      ? await capture3DAnglesStrict(config.capture3D, config.cameraAngles3D, {
          width: 1920,
          height: 1080,
          background: config.background3D ?? 'light'
        })
      : [
          await capture3DSnapshotStrict(config.capture3D, {
            width: 1920,
            height: 1080,
            background: config.background3D ?? 'light'
          })
        ]
    : undefined;

  const pdfArtifact = await buildTechnicalPdfArtifact(project, {
    contentScope: config.contentScope,
    paperSize: config.paperSize || 'A4',
    orientation: config.orientation,
    drawingCode: config.drawingCode,
    drawingScale: config.drawingScale,
    includeDiagram: config.includeDiagram,
    includeLegendPanel: config.includeLegendPanel,
    includeRackElevation: config.includeRackElevation,
    includeTables: config.includeTables,
    captures3D
  });

  return { pdfArtifact, captures3D: captures3D || [] };
}
