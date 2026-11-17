import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useCallback,
  useMemo
} from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CableEdge, DiagramNode, ProjectState, SelectionState } from '../../types/infrastructure';
import type { CanvasTool } from '../../store/useProjectStore';
import {
  canAddDevicesInScene,
  canDragNodeIn3DScene,
  getHiddenLayerSet,
  isNodeEffectivelyLocked,
  isNodePositionLocked,
  resolveNodeLayer
} from '../../utils/layerPolicy';
import { DEVICE_CATALOG, loadCustomDevicePresets } from '../../data/deviceCatalog';
import type {
  CameraPresetId,
  Network3DSceneHandle,
  View3DDisplayOptions
} from '../../contexts/ViewportContext';
import {
  detectSoftwareGl,
  createContactShadowTexture,
  createLockBadgeTexture,
  createWorldAxesHelper,
  setupStudioEnvironment,
  StudioRigCleanup
} from './three/studioEnvironment';
import {
  extractCameraRotationMatrix,
  projectCornerAxesFromCameraMatrix,
  AxisId
} from './three/axisHelperProjection';
import {
  clampFloatingPosition,
  DockSideOrFree,
  FloatingPanelPosition,
  resolveEdgeOrFreeDrop,
  useFloatingPanel
} from '../../hooks/useFloatingPanel';
import {
  WORLD_SCALE,
  build3DCableCurve,
  build3DCableGeometry,
  canvasToWorldXZ,
  getFloorElevationY,
  populateInfrastructure3DWorld,
  disposeObjectTree,
  worldXZToCanvas,
  Populated3DCableEntry,
  World3DBounds,
  WorldCoordinateOrigin
} from './three/proceduralDevices';
import { isRackMountedTopologyShadowNode } from '../../utils/rackGeometry';
import {
  Box,
  Compass,
  GitBranch,
  GripHorizontal,
  GripVertical,
  Layers,
  Lock,
  Maximize2,
  Minimize2,
  Move,
  Spline,
  Trash2,
  ChevronDown,
  ChevronUp,
  Unlock
} from 'lucide-react';

interface Network3DSceneProps {
  project: ProjectState;
  selection: SelectionState;
  activeTool?: CanvasTool;
  isReadOnlyMode?: boolean;
  isSceneDragLocked?: boolean;
  view3DOptions?: View3DDisplayOptions;
  onChangeView3DOptions?: React.Dispatch<React.SetStateAction<View3DDisplayOptions>>;
  onContextLostChange?: (lost: boolean) => void;
  onSelect: (type: SelectionState['type'], id?: string) => void;
  onToggleNodeSelection?: (nodeId: string) => void;
  onSetTool?: (tool: CanvasTool) => void;
  onToggleNodeLock?: (nodeIds: string[]) => void;
  onUpdateNode?: (nodeId: string, partial: Partial<DiagramNode>) => void;
  onAddCable?: (
    sourceNodeId: string,
    targetNodeId: string,
    sourcePortId?: string,
    targetPortId?: string,
    options?: {
      cableType?: CableEdge['cableType'];
      color?: string;
      routingType?: CableEdge['routingType'];
    }
  ) => void;
  onUpdateCable?: (cableId: string, partial: Partial<CableEdge>) => void;
  onAutoRouteCable?: (cableId: string) => void;
  onAutoRouteAllCables?: () => void;
  onDeleteCable?: (cableId: string) => void;
  onBeginDragSnapshot?: () => void;
  onMoveNodesTransient?: (nodeIds: string[], dx: number, dy: number) => void;
  onSnapNodesAndCommitDrag?: (nodeIds: string[], options?: { snapX?: boolean; snapY?: boolean }) => void;
  onOpenDeepInspect: (rackId: string) => void;
  onExit3D: () => void;
  draggedPresetName?: string | null;
  onDropDevice?: (presetName: string, x: number, y: number, customPresetId?: string) => void;
}

type DockEdge = DockSideOrFree;

const DOCK_EDGE_STORAGE_KEY = 'hachihi:3d-dock-edge';
const DOCK_FREE_POS_STORAGE_KEY = 'hachihi:3d-dock-free-pos';
const DOCK_COLLAPSED_STORAGE_KEY = 'hachihi:3d-dock-collapsed';

function loadSavedDockEdge(): DockEdge {
  try {
    const val = window.localStorage.getItem(DOCK_EDGE_STORAGE_KEY);
    if (val === 'left' || val === 'right' || val === 'bottom' || val === 'free') return val;
  } catch {
    // ignore storage errors
  }
  return 'bottom';
}

function loadSavedDockFreePos(): FloatingPanelPosition | null {
  try {
    const raw = window.localStorage.getItem(DOCK_FREE_POS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FloatingPanelPosition;
    if (typeof parsed?.x === 'number' && Number.isFinite(parsed.x) && typeof parsed?.y === 'number' && Number.isFinite(parsed.y)) {
      return parsed;
    }
  } catch {
    // ignore storage errors
  }
  return null;
}

function loadSavedDockCollapsed(): boolean {
  try {
    return window.localStorage.getItem(DOCK_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

interface DragSessionItem {
  nodeId: string;
  group: THREE.Group;
  startGroupPos: THREE.Vector3;
  startNodeX: number;
  startNodeY: number;
}

interface DragSession {
  pointerId: number;
  nodeId: string;
  selectType: 'node' | 'rack' | 'edge';
  selectId: string;
  label: string;
  preserveSelection: boolean;
  items: DragSessionItem[];
  draggedIdSet: Set<string>;
  dragPlane: THREE.Plane;
  startClientPos: { x: number; y: number };
  startHitPoint: THREE.Vector3;
  startAnchorX: number;
  startAnchorY: number;
  lastAppliedDx: number;
  lastAppliedDy: number;
  hasMoved: boolean;
}

const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _targetCamPos = new THREE.Vector3();
const _targetCtrlTarget = new THREE.Vector3();
const _dragHitPoint = new THREE.Vector3();
const _planeNormal = new THREE.Vector3(0, 1, 0);
const _camRotMatrix = new THREE.Matrix4();

export const Network3DScene = forwardRef<Network3DSceneHandle, Network3DSceneProps>(({
  project,
  selection,
  activeTool = 'select',
  isReadOnlyMode = false,
  isSceneDragLocked = true,
  view3DOptions: externalViewOptions,
  onChangeView3DOptions,
  onContextLostChange,
  onSelect,
  onToggleNodeSelection,
  onSetTool,
  onToggleNodeLock,
  onUpdateNode,
  onAddCable,
  onUpdateCable,
  onAutoRouteCable,
  onAutoRouteAllCables,
  onDeleteCable,
  onBeginDragSnapshot,
  onMoveNodesTransient,
  onSnapNodesAndCommitDrag,
  onOpenDeepInspect,
  onExit3D,
  draggedPresetName = null,
  onDropDevice
}, ref) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const mountRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const gizmoLayerRef = useRef<SVGGElement>(null);
  const gizmoGroupXRef = useRef<SVGGElement>(null);
  const gizmoGroupYRef = useRef<SVGGElement>(null);
  const gizmoGroupZRef = useRef<SVGGElement>(null);
  const gizmoPosLineXRef = useRef<SVGLineElement>(null);
  const gizmoPosLineYRef = useRef<SVGLineElement>(null);
  const gizmoPosLineZRef = useRef<SVGLineElement>(null);
  const gizmoNegLineXRef = useRef<SVGLineElement>(null);
  const gizmoNegLineYRef = useRef<SVGLineElement>(null);
  const gizmoNegLineZRef = useRef<SVGLineElement>(null);
  const gizmoDotXRef = useRef<SVGCircleElement>(null);
  const gizmoDotYRef = useRef<SVGCircleElement>(null);
  const gizmoDotZRef = useRef<SVGCircleElement>(null);
  const gizmoTextXRef = useRef<SVGTextElement>(null);
  const gizmoTextYRef = useRef<SVGTextElement>(null);
  const gizmoTextZRef = useRef<SVGTextElement>(null);

  const toolsPanel = useFloatingPanel({
    containerRef: rootRef,
    storageKey: 'hachihi:3d-tools-panel',
    defaultCollapsed: false
  });
  const xyzPanel = useFloatingPanel({
    containerRef: rootRef,
    storageKey: 'hachihi:3d-xyz-panel',
    defaultCollapsed: false
  });

  const canMultiFloorCutaway =
    project.floors.length > 1 &&
    ['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode);

  const [webglError, setWebglError] = useState<string | null>(null);
  const [internalViewOptions, setInternalViewOptions] = useState<View3DDisplayOptions>(() => ({
    showAxes: true,
    explodeSpread: 0,
    viewAllFloors: project.floors.length > 1,
    activePreset: 'iso'
  }));
  const effectiveViewOptions = externalViewOptions ?? internalViewOptions;
  const updateViewOptions = useCallback(
    (updater: React.SetStateAction<View3DDisplayOptions>) => {
      if (onChangeView3DOptions) {
        onChangeView3DOptions(updater);
      } else {
        setInternalViewOptions(updater);
      }
    },
    [onChangeView3DOptions]
  );

  const showAxes = effectiveViewOptions.showAxes;
  const explodeSpread = effectiveViewOptions.explodeSpread;
  const viewAllFloors = effectiveViewOptions.viewAllFloors;
  const activePreset = effectiveViewOptions.activePreset;
  const setViewAllFloors = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      updateViewOptions(prev => ({
        ...prev,
        viewAllFloors: typeof updater === 'function' ? updater(prev.viewAllFloors) : updater
      }));
    },
    [updateViewOptions]
  );
  const setActivePreset = useCallback(
    (preset: CameraPresetId) => {
      updateViewOptions(prev => (prev.activePreset === preset ? prev : { ...prev, activePreset: preset }));
    },
    [updateViewOptions]
  );

  const [dockDrawer, setDockDrawer] = useState<'none' | 'routing'>('none');
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(loadSavedDockCollapsed);
  const [dockEdge, setDockEdge] = useState<DockEdge>(loadSavedDockEdge);
  const [dockFreePos, setDockFreePos] = useState<FloatingPanelPosition | null>(loadSavedDockFreePos);
  const [dockDragPreview, setDockDragPreview] = useState<{
    left: number;
    top: number;
    previewEdge: DockEdge;
    freePos?: FloatingPanelPosition;
  } | null>(null);
  const [draggingHud, setDraggingHud] = useState<{ label: string; x: number; y: number } | null>(null);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [preferredRouting, setPreferredRouting] = useState<CableEdge['routingType']>('orthogonal');
  const [rebuildNonce, setRebuildNonce] = useState(0);
  const [dropPromptState, setDropPromptState] = useState<'idle' | 'ready' | 'locked'>('idle');

  const autoFrameNextBuildRef = useRef(true);
  const prevProjectIdRef = useRef(project.id);
  const prevViewAllFloorsRef = useRef(viewAllFloors);
  const prevActiveModeRef = useRef(project.activeMode);

  const projectRef = useRef(project);
  projectRef.current = project;
  const selectionRef = useRef(selection);
  selectionRef.current = selection;
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;
  const isReadOnlyRef = useRef(isReadOnlyMode);
  isReadOnlyRef.current = isReadOnlyMode;
  const isSceneDragLockedRef = useRef(isSceneDragLocked);
  isSceneDragLockedRef.current = isSceneDragLocked;
  const connectSourceIdRef = useRef(connectSourceId);
  connectSourceIdRef.current = connectSourceId;
  const preferredRoutingRef = useRef(preferredRouting);
  preferredRoutingRef.current = preferredRouting;
  const explodeSpreadRef = useRef(explodeSpread);
  explodeSpreadRef.current = explodeSpread;
  const viewAllFloorsRef = useRef(viewAllFloors);
  viewAllFloorsRef.current = viewAllFloors;
  const canMultiFloorCutawayRef = useRef(canMultiFloorCutaway);
  canMultiFloorCutawayRef.current = canMultiFloorCutaway;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const onToggleNodeSelectionRef = useRef(onToggleNodeSelection);
  onToggleNodeSelectionRef.current = onToggleNodeSelection;
  const onAddCableRef = useRef(onAddCable);
  onAddCableRef.current = onAddCable;
  const onBeginDragSnapshotRef = useRef(onBeginDragSnapshot);
  onBeginDragSnapshotRef.current = onBeginDragSnapshot;
  const onMoveNodesTransientRef = useRef(onMoveNodesTransient);
  onMoveNodesTransientRef.current = onMoveNodesTransient;
  const onSnapNodesAndCommitDragRef = useRef(onSnapNodesAndCommitDrag);
  onSnapNodesAndCommitDragRef.current = onSnapNodesAndCommitDrag;
  const onOpenDeepInspectRef = useRef(onOpenDeepInspect);
  onOpenDeepInspectRef.current = onOpenDeepInspect;

  const dragSessionRef = useRef<DragSession | null>(null);

  const sceneRefs = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    worldRoot: THREE.Group;
    axesGroup: THREE.Group;
    connectPreviewLine: THREE.Line;
    dropPreviewGroup: THREE.Group;
    dropPreviewFootprint: THREE.Group;
    studioRig: StudioRigCleanup;
    shadowTex: THREE.Texture;
    lockBadgeTex: THREE.Texture;
    isSoftwareGl: boolean;
    transitioning: boolean;
    requestRender: () => void;
    origin: WorldCoordinateOrigin;
    worldBounds: World3DBounds;
    nodeGroups: Map<string, { group: THREE.Group; node: DiagramNode; floorY: number }>;
    cableEntries: Populated3DCableEntry[];
    shadowToRackNodeId: Map<string, string>;
  } | null>(null);

  // Resolve currently selected 3D device or rack for floating Lock/Unlock action UI
  const selectedTarget = useMemo(() => {
    if ((selection.type !== 'node' && selection.type !== 'rack') || !selection.id) return null;

    let primaryNode: DiagramNode | undefined;
    if (selection.type === 'rack') {
      primaryNode = project.nodes.find(
        n =>
          n.type === 'rack' &&
          (n.customData?.rackId === selection.id || n.id === selection.id)
      );
    } else {
      primaryNode = project.nodes.find(n => n.id === selection.id);
    }
    if (!primaryNode) return null;

    const idSet = new Set<string>([primaryNode.id]);
    if (selection.type === 'node' && selection.additionalIds?.length) {
      selection.additionalIds.forEach(id => idSet.add(id));
    }

    const targetNodes = project.nodes.filter(n => idSet.has(n.id));
    if (targetNodes.length === 0) return null;

    const allNodeLocked = targetNodes.every(n => isNodePositionLocked(n));
    const allEffectiveLocked = targetNodes.every(n =>
      isNodeEffectivelyLocked(n, project.settings, project.assets, false)
    );
    const layerLockedOnly = allEffectiveLocked && !allNodeLocked;

    const rackInfo =
      primaryNode.type === 'rack'
        ? project.racks.find(
            r =>
              r.id === primaryNode?.customData?.rackId ||
              r.id === primaryNode?.id ||
              r.name === primaryNode?.label
          )
        : undefined;
    const assetInfo = primaryNode.assetId ? project.assets[primaryNode.assetId] : undefined;
    const baseLabel = rackInfo?.name || assetInfo?.name || primaryNode.label;

    return {
      anchorNodeId: primaryNode.id,
      nodeIds: targetNodes.map(n => n.id),
      label: targetNodes.length > 1 ? `${baseLabel} (+${targetNodes.length - 1})` : baseLabel,
      isRack: primaryNode.type === 'rack',
      rackId: rackInfo?.id || primaryNode.id,
      isNodeLocked: allNodeLocked,
      isEffectiveLocked: allEffectiveLocked,
      layerLockedOnly,
      x: Math.round(primaryNode.x),
      y: Math.round(primaryNode.y)
    };
  }, [project, selection]);

  // Resolve currently selected 3D cable edge for routing/editing UI
  const selectedCable = useMemo(() => {
    if (selection.type !== 'edge' || !selection.id) return null;
    const cable = project.cables.find(c => c.id === selection.id);
    if (!cable) return null;
    const srcNode = project.nodes.find(n => n.id === cable.sourceNodeId);
    const tgtNode = project.nodes.find(n => n.id === cable.targetNodeId);
    return {
      cable,
      sourceLabel: srcNode?.label || 'Nguồn',
      targetLabel: tgtNode?.label || 'Đích'
    };
  }, [project.cables, project.nodes, selection]);

  const selectedPanel = useFloatingPanel({
    containerRef: rootRef,
    storageKey: 'hachihi:3d-selected-object-panel',
    defaultCollapsed: false,
    isOpen: Boolean((selectedTarget || selectedCable) && !draggingHud)
  });

  const connectSourceLabel = useMemo(() => {
    if (!connectSourceId) return null;
    return project.nodes.find(n => n.id === connectSourceId)?.label || 'Thiết bị';
  }, [connectSourceId, project.nodes]);

  // Persist dock edge & collapsed state cleanly
  useEffect(() => {
    try {
      window.localStorage.setItem(DOCK_EDGE_STORAGE_KEY, dockEdge);
    } catch {
      // ignore
    }
  }, [dockEdge]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DOCK_COLLAPSED_STORAGE_KEY, String(dockCollapsed));
    } catch {
      // ignore
    }
  }, [dockCollapsed]);

  // Clear in-progress connect session if 3D is locked, read-only, or tool switched away from connect
  useEffect(() => {
    if (isSceneDragLocked || isReadOnlyMode || activeTool !== 'connect') {
      if (connectSourceId) {
        setConnectSourceId(null);
      }
      const line = sceneRefs.current?.connectPreviewLine;
      if (line && line.visible) {
        line.visible = false;
        sceneRefs.current?.requestRender();
      }
    }
  }, [isSceneDragLocked, isReadOnlyMode, activeTool, connectSourceId]);

  const prevSceneDragLockedRef = useRef(isSceneDragLocked);
  useEffect(() => {
    if (prevSceneDragLockedRef.current && !isSceneDragLocked && !isReadOnlyMode) {
      setDockCollapsed(false);
      setDockDrawer(curr => (curr === 'none' ? 'routing' : curr));
    }
    prevSceneDragLockedRef.current = isSceneDragLocked;
  }, [isSceneDragLocked, isReadOnlyMode]);

  // Esc key cancels active 3D cable connection
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && connectSourceIdRef.current) {
        setConnectSourceId(null);
        const line = sceneRefs.current?.connectPreviewLine;
        if (line) {
          line.visible = false;
          sceneRefs.current?.requestRender();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleToggleSelectedLock = useCallback(() => {
    if (!selectedTarget || isReadOnlyMode || selectedTarget.layerLockedOnly) return;
    if (onToggleNodeLock) {
      onToggleNodeLock(selectedTarget.nodeIds);
      return;
    }
    if (onUpdateNode) {
      const nextLocked = !selectedTarget.isNodeLocked;
      for (const nodeId of selectedTarget.nodeIds) {
        const curr = projectRef.current.nodes.find(n => n.id === nodeId);
        if (!curr) continue;
        onUpdateNode(nodeId, {
          locked: nextLocked,
          customData: {
            ...(curr.customData || {}),
            locked: nextLocked
          }
        });
      }
    }
  }, [selectedTarget, isReadOnlyMode, onToggleNodeLock, onUpdateNode]);

  const updateFloatingOverlays = useCallback(() => {
    const refs = sceneRefs.current;
    const container = mountRef.current;
    if (!refs || !container) return;

    // 1. Update corner XYZ Axis Helper using camera's inverse rotation matrix (depth-sorted back-to-front)
    extractCameraRotationMatrix(refs.camera, _camRotMatrix);
    const projectedAxes = projectCornerAxesFromCameraMatrix(_camRotMatrix, 38, 22, 9);
    const axisRefs: Record<
      AxisId,
      {
        group: SVGGElement | null;
        posLine: SVGLineElement | null;
        negLine: SVGLineElement | null;
        dot: SVGCircleElement | null;
        text: SVGTextElement | null;
      }
    > = {
      X: {
        group: gizmoGroupXRef.current,
        posLine: gizmoPosLineXRef.current,
        negLine: gizmoNegLineXRef.current,
        dot: gizmoDotXRef.current,
        text: gizmoTextXRef.current
      },
      Y: {
        group: gizmoGroupYRef.current,
        posLine: gizmoPosLineYRef.current,
        negLine: gizmoNegLineYRef.current,
        dot: gizmoDotYRef.current,
        text: gizmoTextYRef.current
      },
      Z: {
        group: gizmoGroupZRef.current,
        posLine: gizmoPosLineZRef.current,
        negLine: gizmoNegLineZRef.current,
        dot: gizmoDotZRef.current,
        text: gizmoTextZRef.current
      }
    };

    const layerEl = gizmoLayerRef.current;
    for (const item of projectedAxes) {
      const el = axisRefs[item.axis];
      if (!el.group || !el.posLine || !el.negLine || !el.dot || !el.text) continue;
      el.posLine.setAttribute('x2', item.px.toFixed(1));
      el.posLine.setAttribute('y2', item.py.toFixed(1));
      el.negLine.setAttribute('x2', item.nx.toFixed(1));
      el.negLine.setAttribute('y2', item.ny.toFixed(1));
      el.dot.setAttribute('cx', item.px.toFixed(1));
      el.dot.setAttribute('cy', item.py.toFixed(1));
      el.text.setAttribute('x', item.tx.toFixed(1));
      el.text.setAttribute('y', (item.ty + 3.2).toFixed(1));
      el.group.setAttribute('opacity', item.opacity.toFixed(2));
      if (layerEl) {
        layerEl.appendChild(el.group);
      }
    }
  }, []);

  const updateFloatingOverlaysRef = useRef(updateFloatingOverlays);
  updateFloatingOverlaysRef.current = updateFloatingOverlays;

  const visibleCountSummary = useMemo(() => {
    const hiddenLayerSet = getHiddenLayerSet(project.settings);
    const isFloorBasedMode = ['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode);
    const isMultiFloorCutaway = viewAllFloors && isFloorBasedMode && project.floors.length > 1;
    const floorplanRackNodes = project.nodes.filter(
      n => n.type === 'rack' && n.diagramMode === 'floorplan'
    );

    const nodes = project.nodes.filter(n => {
      if (n.hidden) return false;
      if (n.type === 'legend' || n.type === 'text') return false;
      if (hiddenLayerSet.has(resolveNodeLayer(n, project.assets))) return false;
      if (isFloorBasedMode) {
        if (isRackMountedTopologyShadowNode(n, project.assets, floorplanRackNodes, project.racks)) {
          return false;
        }
        if (!isMultiFloorCutaway && n.floorId && project.activeFloorId && n.floorId !== project.activeFloorId) {
          return false;
        }
        return true;
      }
      if (project.activeMode === 'rack') return n.diagramMode === 'rack' || n.type === 'rack';
      return true;
    });

    const nodeIdSet = new Set(nodes.map(n => n.id));
    const cablesCount = hiddenLayerSet.has('cables')
      ? 0
      : project.cables.filter(
          c => isMultiFloorCutaway || (nodeIdSet.has(c.sourceNodeId) && nodeIdSet.has(c.targetNodeId))
        ).length;

    return {
      devices: nodes.filter(n => n.type !== 'rack').length,
      racks: nodes.filter(n => n.type === 'rack').length,
      cables: cablesCount
    };
  }, [project, viewAllFloors]);

  const computePoseForPreset = useCallback((b: World3DBounds, preset: CameraPresetId) => {
    const cx = b.centerX;
    const cy = b.centerY;
    const cz = b.centerZ;
    const span = Math.max(12, b.size);
    const camPos = new THREE.Vector3();
    const target = new THREE.Vector3(cx, cy, cz);

    if (preset === 'top') {
      const dist = span * 1.12;
      camPos.set(cx + 0.01, cy + dist, cz + 0.01);
    } else if (preset === 'front') {
      const dist = span * 0.94;
      camPos.set(cx, cy + span * 0.14, cz + dist);
    } else if (preset === 'side') {
      const dist = span * 0.94;
      camPos.set(cx + dist, cy + span * 0.14, cz + 0.01);
    } else {
      const dist = span * 0.96;
      camPos.set(cx + dist * 0.72, cy + dist * 0.56, cz + dist * 0.76);
    }
    return { camPos, target };
  }, []);

  const applyCameraPreset = useCallback((preset: CameraPresetId, immediate = false) => {
    const refs = sceneRefs.current;
    if (!refs) return;
    setActivePreset(preset);
    const pose = computePoseForPreset(refs.worldBounds, preset);
    _targetCamPos.copy(pose.camPos);
    _targetCtrlTarget.copy(pose.target);

    if (immediate) {
      refs.camera.position.copy(_targetCamPos);
      refs.controls.target.copy(_targetCtrlTarget);
      refs.controls.update();
      refs.transitioning = false;
    } else {
      refs.transitioning = true;
    }
    refs.requestRender();
  }, [computePoseForPreset, setActivePreset]);

  const activePresetRef = useRef(activePreset);
  activePresetRef.current = activePreset;

  const raycastDropToFloorCanvas = useCallback(
    (
      clientX: number,
      clientY: number,
      footprint?: { width: number; height: number; isRack?: boolean }
    ) => {
      const refs = sceneRefs.current;
      if (!refs) return null;
      const rect = refs.renderer.domElement.getBoundingClientRect();
      if (
        rect.width <= 0 ||
        rect.height <= 0 ||
        clientX < rect.left ||
        clientX > rect.right ||
        clientY < rect.top ||
        clientY > rect.bottom
      ) {
        return null;
      }

      const currProj = projectRef.current;
      const activeFloorY = getFloorElevationY(
        currProj,
        currProj.activeFloorId,
        explodeSpreadRef.current,
        canMultiFloorCutawayRef.current && viewAllFloorsRef.current
      );

      _pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_pointer, refs.camera);

      const dropPlane = new THREE.Plane(_planeNormal, -activeFloorY);
      const hit = _raycaster.ray.intersectPlane(dropPlane, _dragHitPoint);

      let hitX = refs.controls.target.x;
      let hitZ = refs.controls.target.z;
      const maxSpanX = Math.max(24, (refs.worldBounds.maxX - refs.worldBounds.minX) * 0.75 + 16);
      const maxSpanZ = Math.max(24, (refs.worldBounds.maxZ - refs.worldBounds.minZ) * 0.75 + 16);
      if (
        hit &&
        Number.isFinite(hit.x) &&
        Number.isFinite(hit.z) &&
        Math.abs(_raycaster.ray.direction.y) >= 0.03
      ) {
        hitX = Math.max(
          refs.worldBounds.centerX - maxSpanX,
          Math.min(refs.worldBounds.centerX + maxSpanX, hit.x)
        );
        hitZ = Math.max(
          refs.worldBounds.centerZ - maxSpanZ,
          Math.min(refs.worldBounds.centerZ + maxSpanZ, hit.z)
        );
      }

      const canvasPt = worldXZToCanvas(hitX, hitZ, refs.origin);
      const nodeW = footprint?.isRack ? 300 : footprint?.width || 150;
      const nodeH = footprint?.isRack ? 180 : footprint?.height || 56;
      const snap = currProj.settings.snapToGrid ? Math.max(1, currProj.settings.gridSize) : 1;
      const rawX = Math.max(10, Math.round(canvasPt.x - nodeW / 2));
      const rawY = Math.max(10, Math.round(canvasPt.y - nodeH / 2));
      const dropX = Math.max(10, Math.round(rawX / snap) * snap);
      const dropY = Math.max(10, Math.round(rawY / snap) * snap);
      const snappedWorld = canvasToWorldXZ(dropX + nodeW / 2, dropY + nodeH / 2, refs.origin);
      const activeFloorObj = currProj.floors.find(f => f.id === currProj.activeFloorId);

      return {
        x: dropX,
        y: dropY,
        worldX: snappedWorld.x,
        worldY: activeFloorY,
        worldZ: snappedWorld.z,
        worldW: nodeW * WORLD_SCALE,
        worldD: nodeH * WORLD_SCALE,
        floorName: activeFloorObj?.name || 'Mặt bằng hiện tại'
      };
    },
    []
  );

  useImperativeHandle(
    ref,
    () => ({
      setCameraPreset: (preset: CameraPresetId) => {
        applyCameraPreset(preset, false);
      },
      fitToScreen: () => {
        applyCameraPreset(activePresetRef.current, false);
      },
      resetZoom: () => {
        applyCameraPreset('iso', false);
      },
      zoomIn: () => {
        const refs = sceneRefs.current;
        if (!refs) return;
        refs.transitioning = false;
        const dir = refs.camera.position.clone().sub(refs.controls.target);
        const dist = dir.length();
        const nextDist = Math.max(refs.controls.minDistance, dist * 0.8);
        dir.normalize().multiplyScalar(nextDist);
        refs.camera.position.copy(refs.controls.target).add(dir);
        refs.controls.update();
        refs.requestRender();
      },
      zoomOut: () => {
        const refs = sceneRefs.current;
        if (!refs) return;
        refs.transitioning = false;
        const dir = refs.camera.position.clone().sub(refs.controls.target);
        const dist = dir.length();
        const nextDist = Math.min(refs.controls.maxDistance, dist * 1.24);
        dir.normalize().multiplyScalar(nextDist);
        refs.camera.position.copy(refs.controls.target).add(dir);
        refs.controls.update();
        refs.requestRender();
      },
      isContextLost: () => {
        const refs = sceneRefs.current;
        if (!refs) return true;
        try {
          return refs.renderer.getContext().isContextLost();
        } catch {
          return true;
        }
      },
      getCenterCanvasCoords: () => {
        const refs = sceneRefs.current;
        if (!refs) return null;
        const pt = worldXZToCanvas(refs.controls.target.x, refs.controls.target.z, refs.origin);
        return {
          x: Math.max(10, Math.round(pt.x - 75)),
          y: Math.max(10, Math.round(pt.y - 28))
        };
      },
      previewLibraryDrop: (clientX, clientY, footprint) => {
        const refs = sceneRefs.current;
        if (!refs) return null;
        if (
          !canAddDevicesInScene({
            isReadOnlyMode: isReadOnlyRef.current,
            is3DView: true,
            is3DDragLocked: isSceneDragLockedRef.current
          })
        ) {
          if (refs.dropPreviewGroup.visible) {
            refs.dropPreviewGroup.visible = false;
            refs.requestRender();
          }
          return null;
        }
        const hit = raycastDropToFloorCanvas(clientX, clientY, footprint);
        if (!hit) {
          if (refs.dropPreviewGroup.visible) {
            refs.dropPreviewGroup.visible = false;
            refs.requestRender();
          }
          return null;
        }
        refs.dropPreviewGroup.position.set(hit.worldX, hit.worldY + 0.04, hit.worldZ);
        refs.dropPreviewFootprint.scale.set(
          Math.max(0.6, hit.worldW),
          1,
          Math.max(0.6, hit.worldD)
        );
        refs.dropPreviewGroup.visible = true;
        refs.requestRender();
        return { x: hit.x, y: hit.y, floorName: hit.floorName };
      },
      clearLibraryDropPreview: () => {
        const refs = sceneRefs.current;
        if (!refs) return;
        if (refs.dropPreviewGroup.visible) {
          refs.dropPreviewGroup.visible = false;
          refs.requestRender();
        }
      },
      focusSelection: (targetType, targetId) => {
        const refs = sceneRefs.current;
        if (!refs || !targetId) return false;

        const focusPoint = new THREE.Vector3();
        let found = false;

        if (targetType === 'edge') {
          const cableEntry = refs.cableEntries.find(ce => ce.cable.id === targetId);
          if (cableEntry) {
            focusPoint.copy(cableEntry.midWorld);
            found = true;
          }
        } else {
          let targetEntry = refs.nodeGroups.get(targetId);
          if (!targetEntry && targetType === 'rack') {
            refs.nodeGroups.forEach(entry => {
              if (
                !targetEntry &&
                entry.node.type === 'rack' &&
                (entry.node.customData?.rackId === targetId || entry.node.id === targetId)
              ) {
                targetEntry = entry;
              }
            });
          }
          if (!targetEntry && targetType === 'node') {
            const mappedRackNodeId = refs.shadowToRackNodeId.get(targetId);
            if (mappedRackNodeId) {
              targetEntry = refs.nodeGroups.get(mappedRackNodeId);
            }
          }
          if (targetEntry) {
            focusPoint.set(
              targetEntry.group.position.x,
              targetEntry.group.position.y + (targetEntry.node.type === 'rack' ? 1.15 : 0.45),
              targetEntry.group.position.z
            );
            found = true;
          }
        }

        if (!found) return false;

        const offset = refs.camera.position.clone().sub(refs.controls.target);
        const currentDist = offset.length();
        const maxFocusDist = Math.max(14, refs.worldBounds.size * 0.65);
        if (currentDist < 1) {
          offset.set(6, 5.5, 6);
        } else if (currentDist > maxFocusDist) {
          offset.normalize().multiplyScalar(maxFocusDist);
        }

        _targetCtrlTarget.copy(focusPoint);
        _targetCamPos.copy(focusPoint).add(offset);
        refs.transitioning = true;
        refs.requestRender();
        return true;
      },
      captureImage: async (reqOpts) => {
        const refs = sceneRefs.current;
        if (!refs) {
          throw new Error('Không thể chụp ảnh 3D vì WebGL Scene chưa được khởi tạo.');
        }
        const gl = refs.renderer.getContext();
        if (gl.isContextLost()) {
          throw new Error('WebGL Context đã bị mất, không thể kết xuất hình ảnh 3D.');
        }

        const w = Math.max(320, Math.min(3840, Math.round(reqOpts?.width ?? 1920)));
        const h = Math.max(240, Math.min(2160, Math.round(reqOpts?.height ?? 1080)));
        const background = reqOpts?.background ?? 'light';
        const usedPreset = reqOpts?.preset ?? activePresetRef.current;

        const prevTarget = refs.renderer.getRenderTarget();
        const prevAspect = refs.camera.aspect;
        const prevCamPos = refs.camera.position.clone();
        const prevCtrlTarget = refs.controls.target.clone();
        const prevBackground = refs.scene.background;
        const prevFog = refs.scene.fog;
        const prevAxesVisible = refs.axesGroup.visible;
        const prevPreviewVisible = refs.connectPreviewLine.visible;
        const prevDark = projectRef.current.settings.isDarkMode;
        const prevTransitioning = refs.transitioning;

        let rt: THREE.WebGLRenderTarget | null = null;
        try {
          const wantSamples = !refs.isSoftwareGl && refs.renderer.capabilities.isWebGL2 ? 4 : 0;
          try {
            rt = new THREE.WebGLRenderTarget(w, h, {
              minFilter: THREE.LinearFilter,
              magFilter: THREE.LinearFilter,
              format: THREE.RGBAFormat,
              type: THREE.UnsignedByteType,
              samples: wantSamples
            });
          } catch {
            rt = new THREE.WebGLRenderTarget(w, h, {
              minFilter: THREE.LinearFilter,
              magFilter: THREE.LinearFilter,
              format: THREE.RGBAFormat,
              type: THREE.UnsignedByteType,
              samples: 0
            });
          }

          refs.transitioning = false;
          refs.axesGroup.visible = false;
          refs.connectPreviewLine.visible = false;
          refs.dropPreviewGroup.visible = false;

          if (background === 'dark') {
            refs.studioRig.updateTheme(true);
          } else {
            refs.studioRig.updateTheme(false);
            refs.scene.background = new THREE.Color(0xffffff);
            refs.scene.fog = null;
          }

          if (reqOpts?.preset) {
            const pose = computePoseForPreset(refs.worldBounds, reqOpts.preset);
            refs.camera.position.copy(pose.camPos);
            refs.controls.target.copy(pose.target);
          }

          refs.camera.aspect = w / h;
          refs.camera.updateProjectionMatrix();
          refs.controls.update();

          refs.renderer.setRenderTarget(rt);
          refs.renderer.clear();
          refs.renderer.render(refs.scene, refs.camera);

          const rawPixels = new Uint8Array(w * h * 4);
          refs.renderer.readRenderTargetPixels(rt, 0, 0, w, h, rawPixels);

          const outCanvas = document.createElement('canvas');
          outCanvas.width = w;
          outCanvas.height = h;
          const ctx = outCanvas.getContext('2d');
          if (!ctx) {
            throw new Error('Trình duyệt không hỗ trợ 2D Canvas để đọc ảnh chụp 3D.');
          }
          const imgData = ctx.createImageData(w, h);
          const rowBytes = w * 4;
          for (let row = 0; row < h; row++) {
            const srcStart = (h - 1 - row) * rowBytes;
            imgData.data.set(rawPixels.subarray(srcStart, srcStart + rowBytes), row * rowBytes);
          }
          ctx.putImageData(imgData, 0, 0);

          const dataUrl = outCanvas.toDataURL('image/png');
          const blob = await new Promise<Blob>((resolve, reject) => {
            outCanvas.toBlob(b => {
              if (b && b.size > 0) resolve(b);
              else reject(new Error('Không thể tạo PNG Blob từ bộ đệm khung hình 3D.'));
            }, 'image/png', 1);
          });

          return {
            blob,
            dataUrl,
            width: w,
            height: h,
            preset: usedPreset,
            background
          };
        } finally {
          refs.renderer.setRenderTarget(prevTarget);
          refs.camera.aspect = prevAspect;
          refs.camera.position.copy(prevCamPos);
          refs.controls.target.copy(prevCtrlTarget);
          refs.camera.updateProjectionMatrix();
          refs.controls.update();
          refs.studioRig.updateTheme(prevDark);
          refs.scene.background = prevBackground;
          refs.scene.fog = prevFog;
          refs.axesGroup.visible = prevAxesVisible;
          refs.connectPreviewLine.visible = prevPreviewVisible;
          refs.transitioning = prevTransitioning;
          rt?.dispose();
          refs.requestRender();
        }
      }
    }),
    [applyCameraPreset, computePoseForPreset]
  );

  // Initialize WebGL Scene once
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareGl();
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: isSoftwareGl ? 'low-power' : 'high-performance'
      });
    } catch (err) {
      setWebglError(
        err instanceof Error ? err.message : 'Trình duyệt không hỗ trợ WebGL 3D.'
      );
      return;
    }

    const width = container.clientWidth || 1000;
    const height = container.clientHeight || 640;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : 2));
    renderer.setSize(width, height);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.touchAction = 'none';
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.2, 180);
    camera.position.set(13, 11.5, 13.5);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.04;
    controls.minDistance = 3;
    controls.maxDistance = 48;
    controls.target.set(0, 0.4, 0);
    controls.update();

    const studioRig = setupStudioEnvironment(
      scene,
      renderer,
      project.settings.isDarkMode,
      isSoftwareGl
    );
    const shadowTex = createContactShadowTexture();
    const lockBadgeTex = createLockBadgeTexture();
    const worldRoot = new THREE.Group();
    worldRoot.name = 'infrastructure_world_root';
    scene.add(worldRoot);

    const axesGroup = createWorldAxesHelper(2.6);
    scene.add(axesGroup);

    const previewGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.3, 0),
      new THREE.Vector3(0, 0.3, 0)
    ]);
    const previewMat = new THREE.LineBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.92
    });
    const connectPreviewLine = new THREE.Line(previewGeo, previewMat);
    connectPreviewLine.visible = false;
    connectPreviewLine.renderOrder = 15;
    connectPreviewLine.name = 'connect_preview_line';
    scene.add(connectPreviewLine);

    const dropPreviewGroup = new THREE.Group();
    dropPreviewGroup.name = 'library_drop_preview';
    dropPreviewGroup.visible = false;
    dropPreviewGroup.renderOrder = 16;

    const dropPreviewFootprint = new THREE.Group();
    const dropPlaneGeo = new THREE.PlaneGeometry(1, 1);
    dropPlaneGeo.rotateX(-Math.PI / 2);
    const dropPlaneMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const dropPlaneMesh = new THREE.Mesh(dropPlaneGeo, dropPlaneMat);
    dropPreviewFootprint.add(dropPlaneMesh);

    const dropBorderGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.5, 0.01, -0.5),
      new THREE.Vector3(0.5, 0.01, -0.5),
      new THREE.Vector3(0.5, 0.01, 0.5),
      new THREE.Vector3(-0.5, 0.01, 0.5)
    ]);
    const dropBorderMat = new THREE.LineBasicMaterial({
      color: 0x0ea5e9,
      transparent: true,
      opacity: 0.95
    });
    const dropBorderLoop = new THREE.LineLoop(dropBorderGeo, dropBorderMat);
    dropPreviewFootprint.add(dropBorderLoop);
    dropPreviewGroup.add(dropPreviewFootprint);

    const beaconGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.65, 10);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85
    });
    const beaconMesh = new THREE.Mesh(beaconGeo, beaconMat);
    beaconMesh.position.y = 0.325;
    dropPreviewGroup.add(beaconMesh);
    scene.add(dropPreviewGroup);

    let rafId = 0;
    let needsRender = true;
    let lastTime = performance.now();
    let disposed = false;

    const scheduleFrame = () => {
      if (disposed || rafId !== 0) return;
      rafId = requestAnimationFrame(tick);
    };

    const requestRender = () => {
      needsRender = true;
      scheduleFrame();
    };

    const tick = (now: number) => {
      rafId = 0;
      if (disposed) return;

      const dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;

      const refs = sceneRefs.current;
      let stillAnimating = false;

      if (refs?.transitioning) {
        const alpha = isSoftwareGl ? 1 : 1 - Math.exp(-9 * dt);
        camera.position.lerp(_targetCamPos, alpha);
        controls.target.lerp(_targetCtrlTarget, alpha);
        if (
          camera.position.distanceTo(_targetCamPos) < 0.04 &&
          controls.target.distanceTo(_targetCtrlTarget) < 0.04
        ) {
          camera.position.copy(_targetCamPos);
          controls.target.copy(_targetCtrlTarget);
          refs.transitioning = false;
        } else {
          stillAnimating = true;
        }
      }

      const dampingChanged = controls.update();
      if (needsRender || dampingChanged || stillAnimating) {
        needsRender = false;
        renderer.render(scene, camera);
        updateFloatingOverlaysRef.current();
      }

      if (stillAnimating || (controls.enableDamping && dampingChanged)) {
        scheduleFrame();
      }
    };

    sceneRefs.current = {
      renderer,
      scene,
      camera,
      controls,
      worldRoot,
      axesGroup,
      connectPreviewLine,
      dropPreviewGroup,
      dropPreviewFootprint,
      studioRig,
      shadowTex,
      lockBadgeTex,
      isSoftwareGl,
      transitioning: false,
      requestRender,
      origin: { centerX: 500, centerY: 320 },
      worldBounds: {
        minX: -8,
        maxX: 8,
        minY: 0,
        maxY: 3,
        minZ: -6,
        maxZ: 6,
        centerX: 0,
        centerY: 0.4,
        centerZ: 0,
        size: 16
      },
      nodeGroups: new Map(),
      cableEntries: [],
      shadowToRackNodeId: new Map()
    };

    const handleControlChange = () => {
      requestRender();
    };
    const handleControlStart = () => {
      if (sceneRefs.current) sceneRefs.current.transitioning = false;
    };
    controls.addEventListener('change', handleControlChange);
    controls.addEventListener('start', handleControlStart);

    // ResizeObserver
    const resizeObs = new ResizeObserver(() => {
      if (!container || disposed) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 500;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      requestRender();
    });
    resizeObs.observe(container);

    const setPointerRay = (clientX: number, clientY: number) => {
      const rect = renderer.domElement.getBoundingClientRect();
      _pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      _pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      _raycaster.setFromCamera(_pointer, camera);
    };

    const pickObjectAt = (clientX: number, clientY: number) => {
      setPointerRay(clientX, clientY);
      const hits = _raycaster.intersectObjects(worldRoot.children, true);
      for (const hit of hits) {
        const { selectType, selectId, nodeId, cableId, label } = hit.object.userData || {};
        if (selectType === 'edge' && (selectId || cableId)) {
          return {
            selectType: 'edge' as const,
            selectId: String(selectId || cableId),
            nodeId: '',
            label: String(label || ''),
            point: hit.point.clone()
          };
        }
        if (selectType && selectId && nodeId) {
          return {
            selectType: selectType as 'node' | 'rack',
            selectId: String(selectId),
            nodeId: String(nodeId),
            label: String(label || ''),
            point: hit.point.clone()
          };
        }
      }
      return null;
    };

    const updateConnectPreview = (clientX: number, clientY: number) => {
      const refs = sceneRefs.current;
      const srcId = connectSourceIdRef.current;
      if (!refs || !srcId) {
        if (refs?.connectPreviewLine.visible) {
          refs.connectPreviewLine.visible = false;
          refs.requestRender();
        }
        return;
      }
      const srcEntry = refs.nodeGroups.get(srcId);
      if (!srcEntry) {
        refs.connectPreviewLine.visible = false;
        return;
      }

      const picked = pickObjectAt(clientX, clientY);
      let tgtCenter: { x: number; z: number } | null = null;
      let tgtIsRack = false;

      if (picked && (picked.selectType === 'node' || picked.selectType === 'rack') && picked.nodeId !== srcId) {
        const tgtEntry = refs.nodeGroups.get(picked.nodeId);
        if (tgtEntry) {
          tgtCenter = { x: tgtEntry.group.position.x, z: tgtEntry.group.position.z };
          tgtIsRack = tgtEntry.node.type === 'rack';
        }
      }

      if (!tgtCenter) {
        setPointerRay(clientX, clientY);
        const plane = new THREE.Plane(_planeNormal, -0.45);
        const hit = _raycaster.ray.intersectPlane(plane, _dragHitPoint);
        if (!hit) return;
        tgtCenter = { x: hit.x, z: hit.z };
      }

      const { curve } = build3DCableCurve(
        { routingType: preferredRoutingRef.current, strokeWidth: 2 },
        { x: srcEntry.group.position.x, z: srcEntry.group.position.z },
        tgtCenter,
        srcEntry.node.type === 'rack',
        tgtIsRack,
        0,
        1,
        explodeSpreadRef.current,
        refs.origin,
        srcEntry.floorY,
        picked && (picked.selectType === 'node' || picked.selectType === 'rack')
          ? (refs.nodeGroups.get(picked.nodeId)?.floorY ?? srcEntry.floorY)
          : srcEntry.floorY
      );
      const pts = curve.getPoints(28);
      refs.connectPreviewLine.geometry.dispose();
      refs.connectPreviewLine.geometry = new THREE.BufferGeometry().setFromPoints(pts);
      refs.connectPreviewLine.visible = true;
      refs.requestRender();
    };

    let lastHoverCheck = 0;

    const handlePointerDown = (e: PointerEvent) => {
      // Only primary mouse/touch button initiates object interaction; right/middle stay camera pan/zoom
      if (e.button !== 0) return;

      const refs = sceneRefs.current;
      if (!refs) return;

      const picked = pickObjectAt(e.clientX, e.clientY);

      // Unlocked 3D cable connect workflow
      if (
        activeToolRef.current === 'connect' &&
        !isSceneDragLockedRef.current &&
        !isReadOnlyRef.current
      ) {
        dragSessionRef.current = null;
        if (picked && (picked.selectType === 'node' || picked.selectType === 'rack')) {
          const currSrc = connectSourceIdRef.current;
          if (!currSrc) {
            setConnectSourceId(picked.nodeId);
            onSelectRef.current(picked.selectType, picked.selectId);
            updateConnectPreview(e.clientX, e.clientY);
          } else if (currSrc !== picked.nodeId) {
            onAddCableRef.current?.(currSrc, picked.nodeId, undefined, undefined, {
              routingType: preferredRoutingRef.current
            });
            setConnectSourceId(null);
            refs.connectPreviewLine.visible = false;
            refs.requestRender();
          } else {
            setConnectSourceId(null);
            refs.connectPreviewLine.visible = false;
            refs.requestRender();
          }
        } else if (picked && picked.selectType === 'edge') {
          onSelectRef.current('edge', picked.selectId);
        } else {
          setConnectSourceId(null);
          refs.connectPreviewLine.visible = false;
          refs.requestRender();
        }
        return;
      }

      if (!picked) {
        dragSessionRef.current = null;
        return;
      }

      if (picked.selectType === 'edge') {
        dragSessionRef.current = {
          pointerId: e.pointerId,
          nodeId: '',
          selectType: 'edge',
          selectId: picked.selectId,
          label: picked.label,
          preserveSelection: false,
          items: [],
          draggedIdSet: new Set(),
          dragPlane: new THREE.Plane(),
          startClientPos: { x: e.clientX, y: e.clientY },
          startHitPoint: new THREE.Vector3(),
          startAnchorX: 0,
          startAnchorY: 0,
          lastAppliedDx: 0,
          lastAppliedDy: 0,
          hasMoved: false
        };
        return;
      }

      const entry = refs.nodeGroups.get(picked.nodeId);
      const currProject = projectRef.current;
      const isLocked =
        !entry ||
        !canDragNodeIn3DScene(entry.node, currProject.settings, currProject.assets, {
          isReadOnlyMode: isReadOnlyRef.current,
          isSceneDragLocked: isSceneDragLockedRef.current
        });

      if (isLocked || !onMoveNodesTransientRef.current) {
        // Still allow click-to-select on locked or read-only objects (cannot drag!)
        dragSessionRef.current = {
          pointerId: e.pointerId,
          nodeId: picked.nodeId,
          selectType: picked.selectType,
          selectId: picked.selectId,
          label: picked.label,
          preserveSelection: false,
          items: [],
          draggedIdSet: new Set(),
          dragPlane: new THREE.Plane(),
          startClientPos: { x: e.clientX, y: e.clientY },
          startHitPoint: new THREE.Vector3(),
          startAnchorX: 0,
          startAnchorY: 0,
          lastAppliedDx: 0,
          lastAppliedDy: 0,
          hasMoved: false
        };
        return;
      }

      const dragPlane = new THREE.Plane(_planeNormal, -entry.group.position.y);
      setPointerRay(e.clientX, e.clientY);
      const hitStart = _raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
      if (!hitStart) return;

      // Match 2D Canvas behavior: move multi-selected nodes or group peers together
      const currSelection = selectionRef.current;
      const currentSelectedIds = new Set<string>();
      if (currSelection.type === 'node' && currSelection.id) {
        currentSelectedIds.add(currSelection.id);
        currSelection.additionalIds?.forEach(id => currentSelectedIds.add(id));
      }
      const isMultiNodeSelected = currentSelectedIds.size > 1 && currentSelectedIds.has(picked.nodeId);

      const candidateIds = new Set<string>([picked.nodeId]);
      if (isMultiNodeSelected) {
        currentSelectedIds.forEach(id => candidateIds.add(id));
      } else if (entry.node.groupId) {
        refs.nodeGroups.forEach((peer, peerId) => {
          if (peer.node.groupId === entry.node.groupId) {
            candidateIds.add(peerId);
          }
        });
      }

      const items: DragSessionItem[] = [];
      const draggedIdSet = new Set<string>();
      candidateIds.forEach(id => {
        const peer = refs.nodeGroups.get(id);
        if (!peer) return;
        if (isNodeEffectivelyLocked(peer.node, currProject.settings, currProject.assets, false)) return;
        draggedIdSet.add(id);
        items.push({
          nodeId: id,
          group: peer.group,
          startGroupPos: peer.group.position.clone(),
          startNodeX: peer.node.x,
          startNodeY: peer.node.y
        });
      });

      if (items.length === 0) return;

      refs.transitioning = false;
      controls.enabled = false;
      renderer.domElement.style.cursor = 'grabbing';
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // ignore synthetic event capture errors
      }

      dragSessionRef.current = {
        pointerId: e.pointerId,
        nodeId: picked.nodeId,
        selectType: picked.selectType,
        selectId: picked.selectId,
        label: items.length > 1 ? `${picked.label} (+${items.length - 1})` : picked.label,
        preserveSelection: isMultiNodeSelected,
        items,
        draggedIdSet,
        dragPlane,
        startClientPos: { x: e.clientX, y: e.clientY },
        startHitPoint: hitStart,
        startAnchorX: entry.node.x,
        startAnchorY: entry.node.y,
        lastAppliedDx: 0,
        lastAppliedDy: 0,
        hasMoved: false
      };
    };

    const handlePointerMove = (e: PointerEvent) => {
      const refs = sceneRefs.current;
      if (!refs) return;

      const drag = dragSessionRef.current;
      if (drag && !controls.enabled) {
        const clientDist = Math.hypot(e.clientX - drag.startClientPos.x, e.clientY - drag.startClientPos.y);
        if (!drag.hasMoved && clientDist <= 4) {
          return;
        }

        if (!drag.hasMoved) {
          drag.hasMoved = true;
          if (!drag.preserveSelection) {
            onSelectRef.current(drag.selectType, drag.selectId);
          }
          onBeginDragSnapshotRef.current?.();
        }

        setPointerRay(e.clientX, e.clientY);
        const hit = _raycaster.ray.intersectPlane(drag.dragPlane, _dragHitPoint);
        if (!hit) return;

        const dxWorld = hit.x - drag.startHitPoint.x;
        const dzWorld = hit.z - drag.startHitPoint.z;

        const minAllowedDx = Math.max(...drag.items.map(it => 10 - it.startNodeX));
        const minAllowedDy = Math.max(...drag.items.map(it => 10 - it.startNodeY));
        const totalDx = Math.max(minAllowedDx, dxWorld / WORLD_SCALE);
        const totalDy = Math.max(minAllowedDy, dzWorld / WORLD_SCALE);

        // 1) Update all dragged 3D mesh groups immediately at 60fps
        for (const item of drag.items) {
          item.group.position.set(
            item.startGroupPos.x + totalDx * WORLD_SCALE,
            item.startGroupPos.y,
            item.startGroupPos.z + totalDy * WORLD_SCALE
          );
        }

        // 2) Update connected 3D cables in real time
        for (const ce of refs.cableEntries) {
          if (!drag.draggedIdSet.has(ce.sourceNodeId) && !drag.draggedIdSet.has(ce.targetNodeId)) continue;
          const srcEntry = refs.nodeGroups.get(ce.sourceNodeId);
          const tgtEntry = refs.nodeGroups.get(ce.targetNodeId);
          if (!srcEntry || !tgtEntry) continue;
          const srcGrp = srcEntry.group;
          const tgtGrp = tgtEntry.group;
          const nextCurve = build3DCableCurve(
            ce.cable,
            { x: srcGrp.position.x, z: srcGrp.position.z },
            { x: tgtGrp.position.x, z: tgtGrp.position.z },
            ce.sourceIsRack,
            ce.targetIsRack,
            ce.laneIndex,
            ce.laneCount,
            explodeSpreadRef.current,
            refs.origin,
            srcEntry.floorY,
            tgtEntry.floorY
          );
          ce.midWorld.copy(nextCurve.midWorld);
          const nextGeo = build3DCableGeometry(
            ce.cable,
            { x: srcGrp.position.x, z: srcGrp.position.z },
            { x: tgtGrp.position.x, z: tgtGrp.position.z },
            ce.sourceIsRack,
            ce.targetIsRack,
            ce.laneIndex,
            ce.laneCount,
            explodeSpreadRef.current,
            refs.origin,
            selectionRef.current.type === 'edge' && selectionRef.current.id === ce.cable.id,
            srcEntry.floorY,
            tgtEntry.floorY
          );
          ce.mesh.geometry.dispose();
          ce.mesh.geometry = nextGeo;
        }

        // 3) Sync live delta into store (rebuild effect skips while dragSessionRef is active)
        const stepDx = totalDx - drag.lastAppliedDx;
        const stepDy = totalDy - drag.lastAppliedDy;
        if (stepDx !== 0 || stepDy !== 0) {
          drag.lastAppliedDx = totalDx;
          drag.lastAppliedDy = totalDy;
          onMoveNodesTransientRef.current?.(Array.from(drag.draggedIdSet), stepDx, stepDy);
        }

        setDraggingHud({
          label: drag.label,
          x: Math.round(drag.startAnchorX + totalDx),
          y: Math.round(drag.startAnchorY + totalDy)
        });
        refs.requestRender();
        return;
      }

      if (
        activeToolRef.current === 'connect' &&
        !isSceneDragLockedRef.current &&
        !isReadOnlyRef.current
      ) {
        if (connectSourceIdRef.current) {
          updateConnectPreview(e.clientX, e.clientY);
        }
        renderer.domElement.style.cursor = 'crosshair';
        return;
      }

      // Throttled hover cursor feedback when not dragging
      const now = performance.now();
      if (now - lastHoverCheck < 45) return;
      lastHoverCheck = now;

      const picked = pickObjectAt(e.clientX, e.clientY);
      if (picked && !isReadOnlyRef.current) {
        if (picked.selectType === 'edge' || isSceneDragLockedRef.current) {
          renderer.domElement.style.cursor = 'pointer';
        } else {
          const entry = refs.nodeGroups.get(picked.nodeId);
          const currProj = projectRef.current;
          const canMove =
            entry &&
            canDragNodeIn3DScene(entry.node, currProj.settings, currProj.assets, {
              isReadOnlyMode: isReadOnlyRef.current,
              isSceneDragLocked: false
            });
          renderer.domElement.style.cursor = canMove ? 'grab' : 'not-allowed';
        }
      } else {
        renderer.domElement.style.cursor = 'default';
      }
    };

    const finishPointerInteraction = (e: PointerEvent, cancelled = false) => {
      const drag = dragSessionRef.current;
      const wasOrbiting = controls.enabled;

      if (!controls.enabled) {
        controls.enabled = true;
        try {
          if (drag && renderer.domElement.hasPointerCapture(drag.pointerId)) {
            renderer.domElement.releasePointerCapture(drag.pointerId);
          }
        } catch {
          // ignore
        }
      }

      renderer.domElement.style.cursor = 'default';
      setDraggingHud(null);

      if (drag?.hasMoved && !cancelled) {
        const committedIds = Array.from(drag.draggedIdSet);
        dragSessionRef.current = null;
        onSnapNodesAndCommitDragRef.current?.(committedIds);
        setRebuildNonce(n => n + 1);
        return;
      }

      dragSessionRef.current = null;

      if (cancelled) {
        setRebuildNonce(n => n + 1);
        return;
      }

      // Treat short press without drag as standard click-to-select (when not orbiting empty space)
      const moveDist = drag
        ? Math.hypot(e.clientX - drag.startClientPos.x, e.clientY - drag.startClientPos.y)
        : 0;

      if (drag && moveDist <= 6) {
        if (e.shiftKey && drag.selectType === 'node' && onToggleNodeSelectionRef.current) {
          onToggleNodeSelectionRef.current(drag.nodeId || drag.selectId);
        } else {
          onSelectRef.current(drag.selectType, drag.selectId);
        }
      } else if (!drag && wasOrbiting) {
        const picked = pickObjectAt(e.clientX, e.clientY);
        if (picked) {
          if (e.shiftKey && picked.selectType === 'node' && onToggleNodeSelectionRef.current) {
            onToggleNodeSelectionRef.current(picked.nodeId || picked.selectId);
          } else {
            onSelectRef.current(picked.selectType, picked.selectId);
          }
        }
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (!dragSessionRef.current && controls.enabled) {
        return;
      }
      finishPointerInteraction(e, false);
    };

    const handlePointerCancel = (e: PointerEvent) => {
      finishPointerInteraction(e, true);
    };

    let bgDownPos: { x: number; y: number } | null = null;
    const handleBgPointerDown = (e: PointerEvent) => {
      if (e.button === 0 && !dragSessionRef.current) {
        bgDownPos = { x: e.clientX, y: e.clientY };
      } else {
        bgDownPos = null;
      }
    };
    const handleBgPointerUp = (e: PointerEvent) => {
      if (bgDownPos && Math.hypot(e.clientX - bgDownPos.x, e.clientY - bgDownPos.y) <= 5) {
        const picked = pickObjectAt(e.clientX, e.clientY);
        if (!picked) {
          onSelectRef.current('none');
        }
      }
      bgDownPos = null;
    };

    const handleDoubleClick = (e: MouseEvent) => {
      const picked = pickObjectAt(e.clientX, e.clientY);
      if (picked?.selectType === 'rack') {
        onOpenDeepInspectRef.current(picked.selectId);
      }
    };

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      onContextLostChange?.(true);
      setWebglError('Kết nối WebGL tạm gián đoạn. Vui lòng chuyển lại chế độ 3D để khôi phục.');
    };
    const handleContextRestored = () => {
      onContextLostChange?.(false);
      setWebglError(null);
      requestRender();
    };

    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerdown', handleBgPointerDown);
    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);
    renderer.domElement.addEventListener('pointerup', handleBgPointerUp);
    renderer.domElement.addEventListener('pointercancel', handlePointerCancel);
    renderer.domElement.addEventListener('dblclick', handleDoubleClick);
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    requestRender();

    return () => {
      disposed = true;
      if (rafId) cancelAnimationFrame(rafId);
      resizeObs.disconnect();
      controls.removeEventListener('change', handleControlChange);
      controls.removeEventListener('start', handleControlStart);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerdown', handleBgPointerDown);
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      renderer.domElement.removeEventListener('pointerup', handleBgPointerUp);
      renderer.domElement.removeEventListener('pointercancel', handlePointerCancel);
      renderer.domElement.removeEventListener('dblclick', handleDoubleClick);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);
      controls.dispose();
      const keepTextures = new Set<THREE.Texture>([shadowTex, lockBadgeTex]);
      disposeObjectTree(worldRoot, keepTextures);
      disposeObjectTree(axesGroup);
      disposeObjectTree(connectPreviewLine);
      disposeObjectTree(dropPreviewGroup);
      shadowTex.dispose();
      lockBadgeTex.dispose();
      studioRig.dispose();
      renderer.dispose();
      sceneRefs.current = null;
    };
  }, []);

  // Sync theme changes without tearing down WebGL context
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    refs.studioRig.updateTheme(project.settings.isDarkMode);
    refs.requestRender();
  }, [project.settings.isDarkMode]);

  // Toggle World XYZ Axes Helper visibility
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs) return;
    refs.axesGroup.visible = showAxes;
    refs.requestRender();
  }, [showAxes]);

  // Reset multi-floor cutaway preference when switching projects
  useEffect(() => {
    if (prevProjectIdRef.current !== project.id) {
      prevProjectIdRef.current = project.id;
      setViewAllFloors(project.floors.length > 1);
      autoFrameNextBuildRef.current = true;
    }
  }, [project.id, project.floors.length]);

  useEffect(() => {
    if (prevViewAllFloorsRef.current !== viewAllFloors || prevActiveModeRef.current !== project.activeMode) {
      prevViewAllFloorsRef.current = viewAllFloors;
      prevActiveModeRef.current = project.activeMode;
      autoFrameNextBuildRef.current = true;
    }
  }, [viewAllFloors, project.activeMode]);

  const selectionAdditionalIdsKey = (selection.additionalIds || []).join(',');

  // Rebuild 3D infrastructure entities when project, selection, or toggles change (paused during active 3D drag)
  useEffect(() => {
    const refs = sceneRefs.current;
    if (!refs || dragSessionRef.current?.hasMoved) return;

    disposeObjectTree(refs.worldRoot, new Set<THREE.Texture>([refs.shadowTex, refs.lockBadgeTex]));
    refs.worldRoot.clear();

    const populated = populateInfrastructure3DWorld(refs.worldRoot, project, selection, {
      showRooms: true,
      showCables: true,
      explodeSpread,
      castShadow: !refs.isSoftwareGl,
      shadowTex: refs.shadowTex,
      lockBadgeTex: refs.lockBadgeTex,
      viewAllFloors
    });
    refs.origin = populated.origin;
    refs.worldBounds = populated.bounds;
    refs.nodeGroups = populated.nodeGroups;
    refs.cableEntries = populated.cableEntries;
    refs.shadowToRackNodeId = populated.shadowToRackNodeId;

    // Adapt camera clip planes and orbit bounds for multi-storey buildings
    refs.controls.maxDistance = Math.max(48, populated.bounds.size * 2.8);
    refs.camera.far = Math.max(180, populated.bounds.size * 6);
    refs.camera.updateProjectionMatrix();

    if (autoFrameNextBuildRef.current) {
      autoFrameNextBuildRef.current = false;
      applyCameraPreset(activePreset, true);
    } else {
      refs.requestRender();
    }
  }, [
    project,
    selection,
    selection.type,
    selection.id,
    selectionAdditionalIdsKey,
    explodeSpread,
    viewAllFloors,
    rebuildNonce,
    applyCameraPreset,
    activePreset
  ]);

  // Persist free dock coordinates & clamp on resize/collapse
  useEffect(() => {
    try {
      if (dockFreePos) {
        window.localStorage.setItem(DOCK_FREE_POS_STORAGE_KEY, JSON.stringify(dockFreePos));
      } else {
        window.localStorage.removeItem(DOCK_FREE_POS_STORAGE_KEY);
      }
    } catch {
      // ignore
    }
  }, [dockFreePos]);

  useEffect(() => {
    if (dockEdge !== 'free' || !dockFreePos) return;
    const containerEl = rootRef.current;
    const dockEl = dockRef.current;
    if (!containerEl || !dockEl) return;

    const clampDock = () => {
      const cRect = containerEl.getBoundingClientRect();
      const dRect = dockEl.getBoundingClientRect();
      if (cRect.width <= 0 || cRect.height <= 0) return;
      const next = clampFloatingPosition(dockFreePos, dRect.width, dRect.height, cRect.width, cRect.height, 8);
      if (next.x !== dockFreePos.x || next.y !== dockFreePos.y) {
        setDockFreePos(next);
      }
    };

    clampDock();
    const ro = new ResizeObserver(clampDock);
    ro.observe(containerEl);
    ro.observe(dockEl);
    return () => ro.disconnect();
  }, [dockEdge, dockFreePos, dockCollapsed, dockDrawer]);

  // Drag-and-drop handler for snapping the 3D Control Dock to Bottom, Left, Right OR moving freely anywhere
  const handleDockDragPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const container = rootRef.current;
    if (!container) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    let lastPreview: { left: number; top: number; previewEdge: DockEdge; freePos?: FloatingPanelPosition } = {
      left: 0,
      top: 0,
      previewEdge: dockEdge
    };

    const computeDropFromPointer = (clientX: number, clientY: number) => {
      const rect = container.getBoundingClientRect();
      const dRect = dockRef.current?.getBoundingClientRect();
      const panelW = dRect?.width || 240;
      const panelH = dRect?.height || 42;
      const relX = Math.max(16, Math.min(rect.width - 16, clientX - rect.left));
      const relY = Math.max(16, Math.min(rect.height - 16, clientY - rect.top));
      const resolved = resolveEdgeOrFreeDrop(relX, relY, panelW, panelH, rect.width, rect.height);
      return {
        left: relX,
        top: relY,
        previewEdge: resolved.mode,
        freePos: resolved.freePos
      };
    };

    const onMove = (ev: PointerEvent) => {
      if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) {
        return;
      }
      dragging = true;
      const preview = computeDropFromPointer(ev.clientX, ev.clientY);
      lastPreview = preview;
      setDockDragPreview(preview);
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (dragging) {
        setDockEdge(lastPreview.previewEdge);
        if (lastPreview.previewEdge === 'free' && lastPreview.freePos) {
          setDockFreePos(lastPreview.freePos);
        } else {
          setDockFreePos(null);
        }
        setDockDragPreview(null);
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [dockEdge]);

  const isVerticalDock = dockEdge === 'left' || dockEdge === 'right';
  const dockPositionClass =
    dockEdge === 'free' && dockFreePos
      ? 'left-0 top-0'
      : dockEdge === 'left'
      ? 'left-2.5 top-1/2 -translate-y-1/2'
      : dockEdge === 'right'
      ? 'right-2.5 top-[54%] -translate-y-1/2'
      : 'bottom-14 left-3';

  const snapEdgeLabel =
    dockDragPreview?.previewEdge === 'left'
      ? 'Xếp gọn bên trái'
      : dockDragPreview?.previewEdge === 'right'
      ? 'Xếp gọn bên phải'
      : dockDragPreview?.previewEdge === 'bottom'
      ? 'Xếp gọn xuống dưới'
      : 'Đặt tự do tại đây';

  const selectedPanelDefaultPosClass =
    !showAxes || xyzPanel.position
      ? 'top-3 right-2.5'
      : xyzPanel.collapsed
      ? 'top-12 right-2.5'
      : 'top-[126px] right-2.5';

  useEffect(() => {
    if (dropPromptState === 'idle') return;
    const clearDropPrompt = () => setDropPromptState('idle');
    window.addEventListener('dragend', clearDropPrompt);
    window.addEventListener('drop', clearDropPrompt);
    return () => {
      window.removeEventListener('dragend', clearDropPrompt);
      window.removeEventListener('drop', clearDropPrompt);
    };
  }, [dropPromptState]);

  const handle3DDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
        return;
      }
      const canInsert = canAddDevicesInScene({
        isReadOnlyMode,
        is3DView: true,
        is3DDragLocked: isSceneDragLocked
      });
      if (!canInsert || !onDropDevice) {
        if (!isReadOnlyMode && isSceneDragLocked) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'none';
          setDropPromptState('locked');
        }
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropPromptState('ready');
      const catalogMatch = draggedPresetName
        ? DEVICE_CATALOG.find(p => p.name === draggedPresetName)
        : undefined;
      const isRack = Boolean(
        catalogMatch?.category === 'rack' ||
          draggedPresetName?.toLowerCase().includes('rack')
      );
      const hit = raycastDropToFloorCanvas(e.clientX, e.clientY, {
        width: catalogMatch?.defaultWidth || 150,
        height: catalogMatch?.defaultHeight || 56,
        isRack
      });
      const refs = sceneRefs.current;
      if (refs && hit) {
        refs.dropPreviewGroup.position.set(hit.worldX, hit.worldY + 0.04, hit.worldZ);
        refs.dropPreviewFootprint.scale.set(
          Math.max(0.6, hit.worldW),
          1,
          Math.max(0.6, hit.worldD)
        );
        refs.dropPreviewGroup.visible = true;
        refs.requestRender();
      }
    },
    [isReadOnlyMode, isSceneDragLocked, onDropDevice, draggedPresetName, raycastDropToFloorCanvas]
  );

  const handle3DDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (rootRef.current && !rootRef.current.contains(e.relatedTarget as Node)) {
      setDropPromptState('idle');
      const refs = sceneRefs.current;
      if (refs && refs.dropPreviewGroup.visible) {
        refs.dropPreviewGroup.visible = false;
        refs.requestRender();
      }
    }
  }, []);

  const handle3DDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      setDropPromptState('idle');
      const refs = sceneRefs.current;
      if (refs && refs.dropPreviewGroup.visible) {
        refs.dropPreviewGroup.visible = false;
        refs.requestRender();
      }
      if (e.dataTransfer?.types && Array.from(e.dataTransfer.types).includes('Files')) {
        return;
      }
      const canInsert = canAddDevicesInScene({
        isReadOnlyMode,
        is3DView: true,
        is3DDragLocked: isSceneDragLocked
      });
      if (!canInsert || !onDropDevice) return;

      e.preventDefault();
      e.stopPropagation();

      const presetName =
        e.dataTransfer.getData('presetName') ||
        e.dataTransfer.getData('text/plain') ||
        draggedPresetName ||
        '';
      const customPresetId = e.dataTransfer.getData('customPresetId') || undefined;
      if (!presetName) return;

      const customMatch = customPresetId
        ? loadCustomDevicePresets().find(c => c.id === customPresetId)
        : undefined;
      const catalogMatch = customMatch || DEVICE_CATALOG.find(p => p.name === presetName);
      const isRack = Boolean(
        catalogMatch?.category === 'rack' || presetName.toLowerCase().includes('rack')
      );
      const hit = raycastDropToFloorCanvas(e.clientX, e.clientY, {
        width: catalogMatch?.defaultWidth || 150,
        height: catalogMatch?.defaultHeight || 56,
        isRack
      });

      onDropDevice(presetName, hit?.x ?? 300, hit?.y ?? 200, customPresetId);
    },
    [
      isReadOnlyMode,
      isSceneDragLocked,
      onDropDevice,
      draggedPresetName,
      raycastDropToFloorCanvas
    ]
  );

  // Touch drag session uses DragSessionItem['selectType'] compatibility: allow 'edge' in DragSession
  return (
    <div
      ref={rootRef}
      onDragOver={handle3DDragOver}
      onDragLeave={handle3DDragLeave}
      onDrop={handle3DDrop}
      className="w-full h-full relative overflow-hidden bg-slate-950 select-none"
    >
      {/* Dedicated WebGL Mount Container */}
      <div ref={mountRef} className="w-full h-full relative" />

      {dropPromptState !== 'idle' && (
        <div className="pointer-events-none absolute top-14 left-1/2 -translate-x-1/2 z-30">
          <div
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold shadow-lg border backdrop-blur-xs ${
              dropPromptState === 'ready'
                ? 'bg-emerald-600/90 text-white border-emerald-400/60'
                : 'bg-amber-600/95 text-white border-amber-400/60'
            }`}
          >
            {dropPromptState === 'ready'
              ? 'Thả để đặt thiết bị vào tầng hiện tại'
              : 'Đang khóa kéo 3D — Nhấn Mở khóa để thêm/kéo thiết bị'}
          </div>
        </div>
      )}

      {webglError && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 text-white p-6 z-30">
          <div className="max-w-md rounded-xl border border-slate-700 bg-slate-900 p-5 text-center space-y-3">
            <Box className="w-8 h-8 text-blue-400 mx-auto" />
            <div className="font-bold text-sm">Không thể khởi tạo WebGL 3D</div>
            <p className="text-xs text-slate-300">{webglError}</p>
            <button
              onClick={onExit3D}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white"
            >
              Quay lại sơ đồ 2D CAD
            </button>
          </div>
        </div>
      )}

      {/* Movable & Collapsible 3D Info + Unlocked Interactive Tools Panel */}
      <div
        ref={toolsPanel.panelRef}
        data-testid="3d-tools-panel"
        style={
          toolsPanel.position
            ? { left: `${toolsPanel.position.x}px`, top: `${toolsPanel.position.y}px` }
            : undefined
        }
        className={`pointer-events-none absolute z-20 flex flex-col items-start gap-1.5 max-w-[calc(100%-24px)] ${
          toolsPanel.position ? '' : 'top-3 left-3'
        }`}
      >
        {toolsPanel.collapsed ? (
          <div className="pointer-events-auto flex items-center gap-1 px-1.5 py-1 rounded-lg bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-md text-[11px] text-slate-800 dark:text-slate-100">
            <button
              type="button"
              data-testid="3d-tools-drag-handle"
              onPointerDown={toolsPanel.handleDragStart}
              onDoubleClick={toolsPanel.resetPosition}
              title="Kéo để di chuyển thanh công cụ 3D · Nhấp đúp để về góc mặc định"
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
            >
              <GripVertical className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              data-testid="3d-tools-collapse-btn"
              onClick={toolsPanel.toggleCollapsed}
              title="Mở rộng thông tin và công cụ chỉnh sửa 3D"
              className="flex items-center gap-1.5 px-1.5 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold whitespace-nowrap"
            >
              <span className="text-blue-600 dark:text-blue-400">3D</span>
              <span className="tabular-nums text-slate-500 dark:text-slate-400">
                {visibleCountSummary.devices} TB · {visibleCountSummary.cables} cáp
              </span>
              {!isSceneDragLocked && !isReadOnlyMode && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              )}
              <Maximize2 className="w-3 h-3 text-slate-500 shrink-0" />
            </button>
          </div>
        ) : (
          <>
            <div className="pointer-events-auto flex items-center gap-2 px-2 py-1 rounded-lg bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-md text-[11px] text-slate-800 dark:text-slate-100">
              <button
                type="button"
                data-testid="3d-tools-drag-handle"
                onPointerDown={toolsPanel.handleDragStart}
                onDoubleClick={toolsPanel.resetPosition}
                title="Kéo để di chuyển thanh công cụ 3D · Nhấp đúp để về góc mặc định"
                className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
              >
                <GripVertical className="w-3.5 h-3.5" />
              </button>
              <span className="font-bold text-blue-600 dark:text-blue-400">Không gian 3D</span>
              <span className="text-slate-400">·</span>
              <span className="tabular-nums font-medium">
                {visibleCountSummary.devices} thiết bị · {visibleCountSummary.racks} tủ Rack · {visibleCountSummary.cables} cáp
              </span>
              {canMultiFloorCutaway && (
                <>
                  <span className="text-slate-400">·</span>
                  <span
                    className="text-slate-600 dark:text-slate-300 font-medium"
                    title="Chuyển xem toàn tòa / từng tầng trong nút Lớp"
                  >
                    {viewAllFloors ? `Toàn tòa (${project.floors.length} tầng)` : 'Chỉ tầng này'}
                  </span>
                </>
              )}
              <span className="text-slate-400 hidden lg:inline">·</span>
              <span className="text-slate-500 dark:text-slate-400 hidden lg:inline">
                {isSceneDragLocked
                  ? 'Đang khóa kéo thả · Nhấn Mở khóa cạnh nút 2D / 3D để chỉnh sửa'
                  : 'Đã mở khóa · Kéo thiết bị trực tiếp (công cụ dây ở thanh dưới)'}
              </span>
              <button
                type="button"
                data-testid="3d-tools-collapse-btn"
                onClick={toolsPanel.toggleCollapsed}
                title="Thu gọn thanh thông tin 3D để không che hình vẽ"
                className="ml-1 p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 shrink-0"
              >
                <Minimize2 className="w-3.5 h-3.5" />
              </button>
            </div>

            {activeTool === 'connect' && !isSceneDragLocked && !isReadOnlyMode && (
              <div className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-[11px] font-medium shadow-md flex items-center gap-1.5">
                <Spline className="w-3 h-3 shrink-0" />
                <span>
                  {connectSourceLabel
                    ? `Đang nối từ "${connectSourceLabel}" · Nhấp thiết bị đích (Esc để hủy)`
                    : 'Chế độ Nối dây 3D · Nhấp thiết bị nguồn để bắt đầu'}
                </span>
              </div>
            )}

            {draggingHud && (
              <div className="px-2.5 py-1 rounded-md bg-blue-600 text-white text-[11px] font-mono tabular-nums shadow-md flex items-center gap-1.5">
                <Move className="w-3 h-3 shrink-0" />
                <span className="font-sans font-semibold">{draggingHud.label}</span>
                <span>· X:{draggingHud.x} Y:{draggingHud.y}</span>
              </div>
            )}
          </>
        )}
      </div>

      {/* Movable & Collapsible Camera-Rotation-Matrix XYZ Axis Helper */}
      {showAxes && (
        <div
          ref={xyzPanel.panelRef}
          data-testid="3d-xyz-gizmo"
          aria-label="Helper trục tọa độ XYZ theo ma trận xoay camera"
          style={
            xyzPanel.position
              ? { left: `${xyzPanel.position.x}px`, top: `${xyzPanel.position.y}px` }
              : undefined
          }
          className={`pointer-events-auto absolute z-20 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-md p-1 flex flex-col items-center gap-0.5 ${
            xyzPanel.position ? '' : 'top-3 right-3'
          }`}
          title="Helper trục tọa độ XYZ cập nhật theo ma trận xoay camera (Nhấp X/Y/Z để căn góc nhìn)"
        >
          <div className="w-full flex items-center justify-between gap-1 px-0.5">
            <button
              type="button"
              data-testid="3d-xyz-drag-handle"
              onPointerDown={xyzPanel.handleDragStart}
              onDoubleClick={xyzPanel.resetPosition}
              title="Kéo để di chuyển bảng trục XYZ · Nhấp đúp về góc phải"
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
            >
              <GripHorizontal className="w-3 h-3" />
            </button>
            <span className="text-[10px] font-mono text-slate-500 dark:text-slate-400 leading-none select-none">
              XYZ
            </span>
            <button
              type="button"
              data-testid="3d-xyz-collapse-btn"
              onClick={xyzPanel.toggleCollapsed}
              title={xyzPanel.collapsed ? 'Mở rộng bảng trục XYZ' : 'Thu gọn bảng trục XYZ'}
              className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 shrink-0"
            >
              {xyzPanel.collapsed ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
            </button>
          </div>
          <svg
            width="76"
            height="76"
            viewBox="0 0 76 76"
            className={xyzPanel.collapsed ? 'hidden' : 'overflow-visible'}
          >
            <circle cx="38" cy="38" r="30" fill="none" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
            <g ref={gizmoLayerRef}>
              <g
                ref={gizmoGroupXRef}
                className="cursor-pointer"
                onClick={() => applyCameraPreset('side')}
              >
                <title>Trục +X (Nhấp để nhìn từ bên hông)</title>
                <line ref={gizmoNegLineXRef} x1="38" y1="38" x2="26" y2="38" stroke="#ef4444" strokeOpacity="0.35" strokeWidth="1.4" strokeDasharray="2 2" strokeLinecap="round" />
                <line ref={gizmoPosLineXRef} x1="38" y1="38" x2="60" y2="38" stroke="#ef4444" strokeWidth="2.4" strokeLinecap="round" />
                <circle ref={gizmoDotXRef} cx="60" cy="38" r="2.8" fill="#ef4444" />
                <text ref={gizmoTextXRef} x="68" y="41" fill="#ef4444" fontSize="10" fontWeight="700" textAnchor="middle">X</text>
              </g>
              <g
                ref={gizmoGroupYRef}
                className="cursor-pointer"
                onClick={() => applyCameraPreset('top')}
              >
                <title>Trục +Y (Nhấp để nhìn từ trên xuống)</title>
                <line ref={gizmoNegLineYRef} x1="38" y1="38" x2="38" y2="50" stroke="#22c55e" strokeOpacity="0.35" strokeWidth="1.4" strokeDasharray="2 2" strokeLinecap="round" />
                <line ref={gizmoPosLineYRef} x1="38" y1="38" x2="38" y2="16" stroke="#22c55e" strokeWidth="2.4" strokeLinecap="round" />
                <circle ref={gizmoDotYRef} cx="38" cy="16" r="2.8" fill="#22c55e" />
                <text ref={gizmoTextYRef} x="38" y="10" fill="#22c55e" fontSize="10" fontWeight="700" textAnchor="middle">Y</text>
              </g>
              <g
                ref={gizmoGroupZRef}
                className="cursor-pointer"
                onClick={() => applyCameraPreset('front')}
              >
                <title>Trục +Z (Nhấp để nhìn trực diện)</title>
                <line ref={gizmoNegLineZRef} x1="38" y1="38" x2="46" y2="29" stroke="#3b82f6" strokeOpacity="0.35" strokeWidth="1.4" strokeDasharray="2 2" strokeLinecap="round" />
                <line ref={gizmoPosLineZRef} x1="38" y1="38" x2="24" y2="53" stroke="#3b82f6" strokeWidth="2.4" strokeLinecap="round" />
                <circle ref={gizmoDotZRef} cx="24" cy="53" r="2.8" fill="#3b82f6" />
                <text ref={gizmoTextZRef} x="18" y="61" fill="#3b82f6" fontSize="10" fontWeight="700" textAnchor="middle">Z</text>
              </g>
            </g>
            <circle cx="38" cy="38" r="2.8" className="fill-slate-600 dark:fill-slate-300 pointer-events-none" />
          </svg>
        </div>
      )}

      {/* Vertical, Right-Corner Docked, Draggable & Collapsible Selected 3D Object Action Panel */}
      {selectedTarget && !draggingHud && (
        <div
          ref={selectedPanel.panelRef}
          data-testid="3d-selected-object-bar"
          data-collapsed={selectedPanel.collapsed ? 'true' : 'false'}
          style={
            selectedPanel.position
              ? { left: `${selectedPanel.position.x}px`, top: `${selectedPanel.position.y}px` }
              : undefined
          }
          className={`pointer-events-auto absolute z-20 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg text-xs text-slate-800 dark:text-slate-100 ${
            selectedPanel.position ? '' : selectedPanelDefaultPosClass
          }`}
        >
          {selectedPanel.collapsed ? (
            <div className="p-1 flex flex-col items-center gap-1 w-9">
              <button
                type="button"
                data-testid="3d-selected-drag-handle"
                onPointerDown={selectedPanel.handleDragStart}
                onDoubleClick={selectedPanel.resetPosition}
                title="Kéo để di chuyển thanh đối tượng · Nhấp đúp về góc phải"
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
              >
                <GripHorizontal className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                data-testid="3d-selected-collapse-btn"
                onClick={e => {
                  e.stopPropagation();
                  selectedPanel.toggleCollapsed();
                }}
                title={`Mở rộng thông tin ${selectedTarget.label}`}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 shrink-0"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                data-testid="3d-toggle-lock-btn"
                disabled={isReadOnlyMode || selectedTarget.layerLockedOnly || (!onToggleNodeLock && !onUpdateNode)}
                onClick={e => {
                  e.stopPropagation();
                  handleToggleSelectedLock();
                }}
                title={
                  selectedTarget.layerLockedOnly
                    ? `${selectedTarget.label} đang khóa theo Lớp thiết kế`
                    : selectedTarget.isNodeLocked
                    ? `Mở khóa ${selectedTarget.label}`
                    : `Khóa vị trí ${selectedTarget.label}`
                }
                className={`p-1.5 rounded-md transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                  selectedTarget.isNodeLocked
                    ? 'bg-amber-500 hover:bg-amber-600 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600'
                }`}
              >
                {selectedTarget.isNodeLocked ? (
                  <Unlock className="w-3.5 h-3.5" />
                ) : (
                  <Lock className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ) : (
            <div className="w-[132px] p-1.5 flex flex-col items-stretch gap-1.5">
              <div className="flex items-center justify-between gap-1 pb-1 border-b border-slate-200/80 dark:border-slate-800">
                <button
                  type="button"
                  data-testid="3d-selected-drag-handle"
                  onPointerDown={selectedPanel.handleDragStart}
                  onDoubleClick={selectedPanel.resetPosition}
                  title="Kéo để di chuyển · Nhấp đúp về góc phải"
                  className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
                >
                  <GripHorizontal className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 select-none truncate">
                  Đối tượng
                </span>
                <button
                  type="button"
                  data-testid="3d-selected-collapse-btn"
                  onClick={e => {
                    e.stopPropagation();
                    selectedPanel.toggleCollapsed();
                  }}
                  title="Thu gọn thanh đối tượng"
                  className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 shrink-0"
                >
                  <Minimize2 className="w-3 h-3" />
                </button>
              </div>

              <div
                title={selectedTarget.label}
                className="font-semibold text-[11px] leading-snug text-slate-900 dark:text-slate-100 break-words line-clamp-2"
              >
                {selectedTarget.label}
              </div>

              <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 bg-slate-100/80 dark:bg-slate-800/70 rounded px-1.5 py-0.5">
                <span>X:{selectedTarget.x}</span>
                <span>Y:{selectedTarget.y}</span>
              </div>

              {selectedTarget.isEffectiveLocked ? (
                <div className="px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300 text-[10px] font-semibold text-center">
                  {selectedTarget.layerLockedOnly ? 'Khóa lớp' : 'Đã khóa'}
                </div>
              ) : isSceneDragLocked ? (
                <div className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-medium text-center">
                  Khóa kéo 3D
                </div>
              ) : null}

              <button
                type="button"
                data-testid="3d-toggle-lock-btn"
                disabled={isReadOnlyMode || selectedTarget.layerLockedOnly || (!onToggleNodeLock && !onUpdateNode)}
                onClick={e => {
                  e.stopPropagation();
                  handleToggleSelectedLock();
                }}
                title={
                  selectedTarget.layerLockedOnly
                    ? 'Đối tượng đang bị khóa theo Lớp thiết kế'
                    : selectedTarget.isNodeLocked
                    ? 'Mở khóa vị trí (cập nhật customData.locked = false) để cho phép kéo thả trong 3D'
                    : 'Khóa vị trí (lưu customData.locked = true) để ngăn kéo thả ngoài ý muốn'
                }
                className={`w-full flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                  selectedTarget.isNodeLocked
                    ? 'bg-amber-500 hover:bg-amber-600 text-white'
                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-100 border border-slate-300 dark:border-slate-600'
                }`}
              >
                {selectedTarget.isNodeLocked ? (
                  <>
                    <Unlock className="w-3 h-3 shrink-0" />
                    <span>Mở khóa</span>
                  </>
                ) : (
                  <>
                    <Lock className="w-3 h-3 shrink-0" />
                    <span>Khóa</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Vertical, Right-Corner Docked, Draggable & Collapsible Selected 3D Cable Panel */}
      {selectedCable && !selectedTarget && !draggingHud && (
        <div
          ref={selectedPanel.panelRef}
          data-testid="3d-selected-cable-bar"
          data-collapsed={selectedPanel.collapsed ? 'true' : 'false'}
          style={
            selectedPanel.position
              ? { left: `${selectedPanel.position.x}px`, top: `${selectedPanel.position.y}px` }
              : undefined
          }
          className={`pointer-events-auto absolute z-20 rounded-xl bg-white/95 dark:bg-slate-900/95 border border-sky-300 dark:border-sky-700 shadow-lg text-xs text-slate-800 dark:text-slate-100 ${
            selectedPanel.position ? '' : selectedPanelDefaultPosClass
          }`}
        >
          {selectedPanel.collapsed ? (
            <div className="p-1 flex flex-col items-center gap-1 w-9">
              <button
                type="button"
                data-testid="3d-selected-drag-handle"
                onPointerDown={selectedPanel.handleDragStart}
                onDoubleClick={selectedPanel.resetPosition}
                title="Kéo để di chuyển · Nhấp đúp về góc phải"
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
              >
                <GripHorizontal className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                data-testid="3d-selected-collapse-btn"
                onClick={e => {
                  e.stopPropagation();
                  selectedPanel.toggleCollapsed();
                }}
                title={`Mở rộng thông tin ${selectedCable.cable.cableCode}`}
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-sky-500 shrink-0"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="w-[136px] p-1.5 flex flex-col items-stretch gap-1.5">
              <div className="flex items-center justify-between gap-1 pb-1 border-b border-slate-200/80 dark:border-slate-800">
                <button
                  type="button"
                  data-testid="3d-selected-drag-handle"
                  onPointerDown={selectedPanel.handleDragStart}
                  onDoubleClick={selectedPanel.resetPosition}
                  title="Kéo để di chuyển · Nhấp đúp về góc phải"
                  className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
                >
                  <GripHorizontal className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-sky-600 dark:text-sky-400 select-none truncate">
                  Tuyến cáp
                </span>
                <button
                  type="button"
                  data-testid="3d-selected-collapse-btn"
                  onClick={e => {
                    e.stopPropagation();
                    selectedPanel.toggleCollapsed();
                  }}
                  title="Thu gọn thanh tuyến cáp"
                  className="p-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-100 shrink-0"
                >
                  <Minimize2 className="w-3 h-3" />
                </button>
              </div>

              <div className="flex items-center gap-1 font-semibold text-[11px]">
                <GitBranch className="w-3.5 h-3.5 text-sky-500 shrink-0" />
                <span className="truncate">{selectedCable.cable.cableCode}</span>
              </div>

              <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight break-words">
                {selectedCable.sourceLabel} → {selectedCable.targetLabel}
              </div>

              <div className="px-1.5 py-0.5 rounded bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 text-[10px] font-medium border border-sky-200 dark:border-sky-800 text-center">
                {selectedCable.cable.routingType === 'straight'
                  ? 'Thẳng'
                  : selectedCable.cable.routingType === 'curved'
                  ? 'Bo tròn'
                  : 'Vuông góc'}
              </div>

              {onDeleteCable && (
                <button
                  type="button"
                  disabled={isReadOnlyMode || isSceneDragLocked}
                  onClick={e => {
                    e.stopPropagation();
                    onDeleteCable(selectedCable.cable.id);
                    onSelect('none');
                  }}
                  title={
                    isSceneDragLocked ? 'Mở khóa kéo 3D để xóa cáp' : 'Xóa tuyến cáp này'
                  }
                  className="w-full flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-rose-600 dark:text-rose-400 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-950/70 disabled:opacity-45 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3 h-3 shrink-0" />
                  <span>Xóa cáp</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Edge Snap Drop-Zone Visual Guides While Dragging the 3D Control Dock */}
      {dockDragPreview && (
        <div className="pointer-events-none absolute inset-0 z-20">
          <div
            className={`absolute left-2 top-1/2 -translate-y-1/2 w-12 h-44 rounded-xl border-2 border-dashed transition-colors flex items-center justify-center text-[10px] font-bold ${
              dockDragPreview.previewEdge === 'left'
                ? 'border-blue-400 bg-blue-500/20 text-blue-200'
                : 'border-slate-500/40 bg-slate-800/20 text-slate-400'
            }`}
          >
            <span className="-rotate-90 whitespace-nowrap">Trái</span>
          </div>
          <div
            className={`absolute right-2 top-[54%] -translate-y-1/2 w-12 h-44 rounded-xl border-2 border-dashed transition-colors flex items-center justify-center text-[10px] font-bold ${
              dockDragPreview.previewEdge === 'right'
                ? 'border-blue-400 bg-blue-500/20 text-blue-200'
                : 'border-slate-500/40 bg-slate-800/20 text-slate-400'
            }`}
          >
            <span className="rotate-90 whitespace-nowrap">Phải</span>
          </div>
          <div
            className={`absolute bottom-2 left-1/2 -translate-x-1/2 w-56 h-10 rounded-xl border-2 border-dashed transition-colors flex items-center justify-center text-[10px] font-bold ${
              dockDragPreview.previewEdge === 'bottom'
                ? 'border-blue-400 bg-blue-500/20 text-blue-200'
                : 'border-slate-500/40 bg-slate-800/20 text-slate-400'
            }`}
          >
            Dưới
          </div>
          <div
            style={{
              left: `${Math.round(dockDragPreview.left)}px`,
              top: `${Math.round(dockDragPreview.top)}px`,
              transform: 'translate(-50%, -50%)'
            }}
            className="absolute px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold shadow-xl border border-blue-300 whitespace-nowrap"
          >
            {snapEdgeLabel}
          </div>
        </div>
      )}

      {/* Draggable, Edge-Snapping (Bottom / Left / Right) OR Free-Moving, Collapsible 3D Control Dock */}
      <div
        ref={dockRef}
        data-testid="3d-control-dock"
        data-dock-edge={dockEdge}
        data-dock-collapsed={dockCollapsed ? 'true' : 'false'}
        style={
          dockEdge === 'free' && dockFreePos
            ? { left: `${dockFreePos.x}px`, top: `${dockFreePos.y}px` }
            : undefined
        }
        className={`pointer-events-none absolute z-20 ${dockPositionClass} ${
          isVerticalDock ? 'max-h-[calc(100%-132px)]' : 'max-w-[95vw]'
        }`}
      >
        {dockCollapsed ? (
          <div
            className={`pointer-events-auto rounded-lg bg-white/95 dark:bg-slate-900/95 border border-slate-200 dark:border-slate-700 shadow-lg p-1 text-xs text-slate-800 dark:text-slate-100 flex ${
              isVerticalDock ? 'flex-col' : 'flex-row'
            } items-center gap-1`}
          >
            <button
              type="button"
              data-testid="3d-dock-drag-handle"
              onPointerDown={handleDockDragPointerDown}
              onDoubleClick={() => {
                setDockEdge('bottom');
                setDockFreePos(null);
              }}
              title="Kéo thả để di chuyển tự do hoặc xếp gọn xuống dưới / trái / phải · Nhấp đúp về dưới"
              className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
            >
              {isVerticalDock ? <GripHorizontal className="w-3.5 h-3.5" /> : <GripVertical className="w-3.5 h-3.5" />}
            </button>
            <button
              type="button"
              data-testid="3d-dock-expand-btn"
              onClick={() => setDockCollapsed(false)}
              title="Mở rộng thanh điều khiển góc nhìn 3D"
              className={`flex items-center gap-1.5 px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold whitespace-nowrap transition-colors ${
                isVerticalDock ? 'flex-col py-1.5' : ''
              }`}
            >
              <Maximize2 className="w-3.5 h-3.5 shrink-0" />
              <span className="text-[11px]">{isVerticalDock ? '3D' : 'Điều khiển 3D'}</span>
            </button>
          </div>
        ) : (
          <div className="pointer-events-auto rounded-xl bg-white/96 dark:bg-slate-900/96 border border-slate-200 dark:border-slate-700 shadow-xl px-2 py-1.5 text-xs text-slate-800 dark:text-slate-100">
            <div
              className={`flex ${
                isVerticalDock ? 'flex-col items-stretch overflow-y-auto max-h-[calc(100vh-220px)]' : 'flex-row items-center overflow-x-auto flex-nowrap'
              } gap-1`}
            >
              <button
                type="button"
                data-testid="3d-dock-drag-handle"
                onPointerDown={handleDockDragPointerDown}
                onDoubleClick={() => {
                  setDockEdge('bottom');
                  setDockFreePos(null);
                }}
                title="Kéo thả để di chuyển tự do hoặc xếp gọn xuống dưới / bên trái / bên phải · Nhấp đúp về dưới"
                className="flex items-center justify-center p-1 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-grab active:cursor-grabbing shrink-0"
              >
                {isVerticalDock ? <GripHorizontal className="w-3.5 h-3.5" /> : <GripVertical className="w-3.5 h-3.5" />}
              </button>

              <button
                type="button"
                onClick={() => applyCameraPreset('iso')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activePreset === 'iso'
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Góc nhìn Isometric 3D"
              >
                <Compass className="w-3.5 h-3.5 shrink-0" />
                <span>Isometric</span>
              </button>

              <button
                type="button"
                onClick={() => applyCameraPreset('top')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activePreset === 'top'
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Chiếu bằng từ trên xuống"
              >
                <Layers className="w-3.5 h-3.5 shrink-0" />
                <span>Trên xuống</span>
              </button>

              <button
                type="button"
                onClick={() => applyCameraPreset('front')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activePreset === 'front'
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Nhìn trực diện tủ Rack"
              >
                <Box className="w-3.5 h-3.5 shrink-0" />
                <span>Trực diện</span>
              </button>

              <button
                type="button"
                onClick={() => applyCameraPreset('side')}
                className={`flex items-center gap-1 px-2 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                  activePreset === 'side'
                    ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title="Nhìn mặt cắt bên hông"
              >
                <Box className="w-3.5 h-3.5 shrink-0" />
                <span>Bên hông</span>
              </button>

              <div className={isVerticalDock ? 'h-px w-full bg-slate-200 dark:bg-slate-700 shrink-0 my-0.5' : 'h-5 w-px bg-slate-200 dark:bg-slate-700 shrink-0'} />

              <button
                type="button"
                data-testid="3d-dock-routing-toggle"
                onClick={() => setDockDrawer(d => (d === 'routing' ? 'none' : 'routing'))}
                className={`flex items-center justify-center gap-1 px-2 py-1 rounded-lg font-medium whitespace-nowrap shrink-0 transition-colors ${
                  dockDrawer === 'routing'
                    ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-700 dark:text-sky-300 border border-sky-300 dark:border-sky-800'
                    : 'hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
                title={
                  dockDrawer === 'routing'
                    ? 'Thu gọn menu kiểu dây & bo góc'
                    : 'Mở rộng menu kiểu dây (Vuông góc, Thẳng, Bo tròn, Bo góc)'
                }
              >
                <Spline className="w-3.5 h-3.5 shrink-0" />
                <span>Kiểu dây</span>
                {dockDrawer === 'routing' ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
              </button>

              <button
                type="button"
                data-testid="3d-dock-collapse-btn"
                onClick={() => setDockCollapsed(true)}
                className="flex items-center justify-center gap-1 px-1.5 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-100 shrink-0"
                title="Thu gọn thanh điều khiển 3D để không che hình vẽ"
              >
                <Minimize2 className="w-3.5 h-3.5 shrink-0" />
                {!isVerticalDock && <span className="text-[11px]">Thu gọn</span>}
              </button>
            </div>

            {dockDrawer === 'routing' && (
              <div
                data-testid="3d-dock-routing-panel"
                className={`mt-1.5 pt-1.5 border-t border-slate-200 dark:border-slate-800 flex ${
                  isVerticalDock
                    ? 'flex-col items-stretch'
                    : 'flex-row items-center justify-between flex-nowrap overflow-x-auto'
                } gap-1 text-[11px]`}
              >
                {selectedCable && (
                  <span className="text-[10px] font-semibold text-sky-700 dark:text-sky-300 px-1 whitespace-nowrap shrink-0">
                    {selectedCable.cable.cableCode}:
                  </span>
                )}

                {(
                  [
                    { id: 'orthogonal', label: 'Vuông góc' },
                    { id: 'straight', label: 'Thẳng' },
                    { id: 'curved', label: 'Bo tròn' }
                  ] as const
                ).map(opt => {
                  const targetRouting = selectedCable ? selectedCable.cable.routingType : preferredRouting;
                  const isActive = targetRouting === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      data-testid={`3d-routing-${opt.id}`}
                      disabled={isReadOnlyMode}
                      onClick={() => {
                        setPreferredRouting(opt.id);
                        if (selectedCable && onUpdateCable) {
                          onUpdateCable(selectedCable.cable.id, { routingType: opt.id });
                        }
                      }}
                      className={`px-2 py-1 rounded-md font-medium whitespace-nowrap shrink-0 transition-colors disabled:opacity-45 disabled:cursor-not-allowed ${
                        isActive
                          ? 'bg-sky-600 text-white shadow-xs'
                          : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300'
                      }`}
                      title={
                        selectedCable
                          ? `Đổi tuyến cáp ${selectedCable.cable.cableCode} sang kiểu ${opt.label}`
                          : `Chọn kiểu dây ${opt.label} cho cáp nối mới`
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
});

Network3DScene.displayName = 'Network3DScene';

