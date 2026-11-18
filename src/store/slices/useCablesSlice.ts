import { useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import { CableEdge, CablePoint, ProjectState, SelectionState } from '../../types/infrastructure';
import {
  AutoRouteObstacle,
  BatchCableRouteUpdate,
  computeAutoRoutedWaypoints,
  computeBatchProjectCableRoutes,
  estimateCableLengthMeters,
  getDefaultCableColorForType,
  normalizeCableColor
} from '../../utils/cableRouting';
import { applyBatchCableRouteUpdates, syncAssetPortsWithCables } from './rackDeviceHelpers';

export interface CablesSliceDeps {
  setSelection: Dispatch<SetStateAction<SelectionState>>;
  updateProject: (updater: (prev: ProjectState) => ProjectState) => void;
  updateProjectTransient: (updater: (prev: ProjectState) => ProjectState) => void;
}

export function useCablesSlice({
  setSelection,
  updateProject,
  updateProjectTransient
}: CablesSliceDeps) {
  const updateCable = useCallback(
    (cableId: string, partial: Partial<CableEdge>) => {
      const sanitized =
        partial.color !== undefined
          ? { ...partial, color: normalizeCableColor(partial.color) }
          : partial;
      updateProject(prev => {
        const nextCables = prev.cables.map(c => (c.id === cableId ? { ...c, ...sanitized } : c));
        const shouldSyncPorts =
          partial.sourcePortId !== undefined ||
          partial.targetPortId !== undefined ||
          partial.sourceNodeId !== undefined ||
          partial.targetNodeId !== undefined;
        return {
          ...prev,
          cables: nextCables,
          assets: shouldSyncPorts
            ? syncAssetPortsWithCables(prev.assets, prev.nodes, nextCables)
            : prev.assets
        };
      });
    },
    [updateProject]
  );

  const setCableColor = useCallback(
    (cableId: string, color: string) => {
      const normalized = normalizeCableColor(color);
      updateProject(prev => ({
        ...prev,
        cables: prev.cables.map(c => (c.id === cableId ? { ...c, color: normalized } : c))
      }));
    },
    [updateProject]
  );

  const setCablesColorByType = useCallback(
    (cableType: CableEdge['cableType'], color: string) => {
      const normalized = normalizeCableColor(color);
      updateProject(prev => ({
        ...prev,
        cables: prev.cables.map(c => (c.cableType === cableType ? { ...c, color: normalized } : c))
      }));
    },
    [updateProject]
  );

  const updateCableControlPointsTransient = useCallback(
    (cableId: string, controlPoints: CablePoint[]) => {
      updateProjectTransient(prev => ({
        ...prev,
        cables: prev.cables.map(c => {
          if (c.id !== cableId) return c;
          const src = prev.nodes.find(n => n.id === c.sourceNodeId);
          const tgt = prev.nodes.find(n => n.id === c.targetNodeId);
          const nextCable: CableEdge = { ...c, controlPoints };
          if (src && tgt) {
            nextCable.lengthMeters = estimateCableLengthMeters(
              nextCable,
              src,
              tgt,
              prev.settings.scale || 30
            );
          }
          return nextCable;
        })
      }));
    },
    [updateProjectTransient]
  );

  const reconnectCableEndpoint = useCallback(
    (cableId: string, endpoint: 'source' | 'target', newNodeId: string) => {
      updateProject(prev => {
        const targetCable = prev.cables.find(c => c.id === cableId);
        if (!targetCable) return prev;
        if (endpoint === 'source' && targetCable.targetNodeId === newNodeId) return prev;
        if (endpoint === 'target' && targetCable.sourceNodeId === newNodeId) return prev;

        const nextCables = prev.cables.map(c => {
          if (c.id !== cableId) return c;
          const updated: CableEdge =
            endpoint === 'source'
              ? { ...c, sourceNodeId: newNodeId, sourcePortId: undefined }
              : { ...c, targetNodeId: newNodeId, targetPortId: undefined };
          const src = prev.nodes.find(n => n.id === updated.sourceNodeId);
          const tgt = prev.nodes.find(n => n.id === updated.targetNodeId);
          if (src && tgt) {
            updated.lengthMeters = estimateCableLengthMeters(
              updated,
              src,
              tgt,
              prev.settings.scale || 30
            );
          }
          return updated;
        });
        return {
          ...prev,
          cables: nextCables,
          assets: syncAssetPortsWithCables(prev.assets, prev.nodes, nextCables)
        };
      });
    },
    [updateProject]
  );

  const deleteCable = useCallback(
    (cableId: string) => {
      updateProject(prev => {
        const nextCables = prev.cables.filter(c => c.id !== cableId);
        return {
          ...prev,
          cables: nextCables,
          assets: syncAssetPortsWithCables(prev.assets, prev.nodes, nextCables)
        };
      });
      setSelection({ type: 'none' });
    },
    [updateProject, setSelection]
  );

  const addCable = useCallback(
    (
      sourceNodeId: string,
      targetNodeId: string,
      sourcePortId?: string,
      targetPortId?: string,
      options?: {
        cableType?: CableEdge['cableType'];
        color?: string;
        routingType?: CableEdge['routingType'];
      }
    ) => {
      if (sourceNodeId === targetNodeId) return;

      updateProject(prev => {
        const src = prev.nodes.find(n => n.id === sourceNodeId);
        const tgt = prev.nodes.find(n => n.id === targetNodeId);
        const srcAsset = src?.assetId ? prev.assets[src.assetId] : undefined;
        const tgtAsset = tgt?.assetId ? prev.assets[tgt.assetId] : undefined;

        const resolvedSourcePortId =
          sourcePortId ||
          srcAsset?.ports.find(p => p.status === 'unlinked' && !p.connectedCableId)?.id;
        const resolvedTargetPortId =
          targetPortId ||
          tgtAsset?.ports.find(p => p.status === 'unlinked' && !p.connectedCableId)?.id;

        const resolvedType: CableEdge['cableType'] = options?.cableType || 'CAT6_UTP';
        const resolvedColor = normalizeCableColor(
          options?.color || getDefaultCableColorForType(resolvedType)
        );
        const resolvedRouting: CableEdge['routingType'] = options?.routingType || 'orthogonal';
        const newCableCode = `CAB-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
        const newCable: CableEdge = {
          id: `cable_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          cableCode: newCableCode,
          diagramMode: prev.activeMode,
          sourceNodeId,
          sourcePortId: resolvedSourcePortId,
          targetNodeId,
          targetPortId: resolvedTargetPortId,
          cableType: resolvedType,
          bandwidth: '1G',
          color: resolvedColor,
          routingType: resolvedRouting,
          lineStyle: 'solid',
          strokeWidth: 2,
          lengthMeters: 15,
          status: 'active'
        };
        if (src && tgt) {
          newCable.lengthMeters = estimateCableLengthMeters(
            newCable,
            src,
            tgt,
            prev.settings.scale || 30
          );
        }

        const nextCables = [...prev.cables, newCable];
        return {
          ...prev,
          cables: nextCables,
          assets: syncAssetPortsWithCables(prev.assets, prev.nodes, nextCables)
        };
      });
    },
    [updateProject]
  );

  const autoRouteCable = useCallback(
    (cableId: string) => {
      let avoidedCount = 0;
      updateProject(prev => {
        const targetCable = prev.cables.find(c => c.id === cableId);
        if (!targetCable) return prev;
        const src = prev.nodes.find(n => n.id === targetCable.sourceNodeId);
        const tgt = prev.nodes.find(n => n.id === targetCable.targetNodeId);
        if (!src || !tgt) return prev;

        const obstacles: AutoRouteObstacle[] = prev.nodes
          .filter(n => {
            if (n.id === src.id || n.id === tgt.id) return false;
            if (n.type === 'zone' || n.type === 'text') return false;
            if (n.diagramMode !== targetCable.diagramMode) return false;
            if (prev.activeFloorId && n.floorId && n.floorId !== prev.activeFloorId) return false;
            return true;
          })
          .map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));

        const preferredTrays = (prev.cableTrays || []).filter(
          t => !prev.activeFloorId || !t.floorId || t.floorId === prev.activeFloorId
        );

        const route = computeAutoRoutedWaypoints(src, tgt, obstacles, {
          gridSize: prev.settings.gridSize || 20,
          clearancePx: 22,
          preferredTrays
        });
        avoidedCount = route.avoidedObstacles;

        return {
          ...prev,
          cables: prev.cables.map(c => {
            if (c.id !== cableId) return c;
            const updated: CableEdge = {
              ...c,
              routingType: 'orthogonal',
              controlPoints: route.controlPoints
            };
            updated.lengthMeters = estimateCableLengthMeters(
              updated,
              src,
              tgt,
              prev.settings.scale || 30
            );
            return updated;
          })
        };
      });
      return { avoidedObstacles: avoidedCount };
    },
    [updateProject]
  );

  const applyBatchCableRoutes = useCallback(
    (updates: BatchCableRouteUpdate[]) => {
      if (updates.length === 0) return;
      updateProject(prev => applyBatchCableRouteUpdates(prev, updates));
    },
    [updateProject]
  );

  const autoRouteAllCables = useCallback(() => {
    let routedCount = 0;
    updateProject(prev => {
      const updates = computeBatchProjectCableRoutes(prev);
      routedCount = updates.length;
      return applyBatchCableRouteUpdates(prev, updates);
    });
    return { routedCount };
  }, [updateProject]);

  return useMemo(
    () => ({
      updateCable,
      setCableColor,
      setCablesColorByType,
      updateCableControlPointsTransient,
      reconnectCableEndpoint,
      deleteCable,
      addCable,
      autoRouteCable,
      autoRouteAllCables,
      applyBatchCableRoutes
    }),
    [
      updateCable,
      setCableColor,
      setCablesColorByType,
      updateCableControlPointsTransient,
      reconnectCableEndpoint,
      deleteCable,
      addCable,
      autoRouteCable,
      autoRouteAllCables,
      applyBatchCableRoutes
    ]
  );
}
