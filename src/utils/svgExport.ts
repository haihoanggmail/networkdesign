import { ProjectState } from '../types/infrastructure';
import { computeCablePath, computeCableBundleLayout, resolveCableLabelTransform } from './cableRouting';
import {
  getRackCanvasMetrics,
  getRackSlotsForSide,
  getSlotSpanRect,
  getAssetUHeight,
  isRackMountedTopologyShadowNode,
  layoutRackNodesForElevationMode
} from './rackGeometry';
import { resolveCanvasAppearance } from './canvasBackgrounds';
import { buildProjectLegendData, computeLegendLayoutMetrics } from './legendGenerator';
import { getCategoryAccentColor, isStandardCatalogNodeColor } from '../data/deviceCatalog';
import { sanitizeSafeImageUrl } from './security';
import { resolveNodeLayer } from './layerPolicy';

export interface DiagramBounds {
  minX: number;
  minY: number;
  width: number;
  height: number;
}

export interface PureSvgExportOptions {
  darkTheme?: boolean;
  includeTitleBlock?: boolean;
  boundsOverride?: DiagramBounds;
  whiteBackground?: boolean;
}

export function computeViewportDiagramBounds(
  pan: { x: number; y: number },
  zoom: number,
  viewportSize: { w: number; h: number }
): DiagramBounds | undefined {
  if (!viewportSize || viewportSize.w <= 0 || viewportSize.h <= 0 || zoom <= 0) {
    return undefined;
  }
  return {
    minX: Math.round(-pan.x / zoom),
    minY: Math.round(-pan.y / zoom),
    width: Math.max(240, Math.round(viewportSize.w / zoom)),
    height: Math.max(180, Math.round(viewportSize.h / zoom))
  };
}

function escapeXml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function computePureDiagramBounds(project: ProjectState): DiagramBounds {
  const floorplanRackNodes = project.nodes.filter(n => !n.hidden && n.type === 'rack' && n.diagramMode === 'floorplan');
  const rawNodes = project.nodes.filter(n => {
    if (n.hidden) return false;
    if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode)) {
      if (n.floorId && project.activeFloorId && n.floorId !== project.activeFloorId) return false;
      if (isRackMountedTopologyShadowNode(n, project.assets, floorplanRackNodes, project.racks)) return false;
    }
    if (project.activeMode === 'rack') return n.diagramMode === 'rack' || n.type === 'rack';
    return true;
  });
  const activeNodes =
    project.activeMode === 'rack'
      ? layoutRackNodesForElevationMode(rawNodes.filter(n => n.type === 'rack'), project.racks)
      : rawNodes;

  const activeRooms = project.rooms.filter(r => {
    if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode)) {
      if (r.floorId && project.activeFloorId && r.floorId !== project.activeFloorId) return false;
    }
    return true;
  });

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  activeNodes.forEach(n => {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.width);
    maxY = Math.max(maxY, n.y + n.height + 42);
  });

  activeRooms.forEach(r => {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  });

  if (!Number.isFinite(minX) || !Number.isFinite(minY)) {
    return { minX: 0, minY: 0, width: 1200, height: 800 };
  }

  const pad = 70;
  return {
    minX: Math.round(minX - pad),
    minY: Math.round(minY - pad),
    width: Math.max(480, Math.round(maxX - minX + pad * 2)),
    height: Math.max(360, Math.round(maxY - minY + pad * 2))
  };
}

/**
 * Generates a pure, self-contained Vector SVG string WITHOUT <foreignObject>,
 * guaranteeing crystal-clear SVG CAD export and reliable canvas PNG rasterization
 * across all browsers (Chrome, Firefox, Edge, Safari).
 */
export function generatePureSvgMarkup(
  project: ProjectState,
  options?: PureSvgExportOptions
): string {
  const bounds = options?.boundsOverride || computePureDiagramBounds(project);
  const whiteBg = Boolean(options?.whiteBackground);
  const appearance = resolveCanvasAppearance(
    whiteBg
      ? {
          ...project.settings,
          backgroundPreset: 'pure_white',
          backgroundColor: '#ffffff',
          backgroundPattern: 'none',
          showGrid: false
        }
      : project.settings,
    whiteBg ? false : options?.darkTheme
  );
  const dark = whiteBg ? false : appearance.isDarkCanvas;
  const bg = whiteBg ? '#ffffff' : appearance.backgroundColor;
  const textPrimary = whiteBg ? '#0f172a' : appearance.labelColor;
  const textMuted = whiteBg ? '#475569' : appearance.mutedLabelColor;
  const roomStroke = dark ? '#475569' : '#94a3b8';

  const hiddenLayers = new Set(project.settings.hiddenLayers || []);
  const hideRooms = hiddenLayers.has('rooms');
  const hideRacks = hiddenLayers.has('racks');
  const hideDevices = hiddenLayers.has('devices');
  const hideCables = hiddenLayers.has('cables');
  const hideWifi = hiddenLayers.has('wifi');
  const hideLabels = hiddenLayers.has('labels');
  const hideCableLabels = hiddenLayers.has('cable_labels') || hideLabels;

  const floorplanRackNodes = project.nodes.filter(n => !n.hidden && n.type === 'rack' && n.diagramMode === 'floorplan');
  const rawVisibleNodes = project.nodes.filter(n => {
    if (n.hidden) return false;
    if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode)) {
      if (n.floorId && project.activeFloorId && n.floorId !== project.activeFloorId) return false;
      if (isRackMountedTopologyShadowNode(n, project.assets, floorplanRackNodes, project.racks)) return false;
    }
    if (project.activeMode === 'rack') return n.diagramMode === 'rack' || n.type === 'rack';
    const layer = resolveNodeLayer(n, project.assets);
    if (hiddenLayers.has(layer)) return false;
    return true;
  });
  const visibleNodes =
    project.activeMode === 'rack'
      ? layoutRackNodesForElevationMode(rawVisibleNodes.filter(n => n.type === 'rack'), project.racks)
      : rawVisibleNodes;

  const visibleRooms = hideRooms
    ? []
    : project.rooms.filter(r => {
        if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode)) {
          if (r.floorId && project.activeFloorId && r.floorId !== project.activeFloorId) return false;
        }
        return true;
      });

  const nodeMap = new Map(visibleNodes.map(n => [n.id, n]));
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}" width="${bounds.width}" height="${bounds.height}" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">`
  );
  parts.push(`<rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="${escapeXml(bg)}" />`);

  // Canvas background grid pattern matching live view (skipped when solid whiteBackground is requested)
  if (!whiteBg && appearance.pattern !== 'none') {
    const g = project.settings.gridSize || 20;
    const dotColor = appearance.gridColor;
    let patternShape = `<circle cx="1.5" cy="1.5" r="1.1" fill="${escapeXml(dotColor)}" />`;
    if (appearance.pattern === 'lines') {
      patternShape = `<path d="M ${g} 0 L 0 0 0 ${g}" fill="none" stroke="${escapeXml(dotColor)}" stroke-width="0.7" stroke-opacity="0.7" />`;
    } else if (appearance.pattern === 'cross') {
      patternShape = `<path d="M 1 4 L 7 4 M 4 1 L 4 7" fill="none" stroke="${escapeXml(dotColor)}" stroke-width="0.9" />`;
    }
    parts.push(`<defs><pattern id="pure-grid" width="${g}" height="${g}" patternUnits="userSpaceOnUse">${patternShape}</pattern></defs>`);
    parts.push(`<rect x="${bounds.minX}" y="${bounds.minY}" width="${bounds.width}" height="${bounds.height}" fill="url(#pure-grid)" />`);
  }

  const safeWorldBg = sanitizeSafeImageUrl(appearance.imageUrl);
  if (safeWorldBg && appearance.imageMode === 'world') {
    parts.push(`<image href="${escapeXml(safeWorldBg)}" x="0" y="0" width="1600" height="1000" preserveAspectRatio="xMidYMid meet" opacity="${appearance.imageOpacity}" />`);
  }

  // 1. Rooms
  for (const room of visibleRooms) {
    const fill = dark ? '#1e293b' : (room.color || '#f1f5f9');
    parts.push(`<g>`);
    parts.push(`<rect x="${room.x}" y="${room.y}" width="${room.width}" height="${room.height}" rx="6" fill="${escapeXml(fill)}" fill-opacity="0.72" stroke="${roomStroke}" stroke-width="${Math.max(2, room.wallThickness || 3)}" />`);
    parts.push(`<text x="${room.x + 12}" y="${room.y + 20}" fill="${textMuted}" font-size="12" font-weight="700">${escapeXml(room.name)}</text>`);
    parts.push(`</g>`);
  }

  // 2. Racks (with mounted U plates)
  const rackNodes = visibleNodes.filter(n => n.type === 'rack');
  for (const rn of rackNodes) {
    const rack = project.racks.find(
      r => r.id === rn.customData?.rackId || r.id === rn.id || r.name === rn.label
    );
    const units = rack?.totalUnits || 42;
    const m = getRackCanvasMetrics(rn, units);
    parts.push(`<g>`);
    parts.push(`<rect x="${rn.x}" y="${rn.y}" width="${rn.width}" height="${rn.height}" rx="6" fill="#0f172a" stroke="#334155" stroke-width="2.5" />`);
    parts.push(`<rect x="${rn.x}" y="${rn.y}" width="${rn.width}" height="28" rx="6" fill="#1e293b" />`);
    parts.push(`<text x="${rn.x + 12}" y="${rn.y + 18}" fill="#f8fafc" font-size="11" font-weight="700">${escapeXml(rack?.name || rn.label)} (${units}U)</text>`);

    if (rack) {
      const slots = getRackSlotsForSide(rack, 'front');
      for (const [uStr, assetId] of Object.entries(slots)) {
        const startU = parseInt(uStr, 10);
        const asset = project.assets[assetId];
        if (!asset || Number.isNaN(startU)) continue;
        const uH = getAssetUHeight(asset);
        const rect = getSlotSpanRect(startU, uH, units, m.slotH);
        const sy = m.slotsY + rect.top + 1;
        const sh = Math.max(8, rect.height - 2);
        parts.push(`<rect x="${m.slotsX + 2}" y="${sy}" width="${m.slotsWidth - 4}" height="${sh}" rx="2" fill="#1d4ed8" stroke="#60a5fa" stroke-width="1" />`);
        parts.push(`<text x="${m.slotsX + 8}" y="${sy + sh / 2 + 3.5}" fill="#ffffff" font-size="9" font-weight="600">U${startU} · ${escapeXml(asset.name)}</text>`);
      }
    }
    parts.push(`</g>`);
  }

  // 3. Cables (grouped visually as parallel Cable Bundles when sharing a corridor)
  const exportableCables = hideCables
    ? []
    : project.cables.filter(
        c => nodeMap.has(c.sourceNodeId) && nodeMap.has(c.targetNodeId)
      );
  const bundleLayout = computeCableBundleLayout(exportableCables, id => {
    const n = nodeMap.get(id);
    return n ? { x: n.x, y: n.y, width: n.width, height: n.height } : null;
  });

  // 3a. Bundle tie-wrap jacket collars
  for (const bundle of bundleLayout.bundles) {
    const angleDeg = (Math.atan2(bundle.tangent.y, bundle.tangent.x) * 180) / Math.PI;
    const collarH = bundle.spanWidthPx + 8;
    parts.push(`<g transform="translate(${bundle.midPoint.x}, ${bundle.midPoint.y}) rotate(${angleDeg.toFixed(1)})">`);
    parts.push(`<rect x="-11" y="${(-collarH / 2).toFixed(1)}" width="22" height="${collarH.toFixed(1)}" rx="6" fill="#eff6ff" fill-opacity="${dark ? '0.22' : '0.85'}" stroke="#60a5fa" stroke-width="1.1" stroke-dasharray="3 2" />`);
    parts.push(`<line x1="-5" y1="${(-(bundle.spanWidthPx / 2 + 2)).toFixed(1)}" x2="-5" y2="${(bundle.spanWidthPx / 2 + 2).toFixed(1)}" stroke="#3b82f6" stroke-width="1.5" />`);
    parts.push(`<line x1="5" y1="${(-(bundle.spanWidthPx / 2 + 2)).toFixed(1)}" x2="5" y2="${(bundle.spanWidthPx / 2 + 2).toFixed(1)}" stroke="#3b82f6" stroke-width="1.5" />`);
    parts.push(`</g>`);
  }

  // 3b. Individual parallel cable strands (suppress overlapping member badges inside bundles)
  for (const cable of exportableCables) {
    const src = nodeMap.get(cable.sourceNodeId);
    const tgt = nodeMap.get(cable.targetNodeId);
    if (!src || !tgt) continue;
    const pathInfo = bundleLayout.cablePaths.get(cable.id) || computeCablePath(cable, src, tgt);
    const dash = cable.lineStyle === 'dashed' ? 'stroke-dasharray="6 4"' : '';
    parts.push(`<g>`);
    parts.push(`<path d="${pathInfo.d}" fill="none" stroke="${escapeXml(cable.color || '#0284c7')}" stroke-width="${cable.strokeWidth || 2}" ${dash} stroke-linecap="round" stroke-linejoin="round" />`);
    parts.push(`</g>`);
  }

  // 3c. Consolidated bundle summary badges
  if (project.settings.showCableCodes && !hideCableLabels) {
    for (const bundle of bundleLayout.bundles) {
      const badgeW = Math.max(76, bundle.summaryLabel.length * 5.8 + 14);
      const labelYOffset = -(bundle.spanWidthPx / 2 + 17);
      parts.push(`<g transform="translate(${bundle.midPoint.x}, ${bundle.midPoint.y + labelYOffset})">`);
      parts.push(`<rect x="${(-badgeW / 2).toFixed(1)}" y="-9" width="${badgeW.toFixed(1)}" height="18" rx="9" fill="#ffffff" stroke="#2563eb" stroke-width="1.2" />`);
      parts.push(`<text x="0" y="3" text-anchor="middle" fill="#1e3a8a" font-size="8.5" font-weight="700" font-family="ui-monospace, monospace">${escapeXml(bundle.summaryLabel)}</text>`);
      parts.push(`</g>`);
    }
  }

  // 3d. Dedicated Cable Labeling Overlay Layer (auto-oriented along cable paths or custom-rotated)
  if (!hideCableLabels) {
    parts.push(`<g data-layer="cable-labeling">`);
    for (const cable of exportableCables) {
      const src = nodeMap.get(cable.sourceNodeId);
      const tgt = nodeMap.get(cable.targetNodeId);
      if (!src || !tgt) continue;
      const isBundled = bundleLayout.cableToBundleId.has(cable.id);
      const hasCustomLabel = Boolean(cable.label && cable.label.trim().length > 0);
      if (!(project.settings.showCableCodes || hasCustomLabel) || isBundled) continue;

      const pathInfo = bundleLayout.cablePaths.get(cable.id) || computeCablePath(cable, src, tgt);
      const lt = resolveCableLabelTransform(cable, pathInfo);
      const badgeText = hasCustomLabel ? lt.text : `${cable.cableCode} (${cable.bandwidth})`;
      const bw = Math.max(lt.badgeWidth, Math.min(360, Math.round(badgeText.length * lt.fontSize * 0.64 + lt.fontSize * 2 + 8)));
      const bh = lt.badgeHeight;
      const halfH = bh / 2;
      const dotR = Math.max(2.4, Math.min(4.2, lt.fontSize * 0.28));
      const cableStroke = escapeXml(cable.color || '#0284c7');

      parts.push(`<g transform="translate(${lt.x.toFixed(1)}, ${lt.y.toFixed(1)}) rotate(${lt.angleDeg.toFixed(1)})">`);
      parts.push(`<rect x="${(-bw / 2).toFixed(1)}" y="${(-halfH).toFixed(1)}" width="${bw}" height="${bh}" rx="4" fill="#ffffff" fill-opacity="0.96" stroke="${cableStroke}" stroke-width="1.1" />`);
      parts.push(`<circle cx="${(-bw / 2 + dotR + 5).toFixed(1)}" cy="0" r="${dotR.toFixed(1)}" fill="${cableStroke}" />`);
      parts.push(`<text x="${(dotR + 1.5).toFixed(1)}" y="${(lt.fontSize * 0.35).toFixed(1)}" text-anchor="middle" fill="#0f172a" font-size="${lt.fontSize}" font-weight="${hasCustomLabel ? '700' : '600'}">${escapeXml(badgeText)}</text>`);
      parts.push(`</g>`);
    }
    parts.push(`</g>`);
  }

  // 4. Legend Documentation Tables (pure SVG with proportional scaling & multi-column support)
  const legendNodes = visibleNodes.filter(n => n.type === 'legend');
  legendNodes.forEach((ln, lnIdx) => {
    const legendData = buildProjectLegendData(project, {
      scope: ln.customData?.legendScope || 'all',
      includeCables: ln.customData?.legendIncludeCables ?? true,
      title: ln.customData?.legendTitle || ln.label
    });
    const metrics = computeLegendLayoutMetrics(
      ln.width,
      ln.height,
      legendData.components.length,
      typeof ln.customData?.legendScale === 'number' ? ln.customData.legendScale : undefined
    );
    const s = metrics.scale;
    const headerH = Math.round(34 * s);
    const fontTitle = (11 * s).toFixed(1);
    const fontRow = (10 * s).toFixed(1);
    const fontCount = (10.5 * s).toFixed(1);
    const fontCable = (9.5 * s).toFixed(1);
    const iconSize = Math.round(16 * s);
    const rowStep = Math.round(25 * s);
    const clipId = `legend-clip-${lnIdx}`;

    parts.push(`<defs><clipPath id="${clipId}"><rect x="${ln.x}" y="${ln.y}" width="${ln.width}" height="${ln.height}" rx="6" /></clipPath></defs>`);
    parts.push(`<g clip-path="url(#${clipId})">`);
    parts.push(`<rect x="${ln.x}" y="${ln.y}" width="${ln.width}" height="${ln.height}" rx="6" fill="#ffffff" stroke="${escapeXml(ln.style?.borderColor || '#1d4ed8')}" stroke-width="2" />`);
    parts.push(`<rect x="${ln.x}" y="${ln.y}" width="${ln.width}" height="${headerH}" rx="6" fill="#1d4ed8" />`);
    parts.push(`<text x="${ln.x + 12}" y="${ln.y + Math.round(headerH * 0.62)}" fill="#ffffff" font-size="${fontTitle}" font-weight="700">${escapeXml(legendData.title.slice(0, 44))}</text>`);

    let rowY = ln.y + headerH + Math.round(18 * s);
    if (metrics.columns === 2) {
      const colW = (ln.width - 24) / 2;
      for (let i = 0; i < legendData.components.length; i += 2) {
        if (rowY > ln.y + ln.height - 14) break;
        for (let c = 0; c < 2; c += 1) {
          const item = legendData.components[i + c];
          if (!item) continue;
          const colX = ln.x + 10 + c * (colW + 6);
          parts.push(`<rect x="${colX}" y="${rowY - Math.round(iconSize * 0.72)}" width="${iconSize}" height="${iconSize}" rx="3" fill="${escapeXml(item.accentColor)}" />`);
          parts.push(`<text x="${colX + iconSize + 6}" y="${rowY}" fill="#0f172a" font-size="${fontRow}" font-weight="600">${escapeXml(item.label.slice(0, 22))}</text>`);
          parts.push(`<text x="${colX + colW - 4}" y="${rowY}" text-anchor="end" fill="#1d4ed8" font-size="${fontCount}" font-weight="800" font-family="ui-monospace, monospace">×${item.count}</text>`);
        }
        rowY += rowStep;
      }
    } else {
      for (const item of legendData.components) {
        if (rowY > ln.y + ln.height - 16) break;
        parts.push(`<rect x="${ln.x + 12}" y="${rowY - Math.round(iconSize * 0.72)}" width="${iconSize}" height="${iconSize}" rx="3" fill="${escapeXml(item.accentColor)}" />`);
        parts.push(`<text x="${ln.x + 18 + iconSize}" y="${rowY}" fill="#0f172a" font-size="${fontRow}" font-weight="600">${escapeXml(item.label)} (${escapeXml(item.subLabel.slice(0, 22))})</text>`);
        parts.push(`<text x="${ln.x + ln.width - 14}" y="${rowY}" text-anchor="end" fill="#1d4ed8" font-size="${fontCount}" font-weight="800" font-family="ui-monospace, monospace">×${item.count}</text>`);
        parts.push(`<line x1="${ln.x + 10}" y1="${rowY + Math.round(8 * s)}" x2="${ln.x + ln.width - 10}" y2="${rowY + Math.round(8 * s)}" stroke="#e2e8f0" stroke-width="0.8" />`);
        rowY += rowStep;
      }
    }

    for (const cab of legendData.cables) {
      if (rowY > ln.y + ln.height - 14) break;
      parts.push(`<line x1="${ln.x + 12}" y1="${rowY - 3}" x2="${ln.x + 28}" y2="${rowY - 3}" stroke="${escapeXml(cab.color)}" stroke-width="3" />`);
      parts.push(`<text x="${ln.x + 36}" y="${rowY}" fill="#334155" font-size="${fontCable}" font-weight="600">${escapeXml(cab.label)}</text>`);
      parts.push(`<text x="${ln.x + ln.width - 14}" y="${rowY}" text-anchor="end" fill="#475569" font-size="${fontCable}" font-weight="700" font-family="ui-monospace, monospace">×${cab.count} (${cab.totalMeters}m)</text>`);
      rowY += Math.round(22 * s);
    }
    parts.push(`</g>`);
  });

  // 5. Device, Shape & Annotation Nodes (pure SVG)
  const deviceNodes = visibleNodes.filter(n => n.type !== 'rack' && n.type !== 'legend');
  for (const node of deviceNodes) {
    const asset = node.assetId ? project.assets[node.assetId] : undefined;
    const cx = node.x + node.width / 2;
    const cy = node.y + node.height / 2;

    if (node.type === 'text') {
      const noteBg = node.style?.backgroundColor && node.style.backgroundColor !== 'transparent'
        ? node.style.backgroundColor
        : (dark ? '#0f172a' : '#ffffff');
      const noteBorder = node.style?.borderColor || '#94a3b8';
      const noteText = node.style?.textColor || textPrimary;
      parts.push(`<g>`);
      parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="6" fill="${escapeXml(noteBg)}" fill-opacity="0.9" stroke="${escapeXml(noteBorder)}" stroke-width="1.2" stroke-dasharray="4 3" />`);
      parts.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="${escapeXml(noteText)}" font-size="11.5" font-weight="600">${escapeXml(node.label)}</text>`);
      parts.push(`</g>`);
      continue;
    }

    if (node.type === 'zone') {
      const zBorder = node.style?.borderColor || '#155eef';
      const zBg = node.style?.backgroundColor && node.style.backgroundColor !== 'transparent'
        ? node.style.backgroundColor
        : '#eff6ff';
      parts.push(`<g>`);
      parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="8" fill="${escapeXml(zBg)}" fill-opacity="0.25" stroke="${escapeXml(zBorder)}" stroke-width="1.5" stroke-dasharray="6 4" />`);
      parts.push(`<text x="${node.x + 10}" y="${node.y + 18}" fill="${escapeXml(zBorder)}" font-size="10.5" font-weight="700">${escapeXml(node.label)}</text>`);
      parts.push(`</g>`);
      continue;
    }

    const rawBg = node.style?.backgroundColor || '#1d4ed8';
    const useEnterpriseCard =
      !node.style?.shape && isStandardCatalogNodeColor(rawBg);
    const categoryAccent = getCategoryAccentColor(asset?.category || node.type);
    const bgColor = useEnterpriseCard ? (dark ? '#1e293b' : '#ffffff') : rawBg;
    const borderColor = useEnterpriseCard
      ? (dark ? '#334155' : '#cbd5e1')
      : (node.style?.borderColor || '#334155');
    const radius = node.style?.shape === 'circle'
      ? Math.max(node.width, node.height) / 2
      : node.style?.shape === 'rect'
      ? 2
      : 10;

    parts.push(`<g>`);
    const wifiRadiusMeters =
      asset?.wifiSpecs?.coverageRadiusMeters ??
      (typeof node.customData?.coverageRadiusMeters === 'number'
        ? node.customData.coverageRadiusMeters
        : undefined);
    if (project.settings.showCoverageRadius && !hideWifi && typeof wifiRadiusMeters === 'number' && wifiRadiusMeters > 0) {
      const radPx = wifiRadiusMeters * (project.settings.scale || 30);
      parts.push(`<circle cx="${cx}" cy="${cy}" r="${radPx}" fill="#0ea5e9" fill-opacity="0.10" stroke="#0ea5e9" stroke-opacity="0.4" stroke-dasharray="4 4" />`);
    }

    parts.push(`<rect x="${node.x}" y="${node.y}" width="${node.width}" height="${node.height}" rx="${radius}" fill="${escapeXml(bgColor)}" stroke="${escapeXml(borderColor)}" stroke-width="${useEnterpriseCard ? 1.5 : (node.style?.borderWidth || 2)}" />`);

    const imgUrl = sanitizeSafeImageUrl(node.customImageUrl || asset?.customImageUrl);
    const iconTag = node.customIcon || asset?.customIcon;
    if (imgUrl) {
      const imgSize = Math.min(node.width, node.height) * 0.65;
      parts.push(`<image href="${escapeXml(imgUrl)}" x="${cx - imgSize / 2}" y="${cy - imgSize / 2}" width="${imgSize}" height="${imgSize}" preserveAspectRatio="xMidYMid meet" />`);
    } else if (iconTag && iconTag.startsWith('iso_')) {
      const s = Math.min(node.width, node.height) * 0.28;
      const isoTag = iconTag.replace(/^iso_/, '').slice(0, 6).toUpperCase();
      parts.push(`<polygon points="${cx},${cy - s} ${cx + s * 1.15},${cy - s * 0.35} ${cx},${cy + s * 0.3} ${cx - s * 1.15},${cy - s * 0.35}" fill="#f8fafc" fill-opacity="0.92" stroke="#0f172a" stroke-width="1.2" />`);
      parts.push(`<polygon points="${cx - s * 1.15},${cy - s * 0.35} ${cx},${cy + s * 0.3} ${cx},${cy + s * 1.05} ${cx - s * 1.15},${cy + s * 0.4}" fill="#cbd5e1" stroke="#0f172a" stroke-width="1.2" />`);
      parts.push(`<polygon points="${cx + s * 1.15},${cy - s * 0.35} ${cx},${cy + s * 0.3} ${cx},${cy + s * 1.05} ${cx + s * 1.15},${cy + s * 0.4}" fill="#94a3b8" stroke="#0f172a" stroke-width="1.2" />`);
      parts.push(`<text x="${cx}" y="${cy + s * 0.1}" text-anchor="middle" fill="#0f172a" font-size="6.5" font-weight="800">${escapeXml(isoTag)}</text>`);
    } else {
      const shortTag = (iconTag ? iconTag.replace(/^logo_/, '') : (asset?.category || node.type)).slice(0, 6).toUpperCase();
      if (useEnterpriseCard) {
        const badgeSize = Math.min(34, Math.min(node.width, node.height) * 0.62);
        parts.push(`<rect x="${cx - badgeSize / 2}" y="${cy - badgeSize / 2}" width="${badgeSize}" height="${badgeSize}" rx="7" fill="${escapeXml(categoryAccent)}" fill-opacity="0.14" stroke="${escapeXml(categoryAccent)}" stroke-opacity="0.45" stroke-width="1" />`);
        parts.push(`<text x="${cx}" y="${cy + 3.5}" text-anchor="middle" fill="${escapeXml(categoryAccent)}" font-size="9.5" font-weight="800">${escapeXml(shortTag)}</text>`);
      } else {
        parts.push(`<text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="${escapeXml(node.style?.iconColor || '#ffffff')}" font-size="11" font-weight="800">${escapeXml(shortTag)}</text>`);
      }
    }

    parts.push(`<text x="${cx}" y="${node.y + node.height + 14}" text-anchor="middle" fill="${textPrimary}" font-size="11" font-weight="700">${escapeXml(node.label)}</text>`);
    if (project.settings.showIpAddresses && !hideLabels && asset?.ipAddress) {
      parts.push(`<text x="${cx}" y="${node.y + node.height + 27}" text-anchor="middle" fill="${textMuted}" font-size="9.5" font-family="ui-monospace, monospace">${escapeXml(asset.ipAddress)}</text>`);
    }
    parts.push(`</g>`);
  }

  if (options?.includeTitleBlock) {
    const tbW = 340;
    const tbH = 44;
    const tbX = bounds.minX + bounds.width - tbW - 14;
    const tbY = bounds.minY + bounds.height - tbH - 14;
    parts.push(`<rect x="${tbX}" y="${tbY}" width="${tbW}" height="${tbH}" rx="4" fill="#ffffff" fill-opacity="0.95" stroke="#1d4ed8" stroke-width="1.5" />`);
    parts.push(`<text x="${tbX + 10}" y="${tbY + 17}" fill="#1e3a8a" font-size="10.5" font-weight="700">${escapeXml(project.name)}</text>`);
    parts.push(`<text x="${tbX + 10}" y="${tbY + 33}" fill="#475569" font-size="9">HACHIHI Designer · ${escapeXml(project.author)} · v${escapeXml(project.version)}</text>`);
  }

  parts.push(`</svg>`);
  return parts.join('\n');
}

function rasterizeSvgToPngDownload(
  svgMarkup: string,
  bounds: DiagramBounds,
  backgroundColor: string,
  filename: string,
  onSuccess?: () => void,
  onError?: (msg: string) => void
) {
  try {
    const svgBlob = new Blob([svgMarkup], { type: 'image/svg+xml;charset=utf-8' });
    const urlApi = window.URL || window.webkitURL || window;
    const blobUrl = urlApi.createObjectURL(svgBlob);

    const img = new window.Image();
    img.onload = () => {
      const scale = Math.min(2, 4800 / Math.max(1, bounds.width), 3600 / Math.max(1, bounds.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bounds.width * scale));
      canvas.height = Math.max(1, Math.round(bounds.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        urlApi.revokeObjectURL(blobUrl);
        onError?.('Trình duyệt không hỗ trợ kết xuất Canvas PNG.');
        return;
      }
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const pngUrl = canvas.toDataURL('image/png');
      const link = document.createElement('a');
      link.href = pngUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      urlApi.revokeObjectURL(blobUrl);
      onSuccess?.();
    };
    img.onerror = () => {
      urlApi.revokeObjectURL(blobUrl);
      onError?.('Không thể kết xuất hình ảnh PNG từ SVG.');
    };
    img.src = blobUrl;
  } catch (err) {
    onError?.(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Exports pure SVG rasterized to crisp 2x PNG (works reliably without foreignObject tainting).
 */
export function exportProjectToPng(
  project: ProjectState,
  onSuccess: () => void,
  onError: (msg: string) => void
) {
  const bounds = computePureDiagramBounds(project);
  const svgMarkup = generatePureSvgMarkup(project, {
    darkTheme: project.settings.isDarkMode,
    includeTitleBlock: true
  });
  const appearance = resolveCanvasAppearance(project.settings, project.settings.isDarkMode);
  const safeName = project.name.trim().replace(/\s+/g, '_') || 'HACHIHI_Project';
  rasterizeSvgToPngDownload(
    svgMarkup,
    bounds,
    appearance.backgroundColor,
    `${safeName}_HighRes.png`,
    onSuccess,
    onError
  );
}

/**
 * Instantly exports the exact current canvas viewport as a crisp PNG with a default white (#ffffff) background.
 */
export function exportCurrentViewToPng(
  project: ProjectState,
  viewport?: { pan: { x: number; y: number }; zoom: number; viewportSize: { w: number; h: number } },
  options?: { whiteBackground?: boolean; includeTitleBlock?: boolean },
  onSuccess?: () => void,
  onError?: (msg: string) => void
) {
  const whiteBackground = options?.whiteBackground ?? true;
  const bounds =
    (viewport ? computeViewportDiagramBounds(viewport.pan, viewport.zoom, viewport.viewportSize) : undefined) ||
    computePureDiagramBounds(project);
  const svgMarkup = generatePureSvgMarkup(project, {
    darkTheme: whiteBackground ? false : project.settings.isDarkMode,
    includeTitleBlock: options?.includeTitleBlock ?? false,
    boundsOverride: bounds,
    whiteBackground
  });
  const appearance = resolveCanvasAppearance(project.settings, project.settings.isDarkMode);
  const safeName = project.name.trim().replace(/\s+/g, '_') || 'HACHIHI_Project';
  rasterizeSvgToPngDownload(
    svgMarkup,
    bounds,
    whiteBackground ? '#ffffff' : appearance.backgroundColor,
    `${safeName}_QuickView.png`,
    onSuccess,
    onError
  );
}
