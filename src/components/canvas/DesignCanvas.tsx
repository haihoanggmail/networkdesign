import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  ProjectState,
  SelectionState,
  DiagramNode,
  CableEdge,
  CablePoint,
  Room,
  ServerRack,
  RackSide
} from '../../types/infrastructure';
import { CanvasTool } from '../../store/useProjectStore';
import { Box, Lock, Type } from 'lucide-react';
import { renderDeviceVisualIcon } from '../../utils/deviceIcons';
import {
  computeCablePath,
  computeCableBundleLayout,
  resolveCableLabelTransform,
  CableBundleInfo,
  normalizeCableColor
} from '../../utils/cableRouting';
import {
  computeGridIntersectionSnap,
  computeRefined2DDragSnap,
  DEFAULT_GRID_SNAP_THRESHOLD_PX,
  detectOverlappingNodes,
  AlignRect,
  AlignmentGuideLine
} from '../../utils/snapGuides';
import { resolveCanvasAppearance, processCanvasBackgroundImage } from '../../utils/canvasBackgrounds';
import {
  getLockedLayerSet,
  isNodeEffectivelyLocked,
  isRoomEffectivelyLocked,
  resolveNodeLayer
} from '../../utils/layerPolicy';
import { DEVICE_CATALOG, getCategoryAccentColor, isStandardCatalogNodeColor, loadCustomDevicePresets } from '../../data/deviceCatalog';
import {
  getAssetUHeight,
  getPresetUHeight,
  getRackCanvasMetrics,
  pixelYToRackU,
  canPlaceDeviceAtU,
  getSlotSpanRect,
  isRackMountedTopologyShadowNode,
  layoutRackNodesForElevationMode
} from '../../utils/rackGeometry';
import { sanitizeSafeImageUrl } from '../../utils/security';
import {
  CanvasCableGeometry,
  DraggingRackDeviceState,
  DraggingRoomState,
  DraggingWaypointState,
  RESIZE_HANDLE_DIRS,
  RackDropHit,
  ReconnectingCableState,
  ResizeHandleDir,
  ResizeSessionState
} from './canvasTypes';
import { CanvasRackNode } from './CanvasRackNode';
import { CanvasLegendNode } from './CanvasLegendNode';
import { CanvasSelectionOverlays } from './CanvasSelectionOverlays';
import { CanvasHudControls } from './CanvasHudControls';
import { CanvasGuideOverlay } from './CanvasGuideOverlay';

export interface Canvas2DDropApi {
  previewLibraryDrop: (
    clientX: number,
    clientY: number,
    presetName: string,
    footprint?: { width?: number; height?: number; isRack?: boolean; customPresetId?: string }
  ) => { x: number; y: number; rackHitName?: string; rackHitU?: number; rackHitValid?: boolean } | null;
  commitLibraryDrop: (
    clientX: number,
    clientY: number,
    presetName: string,
    footprint?: { width?: number; height?: number; isRack?: boolean; customPresetId?: string }
  ) => boolean;
  clearLibraryDropPreview: () => void;
  getCursorCanvasPos: () => { x: number; y: number } | null;
}

interface DesignCanvasProps {
  project: ProjectState;
  selection: SelectionState;
  activeTool: CanvasTool;
  zoom: number;
  pan: { x: number; y: number };
  connectingSource: { nodeId: string; portId?: string } | null;
  draggedPresetName?: string | null;
  isReadOnlyMode?: boolean;
  onSelect: (type: SelectionState['type'], id?: string, additionalIds?: string[]) => void;
  onToggleNodeSelection?: (nodeId: string) => void;
  onSelectMultipleNodes?: (nodeIds: string[]) => void;
  onBeginDragSnapshot?: () => void;
  onMoveNodesTransient?: (nodeIds: string[], dx: number, dy: number) => void;
  onSnapNodesAndCommitDrag?: (nodeIds: string[], options?: { snapX?: boolean; snapY?: boolean }) => void;
  onMoveNode: (nodeId: string, dx: number, dy: number) => void;
  onResizeNodeTransient?: (nodeId: string, rect: { x: number; y: number; width: number; height: number }) => void;
  onSnapNodeResizeAndCommit?: (nodeId: string) => void;
  onMoveRoomTransient?: (roomId: string, dx: number, dy: number) => void;
  onResizeRoomTransient?: (roomId: string, rect: { x: number; y: number; width: number; height: number }) => void;
  onSnapRoomAndCommit?: (roomId: string) => void;
  onUpdateNode?: (nodeId: string, partial: Partial<DiagramNode>) => void;
  onSetNodeIconOrLogo?: (nodeId: string, payload: { customIcon?: string; customImageUrl?: string }) => void;
  onDuplicateNodes?: (nodeIds: string[]) => void;
  onToggleNodeLock?: (nodeIds: string[]) => void;
  onToggleNodeVisibility?: (nodeIds: string[], forceHidden?: boolean) => void;
  onAddTextNode?: (x: number, y: number) => void;
  onSetTool?: (tool: CanvasTool) => void;
  onAddCable: (sourceNodeId: string, targetNodeId: string, sourcePortId?: string, targetPortId?: string) => void;
  onUpdateCableControlPoints?: (cableId: string, controlPoints: CablePoint[]) => void;
  onUpdateCable?: (cableId: string, partial: Partial<CableEdge>) => void;
  onSetCableColor?: (cableId: string, color: string) => void;
  onReconnectCableEndpoint?: (cableId: string, endpoint: 'source' | 'target', newNodeId: string) => void;
  onSetConnectingSource: (src: { nodeId: string; portId?: string } | null) => void;
  onPanChange: (pan: { x: number; y: number }) => void;
  onZoomChange: (zoom: number) => void;
  onOpenDeepInspect: (id: string) => void;
  onAddRoom: (room: Omit<Room, 'id'>) => void;
  onDeleteSelected: () => void;
  onDropDevice: (presetName: string, x: number, y: number, customPresetId?: string) => void;
  onDropDeviceIntoRack?: (presetName: string, rackId: string, preferredU: number, side?: RackSide) => void;
  onAssignDeviceToRackSlot?: (rackId: string, assetId: string, preferredU: number, side?: RackSide) => void;
  onRemoveDeviceFromRackSlot?: (rackId: string, assetIdOrU: string | number, side?: RackSide) => void;
  onUpdateWifiCoverageRadiusTransient?: (nodeId: string, radiusMeters: number) => void;
  onUpdateSettings?: (partial: Partial<ProjectState['settings']>) => void;
  onResizeLegendToFit?: (nodeId: string) => void;
  onAutoRouteCable?: (cableId: string) => void;
  onOpenCommandPalette?: () => void;
  onOpenTemplates?: () => void;
  onAddQuickDevice?: () => void;
  onAddRackAtCursor?: (x: number, y: number) => void;
  onOpenBuildingGenerator?: () => void;
  onSetActiveFloor?: (floorId: string) => void;
  onCloneFloor?: (floorId: string, newLevel: number, newName: string) => void;
  onNudgeNodes?: (nodeIds: string[], dx: number, dy: number) => void;
  showMinimap?: boolean;
  showBgMenu?: boolean;
  onSetShowBgMenu?: React.Dispatch<React.SetStateAction<boolean>>;
  onRegister2DDropApi?: (api: Canvas2DDropApi | null) => void;
}

export const DesignCanvas: React.FC<DesignCanvasProps> = ({
  project,
  selection,
  activeTool,
  zoom,
  pan,
  connectingSource,
  draggedPresetName,
  isReadOnlyMode = false,
  onSelect,
  onToggleNodeSelection,
  onSelectMultipleNodes,
  onBeginDragSnapshot,
  onMoveNodesTransient,
  onSnapNodesAndCommitDrag,
  onMoveNode,
  onResizeNodeTransient,
  onSnapNodeResizeAndCommit,
  onMoveRoomTransient,
  onResizeRoomTransient,
  onSnapRoomAndCommit,
  onUpdateNode,
  onSetNodeIconOrLogo,
  onDuplicateNodes,
  onToggleNodeLock,
  onToggleNodeVisibility,
  onAddTextNode,
  onSetTool,
  onAddCable,
  onUpdateCableControlPoints,
  onUpdateCable,
  onSetCableColor,
  onReconnectCableEndpoint,
  onSetConnectingSource,
  onPanChange,
  onZoomChange,
  onOpenDeepInspect,
  onAddRoom,
  onDeleteSelected,
  onDropDevice,
  onDropDeviceIntoRack,
  onAssignDeviceToRackSlot,
  onRemoveDeviceFromRackSlot,
  onUpdateWifiCoverageRadiusTransient,
  onUpdateSettings,
  onResizeLegendToFit,
  onAutoRouteCable,
  onOpenCommandPalette,
  onOpenTemplates,
  onAddQuickDevice,
  onAddRackAtCursor,
  onOpenBuildingGenerator,
  onSetActiveFloor,
  onCloneFloor,
  onNudgeNodes,
  showMinimap: controlledShowMinimap,
  showBgMenu: controlledShowBgMenu,
  onSetShowBgMenu: controlledOnSetShowBgMenu,
  onRegister2DDropApi
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const bgFileInputRef = useRef<HTMLInputElement>(null);
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({ w: 1200, h: 720 });
  const [internalShowBgMenu, setInternalShowBgMenu] = useState(false);
  const showMinimap = controlledShowMinimap ?? true;
  const showBgMenu = controlledShowBgMenu ?? internalShowBgMenu;
  const setShowBgMenu = controlledOnSetShowBgMenu ?? setInternalShowBgMenu;
  const [bgUploadError, setBgUploadError] = useState<string | null>(null);

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const activePointerIdRef = useRef<number | null>(null);
  const touchPointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchStateRef = useRef<{
    dist: number;
    midX: number;
    midY: number;
    zoom: number;
    panX: number;
    panY: number;
  } | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressOriginRef = useRef<{ x: number; y: number } | null>(null);
  const [touchContextMenu, setTouchContextMenu] = useState<{
    kind: 'node' | 'edge';
    id: string;
    x: number;
    y: number;
  } | null>(null);

  const [draggingNodeIds, setDraggingNodeIds] = useState<string[] | null>(null);
  const [dragStartPos, setDragStartPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuideLine[]>([]);
  const [gridSnapHighlight, setGridSnapHighlight] = useState<{
    x: number;
    y: number;
    distance: number;
    gridSize: number;
  } | null>(null);
  const nodeDragSessionRef = useRef<{
    originClientX: number;
    originClientY: number;
    initialPositions: Map<string, { x: number; y: number }>;
  } | null>(null);

  const [resizingSession, setResizingSession] = useState<ResizeSessionState | null>(null);
  const [wifiResizeSession, setWifiResizeSession] = useState<{
    nodeId: string;
    centerX: number;
    centerY: number;
    currentMeters: number;
  } | null>(null);
  const [draggingRoom, setDraggingRoom] = useState<DraggingRoomState | null>(null);

  const [iconPickerNodeId, setIconPickerNodeId] = useState<string | null>(null);
  const [iconPickerTab, setIconPickerTab] = useState<'icons' | 'isometric' | 'logos' | 'upload'>('icons');
  const [nodeIconUploadError, setNodeIconUploadError] = useState<string | null>(null);

  const [marqueeStart, setMarqueeStart] = useState<{ x: number; y: number } | null>(null);
  const [rackSides, setRackSides] = useState<Record<string, RackSide>>({});
  const [draggingRackDevice, setDraggingRackDevice] = useState<DraggingRackDeviceState | null>(null);
  const [rackDropPreview, setRackDropPreview] = useState<RackDropHit | null>(null);
  const [canvasDropGhost, setCanvasDropGhost] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);

  const [draggingWaypoint, setDraggingWaypoint] = useState<DraggingWaypointState | null>(null);
  const [reconnectingCable, setReconnectingCable] = useState<ReconnectingCableState | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredCableId, setHoveredCableId] = useState<string | null>(null);
  const [activeBundleId, setActiveBundleId] = useState<string | null>(null);
  const [collapsedBundleIds, setCollapsedBundleIds] = useState<Set<string>>(() => new Set());
  const [editingCableLabel, setEditingCableLabel] = useState<{
    cableId: string;
    value: string;
    canvasX: number;
    canvasY: number;
  } | null>(null);

  const [isDrawingRoom, setIsDrawingRoom] = useState(false);
  const [roomStartPos, setRoomStartPos] = useState<{ x: number; y: number } | null>(null);
  const [measureSession, setMeasureSession] = useState<{
    start: { x: number; y: number };
    current: { x: number; y: number };
    locked: boolean;
  } | null>(null);
  const [currentMouseCanvas, setCurrentMouseCanvas] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const cursorInsideCanvasRef = useRef(false);
  const lastCanvasCursorRef = useRef<{ x: number; y: number } | null>(null);
  const [canvasContextMenu, setCanvasContextMenu] = useState<{
    screenX: number;
    screenY: number;
    canvasX: number;
    canvasY: number;
  } | null>(null);

  const [pendingConnection, setPendingConnection] = useState<{
    sourceNodeId: string;
    targetNodeId: string;
    sourcePortId?: string;
    targetPortId?: string;
    screenX: number;
    screenY: number;
  } | null>(null);
  const [confirmToolbarDelete, setConfirmToolbarDelete] = useState<string | null>(null);

  const isSpacePressed = useRef(false);

  // Clear edit-only overlays if Read-Only mode is turned on
  useEffect(() => {
    if (isReadOnlyMode) {
      setIconPickerNodeId(null);
      setPendingConnection(null);
      setEditingCableLabel(null);
      setConfirmToolbarDelete(null);
      setDraggingNodeIds(null);
      setGridSnapHighlight(null);
      setCanvasContextMenu(null);
      setResizingSession(null);
      setWifiResizeSession(null);
      setDraggingRoom(null);
      setDraggingWaypoint(null);
      setReconnectingCable(null);
      setIsDrawingRoom(false);
      setShowBgMenu(false);
    }
  }, [isReadOnlyMode]);

  useEffect(() => {
    setConfirmToolbarDelete(null);
    if (iconPickerNodeId && (selection.type !== 'node' || selection.id !== iconPickerNodeId)) {
      setIconPickerNodeId(null);
      setNodeIconUploadError(null);
    }
  }, [iconPickerNodeId, selection.type, selection.id]);

  useEffect(() => {
    if (editingCableLabel && (selection.type !== 'edge' || selection.id !== editingCableLabel.cableId)) {
      setEditingCableLabel(null);
    }
  }, [editingCableLabel, selection.type, selection.id]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressOriginRef.current = null;
  }, []);

  const scheduleLongPress = useCallback(
    (clientX: number, clientY: number, kind: 'node' | 'edge', id: string) => {
      clearLongPressTimer();
      longPressOriginRef.current = { x: clientX, y: clientY };
      longPressTimerRef.current = window.setTimeout(() => {
        longPressTimerRef.current = null;
        longPressOriginRef.current = null;
        setDraggingNodeIds(null);
        nodeDragSessionRef.current = null;
        setAlignmentGuides([]);
        onSelect(kind, id);
        const rect = containerRef.current?.getBoundingClientRect();
        const localX = rect ? clientX - rect.left : clientX;
        const localY = rect ? clientY - rect.top : clientY;
        setTouchContextMenu({
          kind,
          id,
          x: Math.max(12, Math.min(viewportSize.w - 220, localX - 96)),
          y: Math.max(12, Math.min(viewportSize.h - 240, localY - 24))
        });
      }, 480);
    },
    [clearLongPressTimer, onSelect, viewportSize.h, viewportSize.w]
  );

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current !== null) {
        window.clearTimeout(longPressTimerRef.current);
      }
    };
  }, []);

  const openInlineCableLabelEditor = useCallback((cable: CableEdge, canvasX: number, canvasY: number) => {
    if (isReadOnlyMode || !onUpdateCable) return;
    onSelect('edge', cable.id);
    setEditingCableLabel({
      cableId: cable.id,
      value: cable.label || '',
      canvasX,
      canvasY
    });
  }, [isReadOnlyMode, onSelect, onUpdateCable]);

  const commitInlineCableLabel = useCallback(() => {
    if (!editingCableLabel) return;
    const trimmed = editingCableLabel.value.trim();
    onUpdateCable?.(editingCableLabel.cableId, { label: trimmed || undefined });
    setEditingCableLabel(null);
  }, [editingCableLabel, onUpdateCable]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateSize = () => {
      setViewportSize({ w: el.clientWidth || 1200, h: el.clientHeight || 720 });
    };
    updateSize();
    if (typeof ResizeObserver !== 'undefined') {
      const obs = new ResizeObserver(updateSize);
      obs.observe(el);
      return () => obs.disconnect();
    }
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const selectedNodeIds = useMemo(() => {
    if (selection.type !== 'node' || !selection.id) return [];
    return [selection.id, ...(selection.additionalIds || [])];
  }, [selection]);

  const selectedNodeIdSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, DiagramNode>();
    for (const n of project.nodes) m.set(n.id, n);
    return m;
  }, [project.nodes]);

  const floorplanRackNodes = useMemo(() => {
    return project.nodes.filter(n => !n.hidden && n.type === 'rack' && n.diagramMode === 'floorplan');
  }, [project.nodes]);

  const visibleNodes = useMemo(() => {
    const raw = project.nodes.filter(n => {
      if (n.hidden) return false;
      if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode)) {
        if (n.floorId && project.activeFloorId && n.floorId !== project.activeFloorId) {
          return false;
        }
        if (isRackMountedTopologyShadowNode(n, project.assets, floorplanRackNodes, project.racks)) {
          return false;
        }
      }
      if (project.activeMode === 'rack') {
        return n.diagramMode === 'rack' || n.type === 'rack';
      }
      return true;
    });
    if (project.activeMode === 'rack') {
      const rackNodes = raw.filter(
        n => n.type === 'rack' || (n.assetId && project.assets[n.assetId]?.category === 'rack')
      );
      const nonRackNodes = raw.filter(
        n => !(n.type === 'rack' || (n.assetId && project.assets[n.assetId]?.category === 'rack'))
      );
      return [...layoutRackNodesForElevationMode(rackNodes, project.racks), ...nonRackNodes];
    }
    return raw;
  }, [project.nodes, project.activeMode, project.activeFloorId, project.assets, project.racks, floorplanRackNodes]);

  const hiddenLayerSet = useMemo(
    () => new Set(project.settings.hiddenLayers || []),
    [project.settings.hiddenLayers]
  );

  const lockedLayerSet = useMemo(
    () => getLockedLayerSet(project.settings),
    [project.settings.lockedLayers]
  );

  const visibleRackNodes = useMemo(() => {
    if (hiddenLayerSet.has('racks')) return [];
    return visibleNodes.filter(
      n => n.type === 'rack' || (n.assetId && project.assets[n.assetId]?.category === 'rack')
    );
  }, [visibleNodes, project.assets, hiddenLayerSet]);

  const visibleDeviceNodes = useMemo(() => {
    return visibleNodes.filter(n => {
      if (n.type === 'rack' || (n.assetId && project.assets[n.assetId]?.category === 'rack')) {
        return false;
      }
      const layer = resolveNodeLayer(n, project.assets);
      return !hiddenLayerSet.has(layer);
    });
  }, [visibleNodes, project.assets, hiddenLayerSet]);

  const visibleCableTrays = useMemo(() => {
    if (hiddenLayerSet.has('trays') || project.activeMode === 'rack') return [];
    return (project.cableTrays || []).filter(t => {
      if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode)) {
        if (t.floorId && project.activeFloorId && t.floorId !== project.activeFloorId) {
          return false;
        }
      }
      return t.points && t.points.length >= 2;
    });
  }, [project.cableTrays, project.activeMode, project.activeFloorId, hiddenLayerSet]);

  const overlapReport = useMemo(() => {
    const activeRects = [...visibleRackNodes, ...visibleDeviceNodes]
      .filter(n => n.type !== 'text')
      .map(n => ({
        id: n.id,
        label: n.label,
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.height
      }));
    return detectOverlappingNodes(activeRects, 2);
  }, [visibleRackNodes, visibleDeviceNodes]);

  const culledDeviceNodes = useMemo(() => {
    if (visibleDeviceNodes.length <= 40) return visibleDeviceNodes;
    const buffer = 350;
    const viewMinX = -pan.x / zoom - buffer;
    const viewMinY = -pan.y / zoom - buffer;
    const viewMaxX = (viewportSize.w - pan.x) / zoom + buffer;
    const viewMaxY = (viewportSize.h - pan.y) / zoom + buffer;

    return visibleDeviceNodes.filter(n => {
      if (
        n.type === 'legend' ||
        selectedNodeIdSet.has(n.id) ||
        connectingSource?.nodeId === n.id ||
        hoveredNodeId === n.id
      ) {
        return true;
      }
      return (
        n.x + n.width >= viewMinX &&
        n.x <= viewMaxX &&
        n.y + n.height >= viewMinY &&
        n.y <= viewMaxY
      );
    });
  }, [visibleDeviceNodes, pan.x, pan.y, zoom, viewportSize.w, viewportSize.h, selectedNodeIdSet, connectingSource, hoveredNodeId]);

  const resolveRackForNode = useCallback((rackNode: DiagramNode): ServerRack | undefined => {
    const asset = rackNode.assetId ? project.assets[rackNode.assetId] : undefined;
    return project.racks.find(
      r => r.id === rackNode.customData?.rackId || r.id === rackNode.id || (asset && r.id === asset.id) || r.name === rackNode.label
    );
  }, [project.racks, project.assets]);

  const visibleRooms = useMemo(() => {
    if (hiddenLayerSet.has('rooms')) return [];
    return project.rooms.filter(r => {
      if (['floorplan', 'cctv', 'wifi', 'fiber'].includes(project.activeMode)) {
        if (r.floorId && project.activeFloorId && r.floorId !== project.activeFloorId) {
          return false;
        }
      }
      return true;
    });
  }, [project.rooms, project.activeMode, project.activeFloorId, hiddenLayerSet]);

  const groupBounds = useMemo(() => {
    const groups = new Map<string, { minX: number; minY: number; maxX: number; maxY: number; count: number }>();
    for (const n of visibleDeviceNodes) {
      if (!n.groupId) continue;
      const g = groups.get(n.groupId);
      if (!g) {
        groups.set(n.groupId, {
          minX: n.x,
          minY: n.y,
          maxX: n.x + n.width,
          maxY: n.y + n.height,
          count: 1
        });
      } else {
        g.minX = Math.min(g.minX, n.x);
        g.minY = Math.min(g.minY, n.y);
        g.maxX = Math.max(g.maxX, n.x + n.width);
        g.maxY = Math.max(g.maxY, n.y + n.height);
        g.count++;
      }
    }
    return Array.from(groups.entries()).filter(([, b]) => b.count >= 2);
  }, [visibleDeviceNodes]);

  const getNodeEffectiveRect = useCallback((nodeId: string): { x: number; y: number; width: number; height: number } | null => {
    const visibleDirect = visibleNodes.find(n => n.id === nodeId);
    if (visibleDirect) {
      return { x: visibleDirect.x, y: visibleDirect.y, width: visibleDirect.width, height: visibleDirect.height };
    }

    const anyNode = nodeMap.get(nodeId);
    if (anyNode?.assetId) {
      const asset = project.assets[anyNode.assetId];
      if (asset?.rackId && asset.rackUnitStart) {
        const rackNode = visibleRackNodes.find(rn => resolveRackForNode(rn)?.id === asset.rackId);
        const rack = rackNode ? resolveRackForNode(rackNode) : undefined;
        if (rackNode && rack) {
          const metrics = getRackCanvasMetrics(rackNode, rack.totalUnits || 42);
          const uH = getAssetUHeight(asset);
          const spanRect = getSlotSpanRect(asset.rackUnitStart, uH, metrics.units, metrics.slotH);
          return {
            x: metrics.slotsX + 2,
            y: metrics.slotsY + spanRect.top + 1,
            width: metrics.slotsWidth - 4,
            height: Math.max(8, spanRect.height - 2)
          };
        }
      }
    }
    return null;
  }, [visibleNodes, nodeMap, project.assets, visibleRackNodes, resolveRackForNode]);

  const visibleCables = useMemo(() => {
    if (hiddenLayerSet.has('cables')) return [];
    return project.cables.filter(c => {
      return Boolean(getNodeEffectiveRect(c.sourceNodeId) && getNodeEffectiveRect(c.targetNodeId));
    });
  }, [project.cables, getNodeEffectiveRect, hiddenLayerSet]);

  const clientToCanvasCoord = useCallback((clientX: number, clientY: number) => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left - pan.x) / zoom,
      y: (clientY - rect.top - pan.y) / zoom
    };
  }, [pan.x, pan.y, zoom]);

  const hitTestRackSlot = useCallback((
    canvasX: number,
    canvasY: number,
    unitHeight: number,
    excludeAssetId?: string
  ): RackDropHit | null => {
    for (let i = visibleRackNodes.length - 1; i >= 0; i--) {
      const rackNode = visibleRackNodes[i];
      const rack = resolveRackForNode(rackNode);
      if (!rack) continue;

      const totalUnits = rack.totalUnits || 42;
      const metrics = getRackCanvasMetrics(rackNode, totalUnits);
      const activeSide: RackSide = rackSides[rack.id] || 'front';

      const withinX = canvasX >= rackNode.x && canvasX <= rackNode.x + rackNode.width;
      const withinY = canvasY >= metrics.slotsY - 4 && canvasY <= metrics.slotsBottomY + 4;

      if (withinX && withinY) {
        const relY = canvasY - metrics.slotsY;
        const startU = pixelYToRackU(relY, metrics.slotH, totalUnits, unitHeight);
        const valid = canPlaceDeviceAtU(rack, project.assets, startU, unitHeight, excludeAssetId, activeSide);
        return {
          rackId: rack.id,
          rackNodeId: rackNode.id,
          side: activeSide,
          startU,
          uHeight: unitHeight,
          valid
        };
      }
    }
    return null;
  }, [visibleRackNodes, resolveRackForNode, rackSides, project.assets]);

  const resolve2DDropTarget = useCallback(
    (
      clientX: number,
      clientY: number,
      presetName: string,
      footprint?: { width?: number; height?: number; isRack?: boolean; customPresetId?: string }
    ) => {
      if (isReadOnlyMode || !containerRef.current) return null;
      const rect = containerRef.current.getBoundingClientRect();
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

      const coord = clientToCanvasCoord(clientX, clientY);
      const isRack = Boolean(footprint?.isRack || presetName.toLowerCase().includes('rack'));
      if (!footprint?.customPresetId && !isRack && onDropDeviceIntoRack) {
        const uHeight = getPresetUHeight(presetName);
        const rackHit = hitTestRackSlot(coord.x, coord.y, uHeight);
        if (rackHit) {
          const rackObj = project.racks.find(r => r.id === rackHit.rackId);
          return {
            kind: 'rackSlot' as const,
            rackHit,
            rackName: rackObj?.name || 'Tủ Rack',
            x: Math.round(coord.x),
            y: Math.round(coord.y)
          };
        }
      }

      const customMatch = footprint?.customPresetId
        ? loadCustomDevicePresets().find(c => c.id === footprint.customPresetId)
        : undefined;
      const catalogMatch = customMatch || DEVICE_CATALOG.find(p => p.name === presetName);
      const w = isRack ? 300 : footprint?.width || catalogMatch?.defaultWidth || 150;
      const h = isRack ? 180 : footprint?.height || catalogMatch?.defaultHeight || 56;
      const snap = project.settings.snapToGrid ? Math.max(1, project.settings.gridSize) : 1;
      const rawX = Math.max(10, coord.x - w / 2);
      const rawY = Math.max(10, coord.y - h / 2);
      const dropX = Math.max(10, Math.round(rawX / snap) * snap);
      const dropY = Math.max(10, Math.round(rawY / snap) * snap);
      return { kind: 'canvas' as const, x: dropX, y: dropY, rawX, rawY, width: w, height: h };
    },
    [
      isReadOnlyMode,
      clientToCanvasCoord,
      onDropDeviceIntoRack,
      hitTestRackSlot,
      project.racks,
      project.settings.snapToGrid,
      project.settings.gridSize
    ]
  );

  useEffect(() => {
    if (!onRegister2DDropApi) return;
    onRegister2DDropApi({
      previewLibraryDrop: (clientX, clientY, presetName, footprint) => {
        const target = resolve2DDropTarget(clientX, clientY, presetName, footprint);
        if (!target) {
          setRackDropPreview(null);
          setCanvasDropGhost(null);
          setGridSnapHighlight(null);
          return null;
        }
        if (target.kind === 'rackSlot') {
          setRackDropPreview(target.rackHit);
          setCanvasDropGhost(null);
          setGridSnapHighlight(null);
          return {
            x: target.x,
            y: target.y,
            rackHitName: target.rackName,
            rackHitU: target.rackHit.startU,
            rackHitValid: target.rackHit.valid
          };
        }
        setRackDropPreview(null);
        setCanvasDropGhost({ x: target.x, y: target.y, width: target.width, height: target.height });
        if (project.settings.snapToGrid) {
          const gridStep = Math.max(5, Math.round(project.settings.gridSize || 20));
          const gs = computeGridIntersectionSnap(
            target.rawX,
            target.rawY,
            gridStep,
            DEFAULT_GRID_SNAP_THRESHOLD_PX
          );
          setGridSnapHighlight(
            gs.snapped ? { x: gs.gridX, y: gs.gridY, distance: gs.distance, gridSize: gridStep } : null
          );
        } else {
          setGridSnapHighlight(null);
        }
        return { x: target.x, y: target.y };
      },
      commitLibraryDrop: (clientX, clientY, presetName, footprint) => {
        const target = resolve2DDropTarget(clientX, clientY, presetName, footprint);
        setRackDropPreview(null);
        setCanvasDropGhost(null);
        setGridSnapHighlight(null);
        if (!target) return false;
        if (target.kind === 'rackSlot' && onDropDeviceIntoRack) {
          onDropDeviceIntoRack(
            presetName,
            target.rackHit.rackId,
            target.rackHit.startU,
            target.rackHit.side
          );
          return true;
        }
        onDropDevice(presetName, target.x, target.y, footprint?.customPresetId);
        return true;
      },
      clearLibraryDropPreview: () => {
        setRackDropPreview(null);
        setCanvasDropGhost(null);
        setGridSnapHighlight(null);
      },
      getCursorCanvasPos: () => {
        const pt = lastCanvasCursorRef.current;
        if (!pt) return null;
        if (cursorInsideCanvasRef.current) return pt;
        const screenX = pt.x * zoom + pan.x;
        const screenY = pt.y * zoom + pan.y;
        if (
          screenX >= 0 &&
          screenX <= viewportSize.w &&
          screenY >= 0 &&
          screenY <= viewportSize.h
        ) {
          return pt;
        }
        return null;
      }
    });
    return () => onRegister2DDropApi(null);
  }, [
    onRegister2DDropApi,
    resolve2DDropTarget,
    onDropDeviceIntoRack,
    onDropDevice,
    project.settings.snapToGrid,
    project.settings.gridSize,
    zoom,
    pan.x,
    pan.y,
    viewportSize.w,
    viewportSize.h
  ]);

  const handleDragOver = (e: React.DragEvent) => {
    if (isReadOnlyMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';

    const coord = clientToCanvasCoord(e.clientX, e.clientY);
    const presetName = draggedPresetName || '';
    if (presetName && !presetName.toLowerCase().includes('rack')) {
      const uHeight = getPresetUHeight(presetName);
      setRackDropPreview(hitTestRackSlot(coord.x, coord.y, uHeight));
    } else {
      setRackDropPreview(hitTestRackSlot(coord.x, coord.y, 1));
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
      setRackDropPreview(null);
      setCanvasDropGhost(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    if (isReadOnlyMode) return;
    e.preventDefault();
    const presetName = e.dataTransfer.getData('presetName') || e.dataTransfer.getData('text/plain') || draggedPresetName;
    const customPresetId = e.dataTransfer.getData('customPresetId') || undefined;
    setRackDropPreview(null);
    setCanvasDropGhost(null);

    if (!presetName) return;

    const target = resolve2DDropTarget(e.clientX, e.clientY, presetName, { customPresetId });
    if (!target) return;

    if (target.kind === 'rackSlot' && onDropDeviceIntoRack) {
      onDropDeviceIntoRack(presetName, target.rackHit.rackId, target.rackHit.startU, target.rackHit.side);
      return;
    }

    onDropDevice(presetName, target.x, target.y, customPresetId);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
      onZoomChange(Math.min(Math.max(0.2, zoom * zoomFactor), 3.0));
    } else {
      onPanChange({
        x: pan.x - e.deltaX,
        y: pan.y - e.deltaY
      });
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement)) {
        isSpacePressed.current = true;
      }

      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && !isReadOnlyMode) {
        onDeleteSelected();
      } else if (
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
        !isReadOnlyMode &&
        onNudgeNodes &&
        selectedNodeIds.length > 0
      ) {
        const unlockedIds = selectedNodeIds.filter(id => {
          const n = nodeMap.get(id);
          return n && !isNodeEffectivelyLocked(n, project.settings, project.assets, isReadOnlyMode);
        });
        if (unlockedIds.length > 0) {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
          const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
          onNudgeNodes(unlockedIds, dx, dy);
        }
      } else if (e.key === 'Escape') {
        onSetConnectingSource(null);
        setIsDrawingRoom(false);
        setRoomStartPos(null);
        setMeasureSession(null);
        setMarqueeStart(null);
        setDraggingRackDevice(null);
        setDraggingWaypoint(null);
        setReconnectingCable(null);
        setRackDropPreview(null);
        setAlignmentGuides([]);
        setGridSnapHighlight(null);
        nodeDragSessionRef.current = null;
        setActiveBundleId(null);
        setShowBgMenu(false);
        setIconPickerNodeId(null);
        setResizingSession(null);
        setDraggingRoom(null);
        setTouchContextMenu(null);
        setCanvasContextMenu(null);
        onSelect('none');
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressed.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [isReadOnlyMode, onDeleteSelected, onSetConnectingSource, onSelect, onNudgeNodes, selectedNodeIds, nodeMap, project.settings, project.assets]);

  const handlePointerDownCapture = (e: React.PointerEvent) => {
    if (e.pointerType !== 'touch') return;
    touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (touchPointersRef.current.size >= 2) {
      clearLongPressTimer();
      setTouchContextMenu(null);
      setDraggingNodeIds(null);
      nodeDragSessionRef.current = null;
      setAlignmentGuides([]);
      setMarqueeStart(null);
      setDraggingWaypoint(null);
      setDraggingRoom(null);
      setResizingSession(null);

      const pts = Array.from(touchPointersRef.current.values());
      const p1 = pts[0];
      const p2 = pts[1];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;
      pinchStateRef.current = {
        dist: Math.max(12, dist),
        midX,
        midY,
        zoom,
        panX: pan.x,
        panY: pan.y
      };
    }
  };

  const handlePointerUpCapture = (e: React.PointerEvent) => {
    clearLongPressTimer();
    if (e.pointerType !== 'touch') return;
    touchPointersRef.current.delete(e.pointerId);
    if (touchPointersRef.current.size < 2) {
      pinchStateRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touchPointersRef.current.size >= 2) {
      return;
    }
    if (activePointerIdRef.current !== null && e.pointerType === 'touch') return;
    activePointerIdRef.current = e.pointerId;
    setTouchContextMenu(null);
    setCanvasContextMenu(null);
    const pointerCoord = clientToCanvasCoord(e.clientX, e.clientY);
    cursorInsideCanvasRef.current = true;
    lastCanvasCursorRef.current = pointerCoord;

    const isPrimary = e.pointerType !== 'mouse' || e.button === 0;
    if (
      e.button === 1 ||
      isSpacePressed.current ||
      (isPrimary && (e.altKey || activeTool === 'pan' || isReadOnlyMode))
    ) {
      const targetTag = (e.target as HTMLElement).tagName;
      const isCanvasBackdrop =
        e.target === containerRef.current ||
        targetTag === 'svg' ||
        (e.target as HTMLElement).getAttribute('data-canvas-bg') === 'true';

      if (isReadOnlyMode && isPrimary && isCanvasBackdrop) {
        setShowBgMenu(false);
        setActiveBundleId(null);
        onSelect('canvas');
      }
      setIsPanning(true);
      setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
      return;
    }

    if (isPrimary) {
      const canvasCoord = pointerCoord;

      if (activeTool === 'measure') {
        setMeasureSession({ start: canvasCoord, current: canvasCoord, locked: false });
        return;
      }

      if (!isReadOnlyMode && activeTool === 'text' && onAddTextNode) {
        onAddTextNode(canvasCoord.x, canvasCoord.y);
        onSetTool?.('select');
        return;
      }

      if (!isReadOnlyMode && activeTool === 'room') {
        setIsDrawingRoom(true);
        setRoomStartPos(canvasCoord);
        return;
      }

      const targetTag = (e.target as HTMLElement).tagName;
      const isCanvasBackdrop =
        e.target === containerRef.current ||
        targetTag === 'svg' ||
        (e.target as HTMLElement).getAttribute('data-canvas-bg') === 'true';

      if (isCanvasBackdrop) {
        setShowBgMenu(false);
        setIconPickerNodeId(null);
        setPendingConnection(null);
        setConfirmToolbarDelete(null);
        if (connectingSource) {
          onSetConnectingSource(null);
          return;
        }
        if (activeTool === 'select') {
          setMarqueeStart(canvasCoord);
        }
        setActiveBundleId(null);
        onSelect('canvas');
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (e.pointerType === 'touch' && touchPointersRef.current.has(e.pointerId)) {
      touchPointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (longPressOriginRef.current) {
        const moveDist = Math.hypot(e.clientX - longPressOriginRef.current.x, e.clientY - longPressOriginRef.current.y);
        if (moveDist > 8) {
          clearLongPressTimer();
        }
      }
      if (touchPointersRef.current.size >= 2 && pinchStateRef.current) {
        const pts = Array.from(touchPointersRef.current.values());
        const p1 = pts[0];
        const p2 = pts[1];
        const nextDist = Math.max(12, Math.hypot(p2.x - p1.x, p2.y - p1.y));
        const nextMidX = (p1.x + p2.x) / 2;
        const nextMidY = (p1.y + p2.y) / 2;
        const start = pinchStateRef.current;
        const scale = nextDist / start.dist;
        const nextZoom = Math.min(3.0, Math.max(0.2, start.zoom * scale));

        const rect = containerRef.current?.getBoundingClientRect();
        const originLocalX = rect ? start.midX - rect.left : start.midX;
        const originLocalY = rect ? start.midY - rect.top : start.midY;
        const worldMidX = (originLocalX - start.panX) / start.zoom;
        const worldMidY = (originLocalY - start.panY) / start.zoom;
        const nextLocalX = rect ? nextMidX - rect.left : nextMidX;
        const nextLocalY = rect ? nextMidY - rect.top : nextMidY;

        onZoomChange(Number(nextZoom.toFixed(3)));
        onPanChange({
          x: Math.round(nextLocalX - worldMidX * nextZoom),
          y: Math.round(nextLocalY - worldMidY * nextZoom)
        });
        return;
      }
    }

    if (activePointerIdRef.current !== null && e.pointerId !== activePointerIdRef.current && e.pointerType === 'touch') {
      return;
    }
    const canvasCoord = clientToCanvasCoord(e.clientX, e.clientY);
    cursorInsideCanvasRef.current = true;
    lastCanvasCursorRef.current = canvasCoord;
    setCurrentMouseCanvas(canvasCoord);

    if (isPanning) {
      onPanChange({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y
      });
      return;
    }

    if (measureSession && !measureSession.locked) {
      setMeasureSession(prev => (prev ? { ...prev, current: canvasCoord } : null));
      return;
    }

    if (isReadOnlyMode) return;

    if (resizingSession) {
      const { initialRect, handle, originClientX, originClientY, rotationDeg, minW, minH, targetKind, targetId } = resizingSession;
      const rawDx = (e.clientX - originClientX) / zoom;
      const rawDy = (e.clientY - originClientY) / zoom;
      const radNeg = (-rotationDeg * Math.PI) / 180;
      const localDx = rotationDeg ? rawDx * Math.cos(radNeg) - rawDy * Math.sin(radNeg) : rawDx;
      const localDy = rotationDeg ? rawDx * Math.sin(radNeg) + rawDy * Math.cos(radNeg) : rawDy;

      let nextW = initialRect.width;
      let nextH = initialRect.height;
      let shiftX = 0;
      let shiftY = 0;

      if (handle.includes('e')) {
        nextW = Math.max(minW, initialRect.width + localDx);
      }
      if (handle.includes('w')) {
        nextW = Math.max(minW, initialRect.width - localDx);
        shiftX = initialRect.width - nextW;
      }
      if (handle.includes('s')) {
        nextH = Math.max(minH, initialRect.height + localDy);
      }
      if (handle.includes('n')) {
        nextH = Math.max(minH, initialRect.height - localDy);
        shiftY = initialRect.height - nextH;
      }

      if (e.shiftKey && handle.length === 2 && initialRect.height > 0) {
        const aspect = initialRect.width / initialRect.height;
        if (Math.abs(nextW - initialRect.width) >= Math.abs(nextH - initialRect.height) * aspect) {
          const targetH = Math.max(minH, nextW / aspect);
          if (handle.includes('n')) shiftY = initialRect.height - targetH;
          nextH = targetH;
        } else {
          const targetW = Math.max(minW, nextH * aspect);
          if (handle.includes('w')) shiftX = initialRect.width - targetW;
          nextW = targetW;
        }
      }

      let nextX = initialRect.x + shiftX;
      let nextY = initialRect.y + shiftY;
      if (rotationDeg) {
        const radPos = (rotationDeg * Math.PI) / 180;
        const dxCenter = shiftX + (nextW - initialRect.width) / 2;
        const dyCenter = shiftY + (nextH - initialRect.height) / 2;
        const worldCenterX = initialRect.x + initialRect.width / 2 + dxCenter * Math.cos(radPos) - dyCenter * Math.sin(radPos);
        const worldCenterY = initialRect.y + initialRect.height / 2 + dxCenter * Math.sin(radPos) + dyCenter * Math.cos(radPos);
        nextX = worldCenterX - nextW / 2;
        nextY = worldCenterY - nextH / 2;
      }

      const nextRect = {
        x: Math.max(10, Math.round(nextX)),
        y: Math.max(10, Math.round(nextY)),
        width: Math.max(minW, Math.round(nextW)),
        height: Math.max(minH, Math.round(nextH))
      };

      setResizingSession(prev => prev ? { ...prev, currentRect: nextRect } : null);
      if (targetKind === 'node') {
        onResizeNodeTransient?.(targetId, nextRect);
      } else {
        onResizeRoomTransient?.(targetId, nextRect);
      }
      return;
    }

    if (wifiResizeSession) {
      const distPx = Math.hypot(
        canvasCoord.x - wifiResizeSession.centerX,
        canvasCoord.y - wifiResizeSession.centerY
      );
      const scale = Math.max(5, project.settings.scale || 30);
      const rawMeters = distPx / scale;
      const stepPrecision = e.ctrlKey ? 1 : 0.5;
      const snapped = Math.round(rawMeters / stepPrecision) * stepPrecision;
      const nextMeters = Math.max(2, Math.min(80, snapped));
      setWifiResizeSession(prev => (prev ? { ...prev, currentMeters: nextMeters } : null));
      onUpdateWifiCoverageRadiusTransient?.(wifiResizeSession.nodeId, nextMeters);
      return;
    }

    if (draggingRoom) {
      const dx = (e.clientX - draggingRoom.lastClientX) / zoom;
      const dy = (e.clientY - draggingRoom.lastClientY) / zoom;
      onMoveRoomTransient?.(draggingRoom.roomId, dx, dy);
      setDraggingRoom(prev => prev ? { ...prev, lastClientX: e.clientX, lastClientY: e.clientY } : null);
      return;
    }

    if (draggingWaypoint && onUpdateCableControlPoints) {
      const cable = project.cables.find(c => c.id === draggingWaypoint.cableId);
      if (cable) {
        const snap = project.settings.snapToGrid ? Math.max(5, Math.round(project.settings.gridSize / 2)) : 1;
        const sx = Math.round(canvasCoord.x / snap) * snap;
        const sy = Math.round(canvasCoord.y / snap) * snap;
        const nextPts = [...(cable.controlPoints || [])];
        nextPts[draggingWaypoint.pointIndex] = { x: sx, y: sy };
        onUpdateCableControlPoints(cable.id, nextPts);
      }
      return;
    }

    if (reconnectingCable) {
      const hitNode = visibleDeviceNodes.find(
        n =>
          canvasCoord.x >= n.x &&
          canvasCoord.x <= n.x + n.width &&
          canvasCoord.y >= n.y &&
          canvasCoord.y <= n.y + n.height
      );
      setHoveredNodeId(hitNode ? hitNode.id : null);
      return;
    }

    if (draggingRackDevice) {
      const movedDist = Math.hypot(canvasCoord.x - draggingRackDevice.startX, canvasCoord.y - draggingRackDevice.startY);
      setDraggingRackDevice(prev => prev ? {
        ...prev,
        currentX: canvasCoord.x,
        currentY: canvasCoord.y,
        hasMoved: prev.hasMoved || movedDist > 4
      } : null);

      const hit = hitTestRackSlot(canvasCoord.x, canvasCoord.y, draggingRackDevice.uHeight, draggingRackDevice.assetId);
      setRackDropPreview(hit);
      return;
    }

    if (draggingNodeIds && draggingNodeIds.length > 0) {
      const session = nodeDragSessionRef.current;
      let stepDx = (e.clientX - dragStartPos.x) / zoom;
      let stepDy = (e.clientY - dragStartPos.y) / zoom;

      if (session && session.initialPositions.size > 0) {
        const rawTotalDx = (e.clientX - session.originClientX) / zoom;
        const rawTotalDy = (e.clientY - session.originClientY) / zoom;
        const draggedSet = new Set(draggingNodeIds);
        const draggedGroupIds = new Set<string>();

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let anchorId: string | null = null;

        for (const id of draggingNodeIds) {
          const n = nodeMap.get(id);
          const initPos = session.initialPositions.get(id);
          if (!n || n.locked || !initPos) continue;
          if (!anchorId) anchorId = id;
          if (n.groupId) draggedGroupIds.add(n.groupId);
          const rx = Math.max(10, initPos.x + rawTotalDx);
          const ry = Math.max(10, initPos.y + rawTotalDy);
          minX = Math.min(minX, rx);
          minY = Math.min(minY, ry);
          maxX = Math.max(maxX, rx + n.width);
          maxY = Math.max(maxY, ry + n.height);
        }

        if (anchorId && Number.isFinite(minX)) {
          const targetRects: AlignRect[] = [];
          for (const other of visibleNodes) {
            if (draggedSet.has(other.id)) continue;
            targetRects.push({
              id: other.id,
              x: other.x,
              y: other.y,
              width: other.width,
              height: other.height,
              sourceKind: 'node',
              label: other.label
            });
          }
          for (const room of visibleRooms) {
            targetRects.push({
              id: room.id,
              x: room.x,
              y: room.y,
              width: room.width,
              height: room.height,
              sourceKind: 'container',
              label: room.name
            });
          }
          for (const [grpId, b] of groupBounds) {
            if (draggedGroupIds.has(grpId)) continue;
            targetRects.push({
              id: `grp_${grpId}`,
              x: b.minX - 10,
              y: b.minY - 14,
              width: b.maxX - b.minX + 20,
              height: b.maxY - b.minY + 24,
              sourceKind: 'container',
              label: 'Nhóm'
            });
          }

          const activeFloorGuides = (project.settings.guideLines || []).filter(
            g => !g.floorId || !project.activeFloorId || g.floorId === project.activeFloorId
          );
          const snapThreshold = 8 / Math.max(0.5, Math.min(zoom, 1.5));
          const gridStep = Math.max(5, Math.round(project.settings.gridSize || 20));
          const snapRes = computeRefined2DDragSnap(
            { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
            targetRects,
            {
              smartSnapThreshold: snapThreshold,
              gridSnapThreshold: DEFAULT_GRID_SNAP_THRESHOLD_PX,
              gridSize: gridStep,
              snapToGrid: project.settings.snapToGrid,
              referenceGuides: activeFloorGuides
            }
          );
          setAlignmentGuides(snapRes.guides);
          setGridSnapHighlight(
            snapRes.gridSnap?.snapped
              ? {
                  x: snapRes.gridSnap.gridX,
                  y: snapRes.gridSnap.gridY,
                  distance: snapRes.gridSnap.distance,
                  gridSize: gridStep
                }
              : null
          );

          const anchorInit = session.initialPositions.get(anchorId)!;
          const anchorCurr = nodeMap.get(anchorId)!;
          const desiredAnchorX = Math.max(10, anchorInit.x + rawTotalDx + snapRes.dx);
          const desiredAnchorY = Math.max(10, anchorInit.y + rawTotalDy + snapRes.dy);
          stepDx = desiredAnchorX - anchorCurr.x;
          stepDy = desiredAnchorY - anchorCurr.y;
        }
      }

      if (onMoveNodesTransient) {
        onMoveNodesTransient(draggingNodeIds, stepDx, stepDy);
      } else if (draggingNodeIds.length === 1) {
        onMoveNode(draggingNodeIds[0], stepDx, stepDy);
      }
      setDragStartPos({ x: e.clientX, y: e.clientY });

      if (draggingNodeIds.length === 1) {
        const draggedNode = nodeMap.get(draggingNodeIds[0]);
        if (draggedNode && draggedNode.type !== 'rack' && draggedNode.assetId) {
          const asset = project.assets[draggedNode.assetId];
          if (asset && !['rack', 'cloud', 'telecom_tower'].includes(asset.category)) {
            const uH = getAssetUHeight(asset);
            const hit = hitTestRackSlot(canvasCoord.x, canvasCoord.y, uH, asset.id);
            setRackDropPreview(hit);
          }
        }
      }

      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const margin = 36;
        let edgePanX = 0;
        let edgePanY = 0;
        if (e.clientX - rect.left < margin) edgePanX = 10;
        else if (rect.right - e.clientX < margin) edgePanX = -10;
        if (e.clientY - rect.top < margin) edgePanY = 10;
        else if (rect.bottom - e.clientY < margin) edgePanY = -10;
        if (edgePanX !== 0 || edgePanY !== 0) {
          onPanChange({ x: pan.x + edgePanX, y: pan.y + edgePanY });
        }
      }
    }
  };

  const finishPointerInteraction = (clientX: number, clientY: number) => {
    activePointerIdRef.current = null;
    const canvasCoord = clientToCanvasCoord(clientX, clientY);

    if (isPanning) {
      setIsPanning(false);
    }

    if (measureSession && !measureSession.locked) {
      const distPx = Math.hypot(canvasCoord.x - measureSession.start.x, canvasCoord.y - measureSession.start.y);
      if (distPx < 6) {
        setMeasureSession(null);
      } else {
        setMeasureSession({ start: measureSession.start, current: canvasCoord, locked: true });
      }
      return;
    }

    if (resizingSession) {
      if (resizingSession.targetKind === 'node') {
        onSnapNodeResizeAndCommit?.(resizingSession.targetId);
      } else {
        onSnapRoomAndCommit?.(resizingSession.targetId);
      }
      setResizingSession(null);
      return;
    }

    if (wifiResizeSession) {
      setWifiResizeSession(null);
      onSnapNodesAndCommitDrag?.([]);
      return;
    }

    if (draggingRoom) {
      onSnapRoomAndCommit?.(draggingRoom.roomId);
      setDraggingRoom(null);
      return;
    }

    if (draggingWaypoint) {
      setDraggingWaypoint(null);
      onSnapNodesAndCommitDrag?.([]);
      return;
    }

    if (reconnectingCable) {
      const targetNode = visibleDeviceNodes.find(
        n =>
          canvasCoord.x >= n.x &&
          canvasCoord.x <= n.x + n.width &&
          canvasCoord.y >= n.y &&
          canvasCoord.y <= n.y + n.height
      );
      if (targetNode && onReconnectCableEndpoint) {
        onReconnectCableEndpoint(reconnectingCable.cableId, reconnectingCable.endpoint, targetNode.id);
      }
      setReconnectingCable(null);
      setHoveredNodeId(null);
      return;
    }

    if (marqueeStart) {
      const rx = Math.min(marqueeStart.x, canvasCoord.x);
      const ry = Math.min(marqueeStart.y, canvasCoord.y);
      const rw = Math.abs(canvasCoord.x - marqueeStart.x);
      const rh = Math.abs(canvasCoord.y - marqueeStart.y);
      setMarqueeStart(null);

      if (rw > 8 && rh > 8 && onSelectMultipleNodes) {
        const hitIds = visibleDeviceNodes
          .filter(n => n.x + n.width >= rx && n.x <= rx + rw && n.y + n.height >= ry && n.y <= ry + rh)
          .map(n => n.id);
        if (hitIds.length > 0) {
          onSelectMultipleNodes(hitIds);
        }
      }
      return;
    }

    if (draggingRackDevice) {
      if (draggingRackDevice.hasMoved) {
        const hit = hitTestRackSlot(canvasCoord.x, canvasCoord.y, draggingRackDevice.uHeight, draggingRackDevice.assetId);
        if (hit && hit.valid && onAssignDeviceToRackSlot) {
          onAssignDeviceToRackSlot(hit.rackId, draggingRackDevice.assetId, hit.startU, hit.side);
        }
      } else {
        const linkedNode = project.nodes.find(n => n.assetId === draggingRackDevice.assetId);
        if (linkedNode) {
          onSelect('node', linkedNode.id);
        } else {
          onSelect('rack', draggingRackDevice.sourceRackId);
        }
      }
      setDraggingRackDevice(null);
      setRackDropPreview(null);
      return;
    }

    if (draggingNodeIds && draggingNodeIds.length > 0) {
      if (draggingNodeIds.length === 1 && rackDropPreview?.valid && onAssignDeviceToRackSlot) {
        const draggedNode = nodeMap.get(draggingNodeIds[0]);
        if (draggedNode && draggedNode.type !== 'rack' && draggedNode.assetId) {
          onAssignDeviceToRackSlot(rackDropPreview.rackId, draggedNode.assetId, rackDropPreview.startU, rackDropPreview.side);
        }
      }
      const hasVerticalGuide = alignmentGuides.some(g => g.orientation === 'vertical');
      const hasHorizontalGuide = alignmentGuides.some(g => g.orientation === 'horizontal');
      const hasGridIntersectionSnap = Boolean(gridSnapHighlight);
      onSnapNodesAndCommitDrag?.(draggingNodeIds, {
        snapX: !hasVerticalGuide && hasGridIntersectionSnap,
        snapY: !hasHorizontalGuide && hasGridIntersectionSnap
      });
      setDraggingNodeIds(null);
      setAlignmentGuides([]);
      setGridSnapHighlight(null);
      nodeDragSessionRef.current = null;
      setRackDropPreview(null);
    }

    if (isDrawingRoom && roomStartPos) {
      const width = Math.abs(currentMouseCanvas.x - roomStartPos.x);
      const height = Math.abs(currentMouseCanvas.y - roomStartPos.y);
      if (width > 40 && height > 40) {
        onAddRoom({
          floorId: project.activeFloorId || 'flr_1',
          name: `Phòng (${Math.round(width / project.settings.scale)}x${Math.round(height / project.settings.scale)}m)`,
          type: 'office',
          x: Math.min(roomStartPos.x, currentMouseCanvas.x),
          y: Math.min(roomStartPos.y, currentMouseCanvas.y),
          width,
          height,
          color: '#f8fafc',
          wallThickness: 6
        });
      }
      setIsDrawingRoom(false);
      setRoomStartPos(null);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    clearLongPressTimer();
    finishPointerInteraction(e.clientX, e.clientY);
  };

  const handlePointerCancel = () => {
    clearLongPressTimer();
    touchPointersRef.current.clear();
    pinchStateRef.current = null;
    activePointerIdRef.current = null;
    setIsPanning(false);
    setResizingSession(null);
    setDraggingRoom(null);
    setDraggingWaypoint(null);
    setReconnectingCable(null);
    setMarqueeStart(null);
    setDraggingRackDevice(null);
    setRackDropPreview(null);
    setDraggingNodeIds(null);
    setAlignmentGuides([]);
    setGridSnapHighlight(null);
    nodeDragSessionRef.current = null;
    setIsDrawingRoom(false);
    setRoomStartPos(null);
    setMeasureSession(null);
  };

  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isReadOnlyMode) return;
    const target = e.target as HTMLElement;
    const isCanvasBackdrop =
      e.target === containerRef.current ||
      target.tagName === 'svg' ||
      target.getAttribute('data-canvas-bg') === 'true';
    if (!isCanvasBackdrop) return;
    e.preventDefault();
    const canvasCoord = clientToCanvasCoord(e.clientX, e.clientY);
    cursorInsideCanvasRef.current = true;
    lastCanvasCursorRef.current = canvasCoord;
    const rect = containerRef.current?.getBoundingClientRect();
    const localX = rect ? e.clientX - rect.left : e.clientX;
    const localY = rect ? e.clientY - rect.top : e.clientY;
    setCanvasContextMenu({
      screenX: Math.max(12, Math.min(viewportSize.w - 236, localX)),
      screenY: Math.max(12, Math.min(viewportSize.h - 120, localY)),
      canvasX: canvasCoord.x,
      canvasY: canvasCoord.y
    });
  };

  const initiateConnectionOrOpenPortPicker = useCallback(
    (sourceNodeId: string, targetNodeId: string, clientX?: number, clientY?: number) => {
      if (isReadOnlyMode) return;
      const srcNode = nodeMap.get(sourceNodeId);
      const tgtNode = nodeMap.get(targetNodeId);
      const srcAsset = srcNode?.assetId ? project.assets[srcNode.assetId] : undefined;
      const tgtAsset = tgtNode?.assetId ? project.assets[tgtNode.assetId] : undefined;
      const srcPorts = srcAsset?.ports || [];
      const tgtPorts = tgtAsset?.ports || [];

      if (srcPorts.length === 0 && tgtPorts.length === 0) {
        onAddCable(sourceNodeId, targetNodeId);
        onSetConnectingSource(null);
        return;
      }

      const defaultSrcPort = (srcPorts.find(p => p.status !== 'up') || srcPorts[0])?.id;
      const defaultTgtPort = (tgtPorts.find(p => p.status !== 'up') || tgtPorts[0])?.id;

      const rect = containerRef.current?.getBoundingClientRect();
      const rawX =
        clientX !== undefined && rect
          ? clientX - rect.left
          : tgtNode
          ? (tgtNode.x + tgtNode.width / 2) * zoom + pan.x
          : viewportSize.w / 2;
      const rawY =
        clientY !== undefined && rect
          ? clientY - rect.top
          : tgtNode
          ? (tgtNode.y + tgtNode.height) * zoom + pan.y
          : viewportSize.h / 2;

      setPendingConnection({
        sourceNodeId,
        targetNodeId,
        sourcePortId: defaultSrcPort,
        targetPortId: defaultTgtPort,
        screenX: Math.max(12, Math.min(viewportSize.w - 344, rawX - 150)),
        screenY: Math.max(12, Math.min(viewportSize.h - 290, rawY + 14))
      });
      onSetConnectingSource(null);
    },
    [isReadOnlyMode, nodeMap, project.assets, onAddCable, onSetConnectingSource, zoom, pan.x, pan.y, viewportSize.w, viewportSize.h]
  );

  const handleNodeClick = useCallback((e: React.MouseEvent | React.PointerEvent, node: DiagramNode) => {
    if (activeTool === 'pan' || activeTool === 'text') return;
    e.stopPropagation();

    if (!isReadOnlyMode && connectingSource) {
      if (connectingSource.nodeId !== node.id) {
        initiateConnectionOrOpenPortPicker(connectingSource.nodeId, node.id, e.clientX, e.clientY);
      } else {
        onSetConnectingSource(null);
      }
      return;
    }

    if (!isReadOnlyMode && activeTool === 'connect') {
      onSetConnectingSource({ nodeId: node.id });
      return;
    }

    if (e.shiftKey && onToggleNodeSelection && node.type !== 'rack') {
      onToggleNodeSelection(node.id);
      return;
    }

    if (node.type === 'rack' || node.customData?.rackId) {
      const rackId = node.customData?.rackId || project.racks.find(r => r.id === node.id || r.name === node.label)?.id || node.id;
      onSelect('rack', rackId);
      return;
    }

    if (node.assetId && project.assets[node.assetId]?.category === 'rack') {
      const rackId = project.racks.find(r => r.id === node.assetId || r.name === node.label)?.id || node.assetId;
      onSelect('rack', rackId);
      return;
    }

    onSelect('node', node.id);
  }, [activeTool, connectingSource, initiateConnectionOrOpenPortPicker, isReadOnlyMode, onSelect, onSetConnectingSource, onToggleNodeSelection, project.assets, project.racks]);

  const handleNodePointerDown = useCallback((e: React.PointerEvent, node: DiagramNode) => {
    if (activeTool === 'pan' || activeTool === 'text') {
      return;
    }
    if (e.pointerType === 'touch' && touchPointersRef.current.size >= 2) {
      return;
    }
    e.stopPropagation();
    const isPrimary = e.pointerType !== 'mouse' || e.button === 0;
    if (!isPrimary) return;

    if (e.pointerType === 'touch' && node.type !== 'rack') {
      scheduleLongPress(e.clientX, e.clientY, 'node', node.id);
    }

    if (!isReadOnlyMode && (activeTool === 'connect' || connectingSource)) {
      return;
    }

    if (e.shiftKey) {
      return;
    }

    if (isNodeEffectivelyLocked(node, project.settings, project.assets, isReadOnlyMode)) {
      if (node.type === 'rack' || node.customData?.rackId) {
        onSelect('rack', node.customData?.rackId || node.id);
      } else {
        onSelect('node', node.id);
      }
      return;
    }

    onBeginDragSnapshot?.();

    const beginDragIds = (ids: string[]) => {
      const initialPositions = new Map<string, { x: number; y: number }>();
      for (const id of ids) {
        const target = nodeMap.get(id);
        if (target && !isNodeEffectivelyLocked(target, project.settings, project.assets, isReadOnlyMode)) {
          initialPositions.set(id, { x: target.x, y: target.y });
        }
      }
      nodeDragSessionRef.current = {
        originClientX: e.clientX,
        originClientY: e.clientY,
        initialPositions
      };
      setDraggingNodeIds(ids);
      setDragStartPos({ x: e.clientX, y: e.clientY });
    };

    if (node.type === 'rack' || node.customData?.rackId) {
      const rackId = node.customData?.rackId || node.id;
      onSelect('rack', rackId);
      beginDragIds([node.id]);
    } else if (selectedNodeIdSet.has(node.id) && selectedNodeIds.length > 1) {
      beginDragIds(
        selectedNodeIds.filter(id => {
          const n = nodeMap.get(id);
          return n ? !isNodeEffectivelyLocked(n, project.settings, project.assets, isReadOnlyMode) : false;
        })
      );
    } else if (node.groupId) {
      const groupMembers = project.nodes.filter(n => n.groupId === node.groupId).map(n => n.id);
      if (groupMembers.length > 1) {
        onSelect('node', node.id, groupMembers.filter(id => id !== node.id));
        beginDragIds(
          groupMembers.filter(id => {
            const n = nodeMap.get(id);
            return n ? !isNodeEffectivelyLocked(n, project.settings, project.assets, isReadOnlyMode) : false;
          })
        );
      } else {
        onSelect('node', node.id);
        beginDragIds([node.id]);
      }
    } else {
      onSelect('node', node.id);
      beginDragIds([node.id]);
    }
  }, [activeTool, connectingSource, isReadOnlyMode, nodeMap, onBeginDragSnapshot, onSelect, project.assets, project.nodes, project.settings, scheduleLongPress, selectedNodeIdSet, selectedNodeIds]);

  const startNodeResize = useCallback((
    e: React.PointerEvent,
    nodeId: string,
    dir: ResizeHandleDir,
    rect: { x: number; y: number; width: number; height: number },
    rotationDeg: number,
    minW: number,
    minH: number
  ) => {
    const targetNode = nodeMap.get(nodeId);
    if (!targetNode || isNodeEffectivelyLocked(targetNode, project.settings, project.assets, isReadOnlyMode)) return;
    e.stopPropagation();
    onBeginDragSnapshot?.();
    setResizingSession({
      targetKind: 'node',
      targetId: nodeId,
      handle: dir,
      originClientX: e.clientX,
      originClientY: e.clientY,
      initialRect: rect,
      rotationDeg,
      minW,
      minH,
      currentRect: rect
    });
  }, [isReadOnlyMode, onBeginDragSnapshot]);

  const getDeviceColor = useCallback((cat?: string) => {
    switch (cat) {
      case 'core_switch': return '#0284c7';
      case 'switch': return '#0ea5e9';
      case 'router': return '#2563eb';
      case 'firewall': return '#dc2626';
      case 'server': return '#475569';
      case 'storage': return '#0f766e';
      case 'ups': return '#e11d48';
      case 'pdu': return '#9333ea';
      case 'odf': return '#06b6d4';
      case 'patch_panel': return '#64748b';
      case 'nvr': return '#d97706';
      default: return '#3b82f6';
    }
  }, []);

  const cableBundleLayout = useMemo(
    () => computeCableBundleLayout(visibleCables, getNodeEffectiveRect),
    [visibleCables, getNodeEffectiveRect]
  );

  const activeBundleInfo: CableBundleInfo | undefined = useMemo(
    () => (activeBundleId ? cableBundleLayout.bundles.find(b => b.bundleId === activeBundleId) : undefined),
    [activeBundleId, cableBundleLayout.bundles]
  );

  const getCableGeometry = useCallback((cable: CableEdge): CanvasCableGeometry | null => {
    const info = cableBundleLayout.cablePaths.get(cable.id) || (() => {
      const src = getNodeEffectiveRect(cable.sourceNodeId);
      const tgt = getNodeEffectiveRect(cable.targetNodeId);
      if (!src || !tgt) return null;
      return computeCablePath(cable, src, tgt);
    })();
    if (!info) return null;

    return {
      pathD: info.d,
      pts: info.pts,
      x1: info.x1,
      y1: info.y1,
      x2: info.x2,
      y2: info.y2,
      midX: info.midPoint.x,
      midY: info.midPoint.y,
      midAngleDeg: info.midAngleDeg
    };
  }, [cableBundleLayout.cablePaths, getNodeEffectiveRect]);

  const minimapBounds = useMemo(() => {
    let minX = 0;
    let minY = 0;
    let maxX = 1400;
    let maxY = 900;
    visibleNodes.forEach(n => {
      minX = Math.min(minX, n.x - 80);
      minY = Math.min(minY, n.y - 80);
      maxX = Math.max(maxX, n.x + n.width + 80);
      maxY = Math.max(maxY, n.y + n.height + 80);
    });
    visibleRooms.forEach(r => {
      minX = Math.min(minX, r.x - 80);
      minY = Math.min(minY, r.y - 80);
      maxX = Math.max(maxX, r.x + r.width + 80);
      maxY = Math.max(maxY, r.y + r.height + 80);
    });
    return {
      minX,
      minY,
      width: Math.max(800, maxX - minX),
      height: Math.max(500, maxY - minY)
    };
  }, [visibleNodes, visibleRooms]);

  const connectingSourceRect = connectingSource ? getNodeEffectiveRect(connectingSource.nodeId) : null;
  const connectingSourceNode = connectingSource ? nodeMap.get(connectingSource.nodeId) : undefined;

  const canvasAppearance = useMemo(
    () => resolveCanvasAppearance(project.settings),
    [project.settings]
  );

  const handleBackgroundImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !onUpdateSettings) return;
    try {
      const dataUrl = await processCanvasBackgroundImage(file);
      setBgUploadError(null);
      onUpdateSettings({
        backgroundImageUrl: dataUrl,
        backgroundImageOpacity: project.settings.backgroundImageOpacity ?? 0.35,
        backgroundImageMode: project.settings.backgroundImageMode || 'cover'
      });
    } catch (err) {
      setBgUploadError(err instanceof Error ? err.message : 'Không thể tải ảnh nền.');
    }
    if (bgFileInputRef.current) bgFileInputRef.current.value = '';
  };

  const svgAriaLabel = useMemo(() => {
    return `Sơ đồ kỹ thuật ${project.name} (${project.activeMode}): ${visibleRooms.length} phòng, ${visibleRackNodes.length} tủ rack, ${visibleDeviceNodes.length} thiết bị, ${visibleCables.length} dây cáp${isReadOnlyMode ? ' — Chế độ Chỉ xem' : ''}`;
  }, [project.name, project.activeMode, visibleRooms.length, visibleRackNodes.length, visibleDeviceNodes.length, visibleCables.length, isReadOnlyMode]);

  return (
    <div
      ref={containerRef}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerUpCapture={handlePointerUpCapture}
      onPointerCancelCapture={handlePointerUpCapture}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerEnter={() => {
        cursorInsideCanvasRef.current = true;
      }}
      onPointerLeave={() => {
        cursorInsideCanvasRef.current = false;
      }}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onContextMenu={handleCanvasContextMenu}
      onWheel={handleWheel}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{
        touchAction: 'none',
        backgroundColor: canvasAppearance.backgroundColor
      }}
      className={`relative w-full h-full overflow-hidden select-none transition-colors duration-200 ${
        isReadOnlyMode || activeTool === 'pan'
          ? isPanning
            ? 'cursor-grabbing'
            : 'cursor-grab'
          : activeTool === 'room' || activeTool === 'measure'
          ? 'cursor-crosshair'
          : activeTool === 'text'
          ? 'cursor-text'
          : activeTool === 'connect' || connectingSource || reconnectingCable
          ? 'cursor-pointer'
          : isPanning
          ? 'cursor-grabbing'
          : draggingRackDevice
          ? 'cursor-grabbing'
          : 'cursor-default'
      }`}
    >
      <input
        ref={bgFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={handleBackgroundImageUpload}
        className="hidden"
      />

      {canvasAppearance.imageUrl && canvasAppearance.imageMode === 'cover' && (
        <div
          className="absolute inset-0 pointer-events-none bg-center bg-cover"
          style={{
            backgroundImage: `url(${canvasAppearance.imageUrl})`,
            opacity: canvasAppearance.imageOpacity
          }}
        />
      )}

      {/* Main Vector SVG World */}
      <svg
        id="hachihi-main-svg"
        role="img"
        aria-label={svgAriaLabel}
        className="w-full h-full absolute inset-0"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0'
        }}
      >
        <title>{svgAriaLabel}</title>

        {/* CAD Grid / Pattern */}
        {canvasAppearance.pattern !== 'none' && (
          <defs>
            <pattern
              id="cad-grid-pattern"
              width={project.settings.gridSize}
              height={project.settings.gridSize}
              patternUnits="userSpaceOnUse"
            >
              {canvasAppearance.pattern === 'dots' && (
                <circle cx="1.5" cy="1.5" r="1.15" fill={canvasAppearance.gridColor} />
              )}
              {canvasAppearance.pattern === 'lines' && (
                <path
                  d={`M ${project.settings.gridSize} 0 L 0 0 0 ${project.settings.gridSize}`}
                  fill="none"
                  stroke={canvasAppearance.gridColor}
                  strokeWidth="0.7"
                  strokeOpacity="0.7"
                />
              )}
              {canvasAppearance.pattern === 'cross' && (
                <path
                  d="M 1 4 L 7 4 M 4 1 L 4 7"
                  fill="none"
                  stroke={canvasAppearance.gridColor}
                  strokeWidth="0.9"
                />
              )}
            </pattern>
          </defs>
        )}

        {canvasAppearance.pattern !== 'none' && (
          <rect
            data-canvas-bg="true"
            x="-2000"
            y="-2000"
            width="8000"
            height="8000"
            fill="url(#cad-grid-pattern)"
          />
        )}

        {canvasAppearance.imageUrl && canvasAppearance.imageMode === 'world' && (
          <image
            href={canvasAppearance.imageUrl}
            x={0}
            y={0}
            width={1600}
            height={1000}
            preserveAspectRatio="xMidYMid meet"
            opacity={canvasAppearance.imageOpacity}
            className="pointer-events-none"
          />
        )}

        {/* 1. LAYER: ROOMS */}
        {visibleRooms.map(room => {
          const isSelected = selection.type === 'room' && selection.id === room.id;
          const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
          const handleSize = 8 * invZ;

          const roomLocked = isRoomEffectivelyLocked(room, project.settings, isReadOnlyMode);

          const startRoomResize = (e: React.PointerEvent, dir: ResizeHandleDir) => {
            e.stopPropagation();
            if (roomLocked) return;
            onBeginDragSnapshot?.();
            setResizingSession({
              targetKind: 'room',
              targetId: room.id,
              handle: dir,
              originClientX: e.clientX,
              originClientY: e.clientY,
              initialRect: { x: room.x, y: room.y, width: room.width, height: room.height },
              rotationDeg: 0,
              minW: 60,
              minH: 45,
              currentRect: { x: room.x, y: room.y, width: room.width, height: room.height }
            });
          };

          const getRoomHandlePos = (dir: ResizeHandleDir) => {
            const cx = room.x + room.width / 2;
            const cy = room.y + room.height / 2;
            switch (dir) {
              case 'nw': return { x: room.x, y: room.y };
              case 'n': return { x: cx, y: room.y };
              case 'ne': return { x: room.x + room.width, y: room.y };
              case 'e': return { x: room.x + room.width, y: cy };
              case 'se': return { x: room.x + room.width, y: room.y + room.height };
              case 's': return { x: cx, y: room.y + room.height };
              case 'sw': return { x: room.x, y: room.y + room.height };
              case 'w': return { x: room.x, y: cy };
            }
          };

          return (
            <g
              key={room.id}
              onPointerDown={(e) => {
                e.stopPropagation();
                if (!isReadOnlyMode && (activeTool === 'connect' || connectingSource || activeTool === 'room')) return;
                const isPrimary = e.pointerType !== 'mouse' || e.button === 0;
                if (!isPrimary) return;
                onSelect('room', room.id);
                if (!roomLocked && onMoveRoomTransient) {
                  onBeginDragSnapshot?.();
                  setDraggingRoom({
                    roomId: room.id,
                    lastClientX: e.clientX,
                    lastClientY: e.clientY
                  });
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect('room', room.id);
              }}
              className={roomLocked ? 'cursor-pointer' : 'cursor-move'}
            >
              <rect
                x={room.x}
                y={room.y}
                width={room.width}
                height={room.height}
                fill={room.color || '#f8fafc'}
                stroke={isSelected ? '#2563eb' : '#94a3b8'}
                strokeWidth={isSelected ? 2.5 : room.wallThickness}
                strokeDasharray={room.type === 'utility_riser' ? '6 4' : 'none'}
                rx="4"
              />
              <rect
                x={room.x}
                y={room.y}
                width={room.width}
                height={22}
                fill={isSelected ? '#3b82f6' : '#e2e8f0'}
                opacity={0.85}
                rx="4"
              />
              <text
                x={room.x + 8}
                y={room.y + 15}
                fill={isSelected ? '#ffffff' : '#334155'}
                fontSize="10"
                fontWeight="600"
                className="pointer-events-none"
              >
                {room.name} · {((room.width * room.height) / (project.settings.scale * project.settings.scale)).toFixed(0)}m²
              </text>

              {isSelected && !roomLocked && (
                <g>
                  <rect
                    x={room.x - 2}
                    y={room.y - 2}
                    width={room.width + 4}
                    height={room.height + 4}
                    fill="none"
                    stroke="#3b82f6"
                    strokeWidth={1.2 * invZ}
                    strokeDasharray={`${4 * invZ} ${3 * invZ}`}
                    rx="5"
                    className="pointer-events-none"
                  />
                  {RESIZE_HANDLE_DIRS.map(({ dir, cursorClass }) => {
                    const pos = getRoomHandlePos(dir);
                    return (
                      <rect
                        key={`rm_h_${dir}`}
                        x={pos.x - handleSize / 2}
                        y={pos.y - handleSize / 2}
                        width={handleSize}
                        height={handleSize}
                        rx={1.5 * invZ}
                        fill="#ffffff"
                        stroke="#2563eb"
                        strokeWidth={1.5 * invZ}
                        className={cursorClass}
                        onPointerDown={(e) => startRoomResize(e, dir)}
                      />
                    );
                  })}
                </g>
              )}
            </g>
          );
        })}

        {/* 1b. LAYER: CABLE TRAYS & CONDUITS */}
        {visibleCableTrays.map(tray => {
          const ptsStr = tray.points.map(p => `${p.x},${p.y}`).join(' ');
          const trayW = Math.max(8, tray.widthPx || 16);
          const baseColor =
            tray.color ||
            (tray.kind === 'power_tray' ? '#e11d48' : tray.kind === 'conduit' ? '#0d9488' : '#0284c7');
          const midPt = tray.points[Math.floor(tray.points.length / 2)] || tray.points[0];
          const prevPt = tray.points[Math.max(0, Math.floor(tray.points.length / 2) - 1)] || midPt;
          const labelX = (prevPt.x + midPt.x) / 2;
          const labelY = (prevPt.y + midPt.y) / 2;

          return (
            <g key={tray.id} className="pointer-events-none" opacity={0.85}>
              <polyline
                points={ptsStr}
                fill="none"
                stroke={baseColor}
                strokeWidth={trayW}
                strokeOpacity={0.14}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <polyline
                points={ptsStr}
                fill="none"
                stroke={baseColor}
                strokeWidth={Math.max(2, trayW * 0.72)}
                strokeOpacity={0.32}
                strokeDasharray={tray.kind === 'conduit' ? 'none' : '4 5'}
                strokeLinecap="butt"
                strokeLinejoin="round"
              />
              <polyline
                points={ptsStr}
                fill="none"
                stroke={baseColor}
                strokeWidth={1.4}
                strokeOpacity={0.75}
                strokeDasharray="6 4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {!hiddenLayerSet.has('labels') && (
                <g transform={`translate(${labelX}, ${labelY - trayW / 2 - 8})`}>
                  <rect
                    x={-Math.min(90, tray.name.length * 3.1 + 8)}
                    y={-8}
                    width={Math.min(180, tray.name.length * 6.2 + 16)}
                    height={14}
                    rx="3"
                    fill="#ffffff"
                    fillOpacity={0.92}
                    stroke={baseColor}
                    strokeOpacity={0.6}
                    strokeWidth="0.9"
                  />
                  <text
                    x={0}
                    y={2}
                    textAnchor="middle"
                    fill={baseColor}
                    fontSize="8"
                    fontWeight="700"
                  >
                    {tray.name}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* LOGICAL GROUP FRAMES */}
        {groupBounds.map(([grpId, b]) => (
          <g key={`grp_${grpId}`} className="pointer-events-none">
            <rect
              x={b.minX - 10}
              y={b.minY - 14}
              width={b.maxX - b.minX + 20}
              height={b.maxY - b.minY + 24}
              rx="10"
              fill="#3b82f6"
              fillOpacity="0.04"
              stroke="#3b82f6"
              strokeWidth="1.5"
              strokeDasharray="6 4"
            />
            <text
              x={b.minX - 4}
              y={b.minY - 18}
              fill="#2563eb"
              fontSize="9"
              fontWeight="bold"
              fontFamily="monospace"
            >
              NHÓM ({b.count})
            </text>
          </g>
        ))}

        {/* Dynamic Room Drawing Preview */}
        {isDrawingRoom && roomStartPos && !isReadOnlyMode && (
          <rect
            x={Math.min(roomStartPos.x, currentMouseCanvas.x)}
            y={Math.min(roomStartPos.y, currentMouseCanvas.y)}
            width={Math.abs(currentMouseCanvas.x - roomStartPos.x)}
            height={Math.abs(currentMouseCanvas.y - roomStartPos.y)}
            fill="#3b82f6"
            fillOpacity="0.15"
            stroke="#2563eb"
            strokeWidth="2"
            strokeDasharray="4 4"
          />
        )}

        {/* 2. LAYER: WI-FI HEATMAP */}
        {project.settings.showCoverageRadius && !hiddenLayerSet.has('wifi') && culledDeviceNodes.map(node => {
          const asset = node.assetId ? project.assets[node.assetId] : undefined;
          const baseRadiusMeters =
            asset?.wifiSpecs?.coverageRadiusMeters ??
            (typeof node.customData?.coverageRadiusMeters === 'number'
              ? node.customData.coverageRadiusMeters
              : undefined);
          if (typeof baseRadiusMeters === 'number' && baseRadiusMeters > 0) {
            const activeMeters =
              wifiResizeSession?.nodeId === node.id ? wifiResizeSession.currentMeters : baseRadiusMeters;
            const radiusPx = activeMeters * Math.max(5, project.settings.scale || 30);
            const cx = node.x + node.width / 2;
            const cy = node.y + node.height / 2;
            const isActiveWifi =
              wifiResizeSession?.nodeId === node.id ||
              selectedNodeIdSet.has(node.id) ||
              hoveredNodeId === node.id;
            return (
              <g key={`wifi_heat_${node.id}`} pointerEvents="none">
                <circle
                  cx={cx}
                  cy={cy}
                  r={radiusPx * 0.55}
                  fill="#10b981"
                  fillOpacity={isActiveWifi ? '0.22' : '0.16'}
                  stroke="#059669"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                />
                <circle
                  cx={cx}
                  cy={cy}
                  r={radiusPx}
                  fill="#06b6d4"
                  fillOpacity={isActiveWifi ? '0.12' : '0.07'}
                  stroke={wifiResizeSession?.nodeId === node.id ? '#059669' : '#0891b2'}
                  strokeWidth={wifiResizeSession?.nodeId === node.id ? '2.2' : '1.5'}
                  strokeDasharray="5 5"
                />
                <text x={cx} y={cy - radiusPx - 6} textAnchor="middle" fill="#059669" fontSize="9.5" fontWeight="bold">
                  {activeMeters}m ({Math.round(Math.PI * activeMeters * activeMeters)} m²)
                </text>
              </g>
            );
          }
          return null;
        })}

        {/* 3. LAYER: CAMERA FOV */}
        {project.settings.showCoverageRadius && !hiddenLayerSet.has('fov') && culledDeviceNodes.map(node => {
          const asset = node.assetId ? project.assets[node.assetId] : undefined;
          if (asset?.cameraSpecs) {
            const cx = node.x + node.width / 2;
            const cy = node.y + node.height / 2;
            const fov = asset.cameraSpecs.fovAngle || 90;
            const range = (asset.cameraSpecs.irDistanceMeters || 30) * (project.settings.scale * 0.4);
            const rot = (node.rotation || 0) * (Math.PI / 180);
            const halfFov = (fov / 2) * (Math.PI / 180);

            const x1 = cx + range * Math.cos(rot - halfFov);
            const y1 = cy + range * Math.sin(rot - halfFov);
            const x2 = cx + range * Math.cos(rot + halfFov);
            const y2 = cy + range * Math.sin(rot + halfFov);

            const path = `M ${cx} ${cy} L ${x1} ${y1} A ${range} ${range} 0 0 1 ${x2} ${y2} Z`;

            return (
              <g key={`cam_fov_${node.id}`} pointerEvents="none">
                <path d={path} fill="#f59e0b" fillOpacity="0.22" stroke="#d97706" strokeWidth="1.5" strokeDasharray="4 4" />
                <text x={cx + range * 0.65 * Math.cos(rot)} y={cy + range * 0.65 * Math.sin(rot)} textAnchor="middle" fill="#b45309" fontSize="9" fontWeight="bold">
                  FOV {fov}° ({asset.cameraSpecs.irDistanceMeters}m)
                </text>
              </g>
            );
          }
          return null;
        })}

        {/* 4. LAYER: CABLE BUNDLE JACKETS + CABLES + LABELS */}
        {cableBundleLayout.bundles.map(bundle => {
          const isCollapsed = collapsedBundleIds.has(bundle.bundleId);
          const isBundleActive = activeBundleId === bundle.bundleId;
          const angleDeg = (Math.atan2(bundle.tangent.y, bundle.tangent.x) * 180) / Math.PI;
          const firstCable = bundle.cables[0];
          const trunkGeom = firstCable ? getCableGeometry(firstCable) : null;
          const hasSelectedMember = selection.type === 'edge' && bundle.cables.some(c => c.id === selection.id);

          return (
            <g key={`sheath_${bundle.bundleId}`}>
              {isCollapsed && trunkGeom && (
                <g
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveBundleId(prev => (prev === bundle.bundleId ? null : bundle.bundleId));
                  }}
                  className="cursor-pointer"
                >
                  <path d={trunkGeom.pathD} fill="none" stroke="transparent" strokeWidth={18} />
                  {(isBundleActive || hasSelectedMember) && (
                    <path
                      d={trunkGeom.pathD}
                      fill="none"
                      stroke="#3b82f6"
                      strokeOpacity={0.35}
                      strokeWidth={Math.min(10, 3.5 + bundle.cables.length * 0.9) + 6}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  <path
                    d={trunkGeom.pathD}
                    fill="none"
                    stroke={bundle.primaryColor}
                    strokeWidth={Math.min(10, 3.5 + bundle.cables.length * 0.9)}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity={0.92}
                  />
                  <path
                    d={trunkGeom.pathD}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth={1.2}
                    strokeDasharray="4 6"
                    strokeLinecap="round"
                    opacity={0.65}
                  />
                </g>
              )}

              <g
                transform={`translate(${bundle.midPoint.x}, ${bundle.midPoint.y}) rotate(${angleDeg})`}
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveBundleId(prev => (prev === bundle.bundleId ? null : bundle.bundleId));
                }}
                className="cursor-pointer"
              >
                <rect
                  x={-11}
                  y={-(bundle.spanWidthPx / 2 + 4)}
                  width={22}
                  height={bundle.spanWidthPx + 8}
                  rx="6"
                  fill={isBundleActive ? '#dbeafe' : '#eff6ff'}
                  fillOpacity={project.settings.isDarkMode ? 0.2 : 0.85}
                  stroke={isBundleActive || hasSelectedMember ? '#2563eb' : '#60a5fa'}
                  strokeWidth={isBundleActive ? 1.8 : 1.1}
                  strokeDasharray={isCollapsed ? 'none' : '3 2'}
                />
                <line
                  x1={-5}
                  y1={-(bundle.spanWidthPx / 2 + 2)}
                  x2={-5}
                  y2={bundle.spanWidthPx / 2 + 2}
                  stroke={isBundleActive ? '#1d4ed8' : '#3b82f6'}
                  strokeWidth="1.5"
                />
                <line
                  x1={5}
                  y1={-(bundle.spanWidthPx / 2 + 2)}
                  x2={5}
                  y2={bundle.spanWidthPx / 2 + 2}
                  stroke={isBundleActive ? '#1d4ed8' : '#3b82f6'}
                  strokeWidth="1.5"
                />
              </g>
            </g>
          );
        })}

        {visibleCables.map(cable => {
          const isSelected = selection.type === 'edge' && selection.id === cable.id;
          const isHovered = hoveredCableId === cable.id;
          const bundleId = cableBundleLayout.cableToBundleId.get(cable.id);
          const isBundled = Boolean(bundleId);
          const isBundleCollapsed = Boolean(bundleId && collapsedBundleIds.has(bundleId));

          if (isBundleCollapsed && !isSelected) {
            return null;
          }

          const geom = getCableGeometry(cable);
          if (!geom) return null;

          const { pathD, pts, x1, y1, x2, y2, midX, midY } = geom;
          const cableColor = normalizeCableColor(cable.color || '#0284c7');

          return (
            <g
              key={cable.id}
              onPointerDown={(e) => {
                if (e.pointerType === 'touch') {
                  scheduleLongPress(e.clientX, e.clientY, 'edge', cable.id);
                }
              }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect('edge', cable.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!isReadOnlyMode && midX !== 0) {
                  openInlineCableLabelEditor(cable, midX, midY);
                }
              }}
              onPointerEnter={() => setHoveredCableId(cable.id)}
              onPointerLeave={() => setHoveredCableId(prev => (prev === cable.id ? null : prev))}
              className="cursor-pointer group"
            >
              <path d={pathD} fill="none" stroke="transparent" strokeWidth={isBundled ? 9 : 14} />

              {(isSelected || isHovered) && (
                <path
                  d={pathD}
                  fill="none"
                  stroke={cableColor}
                  strokeOpacity={isSelected ? 0.3 : 0.18}
                  strokeWidth={cable.strokeWidth + (isSelected ? 8 : 5)}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              <path
                d={pathD}
                fill="none"
                stroke={cableColor}
                strokeWidth={isSelected ? cable.strokeWidth + 1.5 : isHovered ? cable.strokeWidth + 0.75 : cable.strokeWidth}
                strokeDasharray={cable.lineStyle === 'dashed' ? '6 4' : 'none'}
                strokeLinecap="round"
                strokeLinejoin="round"
              />

              {isSelected && !isReadOnlyMode && (
                <g>
                  {(cable.controlPoints || []).map((cp, idx) => (
                    <circle
                      key={`wp_${idx}`}
                      cx={cp.x}
                      cy={cp.y}
                      r={6}
                      fill="#f59e0b"
                      stroke="#ffffff"
                      strokeWidth="2"
                      className="cursor-move"
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        onBeginDragSnapshot?.();
                        setDraggingWaypoint({ cableId: cable.id, pointIndex: idx });
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        if (onUpdateCable) {
                          const nextPts = (cable.controlPoints || []).filter((_, i) => i !== idx);
                          onUpdateCable(cable.id, { controlPoints: nextPts.length ? nextPts : undefined });
                        }
                      }}
                    >
                      <title>Kéo để chỉnh điểm uốn · Nhấp đúp để xóa điểm uốn</title>
                    </circle>
                  ))}

                  {pts.slice(0, -1).map((pA, segIdx) => {
                    const pB = pts[segIdx + 1];
                    const sx = (pA.x + pB.x) / 2;
                    const sy = (pA.y + pB.y) / 2;
                    return (
                      <g
                        key={`add_wp_${segIdx}`}
                        transform={`translate(${sx}, ${sy})`}
                        className="cursor-pointer opacity-75 hover:opacity-100"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          if (onUpdateCableControlPoints) {
                            onBeginDragSnapshot?.();
                            const existing = [...(cable.controlPoints || [])];
                            existing.splice(segIdx, 0, { x: sx, y: sy });
                            onUpdateCableControlPoints(cable.id, existing);
                            setDraggingWaypoint({ cableId: cable.id, pointIndex: segIdx });
                          }
                        }}
                      >
                        <circle r={5} fill="#eff6ff" stroke="#2563eb" strokeWidth="1.5" strokeDasharray="2 1" />
                        <text x="0" y="3" textAnchor="middle" fill="#1d4ed8" fontSize="9" fontWeight="bold">+</text>
                        <title>Kéo để thêm điểm uốn mới</title>
                      </g>
                    );
                  })}

                  <circle
                    cx={x1}
                    cy={y1}
                    r={6.5}
                    fill="#10b981"
                    stroke="#ffffff"
                    strokeWidth="2"
                    className="cursor-crosshair"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setReconnectingCable({ cableId: cable.id, endpoint: 'source', anchorX: x2, anchorY: y2 });
                    }}
                  >
                    <title>Kéo đầu cáp nguồn sang thiết bị khác</title>
                  </circle>

                  <circle
                    cx={x2}
                    cy={y2}
                    r={6.5}
                    fill="#06b6d4"
                    stroke="#ffffff"
                    strokeWidth="2"
                    className="cursor-crosshair"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setReconnectingCable({ cableId: cable.id, endpoint: 'target', anchorX: x1, anchorY: y1 });
                    }}
                  >
                    <title>Kéo đầu cáp đích sang thiết bị khác</title>
                  </circle>
                </g>
              )}
            </g>
          );
        })}

        {!hiddenLayerSet.has('labels') && !hiddenLayerSet.has('cable_labels') && cableBundleLayout.bundles.map(bundle => {
          const isBundleActive = activeBundleId === bundle.bundleId;
          const isCollapsed = collapsedBundleIds.has(bundle.bundleId);
          const colorDots = (bundle.distinctColors || [bundle.primaryColor]).slice(0, 4);
          const dotsW = colorDots.length * 7 + 4;
          const badgeW = Math.max(82, bundle.summaryLabel.length * 5.8 + 14 + dotsW);
          const labelYOffset = -(bundle.spanWidthPx / 2 + 17);

          return (
            <g
              key={`badge_${bundle.bundleId}`}
              transform={`translate(${bundle.midPoint.x}, ${bundle.midPoint.y + labelYOffset})`}
              onClick={(e) => {
                e.stopPropagation();
                setActiveBundleId(prev => (prev === bundle.bundleId ? null : bundle.bundleId));
              }}
              className="cursor-pointer"
            >
              <rect
                x={-badgeW / 2}
                y={-9.5}
                width={badgeW}
                height={19}
                rx="4"
                fill={isBundleActive ? '#1d4ed8' : isCollapsed ? '#0f172a' : '#ffffff'}
                stroke={isBundleActive ? '#1e40af' : bundle.primaryColor}
                strokeWidth="1.3"
              />
              {colorDots.map((cColor, idx) => (
                <circle
                  key={`bdot_${idx}`}
                  cx={-badgeW / 2 + 9 + idx * 7}
                  cy={0}
                  r="2.6"
                  fill={cColor}
                  stroke={isBundleActive || isCollapsed ? '#ffffff' : '#0f172a'}
                  strokeOpacity="0.25"
                  strokeWidth="0.6"
                />
              ))}
              <text
                x={dotsW / 2 - 2}
                y="3"
                textAnchor="middle"
                fill={isBundleActive || isCollapsed ? '#ffffff' : '#1e3a8a'}
                fontSize="8.5"
                fontWeight="700"
                fontFamily="monospace"
              >
                {bundle.summaryLabel}
              </text>
              <title>Nhấn để xem danh sách cáp trong bó hoặc gộp/tách đường dây</title>
            </g>
          );
        })}

        {!hiddenLayerSet.has('cable_labels') && !hiddenLayerSet.has('labels') && (
          <g data-layer="cable-labeling">
            {visibleCables.map(cable => {
              const isSelected = selection.type === 'edge' && selection.id === cable.id;
              const isHovered = hoveredCableId === cable.id;
              const bundleId = cableBundleLayout.cableToBundleId.get(cable.id);
              const isBundled = Boolean(bundleId);
              const isBundleCollapsed = Boolean(bundleId && collapsedBundleIds.has(bundleId));

              if (isBundleCollapsed && !isSelected) {
                return null;
              }

              const geom = getCableGeometry(cable);
              if (!geom || geom.midX === 0 || editingCableLabel?.cableId === cable.id) {
                return null;
              }

              const cableColor = normalizeCableColor(cable.color || '#0284c7');
              const hasCustomLabel = Boolean(cable.label && cable.label.trim().length > 0);
              const showBadge =
                (project.settings.showCableCodes || hasCustomLabel) &&
                (!isBundled || isSelected || isHovered || hasCustomLabel);

              const lt = resolveCableLabelTransform(cable, {
                midPoint: { x: geom.midX, y: geom.midY },
                midAngleDeg: geom.midAngleDeg
              });

              if (!showBadge) {
                if (!isSelected || isBundled || isReadOnlyMode) return null;
                return (
                  <g
                    key={`lbl_add_${cable.id}`}
                    transform={`translate(${lt.x}, ${lt.y}) rotate(${lt.angleDeg})`}
                    onClick={(e) => {
                      e.stopPropagation();
                      openInlineCableLabelEditor(cable, lt.x, lt.y);
                    }}
                    className="cursor-text"
                  >
                    <rect
                      x="-38"
                      y="-10"
                      width="76"
                      height="20"
                      rx="4"
                      fill="#f8fafc"
                      stroke={cableColor}
                      strokeWidth="1.1"
                      strokeDasharray="3 2"
                    />
                    <text
                      x="0"
                      y="3"
                      textAnchor="middle"
                      fill="#334155"
                      fontSize="8.5"
                      fontWeight="600"
                    >
                      + Thêm nhãn
                    </text>
                  </g>
                );
              }

              const halfH = lt.badgeHeight / 2;
              const badgeLeft = -lt.badgeWidth / 2;
              const dotR = Math.max(2.4, Math.min(4.2, lt.fontSize * 0.28));
              const dotCx = badgeLeft + dotR + 5.5;
              const textOffsetX = dotR * 0.9 + 2;

              return (
                <g
                  key={`lbl_${cable.id}`}
                  transform={`translate(${lt.x}, ${lt.y}) rotate(${lt.angleDeg})`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect('edge', cable.id);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    if (!isReadOnlyMode) {
                      openInlineCableLabelEditor(cable, lt.x, lt.y);
                    }
                  }}
                  onPointerEnter={() => setHoveredCableId(cable.id)}
                  onPointerLeave={() => setHoveredCableId(prev => (prev === cable.id ? null : prev))}
                  className="cursor-pointer"
                >
                  <rect
                    x={badgeLeft}
                    y={-halfH}
                    width={lt.badgeWidth}
                    height={lt.badgeHeight}
                    rx="4"
                    fill="#ffffff"
                    fillOpacity={isSelected ? 0.99 : 0.95}
                    stroke={cableColor}
                    strokeWidth={isSelected ? 1.8 : 1.1}
                    filter={isSelected ? 'drop-shadow(0 2px 5px rgba(37,99,235,0.22))' : 'drop-shadow(0 1px 2px rgba(15,23,42,0.10))'}
                  />
                  <circle cx={dotCx} cy="0" r={dotR} fill={cableColor} />
                  <text
                    x={textOffsetX}
                    y={lt.fontSize * 0.35}
                    textAnchor="middle"
                    fill="#0f172a"
                    fontSize={lt.fontSize}
                    fontWeight={hasCustomLabel ? '700' : '600'}
                    fontFamily={hasCustomLabel ? 'system-ui, sans-serif' : 'monospace'}
                  >
                    {lt.text}
                  </text>
                  <title>
                    {`${lt.text} (${lt.angleDeg}° · ${lt.fontSize}px)${isReadOnlyMode ? '' : ' — Nhấp đúp để sửa nhanh'}`}
                  </title>
                </g>
              );
            })}
          </g>
        )}

        {reconnectingCable && !isReadOnlyMode && (
          <line
            x1={reconnectingCable.anchorX}
            y1={reconnectingCable.anchorY}
            x2={currentMouseCanvas.x}
            y2={currentMouseCanvas.y}
            stroke="#10b981"
            strokeWidth="2.5"
            strokeDasharray="5 3"
            className="pointer-events-none"
          />
        )}

        {connectingSourceRect && !isReadOnlyMode && (
          <line
            x1={connectingSourceRect.x + connectingSourceRect.width / 2}
            y1={connectingSourceRect.y + connectingSourceRect.height / 2}
            x2={currentMouseCanvas.x}
            y2={currentMouseCanvas.y}
            stroke="#2563eb"
            strokeWidth="2.5"
            strokeDasharray="4 4"
            className="pointer-events-none"
          />
        )}

        {/* 5. LAYER: INTERACTIVE 19-INCH SERVER RACKS */}
        {visibleRackNodes.map(rackNode => (
          <CanvasRackNode
            key={rackNode.id}
            rackNode={rackNode}
            project={project}
            selection={selection}
            activeTool={activeTool}
            zoom={zoom}
            rackSides={rackSides}
            connectingSource={connectingSource}
            draggingRackDevice={draggingRackDevice}
            rackDropPreview={rackDropPreview}
            selectedNodeIdSet={selectedNodeIdSet}
            isOverlapping={overlapReport.overlappingNodeIds.has(rackNode.id)}
            isReadOnlyMode={isReadOnlyMode}
            resolveRackForNode={resolveRackForNode}
            getDeviceColor={getDeviceColor}
            clientToCanvasCoord={clientToCanvasCoord}
            onNodePointerDown={handleNodePointerDown}
            onNodeClick={handleNodeClick}
            onSelect={onSelect}
            onOpenDeepInspect={onOpenDeepInspect}
            onToggleRackSide={(rackId, nextSide) =>
              setRackSides(prev => ({ ...prev, [rackId]: nextSide }))
            }
            onStartDraggingRackDevice={setDraggingRackDevice}
            onRemoveDeviceFromRackSlot={onRemoveDeviceFromRackSlot}
            onStartResize={startNodeResize}
          />
        ))}

        {/* 6. LAYER: DEVICE / LEGEND / SHAPE NODES */}
        {culledDeviceNodes.map(node => {
          const isSelected = selectedNodeIdSet.has(node.id);
          const isSingleSelected = isSelected && selectedNodeIds.length === 1;
          const isConnectingFromThis = connectingSource?.nodeId === node.id;
          const isTargetCandidate =
            !isReadOnlyMode &&
            ((connectingSource && connectingSource.nodeId !== node.id) ||
              (reconnectingCable && hoveredNodeId === node.id));
          const asset = node.assetId ? project.assets[node.assetId] : undefined;

          const resolvedCustomIcon = node.customIcon || asset?.customIcon;
          const resolvedCustomImage = sanitizeSafeImageUrl(node.customImageUrl || asset?.customImageUrl);
          const isBrandLogo = Boolean(resolvedCustomIcon && resolvedCustomIcon.startsWith('logo_'));
          const shapeRx =
            node.style.shape === 'circle'
              ? Math.max(node.width, node.height) / 2
              : node.style.shape === 'rect'
              ? 2
              : 8;

          const minDim = Math.min(node.width, node.height);
          const isExpandedLayout = node.height >= 72 || (node.width <= 96 && node.height >= 56);
          const iconBoxPx = isExpandedLayout
            ? Math.min(58, Math.max(24, Math.round(minDim * 0.44)))
            : Math.min(40, Math.max(22, Math.round(node.height * 0.54)));
          const iconInnerPx = Math.max(14, Math.round(iconBoxPx * (resolvedCustomImage || isBrandLogo ? 0.88 : 0.62)));
          const showIpPill = Boolean(
            project.settings.showIpAddresses &&
            !hiddenLayerSet.has('labels') &&
            (asset?.ipAddress || asset?.vlan) &&
            node.height >= 46
          );

          const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
          const handleSize = 7.5 * invZ;
          const framePad = 5 * invZ;

          const getNodeResizeHandlePos = (dir: ResizeHandleDir) => {
            const left = -framePad;
            const right = node.width + framePad;
            const top = -framePad;
            const bottom = node.height + framePad;
            const cx = node.width / 2;
            const cy = node.height / 2;
            switch (dir) {
              case 'nw': return { x: left, y: top };
              case 'n': return { x: cx, y: top };
              case 'ne': return { x: right, y: top };
              case 'e': return { x: right, y: cy };
              case 'se': return { x: right, y: bottom };
              case 's': return { x: cx, y: bottom };
              case 'sw': return { x: left, y: bottom };
              case 'w': return { x: left, y: cy };
            }
          };

          const isOverlapping = overlapReport.overlappingNodeIds.has(node.id);

          if (node.type === 'legend') {
            return (
              <CanvasLegendNode
                key={node.id}
                node={node}
                project={project}
                isSelected={isSelected}
                isSingleSelected={isSingleSelected}
                isOverlapping={isOverlapping}
                isConnecting={Boolean(connectingSource)}
                isReadOnlyMode={isReadOnlyMode}
                framePad={framePad}
                handleSize={handleSize}
                invZ={invZ}
                getNodeResizeHandlePos={getNodeResizeHandlePos}
                onNodePointerDown={handleNodePointerDown}
                onNodeClick={handleNodeClick}
                onHoverChange={setHoveredNodeId}
                onResizeLegendToFit={onResizeLegendToFit}
                onStartResize={startNodeResize}
              />
            );
          }

          return (
            <g
              key={node.id}
              transform={`translate(${node.x}, ${node.y}) rotate(${node.rotation || 0}, ${node.width / 2}, ${node.height / 2})`}
              onPointerDown={(e) => handleNodePointerDown(e, node)}
              onClick={(e) => handleNodeClick(e, node)}
              onPointerEnter={() => setHoveredNodeId(node.id)}
              onPointerLeave={() => setHoveredNodeId(null)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (asset) onOpenDeepInspect(asset.id);
                else onOpenDeepInspect(node.id);
              }}
              className={`select-none group ${
                connectingSource && !isReadOnlyMode
                  ? 'cursor-pointer'
                  : isReadOnlyMode
                  ? 'cursor-pointer'
                  : node.locked
                  ? 'cursor-not-allowed'
                  : 'cursor-move'
              }`}
            >
              {isTargetCandidate && (
                <rect
                  x="-4"
                  y="-4"
                  width={node.width + 8}
                  height={node.height + 8}
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth="2.5"
                  strokeDasharray="4 4"
                  rx={shapeRx + 4}
                />
              )}

              {isOverlapping && (
                <g className="pointer-events-none">
                  <rect
                    x={-4.5}
                    y={-4.5}
                    width={node.width + 9}
                    height={node.height + 9}
                    fill="none"
                    stroke="#ef4444"
                    strokeWidth="2.4"
                    strokeDasharray="5 3"
                    rx={shapeRx + 4}
                  />
                  <rect x={0} y={-17} width="78" height="14" rx="3" fill="#dc2626" />
                  <text x="39" y="-7" textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="700">
                    ! Chồng lấn
                  </text>
                  <title>Cảnh báo: Thiết bị đang chồng lấn vị trí với đối tượng khác</title>
                </g>
              )}

              {isSelected && (
                <rect
                  x={isSingleSelected && !node.locked && !isReadOnlyMode ? -framePad : -3}
                  y={isSingleSelected && !node.locked && !isReadOnlyMode ? -framePad : -3}
                  width={node.width + (isSingleSelected && !node.locked && !isReadOnlyMode ? framePad * 2 : 6)}
                  height={node.height + (isSingleSelected && !node.locked && !isReadOnlyMode ? framePad * 2 : 6)}
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth={isSingleSelected ? 1.5 * invZ : 2}
                  strokeDasharray={isSingleSelected && !node.locked && !isReadOnlyMode ? `${3.5 * invZ} ${2.5 * invZ}` : undefined}
                  rx={node.style.shape === 'circle' ? shapeRx + 4 : shapeRx + 3}
                />
              )}

              {(() => {
                const isTextNode = node.type === 'text';
                const isZoneNode = node.type === 'zone';
                const isWallNode = node.type === 'wall';
                const isNeutralCatalogCard =
                  !isTextNode &&
                  !isZoneNode &&
                  !isWallNode &&
                  isStandardCatalogNodeColor(node.style.backgroundColor);

                const cardFill = isTextNode
                  ? canvasAppearance.isDarkCanvas
                    ? '#1e293b'
                    : '#ffffff'
                  : isNeutralCatalogCard
                  ? canvasAppearance.isDarkCanvas
                    ? '#1e293b'
                    : '#ffffff'
                  : node.style.backgroundColor || '#155eef';

                const cardStroke = isOverlapping
                  ? '#dc2626'
                  : isSelected || isConnectingFromThis
                  ? '#155eef'
                  : isNeutralCatalogCard
                  ? canvasAppearance.isDarkCanvas
                    ? '#334155'
                    : '#cbd5e1'
                  : node.style.borderColor || '#334155';

                const iconAccent = getCategoryAccentColor(asset?.category || node.type);

                if (isTextNode) {
                  return (
                    <>
                      <rect
                        width={node.width}
                        height={node.height}
                        fill={cardFill}
                        fillOpacity={0.94}
                        stroke={isOverlapping ? '#dc2626' : isSelected ? '#155eef' : canvasAppearance.isDarkCanvas ? '#475569' : '#cbd5e1'}
                        strokeWidth={isSelected ? 1.8 : 1}
                        strokeDasharray={isSelected ? undefined : '4 3'}
                        rx={shapeRx}
                      />
                      <foreignObject x="0" y="0" width={node.width} height={node.height} className="pointer-events-none">
                        <div
                          style={{ fontSize: node.style.fontSize || 12 }}
                          className={`w-full h-full px-2.5 py-1.5 flex items-center font-medium leading-snug break-words ${
                            canvasAppearance.isDarkCanvas ? 'text-slate-100' : 'text-slate-800'
                          }`}
                        >
                          {node.label}
                        </div>
                      </foreignObject>
                    </>
                  );
                }

                if (isZoneNode) {
                  return (
                    <>
                      <rect
                        width={node.width}
                        height={node.height}
                        fill={node.style.backgroundColor || '#EFF6FF'}
                        fillOpacity={0.42}
                        stroke={isOverlapping ? '#dc2626' : isSelected ? '#155eef' : node.style.borderColor || '#155EEF'}
                        strokeWidth={isSelected ? 2 : 1.5}
                        strokeDasharray="6 4"
                        rx={shapeRx}
                      />
                      <foreignObject x="0" y="0" width={node.width} height={28} className="pointer-events-none">
                        <div className="px-2.5 py-1 text-[11px] font-bold tracking-tight text-blue-900 dark:text-blue-200 truncate">
                          {node.label}
                        </div>
                      </foreignObject>
                    </>
                  );
                }

                return (
                  <>
                    <rect
                      width={node.width}
                      height={node.height}
                      fill={cardFill}
                      stroke={cardStroke}
                      strokeWidth={isOverlapping ? 2.4 : isSelected ? 2 : 1.25}
                      rx={shapeRx}
                      filter={
                        isOverlapping
                          ? 'drop-shadow(0 0 8px rgba(220,38,38,0.45))'
                          : isSelected
                          ? 'drop-shadow(0 0 8px rgba(21,94,239,0.35))'
                          : 'drop-shadow(0 1px 3px rgba(15,23,42,0.08))'
                      }
                    />

                    <circle
                      cx={node.width - (node.style.shape === 'circle' ? Math.max(12, node.width * 0.16) : 9)}
                      cy={node.style.shape === 'circle' ? Math.max(10, node.height * 0.16) : 9}
                      r="3"
                      fill={asset?.status === 'online' ? '#16a34a' : asset?.status === 'standby' ? '#f59e0b' : '#dc2626'}
                    />
                    {node.locked && (
                      <g transform={`translate(${node.width - 21}, 3)`} className="pointer-events-none">
                        <rect width="10" height="10" rx="2" fill="#0f172a" fillOpacity="0.7" />
                        <Lock x="2" y="2" width="6" height="6" color="#fbbf24" />
                      </g>
                    )}

                    <foreignObject x="0" y="0" width={node.width} height={node.height} className="pointer-events-none">
                      <div
                        className={`w-full h-full flex ${
                          isNeutralCatalogCard
                            ? canvasAppearance.isDarkCanvas
                              ? 'text-slate-100'
                              : 'text-slate-900'
                            : 'text-white'
                        } ${
                          isExpandedLayout
                            ? 'flex-col items-center justify-center gap-1 p-1.5 text-center'
                            : 'flex-col justify-between p-1.5'
                        }`}
                      >
                        <div
                          className={`flex items-center overflow-hidden ${
                            isExpandedLayout ? 'flex-col justify-center gap-1 w-full' : 'gap-1.5'
                          }`}
                        >
                          <div
                            onPointerDown={isSingleSelected && !connectingSource && !isReadOnlyMode ? (e) => e.stopPropagation() : undefined}
                            onClick={
                              isSingleSelected && !connectingSource && !isReadOnlyMode
                                ? (e) => {
                                    e.stopPropagation();
                                    setNodeIconUploadError(null);
                                    setIconPickerNodeId(prev => (prev === node.id ? null : node.id));
                                  }
                                : undefined
                            }
                            style={{
                              width: iconBoxPx,
                              height: iconBoxPx,
                              backgroundColor: isNeutralCatalogCard ? iconAccent : 'rgba(0,0,0,0.24)'
                            }}
                            className={`rounded-md flex items-center justify-center text-white shrink-0 overflow-hidden transition-transform ${
                              isSingleSelected && !connectingSource && !isReadOnlyMode
                                ? 'pointer-events-auto cursor-pointer ring-1 ring-blue-400/70 hover:ring-2 hover:ring-blue-500 hover:scale-105'
                                : ''
                            }`}
                            title={isSingleSelected && !isReadOnlyMode ? 'Nhấn để đổi Icon / Logo' : undefined}
                          >
                            <span
                              style={{ width: iconInnerPx, height: iconInnerPx }}
                              className="flex items-center justify-center"
                            >
                              {renderDeviceVisualIcon({
                                customIcon: resolvedCustomIcon,
                                customImageUrl: resolvedCustomImage,
                                category: asset?.category || node.type,
                                className: 'w-full h-full'
                              })}
                            </span>
                          </div>
                          <div
                            className={`truncate font-semibold leading-tight ${
                              isExpandedLayout
                                ? 'w-full px-1 text-center text-[11px]'
                                : 'text-[11px] pr-3'
                            }`}
                          >
                            {asset?.name || node.label}
                          </div>
                        </div>

                        {showIpPill && (
                          <div
                            className={`flex items-center justify-between gap-1 font-mono text-[8.5px] px-1.5 py-0.5 rounded truncate tabular-nums ${
                              isNeutralCatalogCard
                                ? canvasAppearance.isDarkCanvas
                                  ? 'bg-slate-800 text-slate-300'
                                  : 'bg-slate-100 text-slate-600'
                                : 'bg-black/25 text-white/95'
                            } ${isExpandedLayout ? 'max-w-[90%]' : ''}`}
                          >
                            <span className="truncate">{asset?.ipAddress || ''}</span>
                            {asset?.vlan && (
                              <span
                                className={`text-[7.5px] shrink-0 ${
                                  isNeutralCatalogCard ? 'text-blue-600 dark:text-blue-400' : 'text-sky-200'
                                }`}
                              >
                                V{asset.vlan.split(',')[0]}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </foreignObject>
                  </>
                );
              })()}

              {!isReadOnlyMode && ['top', 'bottom', 'left', 'right'].map(pos => {
                let px = node.width / 2;
                let py = 0;
                if (pos === 'bottom') py = node.height;
                if (pos === 'left') { px = 0; py = node.height / 2; }
                if (pos === 'right') { px = node.width; py = node.height / 2; }

                return (
                  <circle
                    key={pos}
                    cx={px}
                    cy={py}
                    r={hoveredNodeId === node.id || connectingSource ? 4.5 : 3.2}
                    fill="#155eef"
                    stroke="#ffffff"
                    strokeWidth="1.5"
                    className={`transition-all ${
                      hoveredNodeId === node.id || connectingSource
                        ? 'opacity-100 hover:scale-125 cursor-crosshair'
                        : 'opacity-0 group-hover:opacity-100'
                    }`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (connectingSource) {
                        if (connectingSource.nodeId !== node.id) {
                          initiateConnectionOrOpenPortPicker(connectingSource.nodeId, node.id, e.clientX, e.clientY);
                        } else {
                          onSetConnectingSource(null);
                        }
                      } else {
                        onSetConnectingSource({ nodeId: node.id });
                      }
                    }}
                  />
                );
              })}

              {isSingleSelected && !node.locked && !connectingSource && !isReadOnlyMode && (
                <g>
                  {RESIZE_HANDLE_DIRS.map(({ dir, cursorClass }) => {
                    const pos = getNodeResizeHandlePos(dir);
                    return (
                      <rect
                        key={`nd_h_${dir}`}
                        x={pos.x - handleSize / 2}
                        y={pos.y - handleSize / 2}
                        width={handleSize}
                        height={handleSize}
                        rx={1.5 * invZ}
                        fill="#ffffff"
                        stroke="#2563eb"
                        strokeWidth={1.5 * invZ}
                        className={cursorClass}
                        onPointerDown={(e) => {
                          if (node.locked) return;
                          startNodeResize(
                            e,
                            node.id,
                            dir,
                            { x: node.x, y: node.y, width: node.width, height: node.height },
                            node.rotation || 0,
                            44,
                            36
                          );
                        }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <title>Kéo để thay đổi kích thước (giữ Shift để giữ tỷ lệ)</title>
                      </rect>
                    );
                  })}
                </g>
              )}
            </g>
          );
        })}

        {overlapReport.pairs.map((pair, idx) => (
          <rect
            key={`ovl_${pair.aId}_${pair.bId}_${idx}`}
            x={pair.overlapRect.x}
            y={pair.overlapRect.y}
            width={pair.overlapRect.width}
            height={pair.overlapRect.height}
            fill="#ef4444"
            fillOpacity="0.16"
            stroke="#dc2626"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            className="pointer-events-none"
          />
        ))}

        {marqueeStart && (
          <rect
            x={Math.min(marqueeStart.x, currentMouseCanvas.x)}
            y={Math.min(marqueeStart.y, currentMouseCanvas.y)}
            width={Math.abs(currentMouseCanvas.x - marqueeStart.x)}
            height={Math.abs(currentMouseCanvas.y - marqueeStart.y)}
            fill="#3b82f6"
            fillOpacity="0.12"
            stroke="#2563eb"
            strokeWidth="1.5"
            strokeDasharray="4 3"
            className="pointer-events-none"
          />
        )}

        {draggingRackDevice && draggingRackDevice.hasMoved && !isReadOnlyMode && (
          <g transform={`translate(${draggingRackDevice.currentX - 110}, ${draggingRackDevice.currentY - 12})`} className="pointer-events-none">
            <rect
              width="220"
              height={Math.max(22, draggingRackDevice.uHeight * 14)}
              rx="4"
              fill="#0f172a"
              fillOpacity="0.92"
              stroke={draggingRackDevice.color}
              strokeWidth="2"
              filter="drop-shadow(0 6px 12px rgba(0,0,0,0.4))"
            />
            <text x="12" y="15" fill="#ffffff" fontSize="10" fontWeight="bold">
              {draggingRackDevice.label} ({draggingRackDevice.uHeight}U)
            </text>
          </g>
        )}

        {canvasDropGhost && !isReadOnlyMode && (
          <rect
            x={canvasDropGhost.x}
            y={canvasDropGhost.y}
            width={canvasDropGhost.width}
            height={canvasDropGhost.height}
            rx="8"
            fill="#155EEF"
            fillOpacity="0.14"
            stroke="#155EEF"
            strokeWidth="2"
            strokeDasharray="6 4"
            className="pointer-events-none"
          />
        )}

        {alignmentGuides.map((g, idx) => {
          const isCenter = g.kind === 'center';
          const guideColor = g.sourceKind === 'guide' ? '#06b6d4' : isCenter ? '#0ea5e9' : '#f43f5e';
          const invZ = 1 / Math.max(0.35, zoom);
          const strokeW = 1.4 * invZ;
          const dashArr = `${5 * invZ} ${3.5 * invZ}`;
          const tick = 4.5 * invZ;
          const labelText = `${g.alignLabel} · ${Math.round(g.pos)}`;
          const badgeW = (labelText.length * 5.6 + 12) * invZ;
          const badgeH = 16 * invZ;

          if (g.orientation === 'vertical') {
            const labelY = g.from + 14 * invZ;
            return (
              <g key={`align_v_${idx}`} className="pointer-events-none">
                <line x1={g.pos} y1={g.from} x2={g.pos} y2={g.to} stroke={guideColor} strokeWidth={strokeW} strokeDasharray={dashArr} />
                <line x1={g.pos - tick} y1={g.from} x2={g.pos + tick} y2={g.from} stroke={guideColor} strokeWidth={strokeW} />
                <line x1={g.pos - tick} y1={g.to} x2={g.pos + tick} y2={g.to} stroke={guideColor} strokeWidth={strokeW} />
                <g transform={`translate(${g.pos + 6 * invZ}, ${labelY})`}>
                  <rect x={0} y={-badgeH / 2} width={badgeW} height={badgeH} rx={4 * invZ} fill={guideColor} />
                  <text x={badgeW / 2} y={3.2 * invZ} textAnchor="middle" fill="#ffffff" fontSize={9 * invZ} fontWeight="700" fontFamily="ui-monospace, monospace">
                    {labelText}
                  </text>
                </g>
              </g>
            );
          }

          const labelX = g.from + 12 * invZ + badgeW / 2;
          return (
            <g key={`align_h_${idx}`} className="pointer-events-none">
              <line x1={g.from} y1={g.pos} x2={g.to} y2={g.pos} stroke={guideColor} strokeWidth={strokeW} strokeDasharray={dashArr} />
              <line x1={g.from} y1={g.pos - tick} x2={g.from} y2={g.pos + tick} stroke={guideColor} strokeWidth={strokeW} />
              <line x1={g.to} y1={g.pos - tick} x2={g.to} y2={g.pos + tick} stroke={guideColor} strokeWidth={strokeW} />
              <g transform={`translate(${labelX}, ${g.pos - 11 * invZ})`}>
                <rect x={-badgeW / 2} y={-badgeH / 2} width={badgeW} height={badgeH} rx={4 * invZ} fill={guideColor} />
                <text x={0} y={3.2 * invZ} textAnchor="middle" fill="#ffffff" fontSize={9 * invZ} fontWeight="700" fontFamily="ui-monospace, monospace">
                  {labelText}
                </text>
              </g>
            </g>
          );
        })}

        {gridSnapHighlight && !isReadOnlyMode && (() => {
          const invZ = 1 / Math.max(0.35, zoom);
          const arm = Math.max(18, gridSnapHighlight.gridSize * 1.15);
          const gx = gridSnapHighlight.x;
          const gy = gridSnapHighlight.y;
          const badgeText = `${Math.round(gx)}, ${Math.round(gy)}`;
          const badgeW = (badgeText.length * 6 + 14) * invZ;
          const badgeH = 16 * invZ;
          return (
            <g data-testid="grid-intersection-snap-highlight" className="pointer-events-none">
              <line
                x1={gx - arm}
                y1={gy}
                x2={gx + arm}
                y2={gy}
                stroke="#10b981"
                strokeWidth={1.5 * invZ}
                strokeDasharray={`${3.5 * invZ} ${2.5 * invZ}`}
                strokeOpacity="0.9"
              />
              <line
                x1={gx}
                y1={gy - arm}
                x2={gx}
                y2={gy + arm}
                stroke="#10b981"
                strokeWidth={1.5 * invZ}
                strokeDasharray={`${3.5 * invZ} ${2.5 * invZ}`}
                strokeOpacity="0.9"
              />
              <circle
                cx={gx}
                cy={gy}
                r={9.5 * invZ}
                fill="#10b981"
                fillOpacity="0.16"
                stroke="#10b981"
                strokeWidth={1.5 * invZ}
              />
              <circle
                cx={gx}
                cy={gy}
                r={3.2 * invZ}
                fill="#10b981"
                stroke="#ffffff"
                strokeWidth={1.2 * invZ}
              />
              <g transform={`translate(${gx + 10 * invZ + badgeW / 2}, ${gy - 13 * invZ})`}>
                <rect
                  x={-badgeW / 2}
                  y={-badgeH / 2}
                  width={badgeW}
                  height={badgeH}
                  rx={4 * invZ}
                  fill="#065f46"
                  stroke="#34d399"
                  strokeWidth={1 * invZ}
                />
                <text
                  x={0}
                  y={3.2 * invZ}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={9 * invZ}
                  fontWeight="700"
                  fontFamily="ui-monospace, monospace"
                >
                  {badgeText}
                </text>
              </g>
            </g>
          );
        })()}

        {/* Interactive Wi-Fi Coverage Perimeter Resize Rings & Handles */}
        {project.settings.showCoverageRadius &&
          !hiddenLayerSet.has('wifi') &&
          !isReadOnlyMode &&
          !lockedLayerSet.has('wifi') &&
          !connectingSource &&
          culledDeviceNodes.map(node => {
            const asset = node.assetId ? project.assets[node.assetId] : undefined;
            const baseRadiusMeters =
              asset?.wifiSpecs?.coverageRadiusMeters ??
              (typeof node.customData?.coverageRadiusMeters === 'number'
                ? node.customData.coverageRadiusMeters
                : undefined);
            if (typeof baseRadiusMeters !== 'number' || baseRadiusMeters <= 0) return null;
            if (isNodeEffectivelyLocked(node, project.settings, project.assets, isReadOnlyMode)) return null;

            const isResizingThis = wifiResizeSession?.nodeId === node.id;
            const showHandles =
              isResizingThis || selectedNodeIdSet.has(node.id) || hoveredNodeId === node.id;
            const activeMeters = isResizingThis ? wifiResizeSession.currentMeters : baseRadiusMeters;
            const radiusPx = activeMeters * Math.max(5, project.settings.scale || 30);
            const cx = node.x + node.width / 2;
            const cy = node.y + node.height / 2;
            const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
            const handleR = 5.5 * invZ;

            const beginWifiResize = (e: React.PointerEvent) => {
              e.stopPropagation();
              onSelect('node', node.id);
              onBeginDragSnapshot?.();
              activePointerIdRef.current = e.pointerId;
              setWifiResizeSession({
                nodeId: node.id,
                centerX: cx,
                centerY: cy,
                currentMeters: activeMeters
              });
            };

            const cardinalOffsets = [
              { id: 'e', dx: radiusPx, dy: 0, cursor: 'cursor-ew-resize' },
              { id: 'w', dx: -radiusPx, dy: 0, cursor: 'cursor-ew-resize' },
              { id: 'n', dx: 0, dy: -radiusPx, cursor: 'cursor-ns-resize' },
              { id: 's', dx: 0, dy: radiusPx, cursor: 'cursor-ns-resize' }
            ] as const;

            return (
              <g key={`wifi_resize_${node.id}`}>
                {/* Transparent hit circumference so user can drag any part of the Wi-Fi ring edge */}
                <circle
                  cx={cx}
                  cy={cy}
                  r={radiusPx}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={Math.max(10, 14 * invZ)}
                  className="cursor-ew-resize"
                  onPointerDown={beginWifiResize}
                  onClick={(e) => e.stopPropagation()}
                >
                  <title>Kéo viền vòng phủ sóng Wi-Fi để co giãn bán kính</title>
                </circle>

                {showHandles && (
                  <>
                    {cardinalOffsets.map(pt => (
                      <circle
                        key={`wifi_h_${node.id}_${pt.id}`}
                        data-testid={pt.id === 'e' ? `wifi-resize-handle-${node.id}` : undefined}
                        cx={cx + pt.dx}
                        cy={cy + pt.dy}
                        r={handleR}
                        fill="#ffffff"
                        stroke="#059669"
                        strokeWidth={2 * invZ}
                        className={pt.cursor}
                        onPointerDown={beginWifiResize}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <title>Kéo để điều chỉnh bán kính phủ sóng Wi-Fi ({activeMeters} m)</title>
                      </circle>
                    ))}
                  </>
                )}

                {isResizingThis && (() => {
                  const areaSqm = Math.round(Math.PI * activeMeters * activeMeters);
                  const badgeText = `Wi-Fi R = ${activeMeters} m · ~${areaSqm} m²`;
                  const badgeW = (badgeText.length * 6.4 + 18) * invZ;
                  const badgeH = 22 * invZ;
                  return (
                    <g className="pointer-events-none">
                      <line
                        x1={cx}
                        y1={cy}
                        x2={cx + radiusPx}
                        y2={cy}
                        stroke="#059669"
                        strokeWidth={1.6 * invZ}
                        strokeDasharray={`${4 * invZ} ${3 * invZ}`}
                      />
                      <g transform={`translate(${cx + radiusPx / 2}, ${cy - 18 * invZ})`}>
                        <rect
                          x={-badgeW / 2}
                          y={-badgeH / 2}
                          width={badgeW}
                          height={badgeH}
                          rx={5 * invZ}
                          fill="#064e3b"
                          stroke="#34d399"
                          strokeWidth={1.2 * invZ}
                        />
                        <text
                          x={0}
                          y={4 * invZ}
                          textAnchor="middle"
                          fill="#ffffff"
                          fontSize={10 * invZ}
                          fontWeight="700"
                          fontFamily="ui-monospace, monospace"
                        >
                          {badgeText}
                        </text>
                      </g>
                    </g>
                  );
                })()}
              </g>
            );
          })}

        {resizingSession && (() => {
          const r = resizingSession.currentRect;
          const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
          const scale = project.settings.scale || 30;
          const dimText =
            resizingSession.targetKind === 'room'
              ? `${(r.width / scale).toFixed(1)}m × ${(r.height / scale).toFixed(1)}m (${r.width}×${r.height}px)`
              : `${r.width} × ${r.height} px`;
          const badgeW = (dimText.length * 6.2 + 16) * invZ;
          const badgeH = 20 * invZ;
          const cx = r.x + r.width / 2;
          const by = r.y + r.height + 16 * invZ;
          return (
            <g transform={`translate(${cx}, ${by})`} className="pointer-events-none">
              <rect x={-badgeW / 2} y={-badgeH / 2} width={badgeW} height={badgeH} rx={5 * invZ} fill="#0f172a" stroke="#38bdf8" strokeWidth={1.2 * invZ} />
              <text x={0} y={3.5 * invZ} textAnchor="middle" fill="#ffffff" fontSize={10 * invZ} fontWeight="700" fontFamily="ui-monospace, monospace">
                {dimText}
              </text>
            </g>
          );
        })()}
        {measureSession && (() => {
          const { start, current } = measureSession;
          const dx = current.x - start.x;
          const dy = current.y - start.y;
          const distPx = Math.hypot(dx, dy);
          if (distPx < 2) return null;
          const invZ = 1 / Math.max(0.4, Math.min(zoom, 1.8));
          const scale = Math.max(5, project.settings.scale || 30);
          const distMeters = (distPx / scale).toFixed(2);
          const midX = (start.x + current.x) / 2;
          const midY = (start.y + current.y) / 2;
          const nx = -dy / distPx;
          const ny = dx / distPx;
          const tickLen = 7 * invZ;
          const label = `${distMeters} m · ${Math.round(distPx)} px`;
          const badgeW = (label.length * 6.8 + 16) * invZ;
          const badgeH = 22 * invZ;
          return (
            <g className="pointer-events-none">
              <line
                x1={start.x}
                y1={start.y}
                x2={current.x}
                y2={current.y}
                stroke="#155EEF"
                strokeWidth={2 * invZ}
                strokeDasharray={`${6 * invZ} ${4 * invZ}`}
              />
              <line
                x1={start.x - nx * tickLen}
                y1={start.y - ny * tickLen}
                x2={start.x + nx * tickLen}
                y2={start.y + ny * tickLen}
                stroke="#155EEF"
                strokeWidth={2 * invZ}
              />
              <line
                x1={current.x - nx * tickLen}
                y1={current.y - ny * tickLen}
                x2={current.x + nx * tickLen}
                y2={current.y + ny * tickLen}
                stroke="#155EEF"
                strokeWidth={2 * invZ}
              />
              <circle cx={start.x} cy={start.y} r={3.5 * invZ} fill="#155EEF" />
              <circle cx={current.x} cy={current.y} r={3.5 * invZ} fill="#155EEF" />
              <g transform={`translate(${midX}, ${midY - 16 * invZ})`}>
                <rect
                  x={-badgeW / 2}
                  y={-badgeH / 2}
                  width={badgeW}
                  height={badgeH}
                  rx={5 * invZ}
                  fill="#0f172a"
                  stroke="#3b82f6"
                  strokeWidth={1.2 * invZ}
                />
                <text
                  x={0}
                  y={4 * invZ}
                  textAnchor="middle"
                  fill="#ffffff"
                  fontSize={11 * invZ}
                  fontWeight="700"
                  fontFamily="ui-monospace, monospace"
                >
                  {label}
                </text>
              </g>
            </g>
          );
        })()}
      </svg>

      {canvasContextMenu && !isReadOnlyMode && (
        <div
          role="menu"
          aria-label="Thao tác nhanh tại con trỏ"
          onPointerDown={e => e.stopPropagation()}
          style={{ left: canvasContextMenu.screenX, top: canvasContextMenu.screenY }}
          className="absolute z-40 w-[224px] rounded-xl bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200 dark:border-slate-700 shadow-2xl p-1.5 text-xs text-slate-800 dark:text-slate-100 no-print"
        >
          <div className="px-2 py-1 text-[10px] font-mono text-slate-400 border-b border-slate-100 dark:border-slate-800 mb-1 flex items-center justify-between">
            <span>Vị trí con trỏ</span>
            <span>
              {Math.round(canvasContextMenu.canvasX)}, {Math.round(canvasContextMenu.canvasY)}
            </span>
          </div>
          {onAddRackAtCursor && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const { canvasX, canvasY } = canvasContextMenu;
                setCanvasContextMenu(null);
                onAddRackAtCursor(canvasX, canvasY);
              }}
              className="w-full px-2.5 py-2 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-950/60 text-left font-semibold text-slate-800 dark:text-slate-100 flex items-center justify-between gap-2 transition-colors"
            >
              <span className="flex items-center gap-2 min-w-0">
                <Box className="w-3.5 h-3.5 text-[#155EEF] shrink-0" />
                <span className="truncate">Thêm tủ Rack 42U tại đây</span>
              </span>
              <span className="text-[10px] font-mono text-slate-400 shrink-0">Shift+R</span>
            </button>
          )}
          {onAddTextNode && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const { canvasX, canvasY } = canvasContextMenu;
                setCanvasContextMenu(null);
                onAddTextNode(canvasX, canvasY);
              }}
              className="w-full px-2.5 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-left font-medium text-slate-700 dark:text-slate-200 flex items-center gap-2 transition-colors"
            >
              <Type className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <span>Thêm ghi chú chữ tại đây</span>
            </button>
          )}
        </div>
      )}

      {/* Extracted HTML Overlays */}
      <CanvasSelectionOverlays
        project={project}
        selection={selection}
        selectedNodeIds={selectedNodeIds}
        nodeMap={nodeMap}
        zoom={zoom}
        pan={pan}
        viewportSize={viewportSize}
        isDraggingOrResizing={Boolean(draggingNodeIds || resizingSession)}
        isConnecting={Boolean(connectingSource)}
        isReadOnlyMode={isReadOnlyMode}
        iconPickerNodeId={iconPickerNodeId}
        iconPickerTab={iconPickerTab}
        nodeIconUploadError={nodeIconUploadError}
        confirmToolbarDelete={confirmToolbarDelete}
        pendingConnection={pendingConnection}
        editingCableLabel={editingCableLabel}
        getCableGeometry={getCableGeometry}
        onSetIconPickerNodeId={setIconPickerNodeId}
        onSetIconPickerTab={setIconPickerTab}
        onSetNodeIconUploadError={setNodeIconUploadError}
        onSetConfirmToolbarDelete={setConfirmToolbarDelete}
        onSetPendingConnection={setPendingConnection}
        onSetEditingCableLabel={setEditingCableLabel}
        onCommitInlineCableLabel={commitInlineCableLabel}
        onOpenInlineCableLabelEditor={openInlineCableLabelEditor}
        onResizeLegendToFit={onResizeLegendToFit}
        onToggleNodeLock={onToggleNodeLock}
        onToggleNodeVisibility={onToggleNodeVisibility}
        onDuplicateNodes={onDuplicateNodes}
        onUpdateNode={onUpdateNode}
        onSetNodeIconOrLogo={onSetNodeIconOrLogo}
        onSetConnectingSource={onSetConnectingSource}
        onSetCableColor={onSetCableColor}
        onUpdateCable={onUpdateCable}
        onAutoRouteCable={onAutoRouteCable}
        onAddCable={onAddCable}
        onDeleteSelected={onDeleteSelected}
      />

      {/* Edge Rulers & Draggable Reference Guide Lines */}
      <CanvasGuideOverlay
        containerRef={containerRef}
        viewportSize={viewportSize}
        zoom={zoom}
        pan={pan}
        scale={project.settings.scale || 30}
        unit={project.settings.unit || 'm'}
        isDarkSurface={canvasAppearance.isDarkCanvas}
        showRulers={project.settings.showRulers !== false}
        isReadOnlyMode={isReadOnlyMode}
        activeFloorId={project.activeFloorId}
        guideLines={project.settings.guideLines || []}
        onChangeGuideLines={nextGuideLines => onUpdateSettings?.({ guideLines: nextGuideLines })}
      />

      {/* Extracted HUD Controls */}
      <CanvasHudControls
        containerRef={containerRef}
        project={project}
        selection={selection}
        visibleNodes={visibleNodes}
        visibleRooms={visibleRooms}
        nodeMap={nodeMap}
        selectedNodeIdSet={selectedNodeIdSet}
        overlappingNodeIds={overlapReport.overlappingNodeIds}
        canvasAppearance={canvasAppearance}
        showBgMenu={showBgMenu}
        bgUploadError={bgUploadError}
        bgFileInputRef={bgFileInputRef}
        connectingSource={connectingSource}
        connectingSourceNode={connectingSourceNode}
        reconnectingCableEndpoint={reconnectingCable?.endpoint || null}
        activeBundleInfo={activeBundleInfo}
        collapsedBundleIds={collapsedBundleIds}
        touchContextMenu={touchContextMenu}
        showMinimap={showMinimap}
        minimapBounds={minimapBounds}
        viewportSize={viewportSize}
        zoom={zoom}
        pan={pan}
        isReadOnlyMode={isReadOnlyMode}
        onSetShowBgMenu={setShowBgMenu}
        onSetBgUploadError={setBgUploadError}
        onSetActiveBundleId={setActiveBundleId}
        onSetCollapsedBundleIds={setCollapsedBundleIds}
        onSetHoveredCableId={setHoveredCableId}
        onSetTouchContextMenu={setTouchContextMenu}
        onSetIconPickerNodeId={setIconPickerNodeId}
        onUpdateSettings={onUpdateSettings}
        onSelect={onSelect}
        onSelectMultipleNodes={onSelectMultipleNodes}
        onSetConnectingSource={onSetConnectingSource}
        onOpenTemplates={onOpenTemplates}
        onAddQuickDevice={onAddQuickDevice}
        onOpenCommandPalette={onOpenCommandPalette}
        onOpenBuildingGenerator={onOpenBuildingGenerator}
        onSetActiveFloor={onSetActiveFloor}
        onCloneFloor={onCloneFloor}
        onDuplicateNodes={onDuplicateNodes}
        onToggleNodeLock={onToggleNodeLock}
        onOpenDeepInspect={onOpenDeepInspect}
        onDeleteSelected={onDeleteSelected}
        onAutoRouteCable={onAutoRouteCable}
        onUpdateCable={onUpdateCable}
        getCableGeometry={getCableGeometry}
        onOpenInlineCableLabelEditor={openInlineCableLabelEditor}
        onPanChange={onPanChange}
      />
    </div>
  );
};
