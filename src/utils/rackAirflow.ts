import { DeviceAsset, RackSide, ServerRack } from '../types/infrastructure';
import { getAssetUHeight, getRackSlotsForSide } from './rackGeometry';

export type RackDoorAirflowType = 'perforated' | 'open' | 'glass';
export type ThermalRiskLevel = 'cool' | 'nominal' | 'warm' | 'hot';
export type VentilationStatus = 'optimal' | 'warning' | 'critical';

export interface RackAirflowConfig {
  fanCount?: number; // 0, 2, 4, 6 top canopy exhaust fans
  doorType?: RackDoorAirflowType;
  ambientTempC?: number; // default 22°C
}

export interface RackDeviceThermalProfile {
  assetId: string;
  name: string;
  model: string;
  category: DeviceAsset['category'];
  side: RackSide;
  startU: number;
  endU: number;
  uHeight: number;
  powerWatts: number;
  heatBtuPerHour: number;
  wattsPerU: number;
  requiredCfm: number;
  airflowPattern: 'front-to-back' | 'passive';
  risk: ThermalRiskLevel;
}

export interface RackUnitThermalCell {
  u: number;
  frontAssetId?: string;
  rearAssetId?: string;
  directWatts: number;
  convectionScore: number; // 0..1 combining local density + rising heat from lower Us
  zone: ThermalRiskLevel;
  isBypassGap: boolean;
}

export interface RackThermalHotspot {
  startU: number;
  endU: number;
  totalWatts: number;
  peakWattsPerU: number;
  deviceNames: string[];
  severity: 'warning' | 'critical';
}

export interface RackBypassGap {
  startU: number;
  endU: number;
  size: number;
  side: RackSide;
}

export interface RackVentilationRecommendation {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  targetStartU?: number;
  targetEndU?: number;
}

export interface RackAirflowAnalysis {
  totalUnits: number;
  ambientTempC: number;
  estimatedExhaustTempC: number;
  doorType: RackDoorAirflowType;
  fanCount: number;
  totalWatts: number;
  totalBtuPerHour: number;
  requiredCfm: number;
  rawFanCapacityCfm: number;
  effectiveCoolingCfm: number;
  airflowCoveragePct: number;
  status: VentilationStatus;
  devices: RackDeviceThermalProfile[];
  unitCells: RackUnitThermalCell[]; // indexed 1..totalUnits via u, sorted ascending U1..UN
  hotspots: RackThermalHotspot[];
  bypassGaps: RackBypassGap[];
  recommendations: RackVentilationRecommendation[];
}

const PASSIVE_CATEGORIES = new Set<DeviceAsset['category']>(['odf', 'patch_panel']);

export function getDefaultRackFanCount(rack: ServerRack): number {
  if ((rack.depthMm || 800) >= 1000 || (rack.widthMm || 600) >= 800) return 4;
  return 2;
}

export function analyzeRackAirflow(
  rack: ServerRack,
  assets: Record<string, DeviceAsset>,
  config: RackAirflowConfig = {}
): RackAirflowAnalysis {
  const totalUnits = Math.max(4, rack.totalUnits || 42);
  const ambientTempC = config.ambientTempC ?? 22;
  const doorType: RackDoorAirflowType = config.doorType ?? 'perforated';
  const fanCount = config.fanCount ?? getDefaultRackFanCount(rack);

  const devices: RackDeviceThermalProfile[] = [];
  const frontOccupied = new Map<number, DeviceAsset>();
  const rearOccupied = new Map<number, DeviceAsset>();

  const collectSide = (side: RackSide) => {
    const slotMap = getRackSlotsForSide(rack, side);
    for (const [uStr, assetId] of Object.entries(slotMap)) {
      const startU = parseInt(uStr, 10);
      const asset = assets[assetId];
      if (Number.isNaN(startU) || !asset) continue;
      const uHeight = getAssetUHeight(asset);
      const endU = Math.min(totalUnits, startU + uHeight - 1);
      const powerWatts = Math.max(0, asset.powerWatts || 0);
      const heatBtuPerHour =
        asset.heatBtu && asset.heatBtu > 0
          ? Math.round(asset.heatBtu)
          : Math.round(powerWatts * 3.412);
      const isPassive = PASSIVE_CATEGORIES.has(asset.category) || powerWatts <= 15;
      const wattsPerU = powerWatts / Math.max(1, uHeight);
      // ASHRAE rule of thumb for 20°F (11.1°C) ΔT: CFM = BTU/h / (1.08 * 20) ≈ Watts * 0.158
      const requiredCfm = isPassive ? 0 : Math.max(8, Math.round(heatBtuPerHour / (1.08 * 20)));

      let risk: ThermalRiskLevel = 'cool';
      if (wattsPerU >= 420) risk = 'hot';
      else if (wattsPerU >= 220) risk = 'warm';
      else if (powerWatts > 20) risk = 'nominal';

      devices.push({
        assetId: asset.id,
        name: asset.name,
        model: asset.model,
        category: asset.category,
        side,
        startU,
        endU,
        uHeight,
        powerWatts,
        heatBtuPerHour,
        wattsPerU,
        requiredCfm,
        airflowPattern: isPassive ? 'passive' : 'front-to-back',
        risk
      });

      const targetMap = side === 'rear' ? rearOccupied : frontOccupied;
      for (let u = Math.max(1, startU); u <= endU; u++) {
        targetMap.set(u, asset);
      }
    }
  };

  collectSide('front');
  collectSide('rear');
  devices.sort((a, b) => b.startU - a.startU);

  const totalWatts = devices.reduce((acc, d) => acc + d.powerWatts, 0);
  const totalBtuPerHour = devices.reduce((acc, d) => acc + d.heatBtuPerHour, 0);
  const requiredCfm = devices.reduce((acc, d) => acc + d.requiredCfm, 0);

  // Typical 120mm high-static-pressure rack roof fan delivers ~95 CFM free air
  const cfmPerFan = 95;
  const rawFanCapacityCfm = fanCount * cfmPerFan;
  // Passive convection baseline ~35 CFM for perforated/open rack, ~8 CFM for sealed glass
  const passiveConvectionCfm = doorType === 'open' ? 55 : doorType === 'perforated' ? 35 : 8;
  const doorEfficiency = doorType === 'open' ? 1.0 : doorType === 'perforated' ? 0.9 : 0.48;
  const effectiveCoolingCfm = Math.round((rawFanCapacityCfm + passiveConvectionCfm) * doorEfficiency);

  const airflowCoveragePct =
    requiredCfm <= 0 ? 100 : Math.min(200, Math.round((effectiveCoolingCfm / requiredCfm) * 100));

  // Estimate exhaust ΔT (°C): ΔT_C = (Watts * 1.76) / effectiveCFM (clamped reasonably)
  const deltaTempC =
    totalWatts <= 0
      ? 0
      : Math.min(34, (totalWatts * 1.76) / Math.max(18, effectiveCoolingCfm));
  const estimatedExhaustTempC = Number((ambientTempC + deltaTempC).toFixed(1));

  // Detect unblanked bypass gaps >= 3U on front rail when active cooling equipment is present
  const bypassGaps: RackBypassGap[] = [];
  const hasActiveFrontHeat = devices.some(d => d.side === 'front' && d.powerWatts >= 120);
  if (hasActiveFrontHeat) {
    let gapStart: number | null = null;
    for (let u = 1; u <= totalUnits; u++) {
      const occupied = frontOccupied.has(u);
      if (!occupied && gapStart === null) {
        gapStart = u;
      } else if ((occupied || u === totalUnits) && gapStart !== null) {
        const gapEnd = occupied ? u - 1 : u;
        const size = gapEnd - gapStart + 1;
        if (size >= 3) {
          bypassGaps.push({ startU: gapStart, endU: gapEnd, size, side: 'front' });
        }
        gapStart = null;
      }
    }
  }

  const bypassUSet = new Set<number>();
  for (const g of bypassGaps) {
    for (let u = g.startU; u <= g.endU; u++) bypassUSet.add(u);
  }

  // Build per-U thermal cells with vertical convection accumulation (rising warm plume)
  const unitCells: RackUnitThermalCell[] = [];
  let risingPlumeHeat = 0;
  for (let u = 1; u <= totalUnits; u++) {
    const fDev = frontOccupied.get(u);
    const rDev = rearOccupied.get(u);
    const fWattsPerU = fDev ? (fDev.powerWatts || 0) / getAssetUHeight(fDev) : 0;
    const rWattsPerU = rDev ? (rDev.powerWatts || 0) / getAssetUHeight(rDev) : 0;
    const directWatts = Math.round(fWattsPerU + rWattsPerU);

    // Heat rises slowly and dissipates along open height unless trapped behind solid door
    const retention = doorType === 'glass' ? 0.92 : 0.78;
    risingPlumeHeat = risingPlumeHeat * retention + directWatts * 0.45;
    const effectiveThermalLoad = directWatts + risingPlumeHeat * 0.4;
    const convectionScore = Math.min(1, effectiveThermalLoad / 520);

    let zone: ThermalRiskLevel = 'cool';
    if (convectionScore >= 0.72) zone = 'hot';
    else if (convectionScore >= 0.42) zone = 'warm';
    else if (directWatts > 15 || convectionScore >= 0.16) zone = 'nominal';

    unitCells.push({
      u,
      frontAssetId: fDev?.id,
      rearAssetId: rDev?.id,
      directWatts,
      convectionScore: Number(convectionScore.toFixed(3)),
      zone,
      isBypassGap: bypassUSet.has(u)
    });
  }

  // Detect high-density thermal hotspot clusters (>= 300W/U across contiguous Us or >= 950W stacked)
  const hotspots: RackThermalHotspot[] = [];
  let clusterStart: number | null = null;
  let clusterWatts = 0;
  let clusterPeak = 0;
  const clusterNames = new Set<string>();

  const flushCluster = (endU: number) => {
    if (clusterStart !== null && (clusterWatts >= 900 || clusterPeak >= 420)) {
      hotspots.push({
        startU: clusterStart,
        endU,
        totalWatts: Math.round(clusterWatts),
        peakWattsPerU: Math.round(clusterPeak),
        deviceNames: Array.from(clusterNames),
        severity: clusterWatts >= 1600 || clusterPeak >= 550 ? 'critical' : 'warning'
      });
    }
    clusterStart = null;
    clusterWatts = 0;
    clusterPeak = 0;
    clusterNames.clear();
  };

  for (let u = 1; u <= totalUnits; u++) {
    const cell = unitCells[u - 1];
    if (cell.directWatts >= 200) {
      if (clusterStart === null) clusterStart = u;
      clusterWatts += cell.directWatts;
      clusterPeak = Math.max(clusterPeak, cell.directWatts);
      if (cell.frontAssetId && assets[cell.frontAssetId]) clusterNames.add(assets[cell.frontAssetId].name);
      if (cell.rearAssetId && assets[cell.rearAssetId]) clusterNames.add(assets[cell.rearAssetId].name);
    } else {
      flushCluster(u - 1);
    }
  }
  flushCluster(totalUnits);

  // Engineering recommendations (Vietnamese)
  const recommendations: RackVentilationRecommendation[] = [];

  if (doorType === 'glass' && totalWatts >= 600) {
    recommendations.push({
      id: 'glass_door_choke',
      severity: totalWatts >= 1400 ? 'critical' : 'warning',
      title: 'Cửa kính kín cản trở lưu lượng gió nạp trước',
      detail: `Tủ đang tỏa ${totalWatts}W nhưng dùng cửa kính kín. Khuyến nghị chuyển sang cửa lưới đục lỗ (Perforated Mesh ≥70%) để tăng hiệu suất nạp khí lạnh.`
    });
  }

  if (requiredCfm > effectiveCoolingCfm && totalWatts > 0) {
    const deficit = requiredCfm - effectiveCoolingCfm;
    const extraFans = Math.max(2, Math.ceil(deficit / (cfmPerFan * doorEfficiency) / 2) * 2);
    recommendations.push({
      id: 'insufficient_fan_cfm',
      severity: airflowCoveragePct < 65 ? 'critical' : 'warning',
      title: `Thiếu lưu lượng quạt hút đỉnh (-${deficit} CFM)`,
      detail: `Thiết bị cần ${requiredCfm} CFM nhưng khay ${fanCount} quạt hiện đạt ${effectiveCoolingCfm} CFM hiệu dụng. Nên bổ sung thêm ${extraFans} quạt hút đỉnh.`
    });
  }

  for (const spot of hotspots) {
    recommendations.push({
      id: `hotspot_${spot.startU}_${spot.endU}`,
      severity: spot.severity,
      title: `Cụm tích nhiệt cao tại U${spot.startU}–U${spot.endU} (${spot.totalWatts}W)`,
      detail: `Nhóm ${spot.deviceNames.join(', ')} đặt sát nhau không có khe thở. Nên chèn khe trống 1U có nắp che hoặc tách giãn cách dọc theo thân tủ.`,
      targetStartU: spot.startU,
      targetEndU: spot.endU
    });
  }

  for (const gap of bypassGaps) {
    recommendations.push({
      id: `bypass_${gap.startU}_${gap.endU}`,
      severity: gap.size >= 8 ? 'warning' : 'info',
      title: `Khe trống tuần hoàn khí nóng U${gap.startU}–U${gap.endU} (${gap.size}U)`,
      detail: `Không khí nóng mặt sau có thể quẩn ngược ra mặt trước qua khoảng trống ${gap.size}U. Nên gắn tấm che Blanking Panel 1U–2U để tách luồng lạnh/nóng.`,
      targetStartU: gap.startU,
      targetEndU: gap.endU
    });
  }

  // Check heavy UPS placed high in rack (blocks rising hot exhaust + poor center of gravity)
  const highUps = devices.find(
    d => d.category === 'ups' && d.startU > Math.ceil(totalUnits * 0.55)
  );
  if (highUps) {
    recommendations.push({
      id: `high_ups_${highUps.assetId}`,
      severity: 'warning',
      title: `UPS "${highUps.name}" đang đặt ở tầng cao (U${highUps.startU})`,
      detail: 'Nên đặt UPS ở đáy tủ (U1–U6) để hạ trọng tâm và không cản luồng khí nóng bốc lên khay quạt đỉnh.'
    });
  }

  if (recommendations.length === 0 && totalWatts > 0) {
    recommendations.push({
      id: 'airflow_healthy',
      severity: 'info',
      title: 'Thông gió tủ đạt chuẩn vận hành',
      detail: `Lưu lượng làm mát ${effectiveCoolingCfm} CFM đáp ứng tốt tải nhiệt ${totalWatts}W (${totalBtuPerHour} BTU/h). Nhiệt độ khí xả ước tính ${estimatedExhaustTempC}°C.`
    });
  }

  const hasCritical = recommendations.some(r => r.severity === 'critical') || estimatedExhaustTempC >= 38;
  const hasWarning = recommendations.some(r => r.severity === 'warning') || estimatedExhaustTempC >= 33;
  const status: VentilationStatus = hasCritical ? 'critical' : hasWarning ? 'warning' : 'optimal';

  return {
    totalUnits,
    ambientTempC,
    estimatedExhaustTempC,
    doorType,
    fanCount,
    totalWatts,
    totalBtuPerHour,
    requiredCfm,
    rawFanCapacityCfm,
    effectiveCoolingCfm,
    airflowCoveragePct,
    status,
    devices,
    unitCells,
    hotspots,
    bypassGaps,
    recommendations
  };
}
