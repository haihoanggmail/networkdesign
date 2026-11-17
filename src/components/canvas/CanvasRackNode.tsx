import React from 'react';
import {
  DiagramNode,
  ProjectState,
  RackSide,
  SelectionState,
  ServerRack
} from '../../types/infrastructure';
import { CanvasTool } from '../../store/useProjectStore';
import {
  CANVAS_RACK_FOOTER_H,
  CANVAS_RACK_HEADER_H,
  CANVAS_RACK_RAIL_W,
  getAssetUHeight,
  getRackCanvasMetrics,
  getRackStatistics,
  getRackSlotsForSide,
  getSlotSpanRect
} from '../../utils/rackGeometry';
import {
  DraggingRackDeviceState,
  RESIZE_HANDLE_DIRS,
  RackDropHit,
  ResizeHandleDir,
  StartNodeResizeFn
} from './canvasTypes';

interface CanvasRackNodeProps {
  rackNode: DiagramNode;
  project: ProjectState;
  selection: SelectionState;
  activeTool: CanvasTool;
  zoom: number;
  rackSides: Record<string, RackSide>;
  connectingSource: { nodeId: string; portId?: string } | null;
  draggingRackDevice: DraggingRackDeviceState | null;
  rackDropPreview: RackDropHit | null;
  selectedNodeIdSet: Set<string>;
  isOverlapping: boolean;
  isReadOnlyMode: boolean;
  resolveRackForNode: (rackNode: DiagramNode) => ServerRack | undefined;
  getDeviceColor: (cat?: string) => string;
  clientToCanvasCoord: (clientX: number, clientY: number) => { x: number; y: number };
  onNodePointerDown: (e: React.PointerEvent, node: DiagramNode) => void;
  onNodeClick: (e: React.MouseEvent | React.PointerEvent, node: DiagramNode) => void;
  onSelect: (type: SelectionState['type'], id?: string, additionalIds?: string[]) => void;
  onOpenDeepInspect: (id: string) => void;
  onToggleRackSide: (rackId: string, nextSide: RackSide) => void;
  onStartDraggingRackDevice: (state: DraggingRackDeviceState) => void;
  onRemoveDeviceFromRackSlot?: (rackId: string, assetIdOrU: string | number, side?: RackSide) => void;
  onStartResize: StartNodeResizeFn;
}

export const CanvasRackNode: React.FC<CanvasRackNodeProps> = React.memo(({
  rackNode,
  project,
  selection,
  activeTool,
  zoom,
  rackSides,
  connectingSource,
  draggingRackDevice,
  rackDropPreview,
  selectedNodeIdSet,
  isOverlapping,
  isReadOnlyMode,
  resolveRackForNode,
  getDeviceColor,
  clientToCanvasCoord,
  onNodePointerDown,
  onNodeClick,
  onSelect,
  onOpenDeepInspect,
  onToggleRackSide,
  onStartDraggingRackDevice,
  onRemoveDeviceFromRackSlot,
  onStartResize
}) => {
  const asset = rackNode.assetId ? project.assets[rackNode.assetId] : undefined;
  const rack = resolveRackForNode(rackNode);
  const targetRackId = rack?.id || rackNode.customData?.rackId || asset?.id || rackNode.id;
  const totalUnits = rack?.totalUnits || rackNode.customData?.totalUnits || 42;
  const metrics = getRackCanvasMetrics(rackNode, totalUnits);
  const activeSide: RackSide = rack ? (rackSides[rack.id] || 'front') : 'front';
  const isSelected =
    (selection.type === 'rack' && selection.id === targetRackId) ||
    (selection.type === 'node' && selection.id === rackNode.id);

  const slotMap = rack ? getRackSlotsForSide(rack, activeSide) : {};
  const mountedEntries = Object.entries(slotMap)
    .map(([uStr, devId]) => ({
      startU: parseInt(uStr, 10),
      devId,
      dev: project.assets[devId],
      uHeight: getAssetUHeight(project.assets[devId])
    }))
    .filter(e => !Number.isNaN(e.startU) && Boolean(e.dev));

  const stats = rack ? getRackStatistics(rack, project.assets) : null;
  const hasRackWarning = Boolean(stats && (stats.overflowItems.length > 0 || stats.isOverweight));
  const usedUnitsDisplay = activeSide === 'rear' ? (stats?.rearUsedUnits || 0) : (stats?.frontUsedUnits || 0);
  const freeUnitsDisplay = Math.max(0, totalUnits - usedUnitsDisplay);

  const showEverySlotLabel = metrics.slotH >= 11;
  const labelStep = showEverySlotLabel ? 1 : metrics.slotH >= 7 ? 2 : 5;
  const activePreview = rackDropPreview && rackDropPreview.rackId === targetRackId ? rackDropPreview : null;

  return (
    <g
      onPointerDown={(e) => onNodePointerDown(e, rackNode)}
      onClick={(e) => {
        e.stopPropagation();
        onSelect('rack', targetRackId);
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onOpenDeepInspect(targetRackId);
      }}
      className="select-none"
    >
      {/* Overlap Red Warning Halo */}
      {isOverlapping && (
        <g className="pointer-events-none">
          <rect
            x={rackNode.x - 5}
            y={rackNode.y - 5}
            width={rackNode.width + 10}
            height={rackNode.height + 10}
            rx="8"
            fill="none"
            stroke="#ef4444"
            strokeWidth="2.5"
            strokeDasharray="6 3"
          />
          <rect x={rackNode.x} y={rackNode.y - 18} width="82" height="15" rx="3" fill="#dc2626" />
          <text
            x={rackNode.x + 41}
            y={rackNode.y - 7.5}
            textAnchor="middle"
            fill="#ffffff"
            fontSize="8.5"
            fontWeight="700"
          >
            ! Trùng vị trí
          </text>
        </g>
      )}

      {/* Rack Steel Enclosure Frame */}
      <rect
        x={rackNode.x}
        y={rackNode.y}
        width={rackNode.width}
        height={rackNode.height}
        fill="#0b1120"
        stroke={hasRackWarning || isOverlapping ? '#ef4444' : isSelected ? '#3b82f6' : activePreview ? '#60a5fa' : '#334155'}
        strokeWidth={isSelected || hasRackWarning || isOverlapping ? 3.5 : 2}
        rx="6"
        filter={
          isOverlapping
            ? 'drop-shadow(0 0 10px rgba(239,68,68,0.55))'
            : isSelected
            ? 'drop-shadow(0 0 10px rgba(59,130,246,0.45))'
            : 'drop-shadow(0 4px 10px rgba(0,0,0,0.2))'
        }
      />

      {/* Rack Header Bar */}
      <rect
        x={rackNode.x + 1}
        y={rackNode.y + 1}
        width={rackNode.width - 2}
        height={CANVAS_RACK_HEADER_H}
        fill="#1e293b"
        rx="5"
        className={isReadOnlyMode ? 'cursor-pointer' : 'cursor-move'}
      />
      <text
        x={rackNode.x + 10}
        y={rackNode.y + 21}
        fill="#f8fafc"
        fontSize="10.5"
        fontWeight="bold"
        className="pointer-events-none"
      >
        {(rack?.name || rackNode.label).slice(0, 17)}
      </text>

      {/* Front / Rear Side Toggle Button on Rack Header */}
      {rack && (
        <g
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onToggleRackSide(rack.id, activeSide === 'front' ? 'rear' : 'front');
          }}
          className="cursor-pointer"
        >
          <rect
            x={rackNode.x + rackNode.width - 102}
            y={rackNode.y + 8}
            width={44}
            height={18}
            rx="4"
            fill={activeSide === 'rear' ? '#7c3aed' : '#0f766e'}
          />
          <text
            x={rackNode.x + rackNode.width - 80}
            y={rackNode.y + 20}
            textAnchor="middle"
            fill="#ffffff"
            fontSize="8.5"
            fontWeight="bold"
            fontFamily="monospace"
          >
            {activeSide === 'rear' ? 'SAU' : 'TRƯỚC'}
          </text>
        </g>
      )}

      {/* Open 19" Elevation Modal Button */}
      <g
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onOpenDeepInspect(targetRackId);
        }}
        className="cursor-pointer"
      >
        <rect
          x={rackNode.x + rackNode.width - 54}
          y={rackNode.y + 8}
          width={46}
          height={18}
          rx="4"
          fill="#2563eb"
        />
        <text
          x={rackNode.x + rackNode.width - 31}
          y={rackNode.y + 20}
          textAnchor="middle"
          fill="#ffffff"
          fontSize="9"
          fontWeight="bold"
          fontFamily="monospace"
        >
          {totalUnits}U ↗
        </text>
      </g>

      {/* Left 19" U-Rail Background */}
      <rect
        x={rackNode.x + 4}
        y={metrics.slotsY}
        width={CANVAS_RACK_RAIL_W - 6}
        height={metrics.availableSlotsHeight}
        fill="#0f172a"
        rx="2"
      />

      {/* Inner Bay Background */}
      <rect
        x={metrics.slotsX}
        y={metrics.slotsY}
        width={metrics.slotsWidth}
        height={metrics.availableSlotsHeight}
        fill={activeSide === 'rear' ? '#090d1f' : '#020617'}
        stroke="#1e293b"
        strokeWidth="1"
      />

      {/* Individual U-Slot Grid Lines & U Labels */}
      {Array.from({ length: totalUnits }, (_, idx) => {
        const uNum = totalUnits - idx;
        const rowY = metrics.slotsY + idx * metrics.slotH;
        const shouldLabel = uNum === totalUnits || uNum === 1 || uNum % labelStep === 0;

        return (
          <g key={`u_${uNum}`} className="pointer-events-none">
            <line
              x1={metrics.slotsX}
              y1={rowY + metrics.slotH}
              x2={metrics.slotsX + metrics.slotsWidth}
              y2={rowY + metrics.slotH}
              stroke="#1e293b"
              strokeWidth="0.6"
            />
            {shouldLabel && metrics.slotH >= 6 && (
              <text
                x={rackNode.x + CANVAS_RACK_RAIL_W - 6}
                y={rowY + metrics.slotH * 0.72}
                textAnchor="end"
                fill="#64748b"
                fontSize={metrics.slotH >= 12 ? '8' : '6.5'}
                fontFamily="monospace"
                fontWeight="600"
              >
                U{uNum < 10 ? `0${uNum}` : uNum}
              </text>
            )}
          </g>
        );
      })}

      {/* Mounted Device Plates */}
      {mountedEntries.map(({ startU, devId, dev, uHeight }) => {
        if (!dev) return null;
        const isBeingDragged = draggingRackDevice?.assetId === dev.id && draggingRackDevice.hasMoved;
        const isOverflow = startU < 1 || startU + uHeight - 1 > totalUnits;
        const clampedVisStart = Math.max(1, Math.min(totalUnits, startU));
        const spanRect = getSlotSpanRect(clampedVisStart, uHeight, totalUnits, metrics.slotH);
        const plateX = metrics.slotsX + 2;
        const plateY = metrics.slotsY + spanRect.top + 0.8;
        const plateW = Math.max(20, metrics.slotsWidth - 4);
        const plateH = Math.max(4, spanRect.height - 1.6);
        const color = isOverflow ? '#ef4444' : getDeviceColor(dev.category);
        const linkedNode = project.nodes.find(n => n.assetId === dev.id);
        const isPlateSelected = linkedNode && selectedNodeIdSet.has(linkedNode.id);

        return (
          <g
            key={`plate_${devId}`}
            opacity={isBeingDragged ? 0.35 : 1}
            onPointerDown={(e) => {
              e.stopPropagation();
              const isPrimary = e.pointerType !== 'mouse' || e.button === 0;
              if (!isPrimary) return;
              if (!isReadOnlyMode && (activeTool === 'connect' || connectingSource)) {
                if (linkedNode) {
                  onNodeClick(e, linkedNode);
                }
                return;
              }
              if (isReadOnlyMode) {
                if (linkedNode) {
                  onSelect('node', linkedNode.id);
                } else {
                  onSelect('rack', targetRackId);
                }
                return;
              }
              const coord = clientToCanvasCoord(e.clientX, e.clientY);
              onStartDraggingRackDevice({
                sourceRackId: targetRackId,
                sourceSide: activeSide,
                assetId: dev.id,
                uHeight,
                label: dev.name,
                color,
                startX: coord.x,
                startY: coord.y,
                currentX: coord.x,
                currentY: coord.y,
                hasMoved: false
              });
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onOpenDeepInspect(dev.id);
            }}
            className={`${isReadOnlyMode ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing'} group`}
          >
            <rect
              x={plateX}
              y={plateY}
              width={plateW}
              height={plateH}
              rx="2"
              fill={isOverflow ? '#450a0a' : '#1e293b'}
              stroke={isPlateSelected ? '#ffffff' : color}
              strokeWidth={isPlateSelected ? 1.8 : 1.1}
            />
            <rect x={plateX} y={plateY} width={4} height={plateH} rx="1" fill={color} />
            {plateH >= 8 && (
              <circle
                cx={plateX + 10}
                cy={plateY + plateH / 2}
                r={Math.min(2.5, plateH / 4)}
                fill={isOverflow ? '#ef4444' : dev.status === 'online' ? '#22c55e' : '#f59e0b'}
              />
            )}
            {plateH >= 8 && (
              <text
                x={plateX + 16}
                y={plateY + plateH / 2 + 3}
                fill="#f8fafc"
                fontSize={Math.min(9.5, Math.max(6.5, plateH * 0.55))}
                fontWeight="600"
                className="pointer-events-none"
              >
                {dev.name.slice(0, 19)}{isOverflow ? ' ⚠' : ''}
              </text>
            )}
            {plateH >= 10 && plateW >= 150 && (
              <text
                x={plateX + plateW - 22}
                y={plateY + plateH / 2 + 2.5}
                textAnchor="end"
                fill="#94a3b8"
                fontSize="7.5"
                fontFamily="monospace"
                className="pointer-events-none"
              >
                {uHeight > 1 ? `U${startU}-${startU + uHeight - 1}` : `U${startU}`}
              </text>
            )}
            {!isReadOnlyMode && plateH >= 10 && onRemoveDeviceFromRackSlot && (
              <g
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveDeviceFromRackSlot(targetRackId, startU, activeSide);
                }}
                className="cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <rect x={plateX + plateW - 15} y={plateY + plateH / 2 - 5} width={12} height={10} rx="2" fill="#ef4444" />
                <text x={plateX + plateW - 9} y={plateY + plateH / 2 + 2.5} textAnchor="middle" fill="#ffffff" fontSize="8" fontWeight="bold">
                  ×
                </text>
              </g>
            )}
          </g>
        );
      })}

      {/* Accurate Drop-Zone Preview Overlay */}
      {activePreview && (() => {
        const spanRect = getSlotSpanRect(activePreview.startU, activePreview.uHeight, totalUnits, metrics.slotH);
        const py = metrics.slotsY + spanRect.top + 0.5;
        const ph = Math.max(8, spanRect.height - 1);
        return (
          <g className="pointer-events-none">
            <rect
              x={metrics.slotsX + 1}
              y={py}
              width={metrics.slotsWidth - 2}
              height={ph}
              rx="2"
              fill={activePreview.valid ? '#22c55e' : '#ef4444'}
              fillOpacity="0.28"
              stroke={activePreview.valid ? '#4ade80' : '#f87171'}
              strokeWidth="1.5"
              strokeDasharray="4 2"
            />
            <rect
              x={metrics.slotsX + metrics.slotsWidth / 2 - 36}
              y={py + ph / 2 - 7}
              width={72}
              height={14}
              rx="3"
              fill={activePreview.valid ? '#15803d' : '#b91c1c'}
            />
            <text
              x={metrics.slotsX + metrics.slotsWidth / 2}
              y={py + ph / 2 + 3}
              textAnchor="middle"
              fill="#ffffff"
              fontSize="8"
              fontWeight="bold"
              fontFamily="monospace"
            >
              {activePreview.valid
                ? `${activePreview.uHeight > 1 ? `U${activePreview.startU}-${activePreview.startU + activePreview.uHeight - 1}` : `U${activePreview.startU}`} OK`
                : 'ĐÃ CHIẾM'}
            </text>
          </g>
        );
      })()}

      {/* Rack Footer Power / U Usage Status */}
      <rect
        x={rackNode.x + 1}
        y={rackNode.y + rackNode.height - CANVAS_RACK_FOOTER_H - 1}
        width={rackNode.width - 2}
        height={CANVAS_RACK_FOOTER_H}
        fill={hasRackWarning ? '#450a0a' : '#111827'}
        rx="4"
        className="pointer-events-none"
      />
      <text
        x={rackNode.x + 10}
        y={rackNode.y + rackNode.height - 8}
        fill={hasRackWarning ? '#fca5a5' : '#94a3b8'}
        fontSize="8"
        fontFamily="monospace"
        className="pointer-events-none"
      >
        {usedUnitsDisplay}U dùng · {freeUnitsDisplay}U trống
      </text>
      <text
        x={rackNode.x + rackNode.width - 10}
        y={rackNode.y + rackNode.height - 8}
        textAnchor="end"
        fill={stats?.isOverweight ? '#f87171' : '#34d399'}
        fontSize="8.5"
        fontWeight="bold"
        fontFamily="monospace"
        className="pointer-events-none"
      >
        {stats?.totalPowerWatts || 0}W · {(stats?.totalWeightKg || 0).toFixed(0)}kg
      </text>

      {/* 8 Interactive Resize Handles for Selected Unlocked Rack */}
      {isSelected && !rackNode.locked && !isReadOnlyMode && (() => {
        const invZ = 1 / Math.max(0.45, Math.min(zoom, 1.8));
        const hSize = 8 * invZ;
        const getRackHandlePos = (dir: ResizeHandleDir) => {
          const cx = rackNode.x + rackNode.width / 2;
          const cy = rackNode.y + rackNode.height / 2;
          switch (dir) {
            case 'nw': return { x: rackNode.x, y: rackNode.y };
            case 'n': return { x: cx, y: rackNode.y };
            case 'ne': return { x: rackNode.x + rackNode.width, y: rackNode.y };
            case 'e': return { x: rackNode.x + rackNode.width, y: cy };
            case 'se': return { x: rackNode.x + rackNode.width, y: rackNode.y + rackNode.height };
            case 's': return { x: cx, y: rackNode.y + rackNode.height };
            case 'sw': return { x: rackNode.x, y: rackNode.y + rackNode.height };
            case 'w': return { x: rackNode.x, y: cy };
          }
        };
        return (
          <g>
            {RESIZE_HANDLE_DIRS.map(({ dir, cursorClass }) => {
              const pos = getRackHandlePos(dir);
              return (
                <rect
                  key={`rk_h_${dir}`}
                  x={pos.x - hSize / 2}
                  y={pos.y - hSize / 2}
                  width={hSize}
                  height={hSize}
                  rx={1.5 * invZ}
                  fill="#ffffff"
                  stroke="#3b82f6"
                  strokeWidth={1.5 * invZ}
                  className={cursorClass}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    onStartResize(
                      e,
                      rackNode.id,
                      dir,
                      { x: rackNode.x, y: rackNode.y, width: rackNode.width, height: rackNode.height },
                      0,
                      210,
                      120
                    );
                  }}
                />
              );
            })}
          </g>
        );
      })()}
    </g>
  );
});
