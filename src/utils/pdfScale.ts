import { DiagramBounds } from './svgExport';

export type A4Orientation = 'landscape' | 'portrait';
export type PdfPaperSizeUpper = 'A4' | 'A3' | 'A2' | 'A1';

export interface A4ScaleBarSpec {
  totalMeters: number;
  segmentMeters: number;
  segments: number;
  barWidthMm: number;
  ticks: number[];
}

export interface A4ScaleMetrics {
  pageWidthMm: number;
  pageHeightMm: number;
  marginMm: number;
  drawAreaWidthMm: number;
  drawAreaHeightMm: number;
  renderedDrawWidthMm: number;
  renderedDrawHeightMm: number;
  mmPerWorldPx: number;
  pxPerMeter: number;
  printedMmPerMeter: number;
  realWorldWidthMeters: number;
  realWorldHeightMeters: number;
  engineeringRatioDenominator: number;
  scaleRatioLabel: string;
  scaleBar: A4ScaleBarSpec;
}

export function getPaperDimensionsMm(
  paperSize: PdfPaperSizeUpper,
  orientation: A4Orientation
): { widthMm: number; heightMm: number; format: 'a4' | 'a3' | 'a2' | 'a1' } {
  const baseMap: Record<PdfPaperSizeUpper, { short: number; long: number; format: 'a4' | 'a3' | 'a2' | 'a1' }> = {
    A4: { short: 210, long: 297, format: 'a4' },
    A3: { short: 297, long: 420, format: 'a3' },
    A2: { short: 420, long: 594, format: 'a2' },
    A1: { short: 594, long: 841, format: 'a1' }
  };
  const spec = baseMap[paperSize] || baseMap.A4;
  return orientation === 'landscape'
    ? { widthMm: spec.long, heightMm: spec.short, format: spec.format }
    : { widthMm: spec.short, heightMm: spec.long, format: spec.format };
}

/**
 * Pure scale calculator for ISO A4-A1 technical drawings.
 * Maintains exact 1:1 world aspect ratio and computes physical mm-per-meter
 * plus a calibrated metric scale bar for the target sheet.
 */
export function computeA4ScaleMetrics(
  bounds: DiagramBounds,
  pxPerMeterRaw: number | undefined,
  orientation: A4Orientation = 'landscape',
  options?: { includeLegendPanel?: boolean; paperSize?: PdfPaperSizeUpper }
): A4ScaleMetrics {
  const dims = getPaperDimensionsMm(options?.paperSize || 'A4', orientation);
  const pageWidthMm = dims.widthMm;
  const pageHeightMm = dims.heightMm;
  const marginMm = 8;
  const headerHeightMm = 13;
  const titleBlockHeightMm = 21;
  const includeLegendPanel = options?.includeLegendPanel ?? true;

  const contentW = pageWidthMm - marginMm * 2;
  const contentH = pageHeightMm - marginMm * 2 - headerHeightMm - titleBlockHeightMm;

  const legendReserveW = includeLegendPanel && orientation === 'landscape' ? 66 : 0;
  const legendReserveH = includeLegendPanel && orientation === 'portrait' ? 54 : 0;

  const drawAreaWidthMm = Math.max(80, contentW - legendReserveW - (legendReserveW > 0 ? 3 : 0));
  const drawAreaHeightMm = Math.max(80, contentH - legendReserveH - (legendReserveH > 0 ? 3 : 0));

  const safeW = Math.max(100, bounds.width);
  const safeH = Math.max(100, bounds.height);
  const mmPerWorldPx = Math.min(drawAreaWidthMm / safeW, drawAreaHeightMm / safeH);

  const renderedDrawWidthMm = Number((safeW * mmPerWorldPx).toFixed(2));
  const renderedDrawHeightMm = Number((safeH * mmPerWorldPx).toFixed(2));

  const pxPerMeter = Math.max(1, Number(pxPerMeterRaw || 30));
  const printedMmPerMeter = mmPerWorldPx * pxPerMeter;
  const realWorldWidthMeters = Number((safeW / pxPerMeter).toFixed(2));
  const realWorldHeightMeters = Number((safeH / pxPerMeter).toFixed(2));

  const engineeringRatioDenominator = Math.max(1, Math.round(1000 / Math.max(0.05, printedMmPerMeter)));
  const scaleRatioLabel = `1:${engineeringRatioDenominator}`;

  const candidateTotals = [0.5, 1, 2, 4, 5, 10, 20, 40, 50, 100, 200, 500];
  let chosenTotal = 5;
  let bestDist = Infinity;
  for (const m of candidateTotals) {
    const wMm = m * printedMmPerMeter;
    if (wMm >= 22 && wMm <= 56) {
      chosenTotal = m;
      bestDist = 0;
      break;
    }
    const dist = Math.abs(wMm - 38);
    if (dist < bestDist) {
      bestDist = dist;
      chosenTotal = m;
    }
  }

  const rawBarWidthMm = chosenTotal * printedMmPerMeter;
  const clampedBarWidthMm = Number(Math.max(18, Math.min(64, rawBarWidthMm)).toFixed(2));
  const segments = 4;
  const segmentMeters = Number((chosenTotal / segments).toFixed(2));
  const ticks = [0, Number((chosenTotal / 2).toFixed(2)), chosenTotal];

  return {
    pageWidthMm,
    pageHeightMm,
    marginMm,
    drawAreaWidthMm: Number(drawAreaWidthMm.toFixed(2)),
    drawAreaHeightMm: Number(drawAreaHeightMm.toFixed(2)),
    renderedDrawWidthMm,
    renderedDrawHeightMm,
    mmPerWorldPx,
    pxPerMeter,
    printedMmPerMeter: Number(printedMmPerMeter.toFixed(3)),
    realWorldWidthMeters,
    realWorldHeightMeters,
    engineeringRatioDenominator,
    scaleRatioLabel,
    scaleBar: {
      totalMeters: chosenTotal,
      segmentMeters,
      segments,
      barWidthMm: clampedBarWidthMm,
      ticks
    }
  };
}
