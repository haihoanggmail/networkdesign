import {
  CableEdge,
  DeviceAsset,
  DiagramNode,
  Floor,
  ProjectState,
  Room,
  SelectionState,
  ServerRack
} from '../types/infrastructure';
import { isRackMountedTopologyShadowNode } from './rackGeometry';

export function resolveRackForDiagramNode(
  project: ProjectState,
  node?: DiagramNode
): ServerRack | undefined {
  if (!node) return undefined;
  const asset = node.assetId ? project.assets[node.assetId] : undefined;
  const candidateId = node.customData?.rackId || asset?.id;
  return project.racks.find(
    r =>
      (candidateId && r.id === candidateId) ||
      r.id === node.id ||
      (node.label && r.name === node.label)
  );
}

export function resolveDiagramNodeForRack(
  project: ProjectState,
  rackId: string
): DiagramNode | undefined {
  const candidates = project.nodes.filter(
    n =>
      n.type === 'rack' &&
      (n.customData?.rackId === rackId || n.id === rackId || n.assetId === rackId)
  );
  if (candidates.length === 0) {
    const rack = project.racks.find(r => r.id === rackId);
    if (!rack) return undefined;
    return project.nodes.find(n => n.type === 'rack' && n.label === rack.name);
  }
  return (
    candidates.find(
      n =>
        (!project.activeFloorId || !n.floorId || n.floorId === project.activeFloorId) &&
        n.diagramMode === project.activeMode
    ) ||
    candidates.find(n => !project.activeFloorId || !n.floorId || n.floorId === project.activeFloorId) ||
    candidates[0]
  );
}

export function resolveCanonicalSelection(
  type: SelectionState['type'],
  id: string | undefined,
  project: ProjectState,
  additionalIds?: string[]
): SelectionState {
  if (!id || type === 'none' || type === 'canvas') {
    return { type };
  }

  if (type === 'rack') {
    const directRack = project.racks.find(r => r.id === id);
    if (directRack) {
      return { type: 'rack', id: directRack.id };
    }
    const rackNode = project.nodes.find(
      n => n.id === id || n.customData?.rackId === id
    );
    if (rackNode) {
      const matchedRack = resolveRackForDiagramNode(project, rackNode);
      if (matchedRack) {
        return { type: 'rack', id: matchedRack.id };
      }
      return { type: 'node', id: rackNode.id };
    }
    return { type: 'rack', id };
  }

  if (type === 'node') {
    if (additionalIds && additionalIds.length > 0) {
      const dedupedAdditional = Array.from(new Set(additionalIds.filter(aid => aid && aid !== id)));
      return {
        type: 'node',
        id,
        ...(dedupedAdditional.length > 0 ? { additionalIds: dedupedAdditional } : {})
      };
    }

    const node = project.nodes.find(n => n.id === id);
    if (node) {
      const asset = node.assetId ? project.assets[node.assetId] : undefined;
      if (node.type === 'rack' || Boolean(node.customData?.rackId) || asset?.category === 'rack') {
        const matchedRack = resolveRackForDiagramNode(project, node);
        if (matchedRack) {
          return { type: 'rack', id: matchedRack.id };
        }
      }
      return { type: 'node', id: node.id };
    }

    const fallbackRack = project.racks.find(r => r.id === id);
    if (fallbackRack) {
      return { type: 'rack', id: fallbackRack.id };
    }
    return { type: 'node', id };
  }

  return { type, id };
}

export interface InspectorTargets {
  selectedRack?: ServerRack;
  selectedNode?: DiagramNode;
  selectedAsset?: DeviceAsset;
  selectedCable?: CableEdge;
  selectedRoom?: Room;
  selectedFloor?: Floor;
  selectedNodeIds: string[];
}

export function resolveInspectorTargets(
  selection: SelectionState,
  project: ProjectState
): InspectorTargets {
  let selectedRack =
    selection.type === 'rack' && selection.id
      ? project.racks.find(r => r.id === selection.id)
      : undefined;

  let selectedNode =
    selection.type === 'node' && selection.id
      ? project.nodes.find(n => n.id === selection.id)
      : undefined;

  if (!selectedNode && selectedRack) {
    selectedNode = resolveDiagramNodeForRack(project, selectedRack.id);
  }

  const selectedAsset = selectedNode?.assetId
    ? project.assets[selectedNode.assetId]
    : undefined;

  if (
    !selectedRack &&
    (selectedNode?.type === 'rack' ||
      selectedAsset?.category === 'rack' ||
      selectedNode?.label?.toLowerCase().includes('rack') ||
      selectedAsset?.model?.includes('42U'))
  ) {
    selectedRack = resolveRackForDiagramNode(project, selectedNode);
  }

  const selectedCable =
    selection.type === 'edge' && selection.id
      ? project.cables.find(c => c.id === selection.id)
      : undefined;

  const selectedRoom =
    selection.type === 'room' && selection.id
      ? project.rooms.find(r => r.id === selection.id)
      : undefined;

  const selectedFloor =
    selection.type === 'floor' && selection.id
      ? project.floors.find(f => f.id === selection.id)
      : undefined;

  const selectedNodeIds =
    selection.type === 'node' && selection.id
      ? Array.from(new Set([selection.id, ...(selection.additionalIds || [])]))
      : [];

  return {
    selectedRack,
    selectedNode,
    selectedAsset,
    selectedCable,
    selectedRoom,
    selectedFloor,
    selectedNodeIds
  };
}

export function resolve3DHighlightedIds(
  selection: SelectionState | string | undefined,
  project: ProjectState,
  shadowToRackNodeId?: Map<string, string>
): {
  highlightedNodeIds: Set<string>;
  highlightedRackIds: Set<string>;
  highlightedCableIds: Set<string>;
} {
  const highlightedNodeIds = new Set<string>();
  const highlightedRackIds = new Set<string>();
  const highlightedCableIds = new Set<string>();

  if (!selection) {
    return { highlightedNodeIds, highlightedRackIds, highlightedCableIds };
  }

  if (typeof selection === 'string') {
    highlightedNodeIds.add(selection);
    highlightedRackIds.add(selection);
    highlightedCableIds.add(selection);
    const mappedRackNodeId = shadowToRackNodeId?.get(selection);
    if (mappedRackNodeId) {
      highlightedNodeIds.add(mappedRackNodeId);
    }
    return { highlightedNodeIds, highlightedRackIds, highlightedCableIds };
  }

  if (!selection.id || selection.type === 'none' || selection.type === 'canvas') {
    return { highlightedNodeIds, highlightedRackIds, highlightedCableIds };
  }

  if (selection.type === 'edge') {
    highlightedCableIds.add(selection.id);
    return { highlightedNodeIds, highlightedRackIds, highlightedCableIds };
  }

  if (selection.type === 'rack') {
    highlightedRackIds.add(selection.id);
    project.nodes.forEach(n => {
      if (n.type === 'rack' && (n.customData?.rackId === selection.id || n.id === selection.id)) {
        highlightedNodeIds.add(n.id);
      }
    });
    return { highlightedNodeIds, highlightedRackIds, highlightedCableIds };
  }

  if (selection.type === 'node') {
    const allIds = [selection.id, ...(selection.additionalIds || [])];
    allIds.forEach(nodeId => {
      highlightedNodeIds.add(nodeId);
      const mappedRackNodeId = shadowToRackNodeId?.get(nodeId);
      if (mappedRackNodeId) {
        highlightedNodeIds.add(mappedRackNodeId);
      }
      const node = project.nodes.find(n => n.id === nodeId);
      if (node?.type === 'rack') {
        const rack = resolveRackForDiagramNode(project, node);
        if (rack) {
          highlightedRackIds.add(rack.id);
        }
      }
      // Also resolve mounted asset's rack in case node is not in shadowToRackNodeId map
      const asset = node?.assetId ? project.assets[node.assetId] : undefined;
      if (asset?.rackId) {
        const isFloorBased = ['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode);
        if (isFloorBased) {
          const floorplanRackNodes = project.nodes.filter(
            rn => rn.type === 'rack' && rn.diagramMode === 'floorplan'
          );
          if (
            node &&
            isRackMountedTopologyShadowNode(node, project.assets, floorplanRackNodes, project.racks)
          ) {
            highlightedRackIds.add(asset.rackId);
          }
        }
      }
    });
  }

  return { highlightedNodeIds, highlightedRackIds, highlightedCableIds };
}

export function resolveSelectionFloorId(
  selection: SelectionState,
  project: ProjectState
): string | undefined {
  if (!selection.id) return undefined;

  if (selection.type === 'floor') {
    return project.floors.some(f => f.id === selection.id) ? selection.id : undefined;
  }
  if (selection.type === 'room') {
    return project.rooms.find(r => r.id === selection.id)?.floorId;
  }
  if (selection.type === 'rack') {
    const rack = project.racks.find(r => r.id === selection.id);
    if (rack?.floorId) return rack.floorId;
    return resolveDiagramNodeForRack(project, selection.id)?.floorId;
  }
  if (selection.type === 'node') {
    const node = project.nodes.find(n => n.id === selection.id);
    if (node?.floorId) return node.floorId;
    const asset = node?.assetId ? project.assets[node.assetId] : undefined;
    return asset?.floorId;
  }
  if (selection.type === 'edge') {
    const cable = project.cables.find(c => c.id === selection.id);
    if (!cable) return undefined;
    const srcNode = project.nodes.find(n => n.id === cable.sourceNodeId);
    if (srcNode?.floorId) return srcNode.floorId;
    const tgtNode = project.nodes.find(n => n.id === cable.targetNodeId);
    return tgtNode?.floorId;
  }
  return undefined;
}

export function resolveTargetSelectionForAssetOrNode(
  idOrAssetId: string,
  project: ProjectState
): {
  selection: SelectionState;
  node?: DiagramNode;
  rack?: ServerRack;
  floorId?: string;
} | null {
  if (!idOrAssetId) return null;

  const directRack = project.racks.find(r => r.id === idOrAssetId);
  if (directRack) {
    const rackNode = resolveDiagramNodeForRack(project, directRack.id);
    return {
      selection: { type: 'rack', id: directRack.id },
      node: rackNode,
      rack: directRack,
      floorId: rackNode?.floorId || directRack.floorId
    };
  }

  const directNode = project.nodes.find(n => n.id === idOrAssetId);
  if (directNode) {
    const canonical = resolveCanonicalSelection('node', directNode.id, project);
    const matchedRack =
      canonical.type === 'rack' && canonical.id
        ? project.racks.find(r => r.id === canonical.id)
        : undefined;
    const asset = directNode.assetId ? project.assets[directNode.assetId] : undefined;
    return {
      selection: canonical,
      node: directNode,
      rack: matchedRack,
      floorId: directNode.floorId || asset?.floorId
    };
  }

  const assetNodes = project.nodes.filter(n => n.assetId === idOrAssetId);
  const assetNode =
    assetNodes.find(
      n =>
        n.diagramMode === project.activeMode &&
        (!project.activeFloorId || !n.floorId || n.floorId === project.activeFloorId)
    ) ||
    assetNodes.find(n => n.diagramMode === project.activeMode) ||
    assetNodes[0];
  if (assetNode) {
    const canonical = resolveCanonicalSelection('node', assetNode.id, project);
    const matchedRack =
      canonical.type === 'rack' && canonical.id
        ? project.racks.find(r => r.id === canonical.id)
        : undefined;
    const asset = project.assets[idOrAssetId];
    return {
      selection: canonical,
      node: assetNode,
      rack: matchedRack,
      floorId: assetNode.floorId || asset?.floorId
    };
  }

  const mountedAsset = project.assets[idOrAssetId];
  if (mountedAsset?.rackId) {
    const enclosingRack = project.racks.find(r => r.id === mountedAsset.rackId);
    if (enclosingRack) {
      const rackNode = resolveDiagramNodeForRack(project, enclosingRack.id);
      return {
        selection: { type: 'rack', id: enclosingRack.id },
        node: rackNode,
        rack: enclosingRack,
        floorId: rackNode?.floorId || enclosingRack.floorId || mountedAsset.floorId
      };
    }
  }

  return null;
}

export function shouldFocusInspectorOnSelectionChange(
  prev: SelectionState,
  next: SelectionState
): boolean {
  if (next.type === 'none' || next.type === 'canvas' || !next.id) {
    return false;
  }
  const prevAdd = (prev.additionalIds || []).join(',');
  const nextAdd = (next.additionalIds || []).join(',');
  return prev.type !== next.type || prev.id !== next.id || prevAdd !== nextAdd;
}
