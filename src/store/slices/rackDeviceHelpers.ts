import { CableEdge, DeviceAsset, DiagramNode, ProjectState } from '../../types/infrastructure';
import { BatchCableRouteUpdate } from '../../utils/cableRouting';

/**
 * Synchronizes each DeviceAsset's port status (`up` / `unlinked` / `down`) and link pointers
 * against the active CableEdge list.
 */
export function syncAssetPortsWithCables(
  assets: Record<string, DeviceAsset>,
  nodes: DiagramNode[],
  cables: CableEdge[]
): Record<string, DeviceAsset> {
  const nodeById = new Map(nodes.map(n => [n.id, n]));
  const portLinks = new Map<
    string,
    Map<string, { cableId: string; peerDeviceId: string; peerPortId: string }>
  >();

  const registerLink = (
    assetId: string,
    portIdentifier: string | undefined,
    cableId: string,
    peerDeviceId: string,
    peerPortId: string
  ) => {
    if (!portIdentifier || portIdentifier === 'Auto') return;
    const asset = assets[assetId];
    if (!asset || !asset.ports || asset.ports.length === 0) return;
    const matchedPort = asset.ports.find(
      p => p.id === portIdentifier || p.name === portIdentifier
    );
    if (!matchedPort) return;
    let assetMap = portLinks.get(assetId);
    if (!assetMap) {
      assetMap = new Map();
      portLinks.set(assetId, assetMap);
    }
    assetMap.set(matchedPort.id, { cableId, peerDeviceId, peerPortId });
  };

  for (const cable of cables) {
    const srcNode = nodeById.get(cable.sourceNodeId);
    const tgtNode = nodeById.get(cable.targetNodeId);
    if (srcNode?.assetId) {
      registerLink(
        srcNode.assetId,
        cable.sourcePortId,
        cable.id,
        tgtNode?.assetId || cable.targetNodeId,
        cable.targetPortId || ''
      );
    }
    if (tgtNode?.assetId) {
      registerLink(
        tgtNode.assetId,
        cable.targetPortId,
        cable.id,
        srcNode?.assetId || cable.sourceNodeId,
        cable.sourcePortId || ''
      );
    }
  }

  let changed = false;
  const nextAssets: Record<string, DeviceAsset> = { ...assets };

  for (const [assetId, asset] of Object.entries(assets)) {
    if (!asset.ports || asset.ports.length === 0) continue;
    const assetLinks = portLinks.get(assetId);
    let assetChanged = false;
    const nextPorts = asset.ports.map(port => {
      const link = assetLinks?.get(port.id);
      if (link) {
        if (
          port.status !== 'up' ||
          port.connectedCableId !== link.cableId ||
          port.connectedTarget?.deviceId !== link.peerDeviceId ||
          port.connectedTarget?.portId !== link.peerPortId
        ) {
          assetChanged = true;
          return {
            ...port,
            status: 'up' as const,
            connectedCableId: link.cableId,
            connectedTarget: {
              deviceId: link.peerDeviceId,
              portId: link.peerPortId
            }
          };
        }
        return port;
      }
      if (port.connectedCableId || port.connectedTarget || port.status === 'up') {
        assetChanged = true;
        return {
          ...port,
          status: port.status === 'down' ? ('down' as const) : ('unlinked' as const),
          connectedCableId: undefined,
          connectedTarget: undefined
        };
      }
      return port;
    });

    if (assetChanged) {
      changed = true;
      nextAssets[assetId] = { ...asset, ports: nextPorts };
    }
  }

  return changed ? nextAssets : assets;
}

/**
 * Pure immutable reducer applying batch obstacle-avoiding cable routes computed
 * either synchronously or off-thread by infrastructureCompute.worker.ts.
 */
export function applyBatchCableRouteUpdates(
  prev: ProjectState,
  updates: BatchCableRouteUpdate[]
): ProjectState {
  if (updates.length === 0) return prev;
  const updateMap = new Map(updates.map(u => [u.id, u]));
  return {
    ...prev,
    cables: prev.cables.map(c => {
      const patch = updateMap.get(c.id);
      if (!patch) return c;
      return {
        ...c,
        routingType: 'orthogonal',
        controlPoints: patch.controlPoints,
        lengthMeters: patch.lengthMeters
      };
    })
  };
}
