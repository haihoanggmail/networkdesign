import {
  CableEdge,
  CablePoint,
  CableTray,
  ProjectState
} from '../types/infrastructure';
import { computeCablePath, estimateCableLengthMeters, RectBox } from './cableRouting';

function sanitizeToken(raw: string, fallback: string, maxLen = 8): string {
  const cleaned = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase();
  return (cleaned || fallback).slice(0, maxLen);
}

/**
 * Generates a standardized TIA/EIA-606-B cable identifier:
 * Format: [Floor].[Room].[Rack].[SrcDevice].[SrcPort]-[DstDevice].[DstPort]
 */
export function generateTia606CableCode(cable: CableEdge, project: ProjectState): string {
  const srcNode = project.nodes.find(n => n.id === cable.sourceNodeId);
  const tgtNode = project.nodes.find(n => n.id === cable.targetNodeId);

  const srcAsset = srcNode?.assetId ? project.assets[srcNode.assetId] : undefined;
  const tgtAsset = tgtNode?.assetId ? project.assets[tgtNode.assetId] : undefined;

  const floorObj = project.floors.find(f => f.id === (srcAsset?.floorId || srcNode?.floorId || project.activeFloorId));
  const floorCode = floorObj
    ? floorObj.level < 0
      ? `B${Math.abs(floorObj.level)}`
      : `F${String(floorObj.level).padStart(2, '0')}`
    : 'F01';

  const roomObj = project.rooms.find(r => r.id === srcAsset?.roomId);
  const roomCode = roomObj ? sanitizeToken(roomObj.name, 'RM', 5) : 'ZONE';

  const rackObj = project.racks.find(r => r.id === srcAsset?.rackId);
  const rackCode = rackObj ? sanitizeToken(rackObj.name, 'RK01', 6) : 'TR01';

  const srcDevCode = sanitizeToken(srcAsset?.name || srcNode?.label || 'SRC', 'SRC', 8);
  const tgtDevCode = sanitizeToken(tgtAsset?.name || tgtNode?.label || 'DST', 'DST', 8);

  const srcPort = sanitizeToken(cable.sourcePortId || 'P1', 'P1', 5);
  const tgtPort = sanitizeToken(cable.targetPortId || 'P1', 'P1', 5);

  return `${floorCode}.${roomCode}.${rackCode}.${srcDevCode}.${srcPort}-${tgtDevCode}.${tgtPort}`;
}

/**
 * Applies TIA/EIA-606-B cable labeling across all cables in a project.
 */
export function applyTia606LabelsToProject(project: ProjectState): CableEdge[] {
  return project.cables.map(cable => {
    const code = generateTia606CableCode(cable, project);
    return {
      ...cable,
      cableCode: code,
      label: code
    };
  });
}

function projectPointOnSegment(p: CablePoint, a: CablePoint, b: CablePoint): { point: CablePoint; dist: number } {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lenSq = abx * abx + aby * aby;
  if (lenSq < 1e-6) {
    return { point: a, dist: Math.hypot(p.x - a.x, p.y - a.y) };
  }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby) / lenSq));
  const proj = { x: a.x + t * abx, y: a.y + t * aby };
  return { point: proj, dist: Math.hypot(p.x - proj.x, p.y - proj.y) };
}

function nearestPointOnTray(p: CablePoint, tray: CableTray): { point: CablePoint; dist: number; segDistAlongTray: number } | null {
  if (tray.points.length < 2) return null;
  let bestDist = Infinity;
  let bestPoint = tray.points[0];
  let bestAlong = 0;
  let accumulated = 0;

  for (let i = 0; i < tray.points.length - 1; i++) {
    const a = tray.points[i];
    const b = tray.points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    const { point, dist } = projectPointOnSegment(p, a, b);
    if (dist < bestDist) {
      bestDist = dist;
      bestPoint = point;
      bestAlong = accumulated + Math.hypot(point.x - a.x, point.y - a.y);
    }
    accumulated += segLen;
  }

  return { point: bestPoint, dist: bestDist, segDistAlongTray: bestAlong };
}

/**
 * Calculates real cable length (meters) routed through the nearest compatible Cable Tray / Conduit
 * when present on the floor, or falls back to geometric cable routing.
 */
export function calculateTrayAwareCableLengthMeters(
  cable: CableEdge,
  r1: RectBox,
  r2: RectBox,
  trays: CableTray[],
  pxPerMeter = 30
): { meters: number; routedViaTrayName?: string } {
  const scale = Math.max(10, pxPerMeter);
  const p1: CablePoint = { x: r1.x + r1.width / 2, y: r1.y + r1.height / 2 };
  const p2: CablePoint = { x: r2.x + r2.width / 2, y: r2.y + r2.height / 2 };

  const compatibleTrays = trays.filter(t => {
    if (t.points.length < 2) return false;
    if (cable.cableType === 'POWER_AC') return t.kind === 'power_tray' || t.kind === 'conduit';
    return t.kind === 'network_tray' || t.kind === 'conduit';
  });

  let bestMeters = Infinity;
  let bestTrayName: string | undefined;

  for (const tray of compatibleTrays) {
    const hit1 = nearestPointOnTray(p1, tray);
    const hit2 = nearestPointOnTray(p2, tray);
    if (!hit1 || !hit2) continue;

    // Only route via tray if both endpoints are within reasonable drop radius (~14m)
    const maxDropPx = 14 * scale;
    if (hit1.dist <= maxDropPx && hit2.dist <= maxDropPx) {
      const trayRunPx = Math.abs(hit2.segDistAlongTray - hit1.segDistAlongTray);
      const totalPx = hit1.dist + trayRunPx + hit2.dist;
      // Add +3m vertical drop/termination allowance per TCVN installation practice
      const meters = Math.max(2, Math.round((totalPx / scale) * 1.12 + 3));
      if (meters < bestMeters) {
        bestMeters = meters;
        bestTrayName = tray.name;
      }
    }
  }

  if (Number.isFinite(bestMeters) && bestTrayName) {
    return { meters: bestMeters, routedViaTrayName: bestTrayName };
  }

  return {
    meters: estimateCableLengthMeters(cable, r1, r2, scale, 1.15)
  };
}

/**
 * Computes parallel bundle offsets (px) for cables sharing identical or near-parallel corridors
 * so parallel runs fan out cleanly instead of stacking visually on top of one another.
 */
export function computeCableBundleOffsets(
  cables: CableEdge[],
  getRect: (nodeId: string) => RectBox | null,
  spacingPx = 6
): Map<string, number> {
  const groups = new Map<string, CableEdge[]>();

  cables.forEach(c => {
    const r1 = getRect(c.sourceNodeId);
    const r2 = getRect(c.targetNodeId);
    if (!r1 || !r2) return;
    // Bucket corridor signature by unordered rounded endpoint grid (40px grid)
    const ax = Math.round((r1.x + r1.width / 2) / 40);
    const ay = Math.round((r1.y + r1.height / 2) / 40);
    const bx = Math.round((r2.x + r2.width / 2) / 40);
    const by = Math.round((r2.y + r2.height / 2) / 40);
    const keyA = `${ax},${ay}`;
    const keyB = `${bx},${by}`;
    const corridorKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
    const list = groups.get(corridorKey) || [];
    list.push(c);
    groups.set(corridorKey, list);
  });

  const offsets = new Map<string, number>();
  groups.forEach(list => {
    if (list.length <= 1) {
      if (list[0]) offsets.set(list[0].id, 0);
      return;
    }
    const mid = (list.length - 1) / 2;
    list.forEach((c, idx) => {
      offsets.set(c.id, Number(((idx - mid) * spacingPx).toFixed(1)));
    });
  });

  return offsets;
}

/**
 * Applies a subtle perpendicular lateral offset to a cable's computed path when bundled.
 */
export function computeBundledCablePath(
  cable: CableEdge,
  r1: RectBox,
  r2: RectBox,
  bundleOffsetPx = 0
) {
  if (!bundleOffsetPx || (cable.controlPoints && cable.controlPoints.length > 0)) {
    return computeCablePath(cable, r1, r2);
  }
  const cx1 = r1.x + r1.width / 2;
  const cy1 = r1.y + r1.height / 2;
  const cx2 = r2.x + r2.width / 2;
  const cy2 = r2.y + r2.height / 2;
  const dx = cx2 - cx1;
  const dy = cy2 - cy1;
  const len = Math.max(1, Math.hypot(dx, dy));
  const nx = (-dy / len) * bundleOffsetPx;
  const ny = (dx / len) * bundleOffsetPx;

  return computeCablePath(
    cable,
    { ...r1, x: r1.x + nx, y: r1.y + ny },
    { ...r2, x: r2.x + nx, y: r2.y + ny }
  );
}

export interface BomCostItem {
  code: string;
  category: 'Cáp & Vật Tư' | 'Máng & Ống Gen' | 'Nhân Công TCVN';
  name: string;
  unit: string;
  quantity: number;
  unitPriceVnd: number;
  totalVnd: number;
  note: string;
}

export interface BomCostSummary {
  items: BomCostItem[];
  materialTotalVnd: number;
  laborTotalVnd: number;
  grandTotalVnd: number;
}

/**
 * Estimates full TCVN Bill of Quantities (Materials + Construction Labor) in VND
 * for project tendering and Excel BOQ export.
 */
export function estimateBomWithLabor(project: ProjectState): BomCostSummary {
  const items: BomCostItem[] = [];
  const scale = Math.max(10, project.settings.scale || 30);

  let cat6Meters = 0;
  let cat6aMeters = 0;
  let fiberMeters = 0;
  let powerMeters = 0;

  project.cables.forEach(c => {
    const len = c.lengthMeters || 15;
    if (c.cableType === 'CAT6A_STP') cat6aMeters += len;
    else if (c.cableType === 'FIBER_SM_OS2' || c.cableType === 'FIBER_MM_OM4') fiberMeters += len;
    else if (c.cableType === 'POWER_AC') powerMeters += len;
    else cat6Meters += len;
  });

  if (cat6Meters > 0) {
    items.push({
      code: 'VT-CAT6',
      category: 'Cáp & Vật Tư',
      name: 'Cáp mạng Cat6 UTP 4-pair (LS/AMP chính hãng)',
      unit: 'Mét',
      quantity: cat6Meters,
      unitPriceVnd: 12500,
      totalVnd: cat6Meters * 12500,
      note: 'Đã bao gồm dự phòng co giãn 10%'
    });
  }
  if (cat6aMeters > 0) {
    items.push({
      code: 'VT-CAT6A',
      category: 'Cáp & Vật Tư',
      name: 'Cáp mạng chống nhiễu Cat6A STP 10G',
      unit: 'Mét',
      quantity: cat6aMeters,
      unitPriceVnd: 24000,
      totalVnd: cat6aMeters * 24000,
      note: 'Cho đường trục Uplink / Wi-Fi 6'
    });
  }
  if (fiberMeters > 0) {
    items.push({
      code: 'VT-FO',
      category: 'Cáp & Vật Tư',
      name: 'Cáp quang Single-mode 4-8FO OS2 Outdoor/Indoor',
      unit: 'Mét',
      quantity: fiberMeters,
      unitPriceVnd: 18000,
      totalVnd: fiberMeters * 18000,
      note: 'Trục đứng Riser & liên tầng'
    });
  }
  if (powerMeters > 0) {
    items.push({
      code: 'VT-PWR',
      category: 'Cáp & Vật Tư',
      name: 'Cáp điện Cadivi Cu/PVC/PVC 3x2.5mm²',
      unit: 'Mét',
      quantity: powerMeters,
      unitPriceVnd: 32000,
      totalVnd: powerMeters * 32000,
      note: 'Cấp nguồn UPS / Tủ Rack'
    });
  }

  // Cable Trays & Conduits length
  let trayMeters = 0;
  let conduitMeters = 0;
  (project.cableTrays || []).forEach(t => {
    let px = 0;
    for (let i = 0; i < t.points.length - 1; i++) {
      px += Math.hypot(t.points[i + 1].x - t.points[i].x, t.points[i + 1].y - t.points[i].y);
    }
    const m = Math.max(1, Math.round(px / scale));
    if (t.kind === 'conduit') conduitMeters += m;
    else trayMeters += m;
  });

  if (trayMeters > 0) {
    items.push({
      code: 'MG-TRAY',
      category: 'Máng & Ống Gen',
      name: 'Máng cáp sơn tĩnh điện 100×50mm + nắp & phụ kiện co T',
      unit: 'Mét',
      quantity: trayMeters,
      unitPriceVnd: 165000,
      totalVnd: trayMeters * 165000,
      note: 'Theo tuyến máng cáp đã vẽ trên mặt bằng'
    });
  }
  if (conduitMeters > 0) {
    items.push({
      code: 'MG-PVC',
      category: 'Máng & Ống Gen',
      name: 'Ống luồn dây điện/mạng PVC D25 Sino/Panasonic',
      unit: 'Mét',
      quantity: conduitMeters,
      unitPriceVnd: 22000,
      totalVnd: conduitMeters * 22000,
      note: 'Đi âm tường hoặc nổi trần kỹ thuật'
    });
  }

  // Labor estimation based on asset counts & cable lengths (TCVN norms)
  const assets = Object.values(project.assets);
  const cameraCount = assets.filter(a => a.category === 'camera').length;
  const apCount = assets.filter(a => a.category === 'ap').length;
  const rackCount = project.racks.length;
  const totalPullMeters = cat6Meters + cat6aMeters + fiberMeters + powerMeters;

  if (totalPullMeters > 0) {
    items.push({
      code: 'NC-CAP',
      category: 'Nhân Công TCVN',
      name: 'Nhân công kéo rải cáp, bấm đầu RJ45/hàn quang & đo kiểm Fluke',
      unit: 'Mét',
      quantity: totalPullMeters,
      unitPriceVnd: 15000,
      totalVnd: totalPullMeters * 15000,
      note: 'Bao gồm dán nhãn chuẩn TIA/EIA-606-B'
    });
  }

  if (trayMeters + conduitMeters > 0) {
    const qty = trayMeters + conduitMeters;
    items.push({
      code: 'NC-GEN',
      category: 'Nhân Công TCVN',
      name: 'Nhân công khoan đục tường, lắp đặt máng cáp & ống gen',
      unit: 'Mét',
      quantity: qty,
      unitPriceVnd: 45000,
      totalVnd: qty * 45000,
      note: 'Theo định mức thi công điện nhẹ TCVN'
    });
  }

  if (cameraCount > 0) {
    items.push({
      code: 'NC-CAM',
      category: 'Nhân Công TCVN',
      name: 'Nhân công lắp đặt, căn chỉnh góc quay & cấu hình Camera IP',
      unit: 'Bộ',
      quantity: cameraCount,
      unitPriceVnd: 250000,
      totalVnd: cameraCount * 250000,
      note: 'Bao gồm hộp kỹ thuật & chân đế'
    });
  }

  if (apCount > 0) {
    items.push({
      code: 'NC-AP',
      category: 'Nhân Công TCVN',
      name: 'Nhân công gắn trần, cấu hình Roaming & phát sóng Wi-Fi AP',
      unit: 'Bộ',
      quantity: apCount,
      unitPriceVnd: 220000,
      totalVnd: apCount * 220000,
      note: 'Tối ưu kênh 2.4/5GHz tránh nhiễu'
    });
  }

  if (rackCount > 0) {
    items.push({
      code: 'NC-RACK',
      category: 'Nhân Công TCVN',
      name: 'Nhân công lắp dựng tủ Rack 19", gá thiết bị & đấu nối Patch Panel',
      unit: 'Tủ',
      quantity: rackCount,
      unitPriceVnd: 1500000,
      totalVnd: rackCount * 1500000,
      note: 'Bao gồm bó gọn dây nhảy & tiếp địa tủ'
    });
  }

  const materialTotalVnd = items
    .filter(i => i.category !== 'Nhân Công TCVN')
    .reduce((sum, i) => sum + i.totalVnd, 0);
  const laborTotalVnd = items
    .filter(i => i.category === 'Nhân Công TCVN')
    .reduce((sum, i) => sum + i.totalVnd, 0);

  return {
    items,
    materialTotalVnd,
    laborTotalVnd,
    grandTotalVnd: materialTotalVnd + laborTotalVnd
  };
}
