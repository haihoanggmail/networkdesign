import React, { useState, useEffect, useRef } from 'react';
import { Keyboard, RotateCcw, X, Check } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import {
  SHORTCUT_DEFINITIONS,
  ShortcutActionId,
  ShortcutKeymap,
  formatShortcutDisplay,
  normalizeKeyboardEventToCombo
} from '../../hooks/useKeyboardShortcuts';

interface ShortcutSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  keymap: ShortcutKeymap;
  onUpdateShortcut: (actionId: ShortcutActionId, combo: string) => void;
  onResetShortcuts: () => void;
}

export const ShortcutSettingsModal: React.FC<ShortcutSettingsModalProps> = ({
  isOpen,
  onClose,
  keymap,
  onUpdateShortcut,
  onResetShortcuts
}) => {
  const [recordingId, setRecordingId] = useState<ShortcutActionId | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, recordingId ? undefined : onClose);

  useEffect(() => {
    if (!recordingId) return;
    const handleKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecordingId(null);
        setConflictMsg(null);
        return;
      }
      const combo = normalizeKeyboardEventToCombo(e);
      if (!combo) return;

      const conflict = SHORTCUT_DEFINITIONS.find(
        d => d.id !== recordingId && keymap[d.id] === combo
      );
      if (conflict) {
        setConflictMsg(`Tổ hợp ${formatShortcutDisplay(combo)} đang dùng cho "${conflict.label}".`);
        return;
      }
      onUpdateShortcut(recordingId, combo);
      setRecordingId(null);
      setConflictMsg(null);
    };

    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [recordingId, keymap, onUpdateShortcut]);

  if (!isOpen) return null;

  const categories: Array<'Công cụ' | 'Chỉnh sửa' | 'Khung nhìn'> = ['Công cụ', 'Chỉnh sửa', 'Khung nhìn'];

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Cài đặt phím tắt hệ thống"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-[#155EEF]/10 text-[#155EEF] dark:text-blue-400 flex items-center justify-center shrink-0">
              <Keyboard className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                Phím tắt hệ thống
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Nhấp vào phím hiện tại rồi bấm tổ hợp mới để gán lại
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => {
                onResetShortcuts();
                setRecordingId(null);
                setConflictMsg(null);
              }}
              className="px-2.5 py-1.5 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-200 flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Khôi phục mặc định</span>
            </button>
            <button
              onClick={onClose}
              aria-label="Đóng cửa sổ phím tắt"
              className="p-1.5 rounded-md hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {conflictMsg && (
          <div className="px-5 py-2 bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 font-medium">
            {conflictMsg}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {categories.map(cat => (
            <div key={cat} className="space-y-2">
              <div className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                {cat}
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-lg overflow-hidden">
                {SHORTCUT_DEFINITIONS.filter(d => d.category === cat).map(def => {
                  const isRecording = recordingId === def.id;
                  return (
                    <div
                      key={def.id}
                      className="px-3.5 py-2.5 bg-white dark:bg-slate-900 flex items-center justify-between gap-3"
                    >
                      <span className="text-xs font-medium text-slate-800 dark:text-slate-200">
                        {def.label}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setConflictMsg(null);
                          setRecordingId(prev => (prev === def.id ? null : def.id));
                        }}
                        className={`min-w-[110px] px-2.5 py-1 rounded-md text-xs font-mono font-semibold border transition-colors text-center ${
                          isRecording
                            ? 'bg-[#155EEF] text-white border-[#155EEF]'
                            : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-[#155EEF]'
                        }`}
                      >
                        {isRecording ? 'Nhấn phím...' : formatShortcutDisplay(keymap[def.id])}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 flex items-center justify-between text-xs text-slate-500">
          <span>Nhấn Esc để hủy ghi phím · Phím chữ tự động bỏ qua khi đang nhập văn bản</span>
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md bg-[#155EEF] hover:bg-[#124CC7] text-white font-semibold text-xs flex items-center gap-1"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Xong</span>
          </button>
        </div>
      </div>
    </div>
  );
};
