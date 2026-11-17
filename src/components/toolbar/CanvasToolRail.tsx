import React from 'react';
import {
  MousePointer,
  Hand,
  GitBranch,
  Square,
  Type,
  Table2,
  Ruler,
  type LucideIcon
} from 'lucide-react';
import { DesignMode } from '../../types/infrastructure';
import { CanvasTool } from '../../store/useProjectStore';
import { LayoutTier } from '../../hooks/useWorkspaceLayout';

interface CanvasToolRailProps {
  activeTool: CanvasTool;
  activeMode: DesignMode;
  layoutTier: LayoutTier;
  isReadOnlyMode?: boolean;
  onSetTool: (tool: CanvasTool) => void;
  onGenerateLegend?: () => void;
}

type ToolItem =
  | {
      kind: 'tool';
      id: CanvasTool;
      label: string;
      shortcut: string;
      icon: LucideIcon;
    }
  | {
      kind: 'action';
      id: 'legend';
      label: string;
      shortcut: string;
      icon: LucideIcon;
    };

const CANVAS_TOOLS: ToolItem[] = [
  { kind: 'tool', id: 'select', label: 'Chọn', shortcut: 'V', icon: MousePointer },
  { kind: 'tool', id: 'pan', label: 'Kéo', shortcut: 'H', icon: Hand },
  { kind: 'tool', id: 'connect', label: 'Nối dây', shortcut: 'C', icon: GitBranch },
  { kind: 'tool', id: 'room', label: 'Phòng', shortcut: 'R', icon: Square },
  { kind: 'tool', id: 'text', label: 'Chữ', shortcut: 'T', icon: Type },
  { kind: 'action', id: 'legend', label: 'Chú giải', shortcut: 'L', icon: Table2 },
  { kind: 'tool', id: 'measure', label: 'Đo', shortcut: 'M', icon: Ruler }
];

const RECOMMENDED_BY_MODE: Record<DesignMode, string[]> = {
  topology: ['select', 'connect'],
  multisite: ['select', 'connect'],
  floorplan: ['room', 'measure', 'connect'],
  rack: ['select', 'measure'],
  fiber: ['connect', 'measure'],
  cctv: ['room', 'connect', 'measure'],
  wifi: ['room', 'measure'],
  electrical: ['connect', 'measure']
};

export const CanvasToolRail: React.FC<CanvasToolRailProps> = ({
  activeTool,
  activeMode,
  layoutTier,
  isReadOnlyMode = false,
  onSetTool,
  onGenerateLegend
}) => {
  if (layoutTier === 'narrow') return null;

  const isCompactRail = layoutTier === 'medium';
  const recommendedIds = RECOMMENDED_BY_MODE[activeMode] || ['select'];

  return (
    <aside
      aria-label="Thanh công cụ vẽ"
      onPointerDown={e => e.stopPropagation()}
      className="hidden md:flex flex-col gap-1 absolute top-3 left-3 z-20 p-1.5 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-xl border border-slate-200 dark:border-slate-800 shadow-md select-none no-print"
    >
      {CANVAS_TOOLS.map(item => {
        const Icon = item.icon;
        const isActive = item.kind === 'tool' && activeTool === item.id;
        const isRecommended = recommendedIds.includes(item.id);
        const disabled =
          isReadOnlyMode &&
          item.id !== 'select' &&
          item.id !== 'pan' &&
          item.id !== 'measure';

        const handleClick = () => {
          if (disabled) return;
          if (item.kind === 'action') {
            onGenerateLegend?.();
          } else {
            onSetTool(item.id);
          }
        };

        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={handleClick}
            aria-pressed={item.kind === 'tool' ? isActive : undefined}
            aria-label={`${item.label} (${item.shortcut})`}
            title={`${item.label} (${item.shortcut})${isRecommended ? ' · Phù hợp chế độ hiện tại' : ''}`}
            className={`group relative flex items-center justify-between gap-2.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed ${
              isCompactRail ? 'w-9 h-9 justify-center px-0' : 'h-8 px-2.5 min-w-[116px]'
            } ${
              isActive
                ? 'bg-[#155EEF] text-white font-semibold'
                : isRecommended
                ? 'text-slate-800 dark:text-slate-100 hover:bg-blue-50 dark:hover:bg-slate-800'
                : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span className="flex items-center gap-2">
              <Icon
                className={`w-4 h-4 shrink-0 ${
                  isActive
                    ? 'text-white'
                    : isRecommended
                    ? 'text-[#155EEF] dark:text-blue-400'
                    : 'text-slate-500 dark:text-slate-400'
                }`}
              />
              {!isCompactRail && <span>{item.label}</span>}
            </span>
            {!isCompactRail && (
              <kbd
                className={`font-mono text-xs ${
                  isActive ? 'text-blue-100' : 'text-slate-400 dark:text-slate-500'
                }`}
              >
                {item.shortcut}
              </kbd>
            )}
          </button>
        );
      })}
    </aside>
  );
};
