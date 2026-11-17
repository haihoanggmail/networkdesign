import {
  DeviceAsset,
  DeviceCategory,
  DiagramNode,
  ProjectState
} from '../types/infrastructure';
import { parseIpv4ToInt } from './engineeringValidator';

export interface SubnetMaskPreset {
  prefix: number;
  mask: string;
  label: string;
}

export const SUBNET_MASK_PRESETS: SubnetMaskPreset[] = [
  { prefix: 24, mask: '255.255.255.0', label: '/24 · 255.255.255.0 (254 host)' },
  { prefix: 23, mask: '255.255.254.0', label: '/23 · 255.255.254.0 (510 host)' },
  { prefix: 22, mask: '255.255.252.0', label: '/22 · 255.255.252.0 (1022 host)' },
  { prefix: 25, mask: '255.255.255.128', label: '/25 · 255.255.255.128 (126 host)' },
  { prefix: 26, mask: '255.255.255.192', label: '/26 · 255.255.255.192 (62 host)' },
  { prefix: 27, mask: '255.255.255.224', label: '/27 · 255.255.255.224 (30 host)' },
  { prefix: 28, mask: '255.255.255.240', label: '/28 · 255.255.255.240 (14 host)' },
  { prefix: 16, mask: '255.255.0.0', label: '/16 · 255.255.0.0 (65534 host)' }
];

export const DEFAULT_IP_PLAN_CONFIG: IpPlanConfig = {
  ipRangeStart: '192.168.10.10',
  ipRangeEnd: '192.168.10.250',
  ipSubnetMask: '255.255.255.0',
  ipGateway: '192.168.10.1'
};

export interface IpPlanConfig {
  ipRangeStart: string;
  ipRangeEnd: string;
  ipSubnetMask: string;
  ipGateway?: string;
}

export interface IpPlanValidationResult {
  valid: boolean;
  error?: string;
  prefix: number;
  maskInt: number;
  networkInt: number;
  broadcastInt: number;
  startInt: number;
  endInt: number;
  gatewayInt: number | null;
  networkAddress: string;
  broadcastAddress: string;
  cidrNotation: string;
  resolvedGateway: string;
  availableHostCount: number;
}

export interface IpAssignmentEntry {
  assetId: string;
  name: string;
  category: DeviceCategory;
  oldIp: string;
  newIp: string;
  subnetMask: string;
  gateway: string;
  preserved: boolean;
}

export interface AutoAssignIpResult {
  ok: boolean;
  error?: string;
  updatedAssets: Record<string, DeviceAsset>;
  assignedCount: number;
  preservedCount: number;
  unassignedCount: number;
  totalAssignable: number;
  cidrNotation: string;
  subnetMask: string;
  gatewayUsed: string;
  assignments: IpAssignmentEntry[];
}

export function intToIpv4(num: number): string {
  const n = num >>> 0;
  return [
    (n >>> 24) & 255,
    (n >>> 16) & 255,
    (n >>> 8) & 255,
    n & 255
  ].join('.');
}

export function prefixToMaskInt(prefix: number): number {
  if (prefix <= 0) return 0;
  if (prefix >= 32) return 0xffffffff >>> 0;
  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function prefixToSubnetMask(prefix: number): string {
  return intToIpv4(prefixToMaskInt(prefix));
}

/**
 * Parses a dotted-decimal IPv4 subnet mask (or "/24" shorthand) into CIDR prefix [0..32].
 * Returns null if invalid or non-contiguous (e.g. 255.0.255.0).
 */
export function parseSubnetMaskToPrefix(mask: string): number | null {
  const raw = String(mask || '').trim();
  if (!raw) return null;
  if (/^\/\d{1,2}$/.test(raw)) {
    const p = Number(raw.slice(1));
    return p >= 0 && p <= 32 ? p : null;
  }
  const maskInt = parseIpv4ToInt(raw);
  if (maskInt === null) return null;
  if (maskInt === 0) return 0;
  const inv = (~maskInt) >>> 0;
  // Valid contiguous mask has inverse + 1 as a power of 2
  if (((inv + 1) & inv) !== 0) return null;
  const hostBits = inv === 0 ? 0 : Math.round(Math.log2(inv + 1));
  return 32 - hostBits;
}

const PASSIVE_NON_IP_CATEGORIES = new Set<string>([
  'rack',
  'odf',
  'patch_panel',
  'cloud',
  'telecom_tower',
  'electrical_panel'
]);

export function isIpAssignableCategory(category?: DeviceCategory | string): boolean {
  if (!category) return true;
  return !PASSIVE_NON_IP_CATEGORIES.has(category);
}

/**
 * Hierarchy tier for topology-first IP numbering.
 * Lower number = core infrastructure numbered first.
 */
function getTopologyRolePriority(category?: DeviceCategory | string): number {
  switch (category) {
    case 'router':
    case 'gateway':
      return 0;
    case 'firewall':
      return 1;
    case 'core_switch':
      return 2;
    case 'switch':
      return 3;
    case 'server':
    case 'storage':
    case 'nvr':
      return 4;
    case 'ap':
    case 'camera':
      return 5;
    case 'workstation':
    case 'printer':
      return 6;
    case 'ups':
    case 'pdu':
      return 7;
    default:
      return 8;
  }
}

function isGatewayDeviceCategory(category?: DeviceCategory | string): boolean {
  return category === 'router' || category === 'gateway' || category === 'firewall';
}

export function resolveProjectIpPlanConfig(project: ProjectState): IpPlanConfig {
  return {
    ipRangeStart: (project.settings.ipRangeStart ?? DEFAULT_IP_PLAN_CONFIG.ipRangeStart).trim(),
    ipRangeEnd: (project.settings.ipRangeEnd ?? DEFAULT_IP_PLAN_CONFIG.ipRangeEnd).trim(),
    ipSubnetMask: (project.settings.ipSubnetMask ?? DEFAULT_IP_PLAN_CONFIG.ipSubnetMask).trim(),
    ipGateway: (project.settings.ipGateway ?? '').trim()
  };
}

export function validateIpPlanConfig(config: IpPlanConfig): IpPlanValidationResult {
  const invalidBase: IpPlanValidationResult = {
    valid: false,
    prefix: 24,
    maskInt: 0xffffff00,
    networkInt: 0,
    broadcastInt: 0,
    startInt: 0,
    endInt: 0,
    gatewayInt: null,
    networkAddress: '0.0.0.0',
    broadcastAddress: '0.0.0.0',
    cidrNotation: '—',
    resolvedGateway: '',
    availableHostCount: 0
  };

  const prefix = parseSubnetMaskToPrefix(config.ipSubnetMask);
  if (prefix === null || prefix < 8 || prefix > 30) {
    return {
      ...invalidBase,
      error: 'Subnet Mask không hợp lệ (hỗ trợ từ /8 đến /30, ví dụ 255.255.255.0).'
    };
  }

  const startInt = parseIpv4ToInt(config.ipRangeStart);
  if (startInt === null) {
    return {
      ...invalidBase,
      prefix,
      error: 'IP bắt đầu không đúng định dạng IPv4 (ví dụ: 192.168.10.10).'
    };
  }

  const endInt = parseIpv4ToInt(config.ipRangeEnd);
  if (endInt === null) {
    return {
      ...invalidBase,
      prefix,
      error: 'IP kết thúc không đúng định dạng IPv4 (ví dụ: 192.168.10.250).'
    };
  }

  if (startInt > endInt) {
    return {
      ...invalidBase,
      prefix,
      startInt,
      endInt,
      error: 'IP bắt đầu phải nhỏ hơn hoặc bằng IP kết thúc.'
    };
  }

  const maskInt = prefixToMaskInt(prefix);
  const startNet = (startInt & maskInt) >>> 0;
  const endNet = (endInt & maskInt) >>> 0;
  if (startNet !== endNet) {
    return {
      ...invalidBase,
      prefix,
      maskInt,
      startInt,
      endInt,
      error: 'Dải IP bắt đầu và kết thúc không nằm trong cùng một Subnet theo Subnet Mask đã chọn.'
    };
  }

  const networkInt = startNet;
  const broadcastInt = (networkInt | (~maskInt >>> 0)) >>> 0;
  const firstUsable = Math.max(startInt, networkInt + 1);
  const lastUsable = Math.min(endInt, broadcastInt - 1);

  if (firstUsable > lastUsable) {
    return {
      ...invalidBase,
      prefix,
      maskInt,
      networkInt,
      broadcastInt,
      startInt,
      endInt,
      networkAddress: intToIpv4(networkInt),
      broadcastAddress: intToIpv4(broadcastInt),
      cidrNotation: `${intToIpv4(networkInt)}/${prefix}`,
      error: 'Dải IP không chứa địa chỉ host khả dụng nào (trùng địa chỉ Network/Broadcast).'
    };
  }

  let gatewayInt: number | null = null;
  const rawGateway = (config.ipGateway || '').trim();
  if (rawGateway) {
    const parsedGw = parseIpv4ToInt(rawGateway);
    if (parsedGw === null) {
      return {
        ...invalidBase,
        prefix,
        maskInt,
        networkInt,
        broadcastInt,
        startInt: firstUsable,
        endInt: lastUsable,
        networkAddress: intToIpv4(networkInt),
        broadcastAddress: intToIpv4(broadcastInt),
        cidrNotation: `${intToIpv4(networkInt)}/${prefix}`,
        error: 'Địa chỉ Default Gateway không đúng định dạng IPv4.'
      };
    }
    if (((parsedGw & maskInt) >>> 0) !== networkInt || parsedGw === networkInt || parsedGw === broadcastInt) {
      return {
        ...invalidBase,
        prefix,
        maskInt,
        networkInt,
        broadcastInt,
        startInt: firstUsable,
        endInt: lastUsable,
        networkAddress: intToIpv4(networkInt),
        broadcastAddress: intToIpv4(broadcastInt),
        cidrNotation: `${intToIpv4(networkInt)}/${prefix}`,
        error: `Gateway ${rawGateway} phải nằm trong dải host của subnet ${intToIpv4(networkInt)}/${prefix}.`
      };
    }
    gatewayInt = parsedGw;
  } else {
    gatewayInt = networkInt + 1;
  }

  // Count usable host IPs inside [firstUsable, lastUsable]
  // Note: gateway inside [firstUsable, lastUsable] is still counted as usable if a gateway device exists,
  // or reserved if not, so total pool span is (lastUsable - firstUsable + 1).
  const totalSpan = lastUsable - firstUsable + 1;

  return {
    valid: true,
    prefix,
    maskInt,
    networkInt,
    broadcastInt,
    startInt: firstUsable,
    endInt: lastUsable,
    gatewayInt,
    networkAddress: intToIpv4(networkInt),
    broadcastAddress: intToIpv4(broadcastInt),
    cidrNotation: `${intToIpv4(networkInt)}/${prefix}`,
    resolvedGateway: intToIpv4(gatewayInt),
    availableHostCount: totalSpan
  };
}

/**
 * Orders assignable DeviceAsset IDs by traversing the topology graph (nodes + non-power cables)
 * using role-tiered BFS from edge routers/firewalls/core switches down to access switches and endpoints.
 * Passive nodes (e.g. Patch Panel, ODF) are traversed as hops without consuming an IP.
 */
export function getTopologyOrderedAssetIds(project: ProjectState): string[] {
  const nodeById = new Map<string, DiagramNode>();
  for (const node of project.nodes) {
    nodeById.set(node.id, node);
  }

  const adj = new Map<string, Set<string>>();
  for (const node of project.nodes) {
    adj.set(node.id, new Set());
  }

  for (const cable of project.cables) {
    if (cable.cableType === 'POWER_AC') continue;
    if (!nodeById.has(cable.sourceNodeId) || !nodeById.has(cable.targetNodeId)) continue;
    adj.get(cable.sourceNodeId)?.add(cable.targetNodeId);
    adj.get(cable.targetNodeId)?.add(cable.sourceNodeId);
  }

  const getNodeCategory = (node: DiagramNode): string => {
    if (node.assetId && project.assets[node.assetId]) {
      return project.assets[node.assetId].category;
    }
    return node.type;
  };

  const isCloudAdjacent = (nodeId: string): boolean => {
    const neighbors = adj.get(nodeId);
    if (!neighbors) return false;
    for (const nbId of neighbors) {
      const nb = nodeById.get(nbId);
      if (nb && getNodeCategory(nb) === 'cloud') return true;
    }
    return false;
  };

  const compareNodesForTopology = (a: DiagramNode, b: DiagramNode): number => {
    const modeRankA = a.diagramMode === 'topology' ? 0 : 1;
    const modeRankB = b.diagramMode === 'topology' ? 0 : 1;
    if (modeRankA !== modeRankB) return modeRankA - modeRankB;

    const cloudA = isCloudAdjacent(a.id) ? 0 : 1;
    const cloudB = isCloudAdjacent(b.id) ? 0 : 1;
    if (cloudA !== cloudB) return cloudA - cloudB;

    const prioA = getTopologyRolePriority(getNodeCategory(a));
    const prioB = getTopologyRolePriority(getNodeCategory(b));
    if (prioA !== prioB) return prioA - prioB;

    const degA = adj.get(a.id)?.size || 0;
    const degB = adj.get(b.id)?.size || 0;
    if (degA !== degB) return degB - degA;

    if (Math.abs(a.y - b.y) > 20) return a.y - b.y;
    if (Math.abs(a.x - b.x) > 20) return a.x - b.x;
    return (a.label || '').localeCompare(b.label || '', undefined, { numeric: true });
  };

  const candidateNodes = project.nodes
    .filter(n => n.type !== 'legend' && n.type !== 'text' && n.type !== 'zone' && n.type !== 'wall' && n.type !== 'rack')
    .sort(compareNodesForTopology);

  const visitedNodes = new Set<string>();
  const orderedAssetIds: string[] = [];
  const seenAssets = new Set<string>();

  const recordNodeAsset = (node: DiagramNode) => {
    if (!node.assetId) return;
    const asset = project.assets[node.assetId];
    if (!asset || !isIpAssignableCategory(asset.category)) return;
    if (seenAssets.has(asset.id)) return;
    seenAssets.add(asset.id);
    orderedAssetIds.push(asset.id);
  };

  for (const root of candidateNodes) {
    if (visitedNodes.has(root.id)) continue;
    const queue: DiagramNode[] = [root];
    visitedNodes.add(root.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      recordNodeAsset(current);

      const neighborIds = Array.from(adj.get(current.id) || []);
      const unvisitedNeighbors = neighborIds
        .filter(id => !visitedNodes.has(id))
        .map(id => nodeById.get(id))
        .filter((n): n is DiagramNode => Boolean(n))
        .sort(compareNodesForTopology);

      for (const nb of unvisitedNeighbors) {
        if (!visitedNodes.has(nb.id)) {
          visitedNodes.add(nb.id);
          queue.push(nb);
        }
      }
    }
  }

  // Append any remaining assignable assets not bound to a traversed canvas node
  const remainingAssets = Object.values(project.assets)
    .filter(a => isIpAssignableCategory(a.category) && !seenAssets.has(a.id))
    .sort((a, b) => {
      const prioDiff = getTopologyRolePriority(a.category) - getTopologyRolePriority(b.category);
      if (prioDiff !== 0) return prioDiff;
      return (a.name || '').localeCompare(b.name || '', undefined, { numeric: true });
    });

  for (const asset of remainingAssets) {
    orderedAssetIds.push(asset.id);
  }

  return orderedAssetIds;
}

/**
 * Automatically assigns IP addresses, subnet masks, and default gateways to network devices
 * following topology traversal order within the project's configured IP range.
 */
export function autoAssignTopologyIps(
  project: ProjectState,
  options?: {
    preserveExistingValid?: boolean;
    overrideConfig?: Partial<IpPlanConfig>;
  }
): AutoAssignIpResult {
  const baseConfig = resolveProjectIpPlanConfig(project);
  const config: IpPlanConfig = {
    ...baseConfig,
    ...options?.overrideConfig
  };
  const validation = validateIpPlanConfig(config);
  const maskStr = validation.valid
    ? prefixToSubnetMask(validation.prefix)
    : config.ipSubnetMask;

  if (!validation.valid) {
    return {
      ok: false,
      error: validation.error || 'Cấu hình dải IP / Subnet Mask không hợp lệ.',
      updatedAssets: project.assets,
      assignedCount: 0,
      preservedCount: 0,
      unassignedCount: 0,
      totalAssignable: 0,
      cidrNotation: validation.cidrNotation,
      subnetMask: maskStr,
      gatewayUsed: validation.resolvedGateway,
      assignments: []
    };
  }

  const orderedAssetIds = getTopologyOrderedAssetIds(project);
  const preserveExistingValid = options?.preserveExistingValid ?? false;
  const gatewayStr = validation.resolvedGateway;
  const gatewayInt = validation.gatewayInt;

  const usedIpInts = new Set<number>();
  const preservedAssetIds = new Set<string>();
  const nextAssets: Record<string, DeviceAsset> = { ...project.assets };
  const assignments: IpAssignmentEntry[] = [];

  if (preserveExistingValid) {
    for (const assetId of orderedAssetIds) {
      const asset = project.assets[assetId];
      if (!asset) continue;
      const existingInt = parseIpv4ToInt(asset.ipAddress);
      if (
        existingInt !== null &&
        existingInt >= validation.startInt &&
        existingInt <= validation.endInt &&
        !usedIpInts.has(existingInt) &&
        (existingInt !== gatewayInt || isGatewayDeviceCategory(asset.category))
      ) {
        usedIpInts.add(existingInt);
        preservedAssetIds.add(assetId);
        const normalizedIp = intToIpv4(existingInt);
        nextAssets[assetId] = {
          ...asset,
          ipAddress: normalizedIp,
          subnetMask: maskStr,
          gateway: gatewayStr
        };
        assignments.push({
          assetId,
          name: asset.name,
          category: asset.category,
          oldIp: asset.ipAddress,
          newIp: normalizedIp,
          subnetMask: maskStr,
          gateway: gatewayStr,
          preserved: true
        });
      }
    }
  }

  let cursor = validation.startInt;
  let assignedCount = 0;
  let unassignedCount = 0;
  let gatewayAssigned = gatewayInt !== null && usedIpInts.has(gatewayInt);

  const allocateNextIpInt = (allowGatewayIp: boolean): number | null => {
    if (
      allowGatewayIp &&
      !gatewayAssigned &&
      gatewayInt !== null &&
      gatewayInt >= validation.startInt &&
      gatewayInt <= validation.endInt &&
      !usedIpInts.has(gatewayInt)
    ) {
      usedIpInts.add(gatewayInt);
      gatewayAssigned = true;
      return gatewayInt;
    }

    while (cursor <= validation.endInt) {
      const candidate = cursor;
      cursor += 1;
      if (usedIpInts.has(candidate)) continue;
      if (candidate === gatewayInt && !allowGatewayIp) continue;
      usedIpInts.add(candidate);
      return candidate;
    }
    return null;
  };

  for (const assetId of orderedAssetIds) {
    if (preservedAssetIds.has(assetId)) continue;
    const asset = project.assets[assetId];
    if (!asset) continue;

    const allowGw = isGatewayDeviceCategory(asset.category);
    const allocatedInt = allocateNextIpInt(allowGw);
    if (allocatedInt === null) {
      unassignedCount += 1;
      continue;
    }

    const newIp = intToIpv4(allocatedInt);
    nextAssets[assetId] = {
      ...asset,
      ipAddress: newIp,
      subnetMask: maskStr,
      gateway: gatewayStr
    };
    assignedCount += 1;
    assignments.push({
      assetId,
      name: asset.name,
      category: asset.category,
      oldIp: asset.ipAddress,
      newIp,
      subnetMask: maskStr,
      gateway: gatewayStr,
      preserved: false
    });
  }

  return {
    ok: true,
    updatedAssets: nextAssets,
    assignedCount,
    preservedCount: preservedAssetIds.size,
    unassignedCount,
    totalAssignable: orderedAssetIds.length,
    cidrNotation: validation.cidrNotation,
    subnetMask: maskStr,
    gatewayUsed: gatewayStr,
    assignments
  };
}

/**
 * Picks the next unused IPv4 address from the project's configured IP range and subnet mask
 * when inserting a new device onto the canvas or rack.
 */
export function findNextAvailableIpInProject(
  project: ProjectState,
  category?: DeviceCategory | string
): { ipAddress: string; subnetMask: string; gateway: string } | null {
  const config = resolveProjectIpPlanConfig(project);
  const validation = validateIpPlanConfig(config);
  if (!validation.valid) return null;

  const used = new Set<number>();
  for (const asset of Object.values(project.assets)) {
    const ipInt = parseIpv4ToInt(asset.ipAddress);
    if (ipInt !== null) used.add(ipInt);
  }

  const allowGw = isGatewayDeviceCategory(category);
  for (let ip = validation.startInt; ip <= validation.endInt; ip++) {
    if (used.has(ip)) continue;
    if (ip === validation.gatewayInt && !allowGw) continue;
    return {
      ipAddress: intToIpv4(ip),
      subnetMask: prefixToSubnetMask(validation.prefix),
      gateway: validation.resolvedGateway
    };
  }

  return {
    ipAddress: '',
    subnetMask: prefixToSubnetMask(validation.prefix),
    gateway: validation.resolvedGateway
  };
}
