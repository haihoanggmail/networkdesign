import React, { useMemo, useState } from 'react';
import { Cable, Check, ChevronDown, ChevronUp, ClipboardList, Copy } from 'lucide-react';
import { CableEdge } from '../../types/infrastructure';
import { computeProjectCableSummary } from '../../utils/cableRouting';

interface CableMaterialSummaryPanelProps {
  cables: CableEdge[];
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenBomModal?: () => void;
}

export const CableMaterialSummaryPanel: React.FC<CableMaterialSummaryPanelProps> = ({
  cables,
  isExpanded,
  onToggleExpand,
  onOpenBomModal
}) => {
  const [copied, setCopied] = useState(false);
  const summary = useMemo(() => computeProjectCableSummary(cables), [cables]);

  const handleCopyBom = async () => {
    const lines = [
      `DỰ TOÁN VẬT TƯ CÁP (${summary.totalCount} tuyến · ${summary.totalMeters} m · Dự phòng +10%: ${summary.totalWithReserveMeters} m)`,
      ...summary.byType.map(row => {
        const rollNote = row.estimatedRolls305m ? ` (~${row.estimatedRolls305m} cuộn 305m)` : '';
        return `- ${row.label}: ${row.count} tuyến · ${row.totalMeters} m (${row.percentage}%)${rollNote}`;
      })
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failure in restricted iframes
    }
  };

  return (
    <section
      aria-label="Bảng thống kê cáp và dự toán vật tư"
      className="shrink-0 border-t border-l border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-xs select-text"
    >
      <button
        type="button"
        onClick={onToggleExpand}
        aria-expanded={isExpanded}
        className="w-full px-3.5 py-2.5 flex items-center justify-between gap-2 bg-slate-50/70 dark:bg-slate-900 hover:bg-slate-100/70 dark:hover:bg-slate-800/60 transition-colors text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <Cable className="w-3.5 h-3.5 text-[#155EEF] dark:text-blue-400 shrink-0" />
          <span className="font-semibold text-slate-900 dark:text-white truncate">
            Dự toán vật tư cáp
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0 font-mono tabular-nums text-xs">
          <span className="text-slate-500 dark:text-slate-400">
            {summary.totalCount} tuyến
          </span>
          <span className="text-slate-300 dark:text-slate-700">·</span>
          <span className="font-semibold text-[#155EEF] dark:text-blue-400">
            {summary.totalMeters} m
          </span>
          {isExpanded ? (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          )}
        </div>
      </button>

      {isExpanded && (
        <div className="border-t border-slate-200 dark:border-slate-800 max-h-64 overflow-y-auto bg-white dark:bg-slate-900">
          {/* Unified 3-column hairline KPI strip */}
          <div className="grid grid-cols-3 divide-x divide-slate-200 dark:divide-slate-800 border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30">
            <div className="px-3 py-2">
              <div className="text-xs text-slate-500 dark:text-slate-400">Số tuyến</div>
              <div className="font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
                {summary.totalCount}
              </div>
            </div>
            <div className="px-3 py-2">
              <div className="text-xs text-slate-500 dark:text-slate-400">Tổng dài</div>
              <div className="font-semibold font-mono tabular-nums text-[#155EEF] dark:text-blue-400 mt-0.5">
                {summary.totalMeters} m
              </div>
            </div>
            <div className="px-3 py-2">
              <div className="text-xs text-slate-500 dark:text-slate-400">Dự phòng +10%</div>
              <div className="font-semibold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 mt-0.5">
                {summary.totalWithReserveMeters} m
              </div>
            </div>
          </div>

          {/* Breakdown ledger by Cable Type */}
          {summary.byType.length === 0 ? (
            <div className="px-3.5 py-4 text-center text-xs text-slate-400">
              Chưa có tuyến cáp nào trong dự án.
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
              {summary.byType.map(row => (
                <div key={row.cableType} className="px-3.5 py-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2 h-2 rounded-[2px] shrink-0"
                        style={{ backgroundColor: row.color }}
                      />
                      <span className="font-medium text-slate-800 dark:text-slate-100 truncate" title={row.label}>
                        {row.shortLabel}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 font-mono tabular-nums text-xs">
                      <span className="text-slate-500 dark:text-slate-400">{row.count} tuyến</span>
                      <span className="text-slate-300 dark:text-slate-700">·</span>
                      <span className="font-semibold text-slate-900 dark:text-white">{row.totalMeters} m</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <div className="flex-1 h-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full transition-all"
                        style={{
                          width: `${Math.max(3, row.percentage)}%`,
                          backgroundColor: row.color
                        }}
                      />
                    </div>
                    <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 shrink-0">
                      {row.percentage}%
                      {row.estimatedRolls305m ? ` · ~${row.estimatedRolls305m} cuộn (305m)` : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(summary.totalCount > 0 || onOpenBomModal) && (
            <div className="px-3.5 py-2 border-t border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-900 flex flex-col gap-1.5">
              {onOpenBomModal && (
                <button
                  type="button"
                  onClick={onOpenBomModal}
                  className="ent-btn-primary w-full h-8 text-xs"
                >
                  <ClipboardList className="w-3.5 h-3.5 shrink-0" />
                  <span>Xem Thống kê Vật tư (BOM)</span>
                </button>
              )}
              {summary.totalCount > 0 && (
                <button
                  type="button"
                  onClick={handleCopyBom}
                  className="ent-btn-secondary w-full h-7 text-xs"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                      <span className="text-emerald-600 dark:text-emerald-400">Đã sao chép bảng dự toán</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" />
                      <span>Sao chép bảng dự toán cáp</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
