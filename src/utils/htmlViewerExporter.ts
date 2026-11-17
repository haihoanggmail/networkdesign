import { ProjectState } from '../types/infrastructure';
import { generatePureSvgMarkup } from './svgExport';
import { APP_BUILD_HASH, APP_PRODUCT_NAME, APP_VERSION, BRAND_INFO } from '../config/appInfo';
import { VIEWER_3D_RUNTIME_JS } from './viewer3dRuntimeBundle';

export type HtmlViewerContentScope = '2d' | '3d' | 'both';

export interface HtmlViewerExportOptions {
  contentScope?: HtmlViewerContentScope;
  background3D?: 'light' | 'dark';
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeEmbedJson(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function buildViewerProjectPayload(
  project: ProjectState,
  options?: HtmlViewerExportOptions
): Record<string, unknown> {
  const settingsCopy = { ...(project.settings || {}) } as Record<string, unknown>;
  delete settingsCopy.backgroundImageDataUrl;
  if (options?.background3D) {
    settingsCopy.isDarkMode = options.background3D === 'dark';
  }

  const sanitizedNodes = (project.nodes || []).map(node => {
    if (!node.customData) return node;
    const customCopy = { ...(node.customData as Record<string, unknown>) };
    delete customCopy.image;
    delete customCopy.dataUrl;
    return {
      ...node,
      customData: customCopy
    };
  });

  return {
    id: project.id,
    name: project.name,
    author: project.author,
    version: project.version,
    activeMode: project.activeMode,
    activeFloorId: project.activeFloorId,
    settings: settingsCopy,
    floors: project.floors || [],
    rooms: project.rooms || [],
    racks: project.racks || [],
    nodes: sanitizedNodes,
    cables: project.cables || [],
    cableTrays: project.cableTrays || [],
    assets: project.assets || {}
  };
}

/**
 * Exports a self-contained, zero-dependency interactive HTML Viewer (.html)
 * supporting full 360° 3D WebGL orbit rotation (horizontal & vertical), multi-direction camera presets,
 * floor cutaway/explode controls, click-to-inspect 3D elements, plus 2D CAD SVG pan/zoom and searchable BOM tables offline.
 */
export function generateStandaloneViewerHtml(
  project: ProjectState,
  options?: HtmlViewerExportOptions
): string {
  const contentScope: HtmlViewerContentScope = options?.contentScope ?? 'both';
  const startIn3D = contentScope !== '2d';
  const svgMarkup = generatePureSvgMarkup(project, { darkTheme: false, includeTitleBlock: true });
  const assets = Object.values(project.assets);
  const viewerPayload = buildViewerProjectPayload(project, options);
  const embeddedProjectJson = safeEmbedJson(viewerPayload);

  const floorOptionsHtml =
    project.floors.length > 1
      ? [
          `<option value="__ALL__" selected>Toàn bộ tòa nhà (${project.floors.length} tầng)</option>`,
          ...([...project.floors]
            .sort((a, b) => a.level - b.level)
            .map(f => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`))
        ].join('')
      : '';

  const deviceRowsHtml = assets
    .map(
      a => `
    <tr>
      <td><code>${escapeHtml(a.assetTag)}</code></td>
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td>${escapeHtml(a.category)}</td>
      <td>${escapeHtml(a.vendor)} ${escapeHtml(a.model)}</td>
      <td><code>${escapeHtml(a.ipAddress || '—')}</code></td>
      <td>${escapeHtml(a.vlan || '—')}</td>
      <td>${a.powerWatts || 0} W</td>
    </tr>`
    )
    .join('');

  const cableRowsHtml = project.cables
    .map(c => {
      const src = project.nodes.find(n => n.id === c.sourceNodeId)?.label || c.sourceNodeId;
      const tgt = project.nodes.find(n => n.id === c.targetNodeId)?.label || c.targetNodeId;
      return `
      <tr>
        <td><code>${escapeHtml(c.cableCode)}</code></td>
        <td>${escapeHtml(src)}</td>
        <td>${escapeHtml(tgt)}</td>
        <td>${escapeHtml(c.cableType)}</td>
        <td>${escapeHtml(c.bandwidth)}</td>
        <td>${c.lengthMeters || 0} m</td>
      </tr>`;
    })
    .join('');

  return `<!doctype html>
<html lang="vi">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="referrer" content="no-referrer" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; base-uri 'none';" />
  <title>${escapeHtml(project.name)} — HACHIHI Interactive 3D &amp; 2D Viewer</title>
  <style>
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0;
      font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
      background: #f8fafc;
      color: #0f172a;
      display: flex;
      flex-direction: column;
      min-height: 100vh;
    }
    header {
      background: #1d4ed8;
      color: #fff;
      padding: 10px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
      flex-shrink: 0;
    }
    header h1 { margin: 0; font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 8px; }
    header .badge {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 999px;
      background: rgba(255,255,255,0.2);
      letter-spacing: 0.03em;
    }
    header .meta { font-size: 11.5px; opacity: 0.92; margin-top: 2px; }
    .toolbar {
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
      padding: 7px 14px;
      display: flex;
      gap: 6px;
      align-items: center;
      flex-wrap: wrap;
      flex-shrink: 0;
    }
    .btn-group {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      flex-wrap: wrap;
    }
    .divider { width: 1px; height: 22px; background: #e2e8f0; margin: 0 4px; }
    button, select {
      border: 1px solid #cbd5e1;
      background: #ffffff;
      color: #0f172a;
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.12s, border-color 0.12s, color 0.12s;
      font-family: inherit;
    }
    button:hover { background: #f1f5f9; border-color: #94a3b8; }
    button.active { background: #1d4ed8; color: #ffffff; border-color: #1d4ed8; }
    button.active-teal { background: #0f766e; color: #ffffff; border-color: #0f766e; }
    .spacer { flex: 1 1 16px; }
    main { flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0; position: relative; }
    .viewport-2d {
      flex: 1 1 auto;
      min-height: 520px;
      overflow: hidden;
      background: #f1f5f9;
      position: relative;
      cursor: grab;
    }
    .viewport-2d:active { cursor: grabbing; }
    #stage { transform-origin: 0 0; width: 100%; height: 100%; }
    #stage svg { width: 100%; height: 100%; display: block; }
    .viewport-3d {
      flex: 1 1 auto;
      min-height: 540px;
      position: relative;
      overflow: hidden;
      background: #0b1120;
      user-select: none;
    }
    #canvas3dHost {
      width: 100%;
      height: 100%;
      position: absolute;
      inset: 0;
    }
    #labels3dLayer {
      position: absolute;
      inset: 0;
      pointer-events: none;
      overflow: hidden;
      z-index: 5;
    }
    .label-3d-tag {
      position: absolute;
      transform: translate(-50%, -100%);
      background: rgba(15, 23, 42, 0.88);
      color: #f8fafc;
      border: 1px solid rgba(148, 163, 184, 0.45);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 10.5px;
      font-weight: 600;
      white-space: nowrap;
      pointer-events: none;
      box-shadow: 0 2px 6px rgba(0,0,0,0.28);
    }
    .hud-card {
      position: absolute;
      z-index: 10;
      background: rgba(255, 255, 255, 0.95);
      color: #0f172a;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.16);
      font-size: 11.5px;
    }
    .viewport-3d.theme-dark .hud-card {
      background: rgba(15, 23, 42, 0.94);
      color: #f1f5f9;
      border-color: #334155;
    }
    #hudTopLeft {
      top: 10px;
      left: 10px;
      padding: 6px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      max-width: calc(100% - 110px);
    }
    .hud-title { font-weight: 700; color: #1d4ed8; }
    .viewport-3d.theme-dark .hud-title { color: #60a5fa; }
    .hud-hint { color: #64748b; font-size: 11px; }
    .viewport-3d.theme-dark .hud-hint { color: #94a3b8; }
    #xyzGizmoPanel {
      top: 10px;
      right: 10px;
      padding: 5px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
    }
    #xyzGizmoPanel .gizmo-cap { font-size: 9.5px; font-weight: 700; color: #64748b; letter-spacing: 0.05em; }
    .viewport-3d.theme-dark #xyzGizmoPanel .gizmo-cap { color: #94a3b8; }
    #dockBottomLeft {
      bottom: 12px;
      left: 10px;
      padding: 7px 10px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      max-width: calc(100% - 20px);
    }
    #dockBottomLeft label {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11.5px;
      font-weight: 600;
    }
    #dockBottomLeft input[type="range"] { width: 84px; accent-color: #1d4ed8; cursor: pointer; }
    #dockBottomLeft button, #dockBottomLeft select { padding: 4px 8px; font-size: 11px; }
    .viewport-3d.theme-dark #dockBottomLeft button,
    .viewport-3d.theme-dark #dockBottomLeft select {
      background: #1e293b;
      color: #e2e8f0;
      border-color: #475569;
    }
    .viewport-3d.theme-dark #dockBottomLeft button.active {
      background: #2563eb;
      color: #ffffff;
      border-color: #2563eb;
    }
    #inspector3dCard {
      top: 108px;
      right: 10px;
      width: 260px;
      max-height: calc(100% - 170px);
      overflow-y: auto;
      padding: 10px 12px;
    }
    #inspector3dCard .insp-head {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8px;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 6px;
      margin-bottom: 8px;
    }
    .viewport-3d.theme-dark #inspector3dCard .insp-head { border-bottom-color: #334155; }
    #inspector3dCard .insp-title { font-weight: 700; font-size: 13px; word-break: break-word; }
    #inspector3dCard .insp-sub { font-size: 10.5px; color: #64748b; margin-top: 2px; }
    .viewport-3d.theme-dark #inspector3dCard .insp-sub { color: #94a3b8; }
    #inspector3dCard .insp-close { padding: 2px 7px; font-size: 12px; line-height: 1.2; }
    .insp-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; font-size: 11px; margin-bottom: 8px; }
    .insp-grid .k { color: #64748b; font-weight: 600; }
    .viewport-3d.theme-dark .insp-grid .k { color: #94a3b8; }
    .insp-grid .v { font-weight: 600; word-break: break-word; text-align: right; }
    .insp-u-list {
      margin: 6px 0 8px;
      padding: 6px;
      border-radius: 6px;
      background: rgba(148, 163, 184, 0.14);
      max-height: 140px;
      overflow-y: auto;
      font-size: 10.5px;
    }
    .insp-u-item { display: flex; justify-content: space-between; gap: 6px; padding: 2px 0; border-bottom: 1px dashed rgba(148,163,184,0.28); }
    .insp-u-item:last-child { border-bottom: none; }
    #btnFocusObject { width: 100%; background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
    #btnFocusObject:hover { background: #1e40af; }
    #webglFallback {
      position: absolute;
      inset: 0;
      z-index: 25;
      background: #0f172a;
      color: #f8fafc;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px;
      text-align: center;
      gap: 10px;
    }
    .tables { max-width: 1280px; width: 100%; margin: 16px auto; padding: 0 20px 40px; overflow-x: auto; }
    .table-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 8px; }
    .search-input {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      min-width: 240px;
      font-family: inherit;
    }
    table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e2e8f0; margin-top: 8px; font-size: 12px; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 10px; text-align: left; }
    th { background: #f8fafc; font-weight: 700; color: #334155; }
    footer {
      border-top: 1px solid #e2e8f0;
      background: #ffffff;
      padding: 8px 18px;
      font-size: 11.5px;
      color: #475569;
      display: flex;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      flex-shrink: 0;
    }
    .hidden { display: none !important; }
    @media (max-width: 768px) {
      #inspector3dCard { width: calc(100% - 20px); top: auto; bottom: 68px; max-height: 40vh; }
      .hud-hint { display: none; }
    }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>
        <span>${escapeHtml(project.name)}</span>
        <span class="badge">3D / 2D OFFLINE VIEWER</span>
      </h1>
      <div class="meta">HACHIHI Infrastructure Viewer · Tác giả: ${escapeHtml(project.author)} · Phiên bản: ${escapeHtml(project.version)}</div>
    </div>
    <div class="meta">${assets.length} Thiết bị · ${project.racks.length} Tủ Rack · ${project.cables.length} Tuyến cáp · ${project.floors.length} Tầng</div>
  </header>

  <div class="toolbar">
    <div id="controls3dGroup" class="btn-group${startIn3D ? '' : ' hidden'}">
      <button type="button" data-preset="iso" class="preset-btn active" title="Góc nhìn Isometric (Phím 1)">Isometric</button>
      <button type="button" data-preset="top" class="preset-btn" title="Chiếu bằng từ trên xuống (Phím 2)">Trên xuống</button>
      <button type="button" data-preset="front" class="preset-btn" title="Nhìn trực diện (Phím 3)">Trực diện</button>
      <button type="button" data-preset="back" class="preset-btn" title="Nhìn từ mặt sau (Phím 4)">Mặt sau</button>
      <button type="button" data-preset="left" class="preset-btn" title="Nhìn từ bên trái (Phím 5)">Bên trái</button>
      <button type="button" data-preset="right" class="preset-btn" title="Nhìn từ bên phải (Phím 6)">Bên phải</button>
      <button type="button" data-preset="backIso" class="preset-btn" title="Góc chéo phía sau">Chéo sau</button>
      <span class="divider"></span>
      <button type="button" id="btnAutoRotate" title="Tự động xoay ngang 360° (Phím R)">Xoay 360°</button>
      <button type="button" id="btn3dZoomIn" title="Phóng to">+</button>
      <button type="button" id="btn3dZoomOut" title="Thu nhỏ">-</button>
      <button type="button" id="btn3dFit" title="Đưa toàn bộ công trình vào giữa khung hình (Phím F)">Vừa khung</button>
      <button type="button" id="btn3dTheme">Nền tối / sáng</button>
    </div>

    <div id="controls2dGroup" class="btn-group${startIn3D ? ' hidden' : ''}">
      <button type="button" id="btnZoomIn">Phóng to (+)</button>
      <button type="button" id="btnZoomOut">Thu nhỏ (-)</button>
      <button type="button" id="btnReset">Vừa màn hình</button>
    </div>

    <span class="spacer"></span>

    <div class="btn-group">
      <button type="button" id="tab3D" class="${startIn3D ? 'active' : ''}">Không gian 3D</button>
      <button type="button" id="tabDiag" class="${startIn3D ? '' : 'active'}">Sơ đồ 2D</button>
      <button type="button" id="tabDevices">Thiết bị (${assets.length})</button>
      <button type="button" id="tabCables">Cáp nối (${project.cables.length})</button>
    </div>
  </div>

  <main>
    <div id="view3D" class="viewport-3d${startIn3D ? '' : ' hidden'}">
      <div id="canvas3dHost"></div>
      <div id="labels3dLayer" class="hidden"></div>

      <div id="hudTopLeft" class="hud-card">
        <span class="hud-title">Không gian 3D</span>
        <span id="hudCounts">${assets.length} thiết bị · ${project.racks.length} tủ Rack · ${project.cables.length} cáp</span>
        <span class="hud-hint">· Kéo trái: Xoay ngang/dọc 360° · Kéo phải: Di chuyển · Cuộn: Zoom · Nhấp đối tượng: Xem chi tiết</span>
      </div>

      <div id="xyzGizmoPanel" class="hud-card" title="Trục tọa độ XYZ (Nhấp X/Y/Z để chuyển hướng camera)">
        <span class="gizmo-cap">XYZ</span>
        <svg width="76" height="76" viewBox="0 0 76 76" style="overflow:visible">
          <circle cx="38" cy="38" r="30" fill="none" stroke="rgba(148,163,184,0.28)" stroke-width="1" />
          <g id="gizmoLayer">
            <g id="gizmoX" style="cursor:pointer">
              <line id="gizmoNegX" x1="38" y1="38" x2="26" y2="38" stroke="#ef4444" stroke-opacity="0.35" stroke-width="1.4" stroke-dasharray="2 2" stroke-linecap="round" />
              <line id="gizmoPosX" x1="38" y1="38" x2="60" y2="38" stroke="#ef4444" stroke-width="2.4" stroke-linecap="round" />
              <circle id="gizmoDotX" cx="60" cy="38" r="2.8" fill="#ef4444" />
              <text id="gizmoTxtX" x="68" y="41" fill="#ef4444" font-size="10" font-weight="700" text-anchor="middle">X</text>
            </g>
            <g id="gizmoY" style="cursor:pointer">
              <line id="gizmoNegY" x1="38" y1="38" x2="38" y2="50" stroke="#22c55e" stroke-opacity="0.35" stroke-width="1.4" stroke-dasharray="2 2" stroke-linecap="round" />
              <line id="gizmoPosY" x1="38" y1="38" x2="38" y2="16" stroke="#22c55e" stroke-width="2.4" stroke-linecap="round" />
              <circle id="gizmoDotY" cx="38" cy="16" r="2.8" fill="#22c55e" />
              <text id="gizmoTxtY" x="38" y="10" fill="#22c55e" font-size="10" font-weight="700" text-anchor="middle">Y</text>
            </g>
            <g id="gizmoZ" style="cursor:pointer">
              <line id="gizmoNegZ" x1="38" y1="38" x2="46" y2="29" stroke="#3b82f6" stroke-opacity="0.35" stroke-width="1.4" stroke-dasharray="2 2" stroke-linecap="round" />
              <line id="gizmoPosZ" x1="38" y1="38" x2="24" y2="53" stroke="#3b82f6" stroke-width="2.4" stroke-linecap="round" />
              <circle id="gizmoDotZ" cx="24" cy="53" r="2.8" fill="#3b82f6" />
              <text id="gizmoTxtZ" x="18" y="61" fill="#3b82f6" font-size="10" font-weight="700" text-anchor="middle">Z</text>
            </g>
          </g>
          <circle cx="38" cy="38" r="2.8" fill="#64748b" />
        </svg>
      </div>

      <div id="inspector3dCard" class="hud-card hidden">
        <div class="insp-head">
          <div>
            <div id="inspTitle" class="insp-title">Đối tượng</div>
            <div id="inspSub" class="insp-sub">Chi tiết kỹ thuật</div>
          </div>
          <button type="button" id="inspClose" class="insp-close" title="Đóng bảng chi tiết">×</button>
        </div>
        <div id="inspBody"></div>
        <button type="button" id="btnFocusObject">Hướng camera vào đây</button>
      </div>

      <div id="dockBottomLeft" class="hud-card">
        ${floorOptionsHtml ? `<label>Tầng: <select id="selFloor3d">${floorOptionsHtml}</select></label>` : ''}
        <label title="Điều chỉnh khoảng cách giãn tầng / lớp 3D">
          <span>Giãn tầng:</span>
          <input type="range" id="rngExplode3d" min="0" max="2" step="0.1" value="0" />
          <span id="valExplode3d">0.0</span>
        </label>
        <button type="button" id="togRooms3d" class="active">Phòng &amp; Tường</button>
        <button type="button" id="togCables3d" class="active">Dây cáp 3D</button>
        <button type="button" id="togAxes3d" class="active">Trục XYZ</button>
        <button type="button" id="togLabels3d">Nhãn tên</button>
      </div>

      <div id="webglFallback" class="hidden">
        <strong>Trình duyệt không hỗ trợ hoặc đã tắt WebGL 3D</strong>
        <span style="font-size:12px;color:#cbd5e1;max-width:460px;">Vui lòng mở tệp bằng trình duyệt hỗ trợ WebGL (Chrome, Edge, Firefox, Safari) hoặc chuyển sang tab Sơ đồ 2D để xem bản vẽ CAD.</span>
        <button type="button" id="btnFallback2D">Mở Sơ đồ 2D</button>
      </div>
    </div>

    <div id="viewDiag" class="viewport-2d${startIn3D ? ' hidden' : ''}">
      <div id="stage">${svgMarkup}</div>
    </div>

    <div id="viewDevices" class="tables hidden">
      <div class="table-bar">
        <h2 style="margin:0;font-size:16px;">Danh sách Thiết bị (${assets.length})</h2>
        <input id="filterDevices" class="search-input" type="search" placeholder="Tìm theo tên, mã TS, IP, model..." />
      </div>
      <table>
        <thead><tr><th>Mã TS</th><th>Tên</th><th>Loại</th><th>Model</th><th>IP</th><th>VLAN</th><th>Công suất</th></tr></thead>
        <tbody id="tbodyDevices">${deviceRowsHtml}</tbody>
      </table>
    </div>

    <div id="viewCables" class="tables hidden">
      <div class="table-bar">
        <h2 style="margin:0;font-size:16px;">Danh bạ Đấu nối Cáp (${project.cables.length})</h2>
        <input id="filterCables" class="search-input" type="search" placeholder="Tìm theo mã cáp, thiết bị nguồn/đích..." />
      </div>
      <table>
        <thead><tr><th>Mã cáp</th><th>Nguồn</th><th>Đích</th><th>Loại cáp</th><th>Băng thông</th><th>Dài (m)</th></tr></thead>
        <tbody id="tbodyCables">${cableRowsHtml}</tbody>
      </table>
    </div>
  </main>

  <footer>
    <span>${escapeHtml(APP_PRODUCT_NAME)} · Phiên bản ${escapeHtml(APP_VERSION)} (${escapeHtml(APP_BUILD_HASH)})</span>
    <span>${escapeHtml(BRAND_INFO.websiteLabel)} · Hotline: ${escapeHtml(BRAND_INFO.hotlineDisplay)}</span>
  </footer>

  <script type="application/json" id="hachihi-project-data">${embeddedProjectJson}</script>
  <script>${VIEWER_3D_RUNTIME_JS}</script>
  <script>
    (function(){
      var dataEl = document.getElementById('hachihi-project-data');
      var baseProject = dataEl ? JSON.parse(dataEl.textContent || '{}') : {};
      var startIn3D = ${startIn3D ? 'true' : 'false'};

      // --- 2D Pan & Zoom ---
      var stage = document.getElementById('stage');
      var vp2d = document.getElementById('viewDiag');
      var scale = 1, tx = 0, ty = 0, dragging2d = false, sx = 0, sy = 0;
      function apply2d(){ stage.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')'; }
      vp2d.addEventListener('mousedown', function(e){ dragging2d = true; sx = e.clientX - tx; sy = e.clientY - ty; });
      window.addEventListener('mousemove', function(e){ if(!dragging2d) return; tx = e.clientX - sx; ty = e.clientY - sy; apply2d(); });
      window.addEventListener('mouseup', function(){ dragging2d = false; });
      vp2d.addEventListener('wheel', function(e){
        e.preventDefault();
        scale = Math.min(6, Math.max(0.25, scale * (e.deltaY < 0 ? 1.12 : 0.89)));
        apply2d();
      }, { passive: false });
      document.getElementById('btnZoomIn').onclick = function(){ scale = Math.min(6, scale * 1.2); apply2d(); };
      document.getElementById('btnZoomOut').onclick = function(){ scale = Math.max(0.25, scale * 0.82); apply2d(); };
      document.getElementById('btnReset').onclick = function(){ scale = 1; tx = 0; ty = 0; apply2d(); };

      // --- Searchable BOM Tables ---
      function wireTableFilter(inputId, tbodyId){
        var inp = document.getElementById(inputId);
        var tb = document.getElementById(tbodyId);
        if(!inp || !tb) return;
        inp.addEventListener('input', function(){
          var q = (inp.value || '').toLowerCase().trim();
          var rows = tb.querySelectorAll('tr');
          for(var i = 0; i < rows.length; i++){
            var txt = (rows[i].textContent || '').toLowerCase();
            rows[i].style.display = !q || txt.indexOf(q) !== -1 ? '' : 'none';
          }
        });
      }
      wireTableFilter('filterDevices', 'tbodyDevices');
      wireTableFilter('filterCables', 'tbodyCables');

      // --- 3D Interactive Scene Engine ---
      var viewer3d = null;
      var view3dEl = document.getElementById('view3D');

      function escText(v){
        return String(v == null ? '' : v)
          .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      }

      function init3DViewer(){
        if(viewer3d) return;
        var Runtime = window.HachihiViewer3D;
        var host = document.getElementById('canvas3dHost');
        if(!Runtime || !host){
          document.getElementById('webglFallback').classList.remove('hidden');
          return;
        }
        var THREE = Runtime.THREE;
        var OrbitControls = Runtime.OrbitControls;
        var isSoftwareGl = Runtime.detectSoftwareGl();
        var renderer;
        try {
          renderer = new THREE.WebGLRenderer({
            antialias: !isSoftwareGl,
            powerPreference: isSoftwareGl ? 'low-power' : 'high-performance'
          });
        } catch (err) {
          document.getElementById('webglFallback').classList.remove('hidden');
          return;
        }

        var w = host.clientWidth || window.innerWidth || 1000;
        var h = host.clientHeight || 600;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : 2));
        renderer.setSize(w, h);
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.touchAction = 'none';
        host.innerHTML = '';
        host.appendChild(renderer.domElement);

        var state = {
          isDark: Boolean(baseProject.settings && baseProject.settings.isDarkMode),
          viewAllFloors: Array.isArray(baseProject.floors) && baseProject.floors.length > 1,
          activeFloorId: baseProject.activeFloorId || '',
          explodeSpread: 0,
          showRooms: true,
          showCables: true,
          showAxes: true,
          showLabels: false,
          autoRotate: false,
          activePreset: 'iso',
          selectedId: undefined,
          selectedType: undefined
        };

        function syncThemeClasses(){
          view3dEl.classList.toggle('theme-dark', state.isDark);
          var btnTheme = document.getElementById('btn3dTheme');
          if(btnTheme) btnTheme.textContent = state.isDark ? 'Nền sáng' : 'Nền tối';
        }
        syncThemeClasses();

        var scene = new THREE.Scene();
        var camera = new THREE.PerspectiveCamera(42, w / h, 0.2, 220);
        camera.position.set(13, 11.5, 13.5);

        var controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = !isSoftwareGl;
        controls.dampingFactor = 0.08;
        controls.maxPolarAngle = Math.PI / 2 - 0.03;
        controls.minPolarAngle = 0.04;
        controls.minDistance = 2.5;
        controls.maxDistance = 60;
        controls.autoRotateSpeed = 1.6;
        controls.target.set(0, 0.4, 0);
        controls.update();

        var studioRig = Runtime.setupStudioEnvironment(scene, renderer, state.isDark, isSoftwareGl);
        var shadowTex = Runtime.createContactShadowTexture();
        var lockBadgeTex = Runtime.createLockBadgeTexture();
        var worldRoot = new THREE.Group();
        worldRoot.name = 'infrastructure_world_root';
        scene.add(worldRoot);

        var axesGroup = Runtime.createWorldAxesHelper(2.6);
        axesGroup.visible = state.showAxes;
        scene.add(axesGroup);

        var worldBounds = { minX: -8, maxX: 8, minY: 0, maxY: 3, minZ: -6, maxZ: 6, centerX: 0, centerY: 0.4, centerZ: 0, size: 16 };
        var nodeGroups = new Map();
        var transitioning = false;
        var targetCamPos = new THREE.Vector3();
        var targetCtrlTarget = new THREE.Vector3();
        var rotMatrix = new THREE.Matrix4();
        var labelEls = [];
        var labelsLayer = document.getElementById('labels3dLayer');
        var labelProjVec = new THREE.Vector3();

        function syncLabelsOverlay(){
          if(!labelsLayer) return;
          if(!state.showLabels){
            labelsLayer.classList.add('hidden');
            return;
          }
          labelsLayer.classList.remove('hidden');
          var width = host.clientWidth || 1;
          var height = host.clientHeight || 1;
          var idx = 0;
          nodeGroups.forEach(function(entry){
            var pos = entry.group.position;
            var yOff = entry.node.type === 'rack' ? 2.45 : 0.95;
            labelProjVec.set(pos.x, pos.y + yOff, pos.z).project(camera);
            if(labelProjVec.z > 1 || labelProjVec.z < -1){
              return;
            }
            var sxPx = (labelProjVec.x * 0.5 + 0.5) * width;
            var syPx = (-labelProjVec.y * 0.5 + 0.5) * height;
            if(sxPx < -40 || sxPx > width + 40 || syPx < -20 || syPx > height + 40) return;

            var el = labelEls[idx];
            if(!el){
              el = document.createElement('div');
              el.className = 'label-3d-tag';
              labelsLayer.appendChild(el);
              labelEls.push(el);
            }
            el.style.display = 'block';
            el.style.left = sxPx.toFixed(1) + 'px';
            el.style.top = syPx.toFixed(1) + 'px';
            el.textContent = entry.node.label || entry.node.id;
            idx++;
          });
          for(var j = idx; j < labelEls.length; j++){
            labelEls[j].style.display = 'none';
          }
        }

        function updateCornerGizmo(){
          Runtime.extractCameraRotationMatrix(camera, rotMatrix);
          var projected = Runtime.projectCornerAxesFromCameraMatrix(rotMatrix, 38, 22, 9);
          var layer = document.getElementById('gizmoLayer');
          for(var i = 0; i < projected.length; i++){
            var item = projected[i];
            var grp = document.getElementById('gizmo' + item.axis);
            var posL = document.getElementById('gizmoPos' + item.axis);
            var negL = document.getElementById('gizmoNeg' + item.axis);
            var dot = document.getElementById('gizmoDot' + item.axis);
            var txt = document.getElementById('gizmoTxt' + item.axis);
            if(!grp || !posL || !negL || !dot || !txt) continue;
            posL.setAttribute('x2', item.px.toFixed(1));
            posL.setAttribute('y2', item.py.toFixed(1));
            negL.setAttribute('x2', item.nx.toFixed(1));
            negL.setAttribute('y2', item.ny.toFixed(1));
            dot.setAttribute('cx', item.px.toFixed(1));
            dot.setAttribute('cy', item.py.toFixed(1));
            txt.setAttribute('x', item.tx.toFixed(1));
            txt.setAttribute('y', (item.ty + 3.2).toFixed(1));
            grp.setAttribute('opacity', item.opacity.toFixed(2));
            if(layer) layer.appendChild(grp);
          }
        }

        var rafId = 0;
        var needsRender = true;
        var lastTime = performance.now();

        function scheduleFrame(){
          if(rafId !== 0) return;
          rafId = requestAnimationFrame(tick);
        }
        function requestRender(){
          needsRender = true;
          scheduleFrame();
        }

        function tick(now){
          rafId = 0;
          var dt = Math.min(0.1, Math.max(0.001, (now - lastTime) / 1000));
          lastTime = now;
          var stillAnimating = false;

          if(transitioning){
            var alpha = isSoftwareGl ? 1 : 1 - Math.exp(-9 * dt);
            camera.position.lerp(targetCamPos, alpha);
            controls.target.lerp(targetCtrlTarget, alpha);
            if(camera.position.distanceTo(targetCamPos) < 0.04 && controls.target.distanceTo(targetCtrlTarget) < 0.04){
              camera.position.copy(targetCamPos);
              controls.target.copy(targetCtrlTarget);
              transitioning = false;
            } else {
              stillAnimating = true;
            }
          }

          var dampingChanged = controls.update();
          if(needsRender || dampingChanged || stillAnimating || state.autoRotate){
            needsRender = false;
            renderer.render(scene, camera);
            updateCornerGizmo();
            syncLabelsOverlay();
          }

          if(stillAnimating || state.autoRotate || (controls.enableDamping && dampingChanged)){
            scheduleFrame();
          }
        }

        function computePose(preset){
          var cx = worldBounds.centerX, cy = worldBounds.centerY, cz = worldBounds.centerZ;
          var span = Math.max(12, worldBounds.size);
          var pos = new THREE.Vector3();
          var tgt = new THREE.Vector3(cx, cy, cz);
          if(preset === 'top'){
            pos.set(cx + 0.01, cy + span * 1.12, cz + 0.01);
          } else if(preset === 'front'){
            pos.set(cx, cy + span * 0.14, cz + span * 0.94);
          } else if(preset === 'back'){
            pos.set(cx, cy + span * 0.14, cz - span * 0.94);
          } else if(preset === 'left'){
            pos.set(cx - span * 0.94, cy + span * 0.14, cz + 0.01);
          } else if(preset === 'right'){
            pos.set(cx + span * 0.94, cy + span * 0.14, cz + 0.01);
          } else if(preset === 'backIso'){
            pos.set(cx - span * 0.72, cy + span * 0.56, cz - span * 0.76);
          } else {
            pos.set(cx + span * 0.72, cy + span * 0.56, cz + span * 0.76);
          }
          return { pos: pos, tgt: tgt };
        }

        function applyPreset(preset, immediate){
          state.activePreset = preset;
          var btns = document.querySelectorAll('.preset-btn');
          for(var i = 0; i < btns.length; i++){
            btns[i].classList.toggle('active', btns[i].getAttribute('data-preset') === preset);
          }
          var pose = computePose(preset);
          targetCamPos.copy(pose.pos);
          targetCtrlTarget.copy(pose.tgt);
          if(immediate){
            camera.position.copy(targetCamPos);
            controls.target.copy(targetCtrlTarget);
            controls.update();
            transitioning = false;
          } else {
            transitioning = true;
          }
          requestRender();
        }

        function rebuildWorld(reframe){
          var keepSet = new Set([shadowTex, lockBadgeTex]);
          Runtime.disposeObjectTree(worldRoot, keepSet);
          worldRoot.clear();

          var projForBuild = Object.assign({}, baseProject, {
            activeFloorId: state.activeFloorId || baseProject.activeFloorId,
            settings: Object.assign({}, baseProject.settings || {}, { isDarkMode: state.isDark })
          });

          var populated = Runtime.populateInfrastructure3DWorld(
            worldRoot,
            projForBuild,
            state.selectedId,
            {
              showRooms: state.showRooms,
              showCables: state.showCables,
              explodeSpread: state.explodeSpread,
              castShadow: !isSoftwareGl,
              shadowTex: shadowTex,
              lockBadgeTex: lockBadgeTex,
              viewAllFloors: state.viewAllFloors
            }
          );

          worldBounds = populated.bounds;
          nodeGroups = populated.nodeGroups;
          controls.maxDistance = Math.max(48, worldBounds.size * 2.8);
          camera.far = Math.max(180, worldBounds.size * 6);
          camera.updateProjectionMatrix();

          if(reframe){
            applyPreset(state.activePreset, true);
          } else {
            requestRender();
          }
        }

        rebuildWorld(true);

        controls.addEventListener('change', requestRender);
        controls.addEventListener('start', function(){ transitioning = false; });

        var ro = new ResizeObserver(function(){
          if(view3dEl.classList.contains('hidden')) return;
          var nw = host.clientWidth || 800;
          var nh = host.clientHeight || 500;
          camera.aspect = nw / nh;
          camera.updateProjectionMatrix();
          renderer.setSize(nw, nh);
          requestRender();
        });
        ro.observe(host);

        // --- Raycaster Click-to-Inspect ---
        var raycaster = new THREE.Raycaster();
        var pointerNdc = new THREE.Vector2();
        var downClient = null;
        var inspCard = document.getElementById('inspector3dCard');
        var inspTitle = document.getElementById('inspTitle');
        var inspSub = document.getElementById('inspSub');
        var inspBody = document.getElementById('inspBody');
        var focusedWorldPoint = null;

        function findRackBySelect(selectId, node){
          var racks = baseProject.racks || [];
          for(var i = 0; i < racks.length; i++){
            var r = racks[i];
            if(r.id === selectId || (node && node.customData && r.id === node.customData.rackId) || (node && r.name === node.label)){
              return r;
            }
          }
          return null;
        }

        function showInspectorForHit(picked){
          if(!picked){
            state.selectedId = undefined;
            state.selectedType = undefined;
            focusedWorldPoint = null;
            inspCard.classList.add('hidden');
            rebuildWorld(false);
            return;
          }
          state.selectedId = picked.selectId;
          state.selectedType = picked.selectType;
          focusedWorldPoint = picked.point.clone();

          if(picked.selectType === 'edge'){
            var cable = (baseProject.cables || []).find(function(c){ return c.id === picked.selectId; });
            if(!cable) return;
            var srcNode = (baseProject.nodes || []).find(function(n){ return n.id === cable.sourceNodeId; });
            var tgtNode = (baseProject.nodes || []).find(function(n){ return n.id === cable.targetNodeId; });
            inspTitle.textContent = cable.cableCode || 'Tuyến cáp';
            inspSub.textContent = (srcNode ? srcNode.label : 'Nguồn') + ' → ' + (tgtNode ? tgtNode.label : 'Đích');
            inspBody.innerHTML =
              '<div class="insp-grid">' +
              '<span class="k">Loại cáp</span><span class="v">' + escText(cable.cableType || '—') + '</span>' +
              '<span class="k">Băng thông</span><span class="v">' + escText(cable.bandwidth || '—') + '</span>' +
              '<span class="k">Chiều dài</span><span class="v">' + escText((cable.lengthMeters || 0) + ' m') + '</span>' +
              '<span class="k">Kiểu đi dây</span><span class="v">' + escText(cable.routingType || 'orthogonal') + '</span>' +
              '</div>';
            inspCard.classList.remove('hidden');
            rebuildWorld(false);
            return;
          }

          var entry = nodeGroups.get(picked.nodeId);
          var node = entry ? entry.node : (baseProject.nodes || []).find(function(n){ return n.id === picked.nodeId; });
          if(!node) return;
          if(entry){
            focusedWorldPoint.copy(entry.group.position);
            focusedWorldPoint.y += node.type === 'rack' ? 1.1 : 0.45;
          }
          var asset = node.assetId && baseProject.assets ? baseProject.assets[node.assetId] : null;
          var floorObj = (baseProject.floors || []).find(function(f){ return f.id === node.floorId; });

          if(picked.selectType === 'rack'){
            var rack = findRackBySelect(picked.selectId, node);
            var rackAssets = Object.values(baseProject.assets || {}).filter(function(a){ return rack && a.rackId === rack.id; });
            rackAssets.sort(function(a, b){ return (b.uPosition || 0) - (a.uPosition || 0); });
            var usedU = rackAssets.reduce(function(sum, a){ return sum + (a.uHeight || 1); }, 0);
            inspTitle.textContent = (rack && rack.name) || node.label || 'Tủ Rack';
            inspSub.textContent = 'Tủ Server Rack · ' + usedU + ' / ' + ((rack && rack.totalU) || 42) + 'U đang dùng';
            var html = '<div class="insp-grid">' +
              (floorObj ? '<span class="k">Tầng</span><span class="v">' + escText(floorObj.name) + '</span>' : '') +
              '<span class="k">Thiết bị trong tủ</span><span class="v">' + rackAssets.length + '</span>' +
              '</div>';
            if(rackAssets.length > 0){
              html += '<div class="insp-u-list">' + rackAssets.map(function(a){
                return '<div class="insp-u-item"><span><strong>U' + (a.uPosition || '?') + '</strong> · ' + escText(a.name) + '</span><span>' + escText(a.model || a.category || '') + '</span></div>';
              }).join('') + '</div>';
            }
            inspBody.innerHTML = html;
          } else {
            inspTitle.textContent = (asset && asset.name) || node.label || 'Thiết bị';
            inspSub.textContent = asset ? ((asset.vendor || '') + ' ' + (asset.model || '')).trim() || asset.category : node.type;
            inspBody.innerHTML =
              '<div class="insp-grid">' +
              (asset && asset.assetTag ? '<span class="k">Mã TS</span><span class="v">' + escText(asset.assetTag) + '</span>' : '') +
              (floorObj ? '<span class="k">Tầng</span><span class="v">' + escText(floorObj.name) + '</span>' : '') +
              (asset && asset.ipAddress ? '<span class="k">IP</span><span class="v">' + escText(asset.ipAddress) + '</span>' : '') +
              (asset && asset.vlan ? '<span class="k">VLAN</span><span class="v">' + escText(asset.vlan) + '</span>' : '') +
              (asset && asset.powerWatts ? '<span class="k">Công suất</span><span class="v">' + escText(asset.powerWatts + ' W') + '</span>' : '') +
              '<span class="k">Tọa độ CAD</span><span class="v">X:' + Math.round(node.x) + ' · Y:' + Math.round(node.y) + '</span>' +
              '</div>';
          }
          inspCard.classList.remove('hidden');
          rebuildWorld(false);
        }

        function pickAt(clientX, clientY){
          var rect = renderer.domElement.getBoundingClientRect();
          pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
          pointerNdc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
          raycaster.setFromCamera(pointerNdc, camera);
          var hits = raycaster.intersectObjects(worldRoot.children, true);
          for(var i = 0; i < hits.length; i++){
            var ud = hits[i].object.userData || {};
            if(ud.selectType === 'edge' && (ud.selectId || ud.cableId)){
              return { selectType: 'edge', selectId: String(ud.selectId || ud.cableId), nodeId: '', point: hits[i].point };
            }
            if(ud.selectType && ud.selectId && ud.nodeId){
              return { selectType: ud.selectType, selectId: String(ud.selectId), nodeId: String(ud.nodeId), point: hits[i].point };
            }
          }
          return null;
        }

        renderer.domElement.addEventListener('pointerdown', function(e){
          if(e.button === 0) downClient = { x: e.clientX, y: e.clientY };
          else downClient = null;
        });
        renderer.domElement.addEventListener('pointerup', function(e){
          if(!downClient || e.button !== 0) return;
          var dist = Math.hypot(e.clientX - downClient.x, e.clientY - downClient.y);
          downClient = null;
          if(dist <= 5){
            showInspectorForHit(pickAt(e.clientX, e.clientY));
          }
        });
        renderer.domElement.addEventListener('dblclick', function(e){
          var picked = pickAt(e.clientX, e.clientY);
          if(picked){
            showInspectorForHit(picked);
            if(focusedWorldPoint){
              var dir = camera.position.clone().sub(controls.target).normalize();
              targetCtrlTarget.copy(focusedWorldPoint);
              targetCamPos.copy(focusedWorldPoint).add(dir.multiplyScalar(5.5));
              targetCamPos.y = Math.max(focusedWorldPoint.y + 1.8, targetCamPos.y);
              transitioning = true;
              requestRender();
            }
          }
        });

        document.getElementById('inspClose').onclick = function(){ showInspectorForHit(null); };
        document.getElementById('btnFocusObject').onclick = function(){
          if(!focusedWorldPoint) return;
          var dir = camera.position.clone().sub(controls.target).normalize();
          targetCtrlTarget.copy(focusedWorldPoint);
          targetCamPos.copy(focusedWorldPoint).add(dir.multiplyScalar(5.2));
          targetCamPos.y = Math.max(focusedWorldPoint.y + 1.6, targetCamPos.y);
          transitioning = true;
          requestRender();
        };

        // --- Camera Toolbar & Keyboard Shortcuts ---
        var presetButtons = document.querySelectorAll('.preset-btn');
        for(var p = 0; p < presetButtons.length; p++){
          presetButtons[p].addEventListener('click', function(){
            applyPreset(this.getAttribute('data-preset'), false);
          });
        }
        document.getElementById('gizmoX').onclick = function(){ applyPreset('right', false); };
        document.getElementById('gizmoY').onclick = function(){ applyPreset('top', false); };
        document.getElementById('gizmoZ').onclick = function(){ applyPreset('front', false); };

        var btnAutoRotate = document.getElementById('btnAutoRotate');
        btnAutoRotate.onclick = function(){
          state.autoRotate = !state.autoRotate;
          controls.autoRotate = state.autoRotate;
          btnAutoRotate.classList.toggle('active-teal', state.autoRotate);
          requestRender();
        };

        document.getElementById('btn3dZoomIn').onclick = function(){
          transitioning = false;
          var dir = camera.position.clone().sub(controls.target);
          var d = Math.max(controls.minDistance, dir.length() * 0.78);
          camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(d));
          controls.update();
          requestRender();
        };
        document.getElementById('btn3dZoomOut').onclick = function(){
          transitioning = false;
          var dir = camera.position.clone().sub(controls.target);
          var d = Math.min(controls.maxDistance, dir.length() * 1.25);
          camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(d));
          controls.update();
          requestRender();
        };
        document.getElementById('btn3dFit').onclick = function(){ applyPreset(state.activePreset, false); };

        document.getElementById('btn3dTheme').onclick = function(){
          state.isDark = !state.isDark;
          syncThemeClasses();
          studioRig.updateTheme(state.isDark);
          rebuildWorld(false);
        };

        var selFloor = document.getElementById('selFloor3d');
        if(selFloor){
          selFloor.addEventListener('change', function(){
            var v = selFloor.value;
            if(v === '__ALL__'){
              state.viewAllFloors = true;
            } else {
              state.viewAllFloors = false;
              state.activeFloorId = v;
            }
            rebuildWorld(true);
          });
        }

        var rngExplode = document.getElementById('rngExplode3d');
        var valExplode = document.getElementById('valExplode3d');
        if(rngExplode){
          rngExplode.addEventListener('input', function(){
            state.explodeSpread = parseFloat(rngExplode.value) || 0;
            if(valExplode) valExplode.textContent = state.explodeSpread.toFixed(1);
            rebuildWorld(false);
          });
        }

        function wireToggle(btnId, key, onAfter){
          var btn = document.getElementById(btnId);
          if(!btn) return;
          btn.onclick = function(){
            state[key] = !state[key];
            btn.classList.toggle('active', Boolean(state[key]));
            if(onAfter) onAfter();
          };
        }
        wireToggle('togRooms3d', 'showRooms', function(){ rebuildWorld(false); });
        wireToggle('togCables3d', 'showCables', function(){ rebuildWorld(false); });
        wireToggle('togAxes3d', 'showAxes', function(){
          axesGroup.visible = state.showAxes;
          document.getElementById('xyzGizmoPanel').classList.toggle('hidden', !state.showAxes);
          requestRender();
        });
        wireToggle('togLabels3d', 'showLabels', function(){ syncLabelsOverlay(); });

        window.addEventListener('keydown', function(e){
          if(view3dEl.classList.contains('hidden')) return;
          if(e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
          if(e.key === '1') applyPreset('iso', false);
          else if(e.key === '2') applyPreset('top', false);
          else if(e.key === '3') applyPreset('front', false);
          else if(e.key === '4') applyPreset('back', false);
          else if(e.key === '5') applyPreset('left', false);
          else if(e.key === '6') applyPreset('right', false);
          else if(e.key === 'f' || e.key === 'F') applyPreset(state.activePreset, false);
          else if(e.key === 'r' || e.key === 'R') btnAutoRotate.click();
        });

        viewer3d = {
          resize: function(){
            var nw = host.clientWidth || 800;
            var nh = host.clientHeight || 500;
            camera.aspect = nw / nh;
            camera.updateProjectionMatrix();
            renderer.setSize(nw, nh);
            requestRender();
          }
        };
      }

      // --- Tab Switching ---
      var tabs = [
        { btn: 'tab3D', view: 'view3D', ctrl: 'controls3dGroup' },
        { btn: 'tabDiag', view: 'viewDiag', ctrl: 'controls2dGroup' },
        { btn: 'tabDevices', view: 'viewDevices', ctrl: null },
        { btn: 'tabCables', view: 'viewCables', ctrl: null }
      ];
      function showTab(targetBtn){
        for(var i = 0; i < tabs.length; i++){
          var t = tabs[i];
          var isMatch = t.btn === targetBtn;
          document.getElementById(t.view).classList.toggle('hidden', !isMatch);
          document.getElementById(t.btn).classList.toggle('active', isMatch);
          if(t.ctrl){
            document.getElementById(t.ctrl).classList.toggle('hidden', !isMatch);
          }
        }
        if(targetBtn === 'tab3D'){
          if(!viewer3d) init3DViewer();
          else viewer3d.resize();
        }
      }
      document.getElementById('tab3D').onclick = function(){ showTab('tab3D'); };
      document.getElementById('tabDiag').onclick = function(){ showTab('tabDiag'); };
      document.getElementById('tabDevices').onclick = function(){ showTab('tabDevices'); };
      document.getElementById('tabCables').onclick = function(){ showTab('tabCables'); };
      document.getElementById('btnFallback2D').onclick = function(){ showTab('tabDiag'); };

      if(startIn3D){
        init3DViewer();
      }
    })();
  </script>
</body>
</html>`;
}

export function exportProjectToHtmlViewer(
  project: ProjectState,
  options?: HtmlViewerExportOptions
) {
  const html = generateStandaloneViewerHtml(project, options);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const suffix = options?.contentScope === '3d' ? '_3D_Viewer.html' : '_Viewer.html';
  link.download = `${project.name.replace(/\s+/g, '_')}${suffix}`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
