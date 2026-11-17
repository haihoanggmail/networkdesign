import { zipSync, strToU8 } from 'fflate';
import { ProjectState } from '../types/infrastructure';
import { generatePureSvgMarkup } from './svgExport';
import { generateProjectDxf } from './dxfExporter';
import { generateStandaloneViewerHtml, HtmlViewerExportOptions } from './htmlViewerExporter';
import { buildPatchAndCableSchedule, formatScheduleCsv, runEngineeringAudit } from './engineeringValidator';

export interface HandoverZipInput {
  project: ProjectState;
  pdfBytes?: Uint8Array;
  pdfFilename?: string;
  excelBytes?: Uint8Array;
  excelFilename?: string;
  captured3DImages?: Array<{ filename: string; bytes: Uint8Array }>;
  viewerOptions?: HtmlViewerExportOptions;
}

export interface HandoverZipResult {
  bytes: Uint8Array;
  filename: string;
  entries: string[];
}

export function sanitizeArchiveBaseName(name: string): string {
  const cleaned = (name || 'HACHIHI_Project')
    .trim()
    .replace(/[^\p{L}\p{N}_-]+/gu, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'HACHIHI_Project';
}

/**
 * Pure archive builder packaging vector CAD drawings (SVG, DXF), read-only HTML viewer,
 * CSV Patch/Cable schedule, Engineering Audit summary, JSON project backup, optional
 * 3D rendered PNG views, and binary Technical PDF + Excel Workbook into a single compressed ZIP archive.
 */
export function buildHandoverZipBytes(input: HandoverZipInput): HandoverZipResult {
  const { project, pdfBytes, pdfFilename, excelBytes, excelFilename, captured3DImages, viewerOptions } = input;
  const baseName = sanitizeArchiveBaseName(project.name);

  const pureSvg = generatePureSvgMarkup(project, {
    darkTheme: false,
    includeTitleBlock: true
  });
  const dxfText = generateProjectDxf(project);
  const viewerHtml = generateStandaloneViewerHtml(project, viewerOptions);
  const scheduleRows = buildPatchAndCableSchedule(project);
  const scheduleCsv = formatScheduleCsv(scheduleRows);
  const auditReport = runEngineeringAudit(project);
  const projectJson = JSON.stringify(project, null, 2);

  const extra3DNames = (captured3DImages || [])
    .filter(img => img.bytes && img.bytes.byteLength > 0)
    .map((img, i) => `08_${String(i + 1).padStart(2, '0')}_${img.filename}`);

  const readmeLines = [
    `HACHIHI NETWORK & ELECTRICAL DESIGNER — HO SO BAN GIAO HA TANG`,
    `Du an: ${project.name}`,
    `Tac gia: ${project.author}`,
    `Phien ban: ${project.version}`,
    `Xuat luc: ${new Date().toISOString()}`,
    `Thiet bi: ${auditReport.summary.totalDevices} | Tuyen cap: ${auditReport.summary.totalCables} | Tu Rack: ${project.racks.length}`,
    `Cong suat uoc tinh: ${auditReport.summary.totalPowerWatts} W (~${auditReport.summary.estimatedCurrentAmps220V} A)`,
    `Kiem tra ky thuat: ${auditReport.summary.errorCount} loi, ${auditReport.summary.warningCount} canh bao`,
    ``,
    `Danh sach tep trong goi ban giao:`,
    pdfBytes ? `- 01_${pdfFilename || `${baseName}_A4_Technical.pdf`}` : null,
    excelBytes ? `- 02_${excelFilename || `${baseName}_Ho_So_Ha_Tang.xlsx`}` : null,
    `- 03_${baseName}_CAD_Vector.svg`,
    `- 04_${baseName}_AutoCAD_R12.dxf`,
    `- 05_${baseName}_ReadOnly_Viewer.html`,
    `- 06_${baseName}_Patch_Cable_Schedule.csv`,
    `- 07_${baseName}_Project_Backup.json`,
    ...extra3DNames.map(n => `- ${n}`)
  ]
    .filter(Boolean)
    .join('\n');

  const files: Record<string, Uint8Array> = {
    '00_README_Ban_Giao.txt': strToU8(readmeLines),
    [`03_${baseName}_CAD_Vector.svg`]: strToU8(pureSvg),
    [`04_${baseName}_AutoCAD_R12.dxf`]: strToU8(dxfText),
    [`05_${baseName}_ReadOnly_Viewer.html`]: strToU8(viewerHtml),
    [`06_${baseName}_Patch_Cable_Schedule.csv`]: strToU8('\uFEFF' + scheduleCsv),
    [`07_${baseName}_Project_Backup.json`]: strToU8(projectJson)
  };

  if (pdfBytes && pdfBytes.byteLength > 0) {
    files[`01_${pdfFilename || `${baseName}_A4_Technical.pdf`}`] = pdfBytes;
  }
  if (excelBytes && excelBytes.byteLength > 0) {
    files[`02_${excelFilename || `${baseName}_Ho_So_Ha_Tang.xlsx`}`] = excelBytes;
  }
  if (captured3DImages && captured3DImages.length > 0) {
    captured3DImages.forEach((img, i) => {
      if (img.bytes && img.bytes.byteLength > 0) {
        files[`08_${String(i + 1).padStart(2, '0')}_${img.filename}`] = img.bytes;
      }
    });
  }

  const zipBytes = zipSync(files, { level: 6 });
  return {
    bytes: zipBytes,
    filename: `${baseName}_Handover_Bundle.zip`,
    entries: Object.keys(files).sort()
  };
}

/**
 * Generates Technical PDF (2D, 3D, or Combined), 6-sheet Excel workbook, DXF, SVG, HTML Viewer,
 * CSV Schedule, optional 3D PNG snapshots, and JSON backup in one click and downloads a unified ZIP bundle.
 */
export async function exportHandoverZipBundle(
  project: ProjectState,
  options?: {
    drawingCode?: string;
    drawingScale?: string;
    orientation?: 'landscape' | 'portrait';
    includeLegendPanel?: boolean;
    includeRackElevation?: boolean;
    includeTables?: boolean;
    customPdfArtifact?: { uint8: Uint8Array; filename: string };
    captured3DImages?: Array<{ filename: string; bytes: Uint8Array }>;
    viewerOptions?: HtmlViewerExportOptions;
  }
): Promise<{ filename: string; totalBytes: number; entries: string[] }> {
  const [{ buildA4PdfArtifact }, { buildProjectExcelUint8Array }] = await Promise.all([
    import('./pdfExporter'),
    import('./excelService')
  ]);

  const [pdfArtifact, excelBytes] = await Promise.all([
    options?.customPdfArtifact
      ? Promise.resolve(options.customPdfArtifact)
      : buildA4PdfArtifact(project, {
          orientation: options?.orientation || 'landscape',
          drawingCode: options?.drawingCode || 'NET-ELV-01',
          drawingScale: options?.drawingScale || '',
          includeLegendPanel: options?.includeLegendPanel ?? true,
          includeRackElevation: options?.includeRackElevation ?? true,
          includeTables: options?.includeTables ?? true
        }),
    buildProjectExcelUint8Array(project)
  ]);

  const baseName = sanitizeArchiveBaseName(project.name);
  const archive = buildHandoverZipBytes({
    project,
    pdfBytes: pdfArtifact.uint8,
    pdfFilename: pdfArtifact.filename,
    excelBytes,
    excelFilename: `${baseName}_Ho_So_Ha_Tang.xlsx`,
    captured3DImages: options?.captured3DImages,
    viewerOptions: options?.viewerOptions
  });

  const blob = new Blob([new Uint8Array(archive.bytes)], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = archive.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);

  return {
    filename: archive.filename,
    totalBytes: archive.bytes.byteLength,
    entries: archive.entries
  };
}
