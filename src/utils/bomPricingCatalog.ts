import { CableEdge } from '../types/infrastructure';

const PRICE_OVERRIDES_STORAGE_KEY = 'hachihi_bom_price_overrides_v1';

export interface BomSkuPriceEntry {
  sku: string;
  unitPriceVnd: number;
  supplier: string;
}

const DEFAULT_DEVICE_PRICE_BY_CATEGORY: Record<string, BomSkuPriceEntry> = {
  core_switch: { sku: 'HCH-SW-CORE-100G', unitPriceVnd: 85_000_000, supplier: 'HACHIHI Enterprise' },
  switch: { sku: 'HCH-SW-POE-24P', unitPriceVnd: 12_500_000, supplier: 'HACHIHI Network' },
  router: { sku: 'HCH-RTR-EDGE', unitPriceVnd: 7_800_000, supplier: 'HACHIHI Network' },
  gateway: { sku: 'HCH-GW-SDWAN', unitPriceVnd: 9_500_000, supplier: 'HACHIHI Network' },
  firewall: { sku: 'HCH-FW-NGFW', unitPriceVnd: 32_000_000, supplier: 'HACHIHI Security' },
  server: { sku: 'HCH-SRV-2U-XEON', unitPriceVnd: 68_000_000, supplier: 'HACHIHI Compute' },
  storage: { sku: 'HCH-NAS-SAN-4B', unitPriceVnd: 26_500_000, supplier: 'HACHIHI Storage' },
  ups: { sku: 'HCH-UPS-ONL-3K', unitPriceVnd: 18_500_000, supplier: 'HACHIHI Power' },
  pdu: { sku: 'HCH-PDU-1U-8OUT', unitPriceVnd: 1_850_000, supplier: 'HACHIHI Power' },
  odf: { sku: 'HCH-ODF-24FO-1U', unitPriceVnd: 1_450_000, supplier: 'HACHIHI Fiber' },
  patch_panel: { sku: 'HCH-PP-24P-CAT6', unitPriceVnd: 1_250_000, supplier: 'HACHIHI Cabling' },
  rack: { sku: 'HCH-RK-42U-800', unitPriceVnd: 16_500_000, supplier: 'HACHIHI Rack' },
  ap: { sku: 'HCH-AP-WIFI6', unitPriceVnd: 4_200_000, supplier: 'HACHIHI Wireless' },
  camera: { sku: 'HCH-CAM-4K-AI', unitPriceVnd: 3_450_000, supplier: 'HACHIHI CCTV' },
  nvr: { sku: 'HCH-NVR-32CH', unitPriceVnd: 14_200_000, supplier: 'HACHIHI CCTV' },
  cloud: { sku: 'HCH-WAN-ISP', unitPriceVnd: 0, supplier: 'Nhà mạng ISP' },
  telecom_tower: { sku: 'HCH-BTS-5G', unitPriceVnd: 45_000_000, supplier: 'HACHIHI Telecom' },
  workstation: { sku: 'HCH-WS-OFFICE', unitPriceVnd: 16_000_000, supplier: 'HACHIHI Endpoint' },
  printer: { sku: 'HCH-PRT-LAN', unitPriceVnd: 6_800_000, supplier: 'HACHIHI Endpoint' },
  electrical_panel: { sku: 'HCH-EL-MDB-3P', unitPriceVnd: 12_000_000, supplier: 'HACHIHI Power' },
  other: { sku: 'HCH-DEV-GEN', unitPriceVnd: 2_500_000, supplier: 'HACHIHI Partner' }
};

const MODEL_SPECIFIC_OVERRIDES: Array<{ match: RegExp; sku: string; unitPriceVnd: number; supplier: string }> = [
  { match: /nexus\s*9336/i, sku: 'CS-N9K-9336C', unitPriceVnd: 195_000_000, supplier: 'Cisco Systems' },
  { match: /c9300|catalyst\s*9300/i, sku: 'CS-C9300-48P', unitPriceVnd: 72_000_000, supplier: 'Cisco Systems' },
  { match: /cx\s*6300/i, sku: 'AR-JL661A-48G', unitPriceVnd: 58_000_000, supplier: 'Aruba HPE' },
  { match: /fortigate\s*200f/i, sku: 'FG-200F-BDL', unitPriceVnd: 86_000_000, supplier: 'Fortinet' },
  { match: /ccr2004/i, sku: 'MT-CCR2004-16G', unitPriceVnd: 14_800_000, supplier: 'MikroTik' },
  { match: /rb750/i, sku: 'MT-RB750GR3', unitPriceVnd: 1_950_000, supplier: 'MikroTik' },
  { match: /poweredge\s*r760/i, sku: 'DL-R760-2U', unitPriceVnd: 145_000_000, supplier: 'Dell Technologies' },
  { match: /synology|rs2423/i, sku: 'SY-NAS-PRO', unitPriceVnd: 38_000_000, supplier: 'Synology' },
  { match: /srt3000|smart-ups/i, sku: 'APC-SRT3000XLI', unitPriceVnd: 34_500_000, supplier: 'APC Schneider' },
  { match: /nbs3200/i, sku: 'RJ-NBS3200-24P', unitPriceVnd: 9_800_000, supplier: 'Ruijie Reyee' },
  { match: /u6-pro|unifi/i, sku: 'UB-U6-PRO', unitPriceVnd: 4_650_000, supplier: 'Ubiquiti' },
  { match: /2cd2186|acusense/i, sku: 'HK-2CD2186G2', unitPriceVnd: 3_850_000, supplier: 'Hikvision' },
  { match: /nvr5232|ds-7732/i, sku: 'HK-NVR-32CH-4K', unitPriceVnd: 14_900_000, supplier: 'Hikvision' }
];

const DEFAULT_CABLE_PRICE_PER_METER: Record<CableEdge['cableType'], BomSkuPriceEntry> = {
  CAT6_UTP: { sku: 'HCH-CAB-CAT6U', unitPriceVnd: 12_500, supplier: 'LS / AMP CommScope' },
  CAT6A_STP: { sku: 'HCH-CAB-CAT6AS', unitPriceVnd: 24_000, supplier: 'AMP CommScope' },
  FIBER_SM_OS2: { sku: 'HCH-CAB-OS2-8FO', unitPriceVnd: 18_500, supplier: 'Vinacap / LS' },
  FIBER_MM_OM4: { sku: 'HCH-CAB-OM4-8FO', unitPriceVnd: 34_000, supplier: 'Corning / CommScope' },
  DAC_10G: { sku: 'HCH-DAC-10G-3M', unitPriceVnd: 220_000, supplier: 'Cisco / FS' },
  POWER_AC: { sku: 'HCH-PWR-3X25', unitPriceVnd: 32_000, supplier: 'Cadivi TCVN' }
};

const DEFAULT_ACCESSORY_PRICES: Record<string, BomSkuPriceEntry> = {
  acc_keystone_copper: { sku: 'HCH-ACC-KJ-C6', unitPriceVnd: 45_000, supplier: 'AMP CommScope' },
  acc_patch_cord_copper: { sku: 'HCH-ACC-PC-C6-2M', unitPriceVnd: 85_000, supplier: 'LS Simple' },
  acc_fiber_pigtail_lc: { sku: 'HCH-ACC-PIG-LC', unitPriceVnd: 55_000, supplier: 'HACHIHI Fiber' },
  acc_fiber_patch_cord: { sku: 'HCH-ACC-FPC-LC3M', unitPriceVnd: 135_000, supplier: 'HACHIHI Fiber' },
  acc_cage_nuts: { sku: 'HCH-ACC-M6-NUT', unitPriceVnd: 6_500, supplier: 'HACHIHI Rack' },
  acc_cable_manager_1u: { sku: 'HCH-ACC-CM-1U', unitPriceVnd: 320_000, supplier: 'HACHIHI Rack' },
  acc_tia606_labels: { sku: 'HCH-ACC-LBL-606', unitPriceVnd: 12_000, supplier: 'Brother / HACHIHI' },
  acc_poe_injector_deficit: { sku: 'HCH-ACC-POE-30W', unitPriceVnd: 680_000, supplier: 'TP-Link / Ruijie' },
  acc_tray_straight: { sku: 'HCH-MG-TRAY-100', unitPriceVnd: 165_000, supplier: 'HACHIHI M&E' },
  acc_tray_fittings: { sku: 'HCH-MG-FIT-CT', unitPriceVnd: 145_000, supplier: 'HACHIHI M&E' },
  acc_conduit_pvc: { sku: 'HCH-MG-PVC-D25', unitPriceVnd: 22_000, supplier: 'Sino / Panasonic' }
};

export function loadBomPriceOverrides(): Record<string, number> {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(PRICE_OVERRIDES_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const clean: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) clean[k] = Math.round(n);
    }
    return clean;
  } catch {
    return {};
  }
}

export function saveBomPriceOverrides(overrides: Record<string, number>): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(PRICE_OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    // ignore quota errors
  }
}

export function clearBomPriceOverrides(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(PRICE_OVERRIDES_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function buildGeneratedSku(category: string, vendor: string, model: string): string {
  const clean = (s: string, max: number) =>
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, max);
  const vCode = clean(vendor, 3) || 'GEN';
  const cCode = clean(category, 3) || 'DEV';
  const mCode = clean(model, 8) || 'STD';
  return `${vCode}-${cCode}-${mCode}`;
}

export function resolveDeviceSkuAndPrice(
  key: string,
  category: string,
  vendor: string,
  model: string,
  overrides?: Record<string, number>
): BomSkuPriceEntry {
  const modelMatch = MODEL_SPECIFIC_OVERRIDES.find(o => o.match.test(model));
  const catBase = DEFAULT_DEVICE_PRICE_BY_CATEGORY[category] || DEFAULT_DEVICE_PRICE_BY_CATEGORY.other;
  const sku = modelMatch ? modelMatch.sku : buildGeneratedSku(category, vendor, model);
  const supplier = modelMatch ? modelMatch.supplier : vendor && vendor !== 'Chưa rõ' ? vendor : catBase.supplier;
  const defaultPrice = modelMatch ? modelMatch.unitPriceVnd : catBase.unitPriceVnd;
  const customPrice = overrides?.[key] ?? overrides?.[sku];
  return {
    sku,
    unitPriceVnd: typeof customPrice === 'number' && Number.isFinite(customPrice) ? customPrice : defaultPrice,
    supplier
  };
}

export function resolveCableSkuAndPrice(
  cableType: CableEdge['cableType'],
  overrides?: Record<string, number>
): BomSkuPriceEntry {
  const base = DEFAULT_CABLE_PRICE_PER_METER[cableType] || DEFAULT_CABLE_PRICE_PER_METER.CAT6_UTP;
  const customPrice = overrides?.[`cable::${cableType}`] ?? overrides?.[base.sku];
  return {
    sku: base.sku,
    unitPriceVnd: typeof customPrice === 'number' && Number.isFinite(customPrice) ? customPrice : base.unitPriceVnd,
    supplier: base.supplier
  };
}

export function resolveAccessorySkuAndPrice(
  accId: string,
  overrides?: Record<string, number>
): BomSkuPriceEntry {
  const base = DEFAULT_ACCESSORY_PRICES[accId] || {
    sku: `HCH-${accId.replace(/^acc_/, '').toUpperCase().slice(0, 10)}`,
    unitPriceVnd: 50_000,
    supplier: 'HACHIHI Partner'
  };
  const customPrice = overrides?.[`acc::${accId}`] ?? overrides?.[base.sku];
  return {
    sku: base.sku,
    unitPriceVnd: typeof customPrice === 'number' && Number.isFinite(customPrice) ? customPrice : base.unitPriceVnd,
    supplier: base.supplier
  };
}

export function formatVnd(amount: number): string {
  if (!Number.isFinite(amount)) return '0 đ';
  return `${Math.round(amount).toLocaleString('vi-VN')} đ`;
}
