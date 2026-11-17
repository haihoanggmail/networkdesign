import React, { useMemo, useRef, useState } from 'react';
import { ARCHITECTURE_TEMPLATES } from '../../data/templates';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { 
  X, 
  FolderOpen, 
  ArrowRight, 
  Network, 
  Building2, 
  Server, 
  Video, 
  Wifi, 
  GitBranch, 
  Globe,
  Layers,
  Sparkles,
  Search
} from 'lucide-react';

interface TemplateGalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (templateId: string) => void;
}

const SAMPLE_CATEGORY = 'Dự án mẫu (Sample Project)';
const STANDARD_NETWORK_CATEGORY = 'Mạng tiêu chuẩn (LAN / WAN / Core-Dist)';

function normalizeVi(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

export const TemplateGalleryModal: React.FC<TemplateGalleryModalProps> = ({
  isOpen,
  onClose,
  onSelectTemplate
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [activeCategory, setActiveCategory] = useState<string>('Tất cả');
  const [searchQuery, setSearchQuery] = useState<string>('');
  useFocusTrap(dialogRef, isOpen, onClose);

  const categories = useMemo(
    () => ['Tất cả', ...Array.from(new Set(ARCHITECTURE_TEMPLATES.map(t => t.categoryName)))],
    []
  );

  const filteredTemplates = useMemo(() => {
    const q = normalizeVi(searchQuery.trim());
    return ARCHITECTURE_TEMPLATES.filter(t => {
      if (activeCategory !== 'Tất cả' && t.categoryName !== activeCategory) return false;
      if (!q) return true;
      const hay = normalizeVi(
        [t.name, t.badge, t.categoryName, t.description, ...(t.highlights || [])].join(' ')
      );
      return hay.includes(q);
    });
  }, [activeCategory, searchQuery]);

  if (!isOpen) return null;

  const renderIcon = (iconName: string) => {
    switch (iconName) {
      case 'Layers': return <Layers className="w-5 h-5 text-blue-600 dark:text-blue-400" />;
      case 'Network': return <Network className="w-5 h-5 text-blue-600" />;
      case 'Building2':
      case 'Building': return <Building2 className="w-5 h-5 text-indigo-600" />;
      case 'Server': return <Server className="w-5 h-5 text-slate-700 dark:text-slate-300" />;
      case 'Video': return <Video className="w-5 h-5 text-amber-600" />;
      case 'Wifi': return <Wifi className="w-5 h-5 text-emerald-600" />;
      case 'GitBranch': return <GitBranch className="w-5 h-5 text-cyan-600" />;
      case 'Globe': return <Globe className="w-5 h-5 text-purple-600" />;
      default: return <FolderOpen className="w-5 h-5 text-blue-600" />;
    }
  };

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4" role="dialog" aria-modal="true" aria-label="Thư Viện Mẫu Có Sẵn">
      <div className="w-full h-dvh sm:h-auto sm:max-w-4xl sm:max-h-[90dvh] bg-white dark:bg-slate-900 rounded-none sm:rounded-xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden text-slate-800 dark:text-slate-200 text-xs pb-safe">
        {/* Header */}
        <div className="px-4 sm:px-6 py-3.5 sm:py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/50 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-blue-600 shrink-0" />
              <span className="truncate">Thư viện mẫu thiết kế có sẵn</span>
            </h2>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              Chọn dự án mẫu hoàn chỉnh hoặc sơ đồ mạng tiêu chuẩn (LAN / WAN / Core-Distribution)
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative hidden sm:block w-56">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Tìm mẫu LAN, WAN, Core..."
                aria-label="Tìm kiếm mẫu sơ đồ"
                className="w-full h-8 pl-8 pr-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus:border-blue-500"
              />
            </div>
            <button 
              onClick={onClose}
              aria-label="Đóng thư viện mẫu"
              className="touch-target p-1.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-400 hover:text-slate-600 shrink-0"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div
          className="px-4 sm:px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-1.5 overflow-x-auto shrink-0"
          role="tablist"
          aria-label="Danh mục thư viện mẫu"
        >
          {categories.map(cat => {
            const isSelected = activeCategory === cat;
            const isSampleCat = cat === SAMPLE_CATEGORY;
            const isStdCat = cat === STANDARD_NETWORK_CATEGORY;
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={isSelected}
                onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap border transition-colors flex items-center gap-1.5 ${
                  isSelected
                    ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
                    : isSampleCat || isStdCat
                    ? 'bg-blue-50/80 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800 hover:bg-blue-100/80 dark:hover:bg-blue-900/40'
                    : 'bg-slate-50 dark:bg-slate-800/70 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {isSampleCat && <Sparkles className="w-3.5 h-3.5 shrink-0" />}
                {isStdCat && <Network className="w-3.5 h-3.5 shrink-0" />}
                <span>{cat}</span>
              </button>
            );
          })}
        </div>

        {/* Mobile Search Bar */}
        <div className="sm:hidden px-4 pt-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Tìm mẫu LAN, WAN, Core..."
              aria-label="Tìm kiếm mẫu sơ đồ"
              className="w-full h-9 pl-8 pr-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Templates Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          {activeCategory === SAMPLE_CATEGORY && (
            <div className="mb-4 rounded-xl border border-blue-200 dark:border-blue-800/80 bg-blue-50/70 dark:bg-blue-950/30 px-4 py-3 text-[11px] text-blue-900 dark:text-blue-200">
              <div className="font-bold text-xs mb-0.5 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>Dự án mẫu đầy đủ tính năng cho người mới (Sample Project)</span>
              </div>
              <p className="text-blue-800/90 dark:text-blue-300/90 leading-relaxed">
                Gồm sẵn tòa nhà 3 tầng, sơ đồ mạng logic, thiết bị đã gán vào 3 tủ Rack 19&quot;, danh bạ 5 VLAN / Subnet CIDR, PoE/UPS, vùng phủ Wi-Fi, Camera FOV và bảng vật tư (BOM) để bạn trải nghiệm ngay toàn bộ công cụ.
              </p>
            </div>
          )}

          {activeCategory === STANDARD_NETWORK_CATEGORY && (
            <div className="mb-4 rounded-xl border border-cyan-200 dark:border-cyan-800/80 bg-cyan-50/70 dark:bg-cyan-950/30 px-4 py-3 text-[11px] text-cyan-950 dark:text-cyan-200">
              <div className="font-bold text-xs mb-0.5 flex items-center gap-1.5">
                <Network className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
                <span>Thư viện sơ đồ kết nối mạng tiêu chuẩn (LAN · WAN · Core/Distribution)</span>
              </div>
              <p className="text-cyan-900/90 dark:text-cyan-300/90 leading-relaxed">
                Các mô hình chuẩn công nghiệp đã cấu hình sẵn cổng kết nối vật lý, phân dải IP/Subnet/VLAN và chiều dài tuyến cáp hợp chuẩn để khởi tạo nhanh dự án hạ tầng.
              </p>
            </div>
          )}

          {filteredTemplates.length === 0 ? (
            <div className="py-12 text-center text-slate-500 dark:text-slate-400">
              Không tìm thấy mẫu phù hợp với từ khóa &ldquo;{searchQuery}&rdquo;.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredTemplates.map(tpl => {
                const isSample = tpl.categoryName === SAMPLE_CATEGORY;
                const isStd = tpl.categoryName === STANDARD_NETWORK_CATEGORY;
                return (
                  <div
                    key={tpl.id}
                    onClick={() => {
                      onSelectTemplate(tpl.id);
                      onClose();
                    }}
                    className={`group flex flex-col justify-between p-4 rounded-xl border transition-all cursor-pointer shadow-xs hover:shadow-md ${
                      isSample
                        ? 'border-blue-300 dark:border-blue-700 bg-blue-50/30 dark:bg-blue-950/20 hover:bg-blue-50/70 dark:hover:bg-blue-950/35 hover:border-blue-500'
                        : isStd
                        ? 'border-cyan-300/80 dark:border-cyan-800 bg-cyan-50/20 dark:bg-cyan-950/15 hover:bg-cyan-50/60 dark:hover:bg-cyan-950/30 hover:border-cyan-500'
                        : 'border-slate-200 dark:border-slate-800 bg-white hover:bg-blue-50/40 dark:bg-slate-800/30 dark:hover:bg-blue-950/20 hover:border-blue-400 dark:hover:border-blue-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                            isSample
                              ? 'bg-blue-100 dark:bg-blue-900/50'
                              : isStd
                              ? 'bg-cyan-100 dark:bg-cyan-900/50'
                              : 'bg-slate-100 dark:bg-slate-800'
                          }`}>
                            {renderIcon(tpl.thumbnailIcon)}
                          </div>
                          <div className="min-w-0">
                            <span className="font-bold text-sm text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors block">
                              {tpl.name}
                            </span>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400">
                              {tpl.categoryName}
                            </div>
                          </div>
                        </div>
                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border shrink-0 ${
                          isSample
                            ? 'border-blue-300 dark:border-blue-700 bg-blue-100/80 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300'
                            : isStd
                            ? 'border-cyan-300 dark:border-cyan-700 bg-cyan-100/80 dark:bg-cyan-900/50 text-cyan-800 dark:text-cyan-300'
                            : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
                        }`}>
                          {tpl.badge}
                        </span>
                      </div>

                      <p className="text-slate-600 dark:text-slate-300 text-xs leading-relaxed line-clamp-3 mt-2">
                        {tpl.description}
                      </p>

                      {tpl.highlights && tpl.highlights.length > 0 && (
                        <div className="mt-2.5 flex flex-wrap gap-1.5 text-[10px] font-semibold text-slate-700 dark:text-slate-300">
                          {tpl.highlights.map(item => (
                            <span
                              key={item}
                              className="px-2 py-0.5 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                            >
                              {item}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800/80 flex items-center justify-between text-blue-600 dark:text-blue-400 font-semibold text-xs">
                      <span>Nạp mẫu vào bản vẽ</span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

