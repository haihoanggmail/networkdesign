import { useState, useEffect, useCallback, useRef } from 'react';
import {
  ProjectState,
  ProjectSummary,
  SelectionState,
  DesignMode,
  DiagramNode,
  CableEdge,
  CablePoint,
  DeviceAsset,
  Room,
  Floor,
  ServerRack,
  Building,
  RackSide,
  CanvasLayerId,
  VlanSpec,
  SubnetSpec,
  PatchLink,
  ProjectRevision
} from '../types/infrastructure';
import { createFiveStoreyBuildingProject, ARCHITECTURE_TEMPLATES } from '../data/templates';
import { DEVICE_CATALOG, CustomDevicePreset, createDeviceAssetFromPreset } from '../data/deviceCatalog';
import {
  getAssetUHeight,
  canPlaceDeviceAtU,
  clampStartU,
  findNearestAvailableU,
  getCanvasRackHeight,
  clampRackUnits
} from '../utils/rackGeometry';
import { resolveCanonicalSelection } from '../utils/selectionSync';
import {
  PRIMARY_STORAGE_KEY,
  RECOVERY_STORAGE_KEY,
  CURRENT_SCHEMA_VERSION,
  DEFAULT_CANVAS_SETTINGS,
  safeLoadFromStorage,
  saveProjectToDB,
  listProjectsFromDB,
  loadProjectFromDB,
  setProjectTrashStateInDB,
  deleteProjectPermanentlyFromDB,
  requestPersistentStorage,
  getMetaValue,
  setMetaValue,
  migrateAndValidateProject,
  saveRevisionToDB,
  listRevisionsFromDB,
  deleteRevisionFromDB,
  saveRecoverySnapshot,
  loadLatestValidRecoverySnapshot
} from '../utils/projectStorage';
import { createSaveCoordinator, SaveCoordinator } from '../utils/saveCoordinator';
import {
  estimateCableLengthMeters,
  getDefaultCableColorForType,
  normalizeCableColor,
  computeAutoRoutedWaypoints,
  AutoRouteObstacle
} from '../utils/cableRouting';
import {
  computeSnapToGridAutoAlign,
  SnapToGridAlignMode
} from '../utils/snapGuides';
import {
  buildProjectLegendData,
  computeRecommendedLegendSize
} from '../utils/legendGenerator';
import {
  autoAssignTopologyIps,
  AutoAssignIpResult,
  findNextAvailableIpInProject,
  isIpAssignableCategory
} from '../utils/ipAutoAssign';
import {
  AutoLayeringSummary,
  classifyDeviceLayer,
  computeAutoLayeringPlan,
  isNodePositionLocked,
  resolveNodeLayer
} from '../utils/layerPolicy';

export type CanvasTool = 'select' | 'pan' | 'connect' | 'room' | 'rack' | 'cable' | 'text' | 'measure';

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

const MAX_HISTORY_STEPS = 40;
const AUTOSAVE_DEBOUNCE_MS = 750;

function areStatesStructurallyEqual(a: ProjectState, b: ProjectState): boolean {
  if (a === b) return true;
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.author === b.author &&
    a.version === b.version &&
    a.activeMode === b.activeMode &&
    a.activeBuildingId === b.activeBuildingId &&
    a.activeFloorId === b.activeFloorId &&
    a.buildings === b.buildings &&
    a.floors === b.floors &&
    a.rooms === b.rooms &&
    a.racks === b.racks &&
    a.assets === b.assets &&
    a.nodes === b.nodes &&
    a.cables === b.cables &&
    a.vlans === b.vlans &&
    a.subnets === b.subnets &&
    a.patchLinks === b.patchLinks &&
    a.settings === b.settings
  );
}

export function createEmptyProject(name = 'HACHIHI Dự án Mới'): ProjectState {
  const now = new Date().toISOString();
  return {
    id: `proj_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    name,
    author: 'Kỹ sư Hạ tầng',
    version: '4.1.0',
    schemaVersion: CURRENT_SCHEMA_VERSION,
    lastModified: now,
    lastSavedAt: now,
    buildings: [],
    floors: [
      {
        id: 'flr_1',
        buildingId: 'bld_1',
        level: 1,
        name: 'Tầng 1 - Mặt bằng chính',
        description: 'Mặt bằng thiết kế mặc định',
        widthMeters: 30,
        depthMeters: 20
      }
    ],
    rooms: [],
    racks: [],
    assets: {},
    nodes: [],
    cables: [],
    activeMode: 'topology',
    activeBuildingId: 'bld_1',
    activeFloorId: 'flr_1',
    settings: { ...DEFAULT_CANVAS_SETTINGS }
  };
}

function loadSyncFallbackProject(): { project: ProjectState; hadLegacyLocal: boolean } {
  const fromPrimary = safeLoadFromStorage(PRIMARY_STORAGE_KEY);
  if (fromPrimary) return { project: fromPrimary, hadLegacyLocal: true };
  const fromRing = loadLatestValidRecoverySnapshot();
  if (fromRing) return { project: fromRing.project, hadLegacyLocal: true };
  const fromRecovery = safeLoadFromStorage(RECOVERY_STORAGE_KEY);
  if (fromRecovery) return { project: fromRecovery, hadLegacyLocal: true };
  const fallback = createFiveStoreyBuildingProject();
  return {
    project: {
      ...fallback,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      lastSavedAt: new Date().toISOString()
    },
    hadLegacyLocal: false
  };
}

export function useProjectStore() {
  const [initialBoot] = useState(() => loadSyncFallbackProject());

  // Primary Project State
  const [project, setProject] = useState<ProjectState>(initialBoot.project);
  const projectRef = useRef<ProjectState>(project);
  projectRef.current = project;
  const [projectList, setProjectList] = useState<ProjectSummary[]>([]);
  const [showWelcomeModal, setShowWelcomeModal] = useState<boolean>(false);

  // History stack using structural sharing (no JSON.stringify per step)
  const [history, setHistory] = useState<ProjectState[]>([initialBoot.project]);
  const [historyIndex, setHistoryIndex] = useState<number>(0);
  const historyRef = useRef<ProjectState[]>([initialBoot.project]);
  const historyIndexRef = useRef<number>(0);
  const dragPreSnapshotRef = useRef<ProjectState | null>(null);
  const isInteractingRef = useRef<boolean>(false);

  // Save state tracking
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string>(
    initialBoot.project.lastSavedAt || new Date().toISOString()
  );
  const [lastBackupAt, setLastBackupAt] = useState<string | null>(null);
  const hydratedRef = useRef<boolean>(false);
  const suppressNextAutoSaveRef = useRef<boolean>(true);
  const dirtyTrackingRef = useRef<{ version: number }>({ version: 0 });
  const coordinatorRef = useRef<SaveCoordinator<ProjectState> | null>(null);

  // Active Tool & Selection
  const [activeTool, setActiveTool] = useState<CanvasTool>('select');
  const [selection, setSelection] = useState<SelectionState>({ type: 'none' });

  // Canvas Viewport transform
  const [zoom, setZoom] = useState<number>(1);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 50, y: 50 });

  // Connect Cable in-progress
  const [connectingSource, setConnectingSource] = useState<{ nodeId: string; portId?: string } | null>(null);

  // Deep edit inspection modal
  const [deepInspectId, setDeepInspectId] = useState<string | null>(null);

  // Named Project Revisions
  const [revisions, setRevisions] = useState<ProjectRevision[]>([]);
  // Copied node visual style (C3)
  const [copiedStyle, setCopiedStyle] = useState<DiagramNode['style'] | null>(null);

  const refreshRevisions = useCallback(async (targetProjectId?: string) => {
    const pid = targetProjectId || project.id;
    const list = await listRevisionsFromDB(pid);
    setRevisions(list);
    return list;
  }, [project.id]);

  useEffect(() => {
    let active = true;
    listRevisionsFromDB(project.id).then(list => {
      if (active) setRevisions(list);
    });
    return () => {
      active = false;
    };
  }, [project.id]);

  const refreshProjectList = useCallback(async () => {
    const list = await listProjectsFromDB();
    setProjectList(list);
    return list;
  }, []);

  if (!coordinatorRef.current) {
    coordinatorRef.current = createSaveCoordinator<ProjectState>({
      debounceMs: AUTOSAVE_DEBOUNCE_MS,
      stampSnapshot: (snap, savedAtIso) => ({
        ...snap,
        lastSavedAt: savedAtIso
      }),
      onPersist: async (stampedSnapshot) => saveProjectToDB(stampedSnapshot),
      onPersistSuccess: (stampedSnapshot) => {
        saveRecoverySnapshot(stampedSnapshot, 'autosave');
        void refreshProjectList();
      },
      onStatusChange: (status) => {
        setHasUnsavedChanges(status.hasUnsavedChanges);
        setIsSaving(status.isSaving);
        setStorageError(status.storageError);
        if (status.lastSavedAt) {
          setLastSavedAt(status.lastSavedAt);
        }
      },
      shouldDeferAutoSave: () => isInteractingRef.current
    });
    coordinatorRef.current.reset(
      initialBoot.project,
      initialBoot.project.lastSavedAt || new Date().toISOString()
    );
  }

  // Hydrate from IndexedDB on initial mount & migrate legacy localStorage if present
  useEffect(() => {
    let active = true;
    (async () => {
      await requestPersistentStorage();
      const [existingList, activeId, savedBackupAt, seenWelcome] = await Promise.all([
        listProjectsFromDB(),
        getMetaValue<string>('activeProjectId'),
        getMetaValue<string>('lastFullBackupAt'),
        getMetaValue<boolean>('hasSeenWelcome')
      ]);

      if (!active) return;
      if (savedBackupAt) setLastBackupAt(savedBackupAt);

      if (existingList.length === 0) {
        // First-time IndexedDB setup: migrate legacy localStorage or seed starter
        await saveProjectToDB(initialBoot.project);
        saveRecoverySnapshot(initialBoot.project, 'autosave');
        const updatedList = await listProjectsFromDB();
        if (!active) return;
        setProjectList(updatedList);
        if (!initialBoot.hadLegacyLocal && !seenWelcome) {
          setShowWelcomeModal(true);
        }
      } else {
        setProjectList(existingList);
        const nonTrashed = existingList.filter(p => !p.isTrashed);
        const targetId =
          (activeId && nonTrashed.some(p => p.id === activeId) ? activeId : undefined) ||
          nonTrashed[0]?.id;

        if (targetId) {
          const loaded = await loadProjectFromDB(targetId);
          if (loaded && active) {
            suppressNextAutoSaveRef.current = true;
            projectRef.current = loaded;
            setProject(loaded);
            historyRef.current = [loaded];
            historyIndexRef.current = 0;
            setHistory([loaded]);
            setHistoryIndex(0);
            const loadedSavedAt = loaded.lastSavedAt || loaded.lastModified;
            coordinatorRef.current?.reset(loaded, loadedSavedAt);
            setLastSavedAt(loadedSavedAt);
            setHasUnsavedChanges(false);
          }
        }
      }
      hydratedRef.current = true;
    })();

    return () => {
      active = false;
    };
  }, [initialBoot]);

  // Trigger single-flight serialized Save Coordinator whenever committed project edits change
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (isInteractingRef.current) return;
    if (suppressNextAutoSaveRef.current) {
      suppressNextAutoSaveRef.current = false;
      return;
    }
    coordinatorRef.current?.scheduleSave(project);
  }, [project]);

  useEffect(() => {
    return () => {
      coordinatorRef.current?.dispose();
    };
  }, []);

  // Protect pending edits on tab close/reload with synchronous verified recovery snapshot
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      const status = coordinatorRef.current?.getStatus();
      if (status?.hasUnsavedChanges || status?.isSaving || storageError) {
        saveRecoverySnapshot(projectRef.current, 'crash_guard');
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [storageError]);

  const dismissWelcomeModal = useCallback(async () => {
    setShowWelcomeModal(false);
    await setMetaValue('hasSeenWelcome', true);
  }, []);

  const recordFullBackup = useCallback(async () => {
    const now = new Date().toISOString();
    setLastBackupAt(now);
    await setMetaValue('lastFullBackupAt', now);
  }, []);

  // Push structural snapshot onto Undo/Redo stack
  const pushHistoryState = useCallback((nextState: ProjectState, baseOverride?: ProjectState) => {
    const currentStack = historyRef.current;
    const currentIdx = historyIndexRef.current;
    const compareTarget = baseOverride || currentStack[currentIdx];

    if (compareTarget && areStatesStructurallyEqual(compareTarget, nextState)) {
      return;
    }

    const stamped: ProjectState = {
      ...nextState,
      lastModified: new Date().toISOString()
    };

    const truncated = currentStack.slice(0, currentIdx + 1);
    const updatedStack = [...truncated, stamped].slice(-MAX_HISTORY_STEPS);
    const nextIdx = updatedStack.length - 1;

    historyRef.current = updatedStack;
    historyIndexRef.current = nextIdx;
    setHistory(updatedStack);
    setHistoryIndex(nextIdx);
    dirtyTrackingRef.current.version += 1;
    setHasUnsavedChanges(true);
  }, []);

  const updateProject = useCallback((updater: (prev: ProjectState) => ProjectState) => {
    setProject(prev => {
      const next = updater(prev);
      if (areStatesStructurallyEqual(prev, next)) return prev;
      const stamped: ProjectState = {
        ...next,
        lastModified: new Date().toISOString()
      };
      projectRef.current = stamped;
      pushHistoryState(stamped, prev);
      return stamped;
    });
  }, [pushHistoryState]);

  const updateProjectTransient = useCallback((updater: (prev: ProjectState) => ProjectState) => {
    setProject(prev => {
      const next = updater(prev);
      projectRef.current = next;
      return next;
    });
  }, []);

  const beginDragSnapshot = useCallback(() => {
    isInteractingRef.current = true;
    setProject(current => {
      dragPreSnapshotRef.current = current;
      return current;
    });
  }, []);

  const commitDragSnapshot = useCallback(() => {
    isInteractingRef.current = false;
    const preSnap = dragPreSnapshotRef.current;
    dragPreSnapshotRef.current = null;
    if (!preSnap) return;

    setProject(current => {
      if (areStatesStructurallyEqual(preSnap, current)) {
        return current;
      }
      const stack = historyRef.current;
      const idx = historyIndexRef.current;
      if (!stack[idx] || !areStatesStructurallyEqual(stack[idx], preSnap)) {
        const baseTruncated = stack.slice(0, idx + 1);
        baseTruncated.push(preSnap);
        historyRef.current = baseTruncated.slice(-MAX_HISTORY_STEPS);
        historyIndexRef.current = historyRef.current.length - 1;
      }
      const stamped: ProjectState = {
        ...current,
        lastModified: new Date().toISOString()
      };
      pushHistoryState(stamped, preSnap);
      return stamped;
    });
  }, [pushHistoryState]);

  const undo = useCallback(() => {
    const currentIdx = historyIndexRef.current;
    if (currentIdx > 0) {
      const nextIdx = currentIdx - 1;
      const targetState = historyRef.current[nextIdx];
      if (targetState) {
        historyIndexRef.current = nextIdx;
        setHistoryIndex(nextIdx);
        setProject(targetState);
      }
    }
  }, []);

  const redo = useCallback(() => {
    const currentIdx = historyIndexRef.current;
    if (currentIdx < historyRef.current.length - 1) {
      const nextIdx = currentIdx + 1;
      const targetState = historyRef.current[nextIdx];
      if (targetState) {
        historyIndexRef.current = nextIdx;
        setHistoryIndex(nextIdx);
        setProject(targetState);
      }
    }
  }, []);

  const flushPendingSave = useCallback(async () => {
    if (!coordinatorRef.current) return { ok: true, error: null, committedVersion: 0, dirtyVersion: 0 };
    return coordinatorRef.current.flush(projectRef.current);
  }, []);

  const markSaved = useCallback(async () => {
    const coordinator = coordinatorRef.current;
    if (!coordinator) return;
    const res = await coordinator.saveNow(projectRef.current);
    if (res.ok) {
      const stamped = { ...projectRef.current, lastSavedAt: coordinator.getStatus().lastSavedAt || new Date().toISOString() };
      suppressNextAutoSaveRef.current = true;
      projectRef.current = stamped;
      setProject(stamped);
      saveRecoverySnapshot(stamped, 'manual');
    }
  }, []);

  const resetHistoryToProject = useCallback((proj: ProjectState) => {
    suppressNextAutoSaveRef.current = true;
    projectRef.current = proj;
    historyRef.current = [proj];
    historyIndexRef.current = 0;
    setHistory([proj]);
    setHistoryIndex(0);
    setProject(proj);
    setSelection({ type: 'none' });
    coordinatorRef.current?.reset(proj, proj.lastSavedAt || proj.lastModified);
    setHasUnsavedChanges(false);
    setStorageError(null);
    setZoom(1);
    setPan({ x: 50, y: 50 });
  }, []);

  // Multi-Project Hub Operations
  const switchProject = useCallback(async (projectId: string) => {
    if (projectId !== projectRef.current.id) {
      await flushPendingSave();
    }
    const loaded = await loadProjectFromDB(projectId);
    if (!loaded) return false;
    await setMetaValue('activeProjectId', projectId);
    resetHistoryToProject(loaded);
    saveRecoverySnapshot(loaded, 'pre_switch');
    setLastSavedAt(loaded.lastSavedAt || loaded.lastModified);
    return true;
  }, [flushPendingSave, resetHistoryToProject]);

  const createBlankProject = useCallback(async (name = 'HACHIHI Bản vẽ mới') => {
    await flushPendingSave();
    const emptyProj = createEmptyProject(name);
    await saveProjectToDB(emptyProj);
    saveRecoverySnapshot(emptyProj, 'manual');
    await refreshProjectList();
    resetHistoryToProject(emptyProj);
    setShowWelcomeModal(false);
    await setMetaValue('hasSeenWelcome', true);
  }, [flushPendingSave, refreshProjectList, resetHistoryToProject]);

  const trashProject = useCallback(async (projectId: string) => {
    if (projectId === projectRef.current.id) {
      await flushPendingSave();
    }
    await setProjectTrashStateInDB(projectId, true);
    const updated = await refreshProjectList();
    if (projectId === projectRef.current.id) {
      const nextActive = updated.find(p => !p.isTrashed);
      if (nextActive) {
        await switchProject(nextActive.id);
      } else {
        await createBlankProject();
      }
    }
  }, [flushPendingSave, refreshProjectList, switchProject, createBlankProject]);

  const restoreProject = useCallback(async (projectId: string) => {
    await setProjectTrashStateInDB(projectId, false);
    await refreshProjectList();
  }, [refreshProjectList]);

  const deleteProjectPermanently = useCallback(async (projectId: string) => {
    await deleteProjectPermanentlyFromDB(projectId);
    await refreshProjectList();
  }, [refreshProjectList]);

  const updateProjectMeta = useCallback((meta: Partial<Pick<ProjectState, 'name' | 'author' | 'version'>>) => {
    updateProject(prev => ({
      ...prev,
      ...meta
    }));
  }, [updateProject]);

  const duplicateProject = useCallback(async () => {
    await flushPendingSave();
    const current = projectRef.current;
    const now = new Date().toISOString();
    const cloned: ProjectState = {
      ...structuredClone(current),
      id: `proj_${Date.now()}`,
      name: `${current.name} (Bản sao)`,
      lastModified: now,
      lastSavedAt: now
    };
    await saveProjectToDB(cloned);
    saveRecoverySnapshot(cloned, 'manual');
    await refreshProjectList();
    resetHistoryToProject(cloned);
  }, [flushPendingSave, refreshProjectList, resetHistoryToProject]);

  const importValidatedProject = useCallback((rawJson: unknown) => {
    const res = migrateAndValidateProject(rawJson);
    if (!res.ok) return res;
    saveRecoverySnapshot(projectRef.current, 'pre_switch');
    resetHistoryToProject(res.project);
    void saveProjectToDB(res.project).then(r => {
      if (r.ok) saveRecoverySnapshot(res.project, 'autosave');
      void refreshProjectList();
    });
    return res;
  }, [resetHistoryToProject, refreshProjectList]);

  const commitImportedProject = useCallback(async (importedProject: ProjectState) => {
    await flushPendingSave();
    saveRecoverySnapshot(projectRef.current, 'pre_switch');
    resetHistoryToProject(importedProject);
    const res = await saveProjectToDB(importedProject);
    if (res.ok) {
      saveRecoverySnapshot(importedProject, 'manual');
    }
    await setMetaValue('activeProjectId', importedProject.id);
    setLastSavedAt(importedProject.lastSavedAt || importedProject.lastModified);
    setShowWelcomeModal(false);
    await setMetaValue('hasSeenWelcome', true);
    await refreshProjectList();
  }, [flushPendingSave, resetHistoryToProject, refreshProjectList]);

  // Mode change
  const setDesignMode = useCallback((mode: DesignMode, options?: { preserveSelection?: boolean }) => {
    const modeChanged = projectRef.current.activeMode !== mode;
    updateProject(prev => {
      if (prev.activeMode === mode) return prev;
      return { ...prev, activeMode: mode };
    });
    if (modeChanged && !options?.preserveSelection) {
      setSelection({ type: 'none' });
    }
  }, [updateProject]);

  // Floor navigation
  const setActiveFloor = useCallback((floorId: string, options?: { preserveSelection?: boolean }) => {
    const floorChanged = projectRef.current.activeFloorId !== floorId;
    updateProject(prev => {
      if (prev.activeFloorId === floorId) return prev;
      return { ...prev, activeFloorId: floorId };
    });
    if (floorChanged && !options?.preserveSelection) {
      setSelection({ type: 'none' });
    }
  }, [updateProject]);

  // Select item (canonically synced across 2D canvas, 3D scene, and property inspector)
  const selectItem = useCallback((type: SelectionState['type'], id?: string, additionalIds?: string[]) => {
    setSelection(resolveCanonicalSelection(type, id, projectRef.current, additionalIds));
  }, []);

  const toggleNodeSelection = useCallback((nodeId: string) => {
    setSelection(prev => {
      if (prev.type !== 'node' || !prev.id) {
        return { type: 'node', id: nodeId };
      }
      const existing = [prev.id, ...(prev.additionalIds || [])];
      if (existing.includes(nodeId)) {
        const remaining = existing.filter(id => id !== nodeId);
        if (remaining.length === 0) return { type: 'none' };
        return { type: 'node', id: remaining[0], additionalIds: remaining.slice(1) };
      }
      return { type: 'node', id: prev.id, additionalIds: [...(prev.additionalIds || []), nodeId] };
    });
  }, []);

  const selectMultipleNodes = useCallback((nodeIds: string[]) => {
    const unique = Array.from(new Set(nodeIds));
    if (unique.length === 0) {
      setSelection({ type: 'none' });
      return;
    }
    setSelection({
      type: 'node',
      id: unique[0],
      additionalIds: unique.slice(1)
    });
  }, []);

  const clearSelection = useCallback(() => {
    setSelection({ type: 'none' });
  }, []);

  // Update central device asset
  const updateDeviceAsset = useCallback((assetId: string, partial: Partial<DeviceAsset>) => {
    updateProject(prev => {
      const currentAsset = prev.assets[assetId];
      if (!currentAsset) return prev;
      const updatedAsset = { ...currentAsset, ...partial };

      const updatedNodes = prev.nodes.map(n => {
        if (n.assetId !== assetId) return n;
        const patch: Partial<DiagramNode> = {};
        if (partial.name !== undefined) patch.label = partial.name;
        if ('customIcon' in partial) patch.customIcon = partial.customIcon;
        if ('customImageUrl' in partial) patch.customImageUrl = partial.customImageUrl;
        return Object.keys(patch).length > 0 ? { ...n, ...patch } : n;
      });

      return {
        ...prev,
        assets: {
          ...prev.assets,
          [assetId]: updatedAsset
        },
        nodes: updatedNodes
      };
    });
  }, [updateProject]);

  // Update Diagram Node (and sync custom icon/logo back to linked asset if present)
  const updateNode = useCallback((nodeId: string, partial: Partial<DiagramNode>) => {
    updateProject(prev => {
      const targetNode = prev.nodes.find(n => n.id === nodeId);
      const nextNodes = prev.nodes.map(n => n.id === nodeId ? { ...n, ...partial } : n);
      let nextAssets = prev.assets;

      if (targetNode?.assetId && prev.assets[targetNode.assetId] && ('customIcon' in partial || 'customImageUrl' in partial || partial.label !== undefined)) {
        const asset = prev.assets[targetNode.assetId];
        const assetPatch: Partial<DeviceAsset> = {};
        if ('customIcon' in partial) assetPatch.customIcon = partial.customIcon;
        if ('customImageUrl' in partial) assetPatch.customImageUrl = partial.customImageUrl;
        if (partial.label !== undefined) assetPatch.name = partial.label;
        nextAssets = {
          ...prev.assets,
          [asset.id]: { ...asset, ...assetPatch }
        };
      }

      return {
        ...prev,
        assets: nextAssets,
        nodes: nextNodes
      };
    });
  }, [updateProject]);

  const setNodeIconOrLogo = useCallback((
    nodeId: string,
    visual: { customIcon?: string; customImageUrl?: string }
  ) => {
    updateNode(nodeId, {
      customIcon: visual.customIcon,
      customImageUrl: visual.customImageUrl
    });
  }, [updateNode]);

  const toggleNodeLock = useCallback((nodeIds: string[]) => {
    if (nodeIds.length === 0) return;
    const idSet = new Set(nodeIds);
    updateProject(prev => {
      const targets = prev.nodes.filter(n => idSet.has(n.id));
      const allLocked = targets.length > 0 && targets.every(n => isNodePositionLocked(n));
      const nextLocked = !allLocked;
      return {
        ...prev,
        nodes: prev.nodes.map(n =>
          idSet.has(n.id)
            ? {
                ...n,
                locked: nextLocked,
                customData: {
                  ...(n.customData || {}),
                  locked: nextLocked
                }
              }
            : n
        )
      };
    });
  }, [updateProject]);

  const toggleLayerVisibility = useCallback((layerId: CanvasLayerId) => {
    updateProject(prev => {
      const hidden = prev.settings.hiddenLayers || [];
      const nextHidden = hidden.includes(layerId)
        ? hidden.filter(l => l !== layerId)
        : [...hidden, layerId];
      return {
        ...prev,
        settings: {
          ...prev.settings,
          hiddenLayers: nextHidden
        }
      };
    });
  }, [updateProject]);

  const toggleLayerLock = useCallback((layerId: CanvasLayerId) => {
    updateProject(prev => {
      const locked = prev.settings.lockedLayers || [];
      const nextLocked = locked.includes(layerId)
        ? locked.filter(l => l !== layerId)
        : [...locked, layerId];
      return {
        ...prev,
        settings: {
          ...prev.settings,
          lockedLayers: nextLocked
        }
      };
    });
  }, [updateProject]);

  // Auto-Layering: classifies all nodes by device type into Network / IoT / Electrical / Racks / Labels
  const autoAssignDeviceLayers = useCallback((): AutoLayeringSummary => {
    const currentSnapshot = historyRef.current[historyIndexRef.current] || project;
    const plan = computeAutoLayeringPlan(currentSnapshot);
    updateProject(prev => {
      const nextPlan = computeAutoLayeringPlan(prev);
      return {
        ...prev,
        nodes: nextPlan.nodes
      };
    });
    return plan.summary;
  }, [project, updateProject]);

  // Smooth transient Wi-Fi coverage radius update (meters) for interactive canvas drag-resize
  const updateWifiCoverageRadiusTransient = useCallback((nodeId: string, radiusMeters: number) => {
    const clamped = Math.max(2, Math.min(80, Math.round(radiusMeters * 2) / 2));
    updateProjectTransient(prev => {
      const targetNode = prev.nodes.find(n => n.id === nodeId);
      if (!targetNode || isNodePositionLocked(targetNode)) return prev;
      const lockedLayers = prev.settings.lockedLayers || [];
      if (lockedLayers.includes(resolveNodeLayer(targetNode, prev.assets)) || lockedLayers.includes('wifi')) {
        return prev;
      }

      const nextNodes = prev.nodes.map(n =>
        n.id === nodeId
          ? {
              ...n,
              customData: {
                ...n.customData,
                coverageRadiusMeters: clamped
              }
            }
          : n
      );

      let nextAssets = prev.assets;
      if (targetNode.assetId && prev.assets[targetNode.assetId]) {
        const asset = prev.assets[targetNode.assetId];
        nextAssets = {
          ...prev.assets,
          [asset.id]: {
            ...asset,
            wifiSpecs: asset.wifiSpecs
              ? { ...asset.wifiSpecs, coverageRadiusMeters: clamped }
              : asset.category === 'ap'
              ? {
                  standard: 'Wi-Fi 6 (802.11ax)',
                  bands: '2.4GHz + 5GHz',
                  txPowerDbm: 22,
                  coverageRadiusMeters: clamped,
                  maxClients: 200,
                  ssid: 'HACHIHI-WIFI'
                }
              : undefined
          }
        };
      }

      return {
        ...prev,
        nodes: nextNodes,
        assets: nextAssets
      };
    });
  }, [updateProjectTransient]);

  // Move unlocked single or multiple nodes smoothly during drag (transient)
  const moveNodesTransient = useCallback((nodeIds: string[], dx: number, dy: number) => {
    if ((dx === 0 && dy === 0) || nodeIds.length === 0) return;
    const idSet = new Set(nodeIds);
    updateProjectTransient(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (!idSet.has(n.id) || isNodePositionLocked(n)) return n;
        const lockedLayers = prev.settings.lockedLayers || [];
        const layer = resolveNodeLayer(n, prev.assets);
        if (lockedLayers.includes(layer)) return n;
        return {
          ...n,
          x: Math.max(10, n.x + dx),
          y: Math.max(10, n.y + dy)
        };
      })
    }));
  }, [updateProjectTransient]);

  const snapNodesAndCommitDrag = useCallback((nodeIds: string[], options?: { snapX?: boolean; snapY?: boolean }) => {
    const idSet = new Set(nodeIds);
    const shouldSnapX = options?.snapX ?? true;
    const shouldSnapY = options?.snapY ?? true;
    updateProjectTransient(prev => {
      const snap = prev.settings.snapToGrid ? prev.settings.gridSize : 1;
      if (snap <= 1 || (!shouldSnapX && !shouldSnapY) || nodeIds.length === 0) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map(n => {
          if (!idSet.has(n.id) || isNodePositionLocked(n)) return n;
          return {
            ...n,
            x: shouldSnapX ? Math.max(10, Math.round(n.x / snap) * snap) : n.x,
            y: shouldSnapY ? Math.max(10, Math.round(n.y / snap) * snap) : n.y
          };
        })
      };
    });
    commitDragSnapshot();
  }, [updateProjectTransient, commitDragSnapshot]);

  const moveNode = useCallback((nodeId: string, dx: number, dy: number) => {
    updateProject(prev => {
      const snap = prev.settings.snapToGrid ? prev.settings.gridSize : 1;
      return {
        ...prev,
        nodes: prev.nodes.map(n => {
          if (n.id !== nodeId || isNodePositionLocked(n)) return n;
          const rawX = n.x + dx;
          const rawY = n.y + dy;
          const snappedX = Math.round(rawX / snap) * snap;
          const snappedY = Math.round(rawY / snap) * snap;
          return { ...n, x: Math.max(10, snappedX), y: Math.max(10, snappedY) };
        })
      };
    });
  }, [updateProject]);

  // Smooth transient resize of a single unlocked node (device, shape, legend, or rack)
  const resizeNodeTransient = useCallback((
    nodeId: string,
    rect: { x: number; y: number; width: number; height: number }
  ) => {
    updateProjectTransient(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (n.id !== nodeId || isNodePositionLocked(n)) return n;
        const minW = n.type === 'rack' ? 210 : n.type === 'legend' ? 220 : 44;
        const minH = n.type === 'rack' || n.type === 'legend' ? 120 : 36;
        return {
          ...n,
          x: Math.max(10, rect.x),
          y: Math.max(10, rect.y),
          width: Math.max(minW, Math.round(rect.width)),
          height: Math.max(minH, Math.round(rect.height))
        };
      })
    }));
  }, [updateProjectTransient]);

  const snapNodeResizeAndCommit = useCallback((nodeId: string) => {
    updateProjectTransient(prev => {
      const snap = prev.settings.snapToGrid ? Math.max(5, Math.round(prev.settings.gridSize / 2)) : 1;
      if (snap <= 1) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map(n => {
          if (n.id !== nodeId || isNodePositionLocked(n)) return n;
          const minW = n.type === 'rack' ? 210 : n.type === 'legend' ? 220 : 44;
          const minH = n.type === 'rack' || n.type === 'legend' ? 120 : 36;
          return {
            ...n,
            x: Math.max(10, Math.round(n.x / snap) * snap),
            y: Math.max(10, Math.round(n.y / snap) * snap),
            width: Math.max(minW, Math.round(n.width / snap) * snap),
            height: Math.max(minH, Math.round(n.height / snap) * snap)
          };
        })
      };
    });
    commitDragSnapshot();
  }, [updateProjectTransient, commitDragSnapshot]);

  // Rack Operations
  const addRack = useCallback((name: string, totalUnits = 42, x = 300, y = 80) => {
    const clampedUnits = clampRackUnits(totalUnits);
    const newRackId = `rack_${Date.now()}`;

    updateProject(prev => {
      const snap = prev.settings.snapToGrid ? Math.max(1, prev.settings.gridSize) : 1;
      const snappedX = Math.max(10, Math.round(x / snap) * snap);
      const snappedY = Math.max(10, Math.round(y / snap) * snap);
      const newRack: ServerRack = {
        id: newRackId,
        name,
        totalUnits: clampedUnits,
        widthMm: 800,
        depthMm: 1000,
        maxLoadKg: 1000,
        x: snappedX,
        y: snappedY,
        slots: {},
        rearSlots: {}
      };
      const rackNode: DiagramNode = {
        id: `node_${newRackId}`,
        diagramMode: prev.activeMode,
        floorId: prev.activeFloorId,
        type: 'rack',
        label: name,
        x: snappedX,
        y: snappedY,
        width: 300,
        height: getCanvasRackHeight(clampedUnits),
        rotation: 0,
        style: {
          backgroundColor: '#0f172a',
          borderColor: '#475569',
          borderWidth: 3,
          borderStyle: 'solid',
          opacity: 1,
          textColor: '#f8fafc'
        },
        customData: { rackId: newRackId, totalUnits: clampedUnits }
      };

      return {
        ...prev,
        racks: [...prev.racks, newRack],
        nodes: [...prev.nodes, rackNode]
      };
    });
    setSelection({ type: 'rack', id: newRackId });
  }, [updateProject]);

  const addDeviceFromCatalog = useCallback((presetName: string, dropX = 300, dropY = 200) => {
    const preset = DEVICE_CATALOG.find(p => p.name === presetName) || DEVICE_CATALOG[0];
    const snap = project.settings.snapToGrid ? project.settings.gridSize : 1;
    const snappedX = Math.round(dropX / snap) * snap;
    const snappedY = Math.round(dropY / snap) * snap;

    if (preset.category === 'rack') {
      addRack(preset.name, preset.defaultUHeight || 42, snappedX, snappedY);
      return;
    }

    const newNodeId = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    updateProject(prev => {
      const assetCount = Object.keys(prev.assets).length + 1;
      const newAsset = createDeviceAssetFromPreset(preset, assetCount);
      newAsset.buildingId = prev.activeBuildingId;
      newAsset.floorId = prev.activeFloorId;
      if (isIpAssignableCategory(newAsset.category)) {
        const nextIp = findNextAvailableIpInProject(prev, newAsset.category);
        if (nextIp) {
          if (nextIp.ipAddress) newAsset.ipAddress = nextIp.ipAddress;
          newAsset.subnetMask = nextIp.subnetMask;
          newAsset.gateway = nextIp.gateway;
        }
      }

      const nextAssets = { ...prev.assets, [newAsset.id]: newAsset };
      const draftNode: DiagramNode = {
        id: newNodeId,
        diagramMode: prev.activeMode,
        floorId: prev.activeFloorId,
        type: preset.category === 'cloud' ? 'cloud' : preset.category === 'telecom_tower' ? 'telecom_tower' : 'device',
        assetId: newAsset.id,
        label: newAsset.name,
        x: snappedX,
        y: snappedY,
        width: preset.defaultWidth,
        height: preset.defaultHeight,
        rotation: 0,
        style: {
          backgroundColor: preset.color,
          borderColor: '#334155',
          borderWidth: 2,
          borderStyle: 'solid',
          opacity: 1,
          textColor: '#ffffff',
          iconColor: '#ffffff'
        },
        customData: preset.category === 'camera' ? { fov: 95, irDistance: 30 } : preset.category === 'ap' ? { coverageRadiusMeters: 18 } : undefined
      };
      const newNode: DiagramNode = prev.settings.autoLayeringEnabled
        ? { ...draftNode, layerId: classifyDeviceLayer(draftNode, nextAssets) }
        : draftNode;

      return {
        ...prev,
        assets: nextAssets,
        nodes: [...prev.nodes, newNode]
      };
    });
    setSelection({ type: 'node', id: newNodeId });
  }, [project.settings.snapToGrid, project.settings.gridSize, updateProject, addRack]);

  const addCustomDevicePresetToCanvas = useCallback((preset: CustomDevicePreset, dropX = 300, dropY = 200) => {
    const snap = project.settings.snapToGrid ? project.settings.gridSize : 1;
    const snappedX = Math.round(dropX / snap) * snap;
    const snappedY = Math.round(dropY / snap) * snap;
    const createdNodeId = `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;

    updateProject(prev => {
      const assetCount = Object.keys(prev.assets).length + 1;
      const newAsset = createDeviceAssetFromPreset(preset, assetCount);
      newAsset.buildingId = prev.activeBuildingId;
      newAsset.floorId = prev.activeFloorId;
      if (isIpAssignableCategory(newAsset.category)) {
        const nextIp = findNextAvailableIpInProject(prev, newAsset.category);
        if (nextIp) {
          if (nextIp.ipAddress) newAsset.ipAddress = nextIp.ipAddress;
          newAsset.subnetMask = nextIp.subnetMask;
          newAsset.gateway = nextIp.gateway;
        }
      }
      if (preset.iconName) {
        newAsset.customIcon = preset.iconName;
      }

      const nextAssets = { ...prev.assets, [newAsset.id]: newAsset };
      const draftNode: DiagramNode = {
        id: createdNodeId,
        diagramMode: prev.activeMode,
        floorId: prev.activeFloorId,
        type: preset.category === 'cloud' ? 'cloud' : preset.category === 'telecom_tower' ? 'telecom_tower' : 'device',
        assetId: newAsset.id,
        label: newAsset.name,
        x: snappedX,
        y: snappedY,
        width: preset.defaultWidth || 150,
        height: preset.defaultHeight || 56,
        rotation: 0,
        customIcon: preset.iconName,
        style: {
          backgroundColor: preset.color || '#155EEF',
          borderColor: '#334155',
          borderWidth: 2,
          borderStyle: 'solid',
          opacity: 1,
          textColor: '#ffffff',
          iconColor: '#ffffff'
        },
        customData: preset.category === 'camera' ? { fov: 95, irDistance: 30 } : preset.category === 'ap' ? { coverageRadiusMeters: 18 } : undefined
      };
      const newNode: DiagramNode = prev.settings.autoLayeringEnabled
        ? { ...draftNode, layerId: classifyDeviceLayer(draftNode, nextAssets) }
        : draftNode;

      return {
        ...prev,
        assets: nextAssets,
        nodes: [...prev.nodes, newNode]
      };
    });

    setSelection({ type: 'node', id: createdNodeId });
  }, [project.settings.snapToGrid, project.settings.gridSize, updateProject]);

  const addTextNode = useCallback((dropX = 300, dropY = 200, label = 'Ghi chú kỹ thuật') => {
    const snap = project.settings.snapToGrid ? project.settings.gridSize : 1;
    const snappedX = Math.round(dropX / snap) * snap;
    const snappedY = Math.round(dropY / snap) * snap;
    const nodeId = `node_txt_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;

    updateProject(prev => {
      const newNode: DiagramNode = {
        id: nodeId,
        diagramMode: prev.activeMode,
        floorId: prev.activeFloorId,
        type: 'text',
        label,
        x: snappedX,
        y: snappedY,
        width: 180,
        height: 44,
        rotation: 0,
        style: {
          backgroundColor: '#FFFFFF',
          borderColor: '#CBD5E1',
          borderWidth: 1,
          borderStyle: 'dashed',
          opacity: 1,
          fontSize: 12,
          textColor: '#0F172A',
          shape: 'round'
        }
      };
      return {
        ...prev,
        nodes: [...prev.nodes, newNode]
      };
    });
    setSelection({ type: 'node', id: nodeId });
  }, [project.settings.snapToGrid, project.settings.gridSize, updateProject]);

  const addShapeNode = useCallback((
    kind: 'zone' | 'rect' | 'circle' | 'wall',
    dropX = 280,
    dropY = 180,
    customLabel?: string
  ) => {
    const snap = project.settings.snapToGrid ? project.settings.gridSize : 1;
    const snappedX = Math.round(dropX / snap) * snap;
    const snappedY = Math.round(dropY / snap) * snap;
    const nodeId = `node_shp_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`;

    updateProject(prev => {
      const defaults =
        kind === 'zone'
          ? { type: 'zone' as const, label: customLabel || 'Vùng mạng / VLAN Zone', w: 260, h: 160, bg: '#EFF6FF', border: '#155EEF', bStyle: 'dashed' as const, shape: 'round' as const, text: '#1E3A8A' }
          : kind === 'wall'
          ? { type: 'wall' as const, label: customLabel || 'Vách ngăn kỹ thuật', w: 220, h: 24, bg: '#334155', border: '#0F172A', bStyle: 'solid' as const, shape: 'rect' as const, text: '#FFFFFF' }
          : kind === 'circle'
          ? { type: 'zone' as const, label: customLabel || 'Điểm tập trung', w: 120, h: 120, bg: '#F8FAFC', border: '#475569', bStyle: 'solid' as const, shape: 'circle' as const, text: '#0F172A' }
          : { type: 'zone' as const, label: customLabel || 'Khối chức năng', w: 180, h: 100, bg: '#F8FAFC', border: '#64748B', bStyle: 'solid' as const, shape: 'rect' as const, text: '#0F172A' };

      const newNode: DiagramNode = {
        id: nodeId,
        diagramMode: prev.activeMode,
        floorId: prev.activeFloorId,
        type: defaults.type,
        label: defaults.label,
        x: snappedX,
        y: snappedY,
        width: defaults.w,
        height: defaults.h,
        rotation: 0,
        style: {
          backgroundColor: defaults.bg,
          borderColor: defaults.border,
          borderWidth: 2,
          borderStyle: defaults.bStyle,
          opacity: kind === 'zone' ? 0.85 : 1,
          textColor: defaults.text,
          shape: defaults.shape
        }
      };

      return {
        ...prev,
        nodes: [...prev.nodes, newNode]
      };
    });
    setSelection({ type: 'node', id: nodeId });
  }, [project.settings.snapToGrid, project.settings.gridSize, updateProject]);

  const toggleNodeVisibility = useCallback((nodeIds: string[], forceHidden?: boolean) => {
    if (nodeIds.length === 0) return;
    const idSet = new Set(nodeIds);
    updateProject(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => {
        if (!idSet.has(n.id)) return n;
        const nextHidden = forceHidden !== undefined ? forceHidden : !n.hidden;
        return { ...n, hidden: nextHidden ? true : undefined };
      })
    }));
    if (forceHidden !== false) {
      setSelection(prevSel => {
        if (prevSel.type === 'node' && prevSel.id && idSet.has(prevSel.id)) {
          return { type: 'none' };
        }
        return prevSel;
      });
    }
  }, [updateProject]);

  const deleteNodes = useCallback((nodeIds: string[]) => {
    if (nodeIds.length === 0) return;
    const deleteSet = new Set(nodeIds);
    updateProject(prev => {
      const nextNodes = prev.nodes.filter(n => !deleteSet.has(n.id));
      const nextCables = prev.cables.filter(
        c => !deleteSet.has(c.sourceNodeId) && !deleteSet.has(c.targetNodeId)
      );
      return {
        ...prev,
        nodes: nextNodes,
        cables: nextCables,
        assets: syncAssetPortsWithCables(prev.assets, nextNodes, nextCables)
      };
    });
    setSelection({ type: 'none' });
  }, [updateProject]);

  const deleteNode = useCallback((nodeId: string) => {
    deleteNodes([nodeId]);
  }, [deleteNodes]);

  const duplicateNodes = useCallback((nodeIds: string[]) => {
    if (nodeIds.length === 0) return;
    const idSet = new Set(nodeIds);
    const createdNodeIds: string[] = [];

    updateProject(prev => {
      const nextAssets = { ...prev.assets };
      const clonedNodes: DiagramNode[] = [];
      const nodeIdMap: Record<string, string> = {};
      const newGroupId = nodeIds.length > 1 ? `grp_${Date.now()}` : undefined;

      prev.nodes.filter(n => idSet.has(n.id)).forEach((orig, idx) => {
        const newNodeId = `node_dup_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 5)}`;
        nodeIdMap[orig.id] = newNodeId;
        createdNodeIds.push(newNodeId);

        let newAssetId = orig.assetId;
        if (orig.assetId && prev.assets[orig.assetId]) {
          const origAsset = prev.assets[orig.assetId];
          const clonedAssetId = `dev_dup_${Date.now()}_${idx}_${Math.random().toString(36).substring(2, 5)}`;
          nextAssets[clonedAssetId] = {
            ...structuredClone(origAsset),
            id: clonedAssetId,
            name: `${origAsset.name}-Copy`,
            assetTag: `${origAsset.assetTag}-C`,
            rackId: undefined,
            rackUnitStart: undefined
          };
          newAssetId = clonedAssetId;
        }

        clonedNodes.push({
          ...structuredClone(orig),
          id: newNodeId,
          assetId: newAssetId,
          locked: false,
          groupId: orig.groupId ? newGroupId : orig.groupId,
          label: `${orig.label}-Copy`,
          x: orig.x + 36,
          y: orig.y + 36
        });
      });

      const clonedCables: CableEdge[] = prev.cables
        .filter(c => nodeIdMap[c.sourceNodeId] && nodeIdMap[c.targetNodeId])
        .map((c, idx) => ({
          ...structuredClone(c),
          id: `cable_dup_${Date.now()}_${idx}`,
          cableCode: `${c.cableCode}-C`,
          sourceNodeId: nodeIdMap[c.sourceNodeId],
          targetNodeId: nodeIdMap[c.targetNodeId],
          controlPoints: c.controlPoints?.map(pt => ({ x: pt.x + 36, y: pt.y + 36 }))
        }));

      return {
        ...prev,
        assets: nextAssets,
        nodes: [...prev.nodes, ...clonedNodes],
        cables: [...prev.cables, ...clonedCables]
      };
    });

    if (createdNodeIds.length > 0) {
      setSelection({
        type: 'node',
        id: createdNodeIds[0],
        additionalIds: createdNodeIds.slice(1)
      });
    }
  }, [updateProject]);

  const nudgeNodes = useCallback((nodeIds: string[], dx: number, dy: number) => {
    if (nodeIds.length === 0 || (dx === 0 && dy === 0)) return;
    const idSet = new Set(nodeIds);
    updateProject(prev => {
      const nextNodes = prev.nodes.map(n =>
        idSet.has(n.id) && !isNodePositionLocked(n) ? { ...n, x: Math.round(n.x + dx), y: Math.round(n.y + dy) } : n
      );
      const nodeMap = new Map(nextNodes.map(n => [n.id, n]));
      const nextCables = prev.cables.map(c => {
        if (!idSet.has(c.sourceNodeId) && !idSet.has(c.targetNodeId)) return c;
        const src = nodeMap.get(c.sourceNodeId);
        const tgt = nodeMap.get(c.targetNodeId);
        if (!src || !tgt) return c;
        return {
          ...c,
          lengthMeters: estimateCableLengthMeters(c, src, tgt, prev.settings.scale || 30)
        };
      });
      return { ...prev, nodes: nextNodes, cables: nextCables };
    });
  }, [updateProject]);

  const copyNodeStyle = useCallback((nodeId: string) => {
    const found = project.nodes.find(n => n.id === nodeId);
    if (!found) return false;
    setCopiedStyle({ ...found.style });
    return true;
  }, [project.nodes]);

  const pasteNodeStyle = useCallback((nodeIds: string[]) => {
    if (!copiedStyle || nodeIds.length === 0) return false;
    const idSet = new Set(nodeIds);
    updateProject(prev => ({
      ...prev,
      nodes: prev.nodes.map(n =>
        idSet.has(n.id) ? { ...n, style: { ...n.style, ...copiedStyle } } : n
      )
    }));
    return true;
  }, [copiedStyle, updateProject]);

  const groupNodes = useCallback((nodeIds: string[]) => {
    if (nodeIds.length < 2) return;
    const groupId = `grp_${Date.now()}`;
    const idSet = new Set(nodeIds);
    updateProject(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => idSet.has(n.id) ? { ...n, groupId } : n)
    }));
  }, [updateProject]);

  const ungroupNodes = useCallback((nodeIds: string[]) => {
    if (nodeIds.length === 0) return;
    const idSet = new Set(nodeIds);
    updateProject(prev => ({
      ...prev,
      nodes: prev.nodes.map(n => idSet.has(n.id) ? { ...n, groupId: undefined } : n)
    }));
  }, [updateProject]);

  const alignNodes = useCallback((nodeIds: string[], alignment: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (nodeIds.length < 2) return;
    const idSet = new Set(nodeIds);
    updateProject(prev => {
      const targets = prev.nodes.filter(n => idSet.has(n.id));
      if (targets.length < 2) return prev;

      const minX = Math.min(...targets.map(n => n.x));
      const maxX = Math.max(...targets.map(n => n.x + n.width));
      const avgCenterX = (minX + maxX) / 2;
      const minY = Math.min(...targets.map(n => n.y));
      const maxY = Math.max(...targets.map(n => n.y + n.height));
      const avgCenterY = (minY + maxY) / 2;

      return {
        ...prev,
        nodes: prev.nodes.map(n => {
          if (!idSet.has(n.id) || isNodePositionLocked(n)) return n;
          switch (alignment) {
            case 'left': return { ...n, x: minX };
            case 'center': return { ...n, x: Math.round(avgCenterX - n.width / 2) };
            case 'right': return { ...n, x: maxX - n.width };
            case 'top': return { ...n, y: minY };
            case 'middle': return { ...n, y: Math.round(avgCenterY - n.height / 2) };
            case 'bottom': return { ...n, y: maxY - n.height };
            default: return n;
          }
        })
      };
    });
  }, [updateProject]);

  const distributeNodes = useCallback((nodeIds: string[], axis: 'horizontal' | 'vertical') => {
    if (nodeIds.length < 3) return;
    const idSet = new Set(nodeIds);
    updateProject(prev => {
      const targets = prev.nodes
        .filter(n => idSet.has(n.id))
        .sort((a, b) => axis === 'horizontal' ? a.x - b.x : a.y - b.y);
      if (targets.length < 3) return prev;

      const first = targets[0];
      const last = targets[targets.length - 1];
      const span = axis === 'horizontal' ? (last.x - first.x) : (last.y - first.y);
      const step = span / (targets.length - 1);
      const posMap = new Map<string, number>();
      targets.forEach((n, idx) => {
        posMap.set(n.id, Math.round((axis === 'horizontal' ? first.x : first.y) + step * idx));
      });

      return {
        ...prev,
        nodes: prev.nodes.map(n => {
          const val = posMap.get(n.id);
          if (val === undefined || isNodePositionLocked(n)) return n;
          return axis === 'horizontal' ? { ...n, x: val } : { ...n, y: val };
        })
      };
    });
  }, [updateProject]);

  const autoAlignNodesSnapToGrid = useCallback((
    nodeIds: string[],
    mode: SnapToGridAlignMode,
    options?: { evenSpacing?: boolean }
  ) => {
    if (nodeIds.length < 2 && mode !== 'grid-only') return;
    if (nodeIds.length === 0) return;
    const idSet = new Set(nodeIds);
    updateProject(prev => {
      const targets = prev.nodes.filter(n => idSet.has(n.id));
      const posMap = computeSnapToGridAutoAlign(
        targets,
        mode,
        prev.settings.gridSize || 20,
        { evenSpacing: options?.evenSpacing ?? true }
      );
      if (posMap.size === 0) return prev;
      return {
        ...prev,
        nodes: prev.nodes.map(n => {
          const nextPos = posMap.get(n.id);
          if (!nextPos || isNodePositionLocked(n)) return n;
          return { ...n, x: nextPos.x, y: nextPos.y };
        })
      };
    });
  }, [updateProject]);

  const generateOrUpdateLegendNode = useCallback((options?: {
    scope?: 'all' | 'activeFloor';
    includeCables?: boolean;
    title?: string;
    x?: number;
    y?: number;
  }) => {
    const currentSnapshot = projectRef.current;
    const preExisting = currentSnapshot.nodes.find(
      n =>
        n.type === 'legend' &&
        (!n.floorId || !currentSnapshot.activeFloorId || n.floorId === currentSnapshot.activeFloorId)
    );
    const createdLegendId = `node_legend_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
    const targetLegendId = preExisting?.id || createdLegendId;
    let resolvedLegendId = targetLegendId;

    updateProject(prev => {
      const existing = prev.nodes.find(
        n => n.type === 'legend' && (!n.floorId || !prev.activeFloorId || n.floorId === prev.activeFloorId)
      );
      if (existing) {
        resolvedLegendId = existing.id;
      }
      const scope = options?.scope ?? existing?.customData?.legendScope ?? 'all';
      const includeCables = options?.includeCables ?? existing?.customData?.legendIncludeCables ?? true;
      const title = options?.title ?? existing?.customData?.legendTitle ?? 'BẢNG CHÚ GIẢI KÝ HIỆU THIẾT BỊ';

      const data = buildProjectLegendData(prev, { scope, includeCables, title });
      const rec = computeRecommendedLegendSize(data);

      if (existing) {
        return {
          ...prev,
          nodes: prev.nodes.map(n =>
            n.id === existing.id
              ? {
                  ...n,
                  label: title,
                  width: Math.max(n.width, rec.width),
                  height: rec.height,
                  customData: {
                    ...n.customData,
                    legendScope: scope,
                    legendIncludeCables: includeCables,
                    legendTitle: title
                  }
                }
              : n
          )
        };
      }

      // Place cleanly to the right of existing nodes or at specified coordinates
      const nonLegendNodes = prev.nodes.filter(n => n.type !== 'legend');
      let defaultX = options?.x ?? 760;
      let defaultY = options?.y ?? 60;
      if (options?.x === undefined && nonLegendNodes.length > 0) {
        const maxRight = Math.max(...nonLegendNodes.map(n => n.x + n.width));
        const minTop = Math.min(...nonLegendNodes.map(n => n.y));
        defaultX = Math.max(40, Math.round((maxRight + 48) / 20) * 20);
        defaultY = Math.max(40, Math.round(minTop / 20) * 20);
      }

      const newLegendNode: DiagramNode = {
        id: createdLegendId,
        diagramMode: prev.activeMode,
        floorId: prev.activeFloorId || undefined,
        type: 'legend',
        label: title,
        x: defaultX,
        y: defaultY,
        width: rec.width,
        height: rec.height,
        rotation: 0,
        style: {
          backgroundColor: '#ffffff',
          borderColor: '#1d4ed8',
          borderWidth: 2,
          borderStyle: 'solid',
          opacity: 1,
          textColor: '#0f172a'
        },
        customData: {
          legendScope: scope,
          legendIncludeCables: includeCables,
          legendTitle: title
        }
      };

      resolvedLegendId = createdLegendId;
      return {
        ...prev,
        nodes: [...prev.nodes, newLegendNode]
      };
    });

    setSelection({ type: 'node', id: resolvedLegendId });
    queueMicrotask(() => {
      if (resolvedLegendId && resolvedLegendId !== targetLegendId) {
        setSelection({ type: 'node', id: resolvedLegendId });
      }
    });
  }, [updateProject]);

  const resizeLegendToFit = useCallback((nodeId: string) => {
    updateProject(prev => {
      const target = prev.nodes.find(n => n.id === nodeId && n.type === 'legend');
      if (!target) return prev;
      const data = buildProjectLegendData(prev, {
        scope: target.customData?.legendScope || 'all',
        includeCables: target.customData?.legendIncludeCables ?? true,
        title: target.customData?.legendTitle || target.label
      });
      const rec = computeRecommendedLegendSize(data);
      return {
        ...prev,
        nodes: prev.nodes.map(n =>
          n.id === nodeId ? { ...n, width: Math.max(300, rec.width), height: rec.height } : n
        )
      };
    });
  }, [updateProject]);

  // Cable Edge Operations
  const updateCable = useCallback((cableId: string, partial: Partial<CableEdge>) => {
    const sanitized = partial.color !== undefined
      ? { ...partial, color: normalizeCableColor(partial.color) }
      : partial;
    updateProject(prev => {
      const nextCables = prev.cables.map(c => c.id === cableId ? { ...c, ...sanitized } : c);
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
  }, [updateProject]);

  const setCableColor = useCallback((cableId: string, color: string) => {
    const normalized = normalizeCableColor(color);
    updateProject(prev => ({
      ...prev,
      cables: prev.cables.map(c => c.id === cableId ? { ...c, color: normalized } : c)
    }));
  }, [updateProject]);

  const setCablesColorByType = useCallback((cableType: CableEdge['cableType'], color: string) => {
    const normalized = normalizeCableColor(color);
    updateProject(prev => ({
      ...prev,
      cables: prev.cables.map(c => c.cableType === cableType ? { ...c, color: normalized } : c)
    }));
  }, [updateProject]);

  const updateCableControlPointsTransient = useCallback((cableId: string, controlPoints: CablePoint[]) => {
    updateProjectTransient(prev => ({
      ...prev,
      cables: prev.cables.map(c => {
        if (c.id !== cableId) return c;
        const src = prev.nodes.find(n => n.id === c.sourceNodeId);
        const tgt = prev.nodes.find(n => n.id === c.targetNodeId);
        const nextCable: CableEdge = { ...c, controlPoints };
        if (src && tgt) {
          nextCable.lengthMeters = estimateCableLengthMeters(nextCable, src, tgt, prev.settings.scale || 30);
        }
        return nextCable;
      })
    }));
  }, [updateProjectTransient]);

  const reconnectCableEndpoint = useCallback((cableId: string, endpoint: 'source' | 'target', newNodeId: string) => {
    updateProject(prev => {
      const targetCable = prev.cables.find(c => c.id === cableId);
      if (!targetCable) return prev;
      if (endpoint === 'source' && targetCable.targetNodeId === newNodeId) return prev;
      if (endpoint === 'target' && targetCable.sourceNodeId === newNodeId) return prev;

      const nextCables = prev.cables.map(c => {
        if (c.id !== cableId) return c;
        const updated: CableEdge = endpoint === 'source'
          ? { ...c, sourceNodeId: newNodeId, sourcePortId: undefined }
          : { ...c, targetNodeId: newNodeId, targetPortId: undefined };
        const src = prev.nodes.find(n => n.id === updated.sourceNodeId);
        const tgt = prev.nodes.find(n => n.id === updated.targetNodeId);
        if (src && tgt) {
          updated.lengthMeters = estimateCableLengthMeters(updated, src, tgt, prev.settings.scale || 30);
        }
        return updated;
      });
      return {
        ...prev,
        cables: nextCables,
        assets: syncAssetPortsWithCables(prev.assets, prev.nodes, nextCables)
      };
    });
  }, [updateProject]);

  const deleteCable = useCallback((cableId: string) => {
    updateProject(prev => {
      const nextCables = prev.cables.filter(c => c.id !== cableId);
      return {
        ...prev,
        cables: nextCables,
        assets: syncAssetPortsWithCables(prev.assets, prev.nodes, nextCables)
      };
    });
    setSelection({ type: 'none' });
  }, [updateProject]);

  const addCable = useCallback((
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
        newCable.lengthMeters = estimateCableLengthMeters(newCable, src, tgt, prev.settings.scale || 30);
      }

      const nextCables = [...prev.cables, newCable];
      return {
        ...prev,
        cables: nextCables,
        assets: syncAssetPortsWithCables(prev.assets, prev.nodes, nextCables)
      };
    });
  }, [updateProject]);

  const autoRouteCable = useCallback((cableId: string) => {
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
          updated.lengthMeters = estimateCableLengthMeters(updated, src, tgt, prev.settings.scale || 30);
          return updated;
        })
      };
    });
    return { avoidedObstacles: avoidedCount };
  }, [updateProject]);

  const autoRouteAllCables = useCallback(() => {
    let routedCount = 0;
    updateProject(prev => {
      const modeCables = prev.cables.filter(c => c.diagramMode === prev.activeMode);
      if (modeCables.length === 0) return prev;

      const occupiedSegments: Array<{ a: CablePoint; b: CablePoint }> = [];
      const preferredTrays = (prev.cableTrays || []).filter(
        t => !prev.activeFloorId || !t.floorId || t.floorId === prev.activeFloorId
      );
      const updatedMap = new Map<string, CableEdge>();

      for (const cable of modeCables) {
        const src = prev.nodes.find(n => n.id === cable.sourceNodeId);
        const tgt = prev.nodes.find(n => n.id === cable.targetNodeId);
        if (!src || !tgt) continue;
        if (prev.activeFloorId) {
          if ((src.floorId && src.floorId !== prev.activeFloorId) && (tgt.floorId && tgt.floorId !== prev.activeFloorId)) {
            continue;
          }
        }

        const obstacles: AutoRouteObstacle[] = prev.nodes
          .filter(n => {
            if (n.id === src.id || n.id === tgt.id) return false;
            if (n.type === 'zone' || n.type === 'text') return false;
            if (n.diagramMode !== cable.diagramMode) return false;
            if (prev.activeFloorId && n.floorId && n.floorId !== prev.activeFloorId) return false;
            return true;
          })
          .map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }));

        const route = computeAutoRoutedWaypoints(src, tgt, obstacles, {
          gridSize: prev.settings.gridSize || 20,
          clearancePx: 22,
          occupiedSegments,
          preferredTrays
        });

        const sCenter = { x: src.x + src.width / 2, y: src.y + src.height / 2 };
        const tCenter = { x: tgt.x + tgt.width / 2, y: tgt.y + tgt.height / 2 };
        const pts = [sCenter, ...route.controlPoints, tCenter];
        for (let i = 0; i < pts.length - 1; i++) {
          occupiedSegments.push({ a: pts[i], b: pts[i + 1] });
        }

        const updated: CableEdge = {
          ...cable,
          routingType: 'orthogonal',
          controlPoints: route.controlPoints
        };
        updated.lengthMeters = estimateCableLengthMeters(updated, src, tgt, prev.settings.scale || 30);
        updatedMap.set(cable.id, updated);
        routedCount++;
      }

      if (updatedMap.size === 0) return prev;
      return {
        ...prev,
        cables: prev.cables.map(c => updatedMap.get(c.id) || c)
      };
    });
    return { routedCount };
  }, [updateProject]);

  // Room Operations
  const addRoom = useCallback((room: Omit<Room, 'id'>) => {
    const newRoom: Room = {
      ...room,
      id: `rm_${Date.now()}`
    };
    updateProject(prev => ({
      ...prev,
      rooms: [...prev.rooms, newRoom]
    }));
    setSelection({ type: 'room', id: newRoom.id });
  }, [updateProject]);

  const updateRoom = useCallback((roomId: string, partial: Partial<Room>) => {
    updateProject(prev => ({
      ...prev,
      rooms: prev.rooms.map(r => r.id === roomId ? { ...r, ...partial } : r)
    }));
  }, [updateProject]);

  const moveRoomTransient = useCallback((roomId: string, dx: number, dy: number) => {
    if (dx === 0 && dy === 0) return;
    updateProjectTransient(prev => ({
      ...prev,
      rooms: prev.rooms.map(r => {
        if (r.id !== roomId || r.locked) return r;
        return {
          ...r,
          x: Math.max(10, r.x + dx),
          y: Math.max(10, r.y + dy)
        };
      })
    }));
  }, [updateProjectTransient]);

  const resizeRoomTransient = useCallback((
    roomId: string,
    rect: { x: number; y: number; width: number; height: number }
  ) => {
    updateProjectTransient(prev => ({
      ...prev,
      rooms: prev.rooms.map(r => {
        if (r.id !== roomId || r.locked) return r;
        return {
          ...r,
          x: Math.max(10, rect.x),
          y: Math.max(10, rect.y),
          width: Math.max(60, Math.round(rect.width)),
          height: Math.max(45, Math.round(rect.height))
        };
      })
    }));
  }, [updateProjectTransient]);

  const snapRoomAndCommit = useCallback((roomId: string) => {
    updateProjectTransient(prev => {
      const snap = prev.settings.snapToGrid ? Math.max(5, Math.round(prev.settings.gridSize / 2)) : 1;
      if (snap <= 1) return prev;
      return {
        ...prev,
        rooms: prev.rooms.map(r => {
          if (r.id !== roomId || r.locked) return r;
          return {
            ...r,
            x: Math.max(10, Math.round(r.x / snap) * snap),
            y: Math.max(10, Math.round(r.y / snap) * snap),
            width: Math.max(60, Math.round(r.width / snap) * snap),
            height: Math.max(45, Math.round(r.height / snap) * snap)
          };
        })
      };
    });
    commitDragSnapshot();
  }, [updateProjectTransient, commitDragSnapshot]);

  const deleteRoom = useCallback((roomId: string) => {
    updateProject(prev => ({
      ...prev,
      rooms: prev.rooms.filter(r => r.id !== roomId)
    }));
    setSelection({ type: 'none' });
  }, [updateProject]);

  const updateRack = useCallback((rackId: string, partial: Partial<ServerRack>) => {
    updateProject(prev => {
      const nextUnits = partial.totalUnits !== undefined ? clampRackUnits(partial.totalUnits) : undefined;
      const sanitizedPartial = nextUnits !== undefined ? { ...partial, totalUnits: nextUnits } : partial;

      const updatedRacks = prev.racks.map(r => r.id === rackId ? { ...r, ...sanitizedPartial } : r);
      const updatedNodes = prev.nodes.map(n => {
        if (n.type === 'rack' && (n.customData?.rackId === rackId || n.id === rackId)) {
          const resolvedUnits = nextUnits ?? n.customData?.totalUnits ?? 42;
          return {
            ...n,
            label: sanitizedPartial.name ?? n.label,
            height: nextUnits !== undefined ? getCanvasRackHeight(nextUnits) : n.height,
            customData: {
              ...n.customData,
              rackId,
              totalUnits: resolvedUnits
            }
          };
        }
        return n;
      });
      return {
        ...prev,
        racks: updatedRacks,
        nodes: updatedNodes
      };
    });
  }, [updateProject]);

  const assignDeviceToRackSlot = useCallback((
    rackId: string,
    assetId: string,
    preferredU: number,
    side: RackSide = 'front'
  ) => {
    updateProject(prev => {
      const targetRack = prev.racks.find(r => r.id === rackId);
      const targetAsset = prev.assets[assetId];
      if (!targetRack || !targetAsset) return prev;

      const totalUnits = targetRack.totalUnits || 42;
      const uHeight = getAssetUHeight(targetAsset);
      if (uHeight > totalUnits) return prev;

      const clampedU = clampStartU(preferredU, totalUnits, uHeight);
      if (!canPlaceDeviceAtU(targetRack, prev.assets, clampedU, uHeight, assetId, side)) {
        return prev;
      }

      const updatedRacks = prev.racks.map(r => {
        const cleanedFront: Record<number, string> = {};
        for (const [uStr, devId] of Object.entries(r.slots || {})) {
          if (devId && devId !== assetId) cleanedFront[parseInt(uStr, 10)] = devId;
        }
        const cleanedRear: Record<number, string> = {};
        for (const [uStr, devId] of Object.entries(r.rearSlots || {})) {
          if (devId && devId !== assetId) cleanedRear[parseInt(uStr, 10)] = devId;
        }

        if (r.id === rackId) {
          if (side === 'rear') cleanedRear[clampedU] = assetId;
          else cleanedFront[clampedU] = assetId;
        }
        return { ...r, slots: cleanedFront, rearSlots: cleanedRear };
      });

      const updatedAsset: DeviceAsset = {
        ...targetAsset,
        rackId,
        rackUnitStart: clampedU,
        rackUnitHeight: uHeight,
        rackSide: side
      };

      return {
        ...prev,
        racks: updatedRacks,
        assets: {
          ...prev.assets,
          [assetId]: updatedAsset
        }
      };
    });
  }, [updateProject]);

  const removeDeviceFromRackSlot = useCallback((
    rackId: string,
    assetIdOrU: string | number,
    side: RackSide = 'front'
  ) => {
    updateProject(prev => {
      const targetRack = prev.racks.find(r => r.id === rackId);
      if (!targetRack) return prev;

      let removedAssetId: string | undefined;
      const filterSlotMap = (slotMap: Record<number, string> | undefined, activeSideMatch: boolean) => {
        const nextMap: Record<number, string> = {};
        for (const [uStr, devId] of Object.entries(slotMap || {})) {
          const uNum = parseInt(uStr, 10);
          const matches = typeof assetIdOrU === 'number'
            ? (activeSideMatch && uNum === assetIdOrU)
            : devId === assetIdOrU;
          if (matches) {
            removedAssetId = devId;
          } else {
            nextMap[uNum] = devId;
          }
        }
        return nextMap;
      };

      const nextFront = filterSlotMap(targetRack.slots, side === 'front');
      const nextRear = filterSlotMap(targetRack.rearSlots, side === 'rear');

      const nextAssets = { ...prev.assets };
      if (removedAssetId && nextAssets[removedAssetId]) {
        nextAssets[removedAssetId] = {
          ...nextAssets[removedAssetId],
          rackId: undefined,
          rackUnitStart: undefined,
          rackSide: undefined
        };
      }

      return {
        ...prev,
        racks: prev.racks.map(r => r.id === rackId ? { ...r, slots: nextFront, rearSlots: nextRear } : r),
        assets: nextAssets
      };
    });
  }, [updateProject]);

  const addDeviceFromCatalogToRack = useCallback((
    presetName: string,
    rackId: string,
    preferredU: number,
    side: RackSide = 'front'
  ) => {
    const preset = DEVICE_CATALOG.find(p => p.name === presetName);
    if (!preset || preset.category === 'rack') return;

    updateProject(prev => {
      const targetRack = prev.racks.find(r => r.id === rackId);
      if (!targetRack) return prev;

      const assetCount = Object.keys(prev.assets).length + 1;
      const newAsset = createDeviceAssetFromPreset(preset, assetCount);
      const uHeight = preset.defaultUHeight >= 1 ? preset.defaultUHeight : 1;
      const targetU = findNearestAvailableU(targetRack, prev.assets, preferredU, uHeight, undefined, side);

      if (targetU === null) return prev;

      if (isIpAssignableCategory(newAsset.category)) {
        const nextIp = findNextAvailableIpInProject(prev, newAsset.category);
        if (nextIp) {
          if (nextIp.ipAddress) newAsset.ipAddress = nextIp.ipAddress;
          newAsset.subnetMask = nextIp.subnetMask;
          newAsset.gateway = nextIp.gateway;
        }
      }

      newAsset.rackId = rackId;
      newAsset.rackUnitStart = targetU;
      newAsset.rackUnitHeight = uHeight;
      newAsset.rackSide = side;
      newAsset.buildingId = targetRack.buildingId || prev.activeBuildingId;
      newAsset.floorId = targetRack.floorId || prev.activeFloorId;

      const rackNode = prev.nodes.find(n => n.type === 'rack' && (n.customData?.rackId === rackId || n.id === rackId));
      const existingCount = Object.keys(targetRack.slots || {}).length + Object.keys(targetRack.rearSlots || {}).length;

      const newNode: DiagramNode = {
        id: `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
        diagramMode: 'topology',
        floorId: newAsset.floorId,
        type: 'device',
        assetId: newAsset.id,
        label: newAsset.name,
        x: (rackNode?.x ?? targetRack.x ?? 300) + 340,
        y: (rackNode?.y ?? targetRack.y ?? 100) + (existingCount * 70),
        width: preset.defaultWidth,
        height: preset.defaultHeight,
        rotation: 0,
        style: {
          backgroundColor: preset.color,
          borderColor: '#334155',
          borderWidth: 2,
          borderStyle: 'solid',
          opacity: 1,
          textColor: '#ffffff',
          iconColor: '#ffffff'
        }
      };

      return {
        ...prev,
        assets: { ...prev.assets, [newAsset.id]: newAsset },
        nodes: [...prev.nodes, newNode],
        racks: prev.racks.map(r => {
          if (r.id !== rackId) return r;
          if (side === 'rear') {
            return { ...r, rearSlots: { ...(r.rearSlots || {}), [targetU]: newAsset.id } };
          }
          return { ...r, slots: { ...r.slots, [targetU]: newAsset.id } };
        })
      };
    });
  }, [updateProject]);

  const deleteRack = useCallback((rackId: string) => {
    updateProject(prev => {
      const updatedAssets = { ...prev.assets };
      Object.values(updatedAssets).forEach(a => {
        if (a.rackId === rackId) {
          updatedAssets[a.id] = { ...a, rackId: undefined, rackUnitStart: undefined, rackSide: undefined };
        }
      });

      return {
        ...prev,
        assets: updatedAssets,
        racks: prev.racks.filter(r => r.id !== rackId),
        nodes: prev.nodes.filter(n => !(n.type === 'rack' && n.customData?.rackId === rackId))
      };
    });
    setSelection({ type: 'none' });
  }, [updateProject]);

  // Multi-floor Building Generator
  const generateOrUpdateBuilding = useCallback((config: {
    name: string;
    totalFloors: number;
    basementFloors: number;
    widthMeters: number;
    depthMeters: number;
    floorHeightMeters: number;
    wallThicknessMm: number;
    layoutStyle: 'rectangle' | 'L-shape' | 'U-shape';
  }) => {
    updateProject(prev => {
      const existingBuilding = prev.buildings[0];
      const buildingId = existingBuilding?.id || `bld_${Date.now()}`;

      const newBuilding: Building = {
        id: buildingId,
        name: config.name,
        totalFloors: config.totalFloors,
        basementFloors: config.basementFloors,
        widthMeters: config.widthMeters,
        depthMeters: config.depthMeters,
        floorHeightMeters: config.floorHeightMeters,
        wallThicknessMm: config.wallThicknessMm,
        layoutStyle: config.layoutStyle
      };

      const existingFloorMap = new Map(prev.floors.map(f => [f.level, f]));
      const newFloors: Floor[] = [];

      for (let b = config.basementFloors; b >= 1; b--) {
        const level = -b;
        if (existingFloorMap.has(level)) {
          newFloors.push({
            ...existingFloorMap.get(level)!,
            widthMeters: config.widthMeters,
            depthMeters: config.depthMeters
          });
        } else {
          newFloors.push({
            id: `flr_b${b}_${Date.now()}`,
            buildingId,
            level,
            name: `Tầng hầm B${b} - Bãi xe & Phòng Kỹ thuật Điện`,
            description: 'Khu đỗ xe và trạm phân phối phụ trợ',
            widthMeters: config.widthMeters,
            depthMeters: config.depthMeters
          });
        }
      }

      for (let f = 1; f <= config.totalFloors; f++) {
        if (existingFloorMap.has(f)) {
          newFloors.push({
            ...existingFloorMap.get(f)!,
            widthMeters: config.widthMeters,
            depthMeters: config.depthMeters
          });
        } else {
          newFloors.push({
            id: `flr_${f}_${Date.now()}`,
            buildingId,
            level: f,
            name: `Tầng ${f} - Khu vực Mở rộng`,
            description: `Mặt bằng tầng ${f} phân phối`,
            widthMeters: config.widthMeters,
            depthMeters: config.depthMeters
          });
        }
      }

      const targetActiveFloorId = newFloors.some(fl => fl.id === prev.activeFloorId)
        ? prev.activeFloorId
        : newFloors[0]?.id || '';

      return {
        ...prev,
        buildings: [newBuilding],
        floors: newFloors,
        activeBuildingId: buildingId,
        activeFloorId: targetActiveFloorId
      };
    });
  }, [updateProject]);

  const cloneFloor = useCallback((sourceFloorId: string, newLevelNumber: number, newFloorName: string) => {
    updateProject(prev => {
      const sourceFloor = prev.floors.find(f => f.id === sourceFloorId);
      if (!sourceFloor) return prev;

      const newFloorId = `flr_${Date.now()}`;
      const newFloor: Floor = {
        ...sourceFloor,
        id: newFloorId,
        level: newLevelNumber,
        name: newFloorName
      };

      const clonedRooms: Room[] = prev.rooms
        .filter(r => r.floorId === sourceFloorId)
        .map(r => ({
          ...r,
          id: `rm_${Date.now()}_${Math.random().toString(36).substring(2, 5)}`,
          floorId: newFloorId
        }));

      const clonedAssets: Record<string, DeviceAsset> = { ...prev.assets };
      const clonedNodes: DiagramNode[] = [];

      prev.nodes
        .filter(n => n.floorId === sourceFloorId)
        .forEach(n => {
          let newAssetId: string | undefined = undefined;
          if (n.assetId && prev.assets[n.assetId]) {
            const originalAsset = prev.assets[n.assetId];
            const newAsset: DeviceAsset = {
              ...originalAsset,
              id: `asset_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              name: `${originalAsset.name}-L${newLevelNumber}`,
              floorId: newFloorId
            };
            clonedAssets[newAsset.id] = newAsset;
            newAssetId = newAsset.id;
          }

          clonedNodes.push({
            ...n,
            id: `node_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            floorId: newFloorId,
            assetId: newAssetId
          });
        });

      return {
        ...prev,
        floors: [...prev.floors, newFloor],
        rooms: [...prev.rooms, ...clonedRooms],
        assets: clonedAssets,
        nodes: [...prev.nodes, ...clonedNodes],
        activeFloorId: newFloorId
      };
    });
  }, [updateProject]);

  const loadTemplate = useCallback(async (templateId: string) => {
    const tpl = ARCHITECTURE_TEMPLATES.find(t => t.id === templateId);
    if (!tpl) return;
    await flushPendingSave();
    saveRecoverySnapshot(projectRef.current, 'pre_switch');
    const newProject: ProjectState = {
      ...tpl.createProject(),
      id: `proj_${Date.now()}`,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      lastSavedAt: new Date().toISOString()
    };
    resetHistoryToProject(newProject);
    const res = await saveProjectToDB(newProject);
    if (res.ok) {
      saveRecoverySnapshot(newProject, 'manual');
    }
    await refreshProjectList();
    setShowWelcomeModal(false);
    await setMetaValue('hasSeenWelcome', true);
  }, [flushPendingSave, resetHistoryToProject, refreshProjectList]);

  const resetCanvas = useCallback(async () => {
    await createBlankProject('HACHIHI Sơ đồ mới');
  }, [createBlankProject]);

  const updateSettings = useCallback((partial: Partial<ProjectState['settings']>) => {
    updateProject(prev => ({
      ...prev,
      settings: { ...prev.settings, ...partial }
    }));
  }, [updateProject]);

  const autoAssignIps = useCallback((options?: { preserveExistingValid?: boolean }): AutoAssignIpResult => {
    let result = autoAssignTopologyIps(project, options);
    updateProject(prev => {
      const computed = autoAssignTopologyIps(prev, options);
      result = computed;
      if (!computed.ok || (computed.assignedCount === 0 && computed.preservedCount === 0)) {
        return prev;
      }
      return {
        ...prev,
        assets: computed.updatedAssets
      };
    });
    return result;
  }, [project, updateProject]);

  // Named Version Checkpoints
  const createNamedRevision = useCallback(async (label: string, note?: string) => {
    const trimmed = label.trim() || `Mốc lưu ${new Date().toLocaleTimeString('vi-VN')}`;
    const snapshot = structuredClone(project);
    const rev: ProjectRevision = {
      id: `rev_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      projectId: project.id,
      label: trimmed,
      note: note?.trim() || undefined,
      createdAt: new Date().toISOString(),
      author: project.author || 'Kỹ sư Hạ tầng',
      nodeCount: snapshot.nodes.length,
      assetCount: Object.keys(snapshot.assets).length,
      rackCount: snapshot.racks.length,
      cableCount: snapshot.cables.length,
      snapshot
    };
    const ok = await saveRevisionToDB(rev);
    if (ok) {
      await refreshRevisions(project.id);
    }
    return ok ? rev : null;
  }, [project, refreshRevisions]);

  const restoreNamedRevision = useCallback(async (revisionId: string) => {
    const found = revisions.find(r => r.id === revisionId);
    if (!found) return false;
    await flushPendingSave();
    saveRecoverySnapshot(projectRef.current, 'pre_switch');
    const restored: ProjectState = {
      ...structuredClone(found.snapshot),
      id: projectRef.current.id,
      lastModified: new Date().toISOString(),
      lastSavedAt: new Date().toISOString()
    };
    resetHistoryToProject(restored);
    const res = await saveProjectToDB(restored);
    if (res.ok) {
      saveRecoverySnapshot(restored, 'manual');
    }
    await refreshProjectList();
    return true;
  }, [revisions, flushPendingSave, resetHistoryToProject, refreshProjectList]);

  const deleteNamedRevision = useCallback(async (revisionId: string) => {
    const ok = await deleteRevisionFromDB(revisionId);
    if (ok) {
      await refreshRevisions(project.id);
    }
    return ok;
  }, [project.id, refreshRevisions]);

  // VLAN, Subnet & Patch Panel Directory CRUD
  const upsertVlan = useCallback((spec: Omit<VlanSpec, 'id'> & { id?: string }) => {
    updateProject(prev => {
      const current = prev.vlans || [];
      const id = spec.id || `vlan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const entry: VlanSpec = { ...spec, id };
      const exists = current.some(v => v.id === id);
      return {
        ...prev,
        vlans: exists ? current.map(v => (v.id === id ? entry : v)) : [...current, entry]
      };
    });
  }, [updateProject]);

  const deleteVlan = useCallback((id: string) => {
    updateProject(prev => ({
      ...prev,
      vlans: (prev.vlans || []).filter(v => v.id !== id)
    }));
  }, [updateProject]);

  const upsertSubnet = useCallback((spec: Omit<SubnetSpec, 'id'> & { id?: string }) => {
    updateProject(prev => {
      const current = prev.subnets || [];
      const id = spec.id || `subnet_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const entry: SubnetSpec = { ...spec, id };
      const exists = current.some(s => s.id === id);
      return {
        ...prev,
        subnets: exists ? current.map(s => (s.id === id ? entry : s)) : [...current, entry]
      };
    });
  }, [updateProject]);

  const deleteSubnet = useCallback((id: string) => {
    updateProject(prev => ({
      ...prev,
      subnets: (prev.subnets || []).filter(s => s.id !== id)
    }));
  }, [updateProject]);

  const upsertPatchLink = useCallback((link: Omit<PatchLink, 'id'> & { id?: string }) => {
    updateProject(prev => {
      const current = prev.patchLinks || [];
      const id = link.id || `patch_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const entry: PatchLink = { ...link, id };
      const exists = current.some(p => p.id === id);
      return {
        ...prev,
        patchLinks: exists ? current.map(p => (p.id === id ? entry : p)) : [...current, entry]
      };
    });
  }, [updateProject]);

  const deletePatchLink = useCallback((id: string) => {
    updateProject(prev => ({
      ...prev,
      patchLinks: (prev.patchLinks || []).filter(p => p.id !== id)
    }));
  }, [updateProject]);

  return {
    project,
    setProject,
    projectList,
    showWelcomeModal,
    dismissWelcomeModal,
    switchProject,
    createBlankProject,
    trashProject,
    restoreProject,
    deleteProjectPermanently,
    refreshProjectList,
    updateProject,
    updateProjectTransient,
    beginDragSnapshot,
    commitDragSnapshot,
    history,
    historyIndex,
    undo,
    redo,
    hasUnsavedChanges,
    isSaving,
    storageError,
    lastSavedAt,
    lastBackupAt,
    recordFullBackup,
    markSaved,
    flushPendingSave,
    updateProjectMeta,
    duplicateProject,
    importValidatedProject,
    commitImportedProject,
    activeTool,
    setActiveTool,
    selection,
    setSelection,
    selectItem,
    toggleNodeSelection,
    selectMultipleNodes,
    clearSelection,
    zoom,
    setZoom,
    pan,
    setPan,
    connectingSource,
    setConnectingSource,
    deepInspectId,
    setDeepInspectId,
    setDesignMode,
    setActiveFloor,
    updateDeviceAsset,
    updateNode,
    setNodeIconOrLogo,
    toggleNodeLock,
    toggleLayerVisibility,
    toggleLayerLock,
    autoAssignDeviceLayers,
    updateWifiCoverageRadiusTransient,
    moveNode,
    moveNodesTransient,
    snapNodesAndCommitDrag,
    resizeNodeTransient,
    snapNodeResizeAndCommit,
    addDeviceFromCatalog,
    addCustomDevicePresetToCanvas,
    addTextNode,
    addShapeNode,
    toggleNodeVisibility,
    deleteNode,
    deleteNodes,
    duplicateNodes,
    nudgeNodes,
    hasCopiedStyle: Boolean(copiedStyle),
    copyNodeStyle,
    pasteNodeStyle,
    groupNodes,
    ungroupNodes,
    alignNodes,
    distributeNodes,
    autoAlignNodesSnapToGrid,
    generateOrUpdateLegendNode,
    resizeLegendToFit,
    updateCable,
    setCableColor,
    setCablesColorByType,
    updateCableControlPointsTransient,
    reconnectCableEndpoint,
    deleteCable,
    addCable,
    autoRouteCable,
    autoRouteAllCables,
    addRoom,
    updateRoom,
    moveRoomTransient,
    resizeRoomTransient,
    snapRoomAndCommit,
    deleteRoom,
    addRack,
    updateRack,
    assignDeviceToRackSlot,
    removeDeviceFromRackSlot,
    addDeviceFromCatalogToRack,
    deleteRack,
    generateOrUpdateBuilding,
    cloneFloor,
    loadTemplate,
    resetCanvas,
    updateSettings,
    autoAssignIps,
    revisions,
    refreshRevisions,
    createNamedRevision,
    restoreNamedRevision,
    deleteNamedRevision,
    upsertVlan,
    deleteVlan,
    upsertSubnet,
    deleteSubnet,
    upsertPatchLink,
    deletePatchLink
  };
}
