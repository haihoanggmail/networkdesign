import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  STANDARD_RACK_UNITS,
  ServerRack,
  DeviceAsset,
  CableEdge
} from '../../types/infrastructure';
import {
  extractCameraRotationMatrix,
  projectCornerAxesFromCameraMatrix
} from '../../components/canvas/three/axisHelperProjection';
import {
  build3DCableCurve,
  build3DCableGeometry,
  canvasToWorldXZ,
  disposeObjectTree,
  getFloorElevationY,
  populateInfrastructure3DWorld,
  worldXZToCanvas
} from '../../components/canvas/three/proceduralDevices';
import {
  clampFloatingPosition,
  resolveEdgeOrFreeDrop
} from '../../hooks/useFloatingPanel';
import {
  canPlaceDeviceAtU,
  findNearestAvailableU,
  getRackStatistics,
  clampRackUnits,
  findContiguousFreeUBlocks,
  computeRackPduOutletSummary,
  isRackMountedTopologyShadowNode,
  layoutRackNodesForElevationMode
} from '../rackGeometry';
import {
  resolveCanonicalSelection,
  resolveInspectorTargets,
  resolve3DHighlightedIds,
  resolveSelectionFloorId,
  resolveTargetSelectionForAssetOrNode,
  shouldFocusInspectorOnSelectionChange
} from '../selectionSync';
import { analyzeRackAirflow } from '../rackAirflow';
import {
  getRackDimensions3D,
  uSlotToCenterY,
  UNIT_HEIGHT_M
} from '../../components/rack/rack3DGeometry';
import {
  migrateAndValidateProject,
  CURRENT_SCHEMA_VERSION,
  computeDetailedRevisionDiff,
  computeProjectChecksum,
  saveRecoverySnapshot,
  listRecoverySnapshots,
  loadLatestValidRecoverySnapshot,
  verifyRecoveryEnvelope,
  clearRecoverySnapshots,
  safeLoadFromStorage,
  RECOVERY_SNAPSHOTS_KEY,
  RECOVERY_STORAGE_KEY
} from '../projectStorage';
import { createSaveCoordinator } from '../saveCoordinator';
import {
  validateChatRequest,
  buildSystemInstruction
} from '../../server/chatValidation';
import {
  isOriginAllowed,
  extractTrustedClientIp,
  verifyOptionalChatSecret,
  classifyAndSanitizeAiError
} from '../../server/chatSecurity';
import {
  checkRateLimitShared,
  resetInMemoryRateLimitState,
  recordDailyTokenUsage
} from '../../server/chatRateLimit';
import { getAiRuntimeConfig } from '../../server/chatTypes';
import {
  runEngineeringAudit,
  buildIpVlanMatrix,
  detectL2SwitchingLoops,
  resolveUpsActiveWatts,
  parseAndApplyBulkStaticIpsCsv,
  collectFloorWallSegments,
  computeSegmentWallCrossings,
  estimateWifiRssiDbm
} from '../engineeringValidator';
import {
  computeCablePath,
  computeBundledCablePath,
  computeCableBundleLayout,
  estimateCableLengthMeters,
  computeRealTimeCableLengthBreakdown,
  normalizeReadableAngleDeg,
  resolveCableLabelTransform,
  CABLE_SIGNAL_COLOR_PRESETS,
  getDefaultCableColorForType,
  normalizeCableColor,
  computeAutoRoutedWaypoints,
  computeProjectCableSummary,
  computeOpticalLinkBudget
} from '../cableRouting';
import {
  BRAND_LOGO_OPTIONS,
  DEVICE_ICON_OPTIONS,
  ISOMETRIC_ICON_OPTIONS,
  getIsometricIconOption
} from '../deviceIcons';
import {
  generatePureSvgMarkup,
  computePureDiagramBounds,
  computeViewportDiagramBounds
} from '../svgExport';
import { generateProjectDxf } from '../dxfExporter';
import { generateStandaloneViewerHtml } from '../htmlViewerExporter';
import { importNetworkScannerData, diffMergeNetworkScannerData } from '../scannerImport';
import {
  DEFAULT_GRID_SNAP_THRESHOLD_PX,
  computeGridIntersectionSnap,
  computeRefined2DDragSnap,
  computeSmartSnap,
  computeSnapToGridAutoAlign,
  detectOverlappingNodes
} from '../snapGuides';
import { CANVAS_BACKGROUND_PRESETS, resolveCanvasAppearance } from '../canvasBackgrounds';
import {
  WORKSPACE_PRESETS,
  getWorkspacePresetMeta,
  computeNextHiddenLayersForPreset
} from '../workspacePresets';
import { DEVICE_CATALOG, searchDeviceCatalog } from '../../data/deviceCatalog';
import { buildProjectLegendData, computeLegendLayoutMetrics, computeRecommendedLegendSize } from '../legendGenerator';
import {
  ARCHITECTURE_TEMPLATES,
  createEnterpriseTopologyProject,
  createMultiFloorSampleOfficeProject,
  createServerRackProject
} from '../../data/templates';
import { createHachihi2BuildingProject } from '../../data/hachihi2BuildingTemplate';
import { syncAssetPortsWithCables } from '../../store/useProjectStore';
import {
  buildTechnicalPdfArtifact,
  computeA4ScaleMetrics,
  fitBoxPreserveAspectRatio
} from '../pdfExporter';
import { capture3DAnglesStrict, capture3DSnapshotStrict } from '../../services/export/capture3D';
import { runExportSvg } from '../../services/export/exportSvg';
import { runExportDxf } from '../../services/export/exportDxf';
import {
  parseSubnetMaskToPrefix,
  prefixToSubnetMask,
  validateIpPlanConfig,
  autoAssignTopologyIps
} from '../ipAutoAssign';
import {
  classifyPoeStandard,
  computeProjectPoeSummary,
  computeSwitchPoeBreakdown,
  isPoeConsumerDevice,
  isPseDevice,
  computeUpsBatteryRuntime,
  simulateBranchOutage
} from '../poeCalculator';
import {
  PACKAGE_FORMAT_TAG,
  PACKAGE_FORMAT_VERSION,
  createProjectPackage,
  inspectProjectImportPayload,
  cloneProjectForNewImport
} from '../projectPackage';
import { buildBomCsvContent, escapeBomCsvCell, formatBomTsvForClipboard } from '../bomCsvExporter';
import { computeProjectBomStats, optimizeCableSpools, compareProjectBoms } from '../bomAggregator';
import {
  resolveDeviceSkuAndPrice,
  resolveCableSkuAndPrice,
  saveBomPriceOverrides,
  loadBomPriceOverrides,
  clearBomPriceOverrides
} from '../bomPricingCatalog';
import { buildProjectExcelWorkbook, buildDetailedBomExcelWorkbook, parseExcelDevices } from '../excelService';
import {
  buildRouterTreeTemplateWorkbook,
  buildRouterTreeExportWorkbook,
  buildSampleRouterTreePreview,
  extractRouterTreeFromProject,
  parseRouterTreeExcelPayload,
  parseRouterTreeTextPayload,
  computeRouterTreeLayout,
  buildProjectFromRouterTree
} from '../excelTreeImporter';
import {
  LAYER_CATALOG,
  canAddDevicesInScene,
  canDragNodeIn3DScene,
  classifyDeviceLayer,
  computeAutoLayeringPlan,
  computeLayerObjectCounts,
  isNodeEffectivelyLocked,
  isNodePositionLocked,
  isRoomEffectivelyLocked,
  isCableEffectivelyLocked,
  isTrayEffectivelyLocked,
  resolveNodeLayer,
  resolveSelectableTargetForLayer
} from '../layerPolicy';
import {
  HELP_SUGGESTIONS,
  matchesAccentInsensitiveQuery,
  searchHelpCatalog,
  searchHelpShortcuts,
  stripVietnameseDiacritics
} from '../helpCatalog';
import {
  MAX_RECENT_ACTIONS,
  RecentActionEntry,
  ReplayableActionId,
  pushRecentAction
} from '../recentActions';
import { getDefaultShortcutKeymap } from '../../hooks/useKeyboardShortcuts';
import {
  APP_VERSION,
  BRAND_INFO,
  buildFeedbackFormUrl,
  formatFeedbackPrefillUrl,
  isFeedbackFormConfigured
} from '../../config/appInfo';
import {
  checkImportPayloadSize,
  isSafeSvgContent,
  MAX_IMPORT_JSON_BYTES,
  MAX_PROJECT_NODES,
  MAX_SCANNER_FILE_BYTES
} from '../security';
import type { CustomDevicePreset } from '../../data/deviceCatalog';
import type { ProjectRevision, ProjectState, ProjectSummary } from '../../types/infrastructure';

let passed = 0;

async function runTest(name: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

async function main() {
  // 1. Rack Geometry Tests
  await runTest('rackGeometry: supports standard rack units and clamps bounds', () => {
    assert.ok(STANDARD_RACK_UNITS.includes(6));
    assert.ok(STANDARD_RACK_UNITS.includes(42));
    assert.ok(STANDARD_RACK_UNITS.includes(45));
    assert.equal(clampRackUnits(2), 4);
    assert.equal(clampRackUnits(100), 60);
    assert.equal(clampRackUnits(27), 27);
  });

  await runTest('rackGeometry: isolates Front/Rear mounting & blocks multi-U collisions', () => {
    const rack: ServerRack = {
      id: 'rk_test',
      name: 'Test Rack 12U',
      totalUnits: 12,
      widthMm: 800,
      depthMm: 1000,
      maxLoadKg: 100,
      x: 100,
      y: 100,
      slots: { 5: 'srv_2u' },
      rearSlots: { 5: 'pdu_1u' }
    };

    const assets: Record<string, DeviceAsset> = {
      srv_2u: {
        id: 'srv_2u',
        name: 'Server-2U',
        category: 'server',
        vendor: 'Dell',
        model: 'R750',
        assetTag: 'AST-01',
        serialNumber: 'SN01',
        ipAddress: '10.0.0.10',
        subnetMask: '255.255.255.0',
        gateway: '10.0.0.1',
        macAddress: '00:11:22:33:44:55',
        vlan: '10',
        status: 'online',
        rackId: 'rk_test',
        rackUnitStart: 5,
        rackUnitHeight: 2,
        rackSide: 'front',
        powerWatts: 450,
        weightKg: 70,
        ports: []
      },
      pdu_1u: {
        id: 'pdu_1u',
        name: 'PDU-Rear',
        category: 'pdu',
        vendor: 'APC',
        model: 'AP8959',
        assetTag: 'AST-02',
        serialNumber: 'SN02',
        ipAddress: '10.0.0.11',
        subnetMask: '255.255.255.0',
        gateway: '10.0.0.1',
        macAddress: '00:11:22:33:44:56',
        vlan: '10',
        status: 'online',
        rackId: 'rk_test',
        rackUnitStart: 5,
        rackUnitHeight: 1,
        rackSide: 'rear',
        powerWatts: 50,
        weightKg: 45,
        ports: []
      }
    };

    // Front slots 5 & 6 are occupied by srv_2u
    assert.equal(canPlaceDeviceAtU(rack, assets, 5, 1, undefined, 'front'), false);
    assert.equal(canPlaceDeviceAtU(rack, assets, 6, 1, undefined, 'front'), false);
    assert.equal(canPlaceDeviceAtU(rack, assets, 4, 2, undefined, 'front'), false); // overlaps U5
    assert.equal(canPlaceDeviceAtU(rack, assets, 3, 2, undefined, 'front'), true);  // U3-U4 free
    assert.equal(canPlaceDeviceAtU(rack, assets, 7, 1, undefined, 'front'), true);  // U7 free

    // Rear side U6 is free even though Front U6 is occupied
    assert.equal(canPlaceDeviceAtU(rack, assets, 6, 1, undefined, 'rear'), true);
    assert.equal(canPlaceDeviceAtU(rack, assets, 5, 1, undefined, 'rear'), false);

    // Nearest free U near 5 for 2U on front should jump to U7 or U3
    const nearest = findNearestAvailableU(rack, assets, 5, 2, undefined, 'front');
    assert.ok(nearest === 7 || nearest === 3);

    // Statistics: 2U front, 1U rear, total 70 + 45 = 115kg (>100kg overweight)
    const stats = getRackStatistics(rack, assets);
    assert.equal(stats.frontUsedUnits, 2);
    assert.equal(stats.frontFreeUnits, 10);
    assert.equal(stats.rearUsedUnits, 1);
    assert.equal(stats.totalPowerWatts, 500);
    assert.equal(stats.isOverweight, true);
    assert.equal(stats.overflowItems.length, 0);

    // Overflow detection
    rack.slots[12] = 'srv_2u'; // 2U starting at U12 exceeds 12U
    const overflowStats = getRackStatistics(rack, assets);
    assert.ok(overflowStats.overflowItems.length > 0);
  });

  // 2. Project Storage Migration & Validation Tests
  await runTest('projectStorage: migrates V3 template cleanly and rejects corrupt JSON', () => {
    const rackProject = createServerRackProject();
    const legacyV3Payload = {
      ...rackProject,
      schemaVersion: undefined,
      racks: rackProject.racks.map(r => {
        const clone = { ...r } as Record<string, unknown>;
        delete clone.rearSlots;
        return clone;
      })
    };

    const migrated = migrateAndValidateProject(legacyV3Payload);
    assert.equal(migrated.ok, true);
    if (migrated.ok) {
      assert.equal(migrated.project.schemaVersion, CURRENT_SCHEMA_VERSION);
      assert.equal(migrated.project.racks.length, rackProject.racks.length);
      assert.ok(migrated.project.racks.every(r => typeof r.rearSlots === 'object'));
      assert.equal(Object.keys(migrated.project.assets).length, Object.keys(rackProject.assets).length);
    }

    assert.equal(migrateAndValidateProject(null).ok, false);
    assert.equal(migrateAndValidateProject({ foo: 'bar' }).ok, false);
    assert.equal(migrateAndValidateProject({ assets: {}, nodes: 'not-an-array' }).ok, false);
  });

  // 3. ExcelJS Export & Round-Trip Import Tests
  await runTest('excelService: builds 6 worksheets and parses xlsx/csv round-trip', async () => {
    const enterprise = createEnterpriseTopologyProject();
    const wb = buildProjectExcelWorkbook(enterprise);
    const sheetNames = wb.worksheets.map(s => s.name);

    assert.equal(sheetNames.length, 6);
    assert.deepEqual(sheetNames, [
      'Tong_Quan',
      'BOM_Vat_Tu',
      'Danh_Sach_Thiet_Bi',
      'Ket_Noi_Cap',
      'Tu_Rack_Chi_Tiet',
      'Theo_Khu_Vuc'
    ]);

    const buffer = await wb.xlsx.writeBuffer();
    const file = new File([buffer], 'roundtrip.xlsx', {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    const parsed = await parseExcelDevices(file, enterprise);
    assert.ok(parsed.importedCount > 0);
    assert.ok(Object.keys(parsed.newAssets).length > Object.keys(enterprise.assets).length);

    const csv = [
      'Mã Tài Sản (Asset Tag),Tên Thiết Bị,Loại Thiết Bị,Hãng Sản Xuất,Model,Địa Chỉ IP,VLAN,Công Suất (W)',
      'AST-9001,SW-EDGE-TEST,switch,Aruba,CX6100,10.20.30.40,20,120'
    ].join('\n');
    const csvFile = new File([csv], 'devices.csv', { type: 'text/csv' });
    const parsedCsv = await parseExcelDevices(csvFile, enterprise);
    assert.equal(parsedCsv.importedCount, 1);
  });

  // 4. Engineering Validator & IP/VLAN Matrix Tests
  await runTest('engineeringValidator: detects duplicate IP, port conflict, VLAN mismatch, rack overload & builds matrix', () => {
    const base = createEnterpriseTopologyProject();
    const nodeIds = base.nodes.filter(n => n.assetId).map(n => n.id);
    assert.ok(nodeIds.length >= 2);

    const n1 = base.nodes.find(n => n.id === nodeIds[0])!;
    const n2 = base.nodes.find(n => n.id === nodeIds[1])!;
    const a1 = base.assets[n1.assetId!];
    const a2 = base.assets[n2.assetId!];

    // Force duplicate IP + VLAN mismatch
    a1.ipAddress = '192.168.99.99';
    a2.ipAddress = '192.168.99.99';
    a1.vlan = '10';
    a2.vlan = '20';

    // Force port conflict on n1:port_1
    const c1: CableEdge = {
      id: 'cab_test_1',
      cableCode: 'TST-01',
      diagramMode: 'topology',
      sourceNodeId: n1.id,
      targetNodeId: n2.id,
      sourcePortId: 'port_1',
      targetPortId: 'port_1',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#2563eb',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 15,
      status: 'active'
    };
    const c2: CableEdge = {
      ...c1,
      id: 'cab_test_2',
      cableCode: 'TST-02',
      targetPortId: 'port_2'
    };
    base.cables.push(c1, c2);

    const report = runEngineeringAudit(base);
    assert.ok(report.issues.some(i => i.category === 'ip'));
    assert.ok(report.issues.some(i => i.category === 'port'));
    assert.ok(report.issues.some(i => i.category === 'vlan'));
    assert.ok(report.summary.errorCount >= 2);

    const matrix = buildIpVlanMatrix(base);
    const dupRows = matrix.filter(r => r.ipAddress === '192.168.99.99');
    assert.equal(dupRows.length, 2);
    assert.ok(dupRows.every(r => r.duplicateIp === true));
  });

  // 5. Cable Routing Tests
  await runTest('cableRouting: computes straight, orthogonal, 1-point quadratic & multi-point Catmull-Rom curves', () => {
    const r1 = { x: 0, y: 0, width: 100, height: 40 };
    const r2 = { x: 300, y: 200, width: 100, height: 40 };

    const straight: CableEdge = {
      id: 'c1', cableCode: 'C1', diagramMode: 'topology', sourceNodeId: 'a', targetNodeId: 'b',
      cableType: 'CAT6_UTP', bandwidth: '1G', color: '#000', routingType: 'straight',
      lineStyle: 'solid', strokeWidth: 2, lengthMeters: 15, status: 'active'
    };
    const sRes = computeCablePath(straight, r1, r2);
    assert.equal(sRes.d, 'M 50 20 L 350 220');

    const ortho: CableEdge = { ...straight, routingType: 'orthogonal' };
    const oRes = computeCablePath(ortho, r1, r2);
    assert.ok(oRes.d.includes('200 20'));

    const quad: CableEdge = { ...straight, routingType: 'curved', controlPoints: [{ x: 200, y: 40 }] };
    const qRes = computeCablePath(quad, r1, r2);
    assert.ok(qRes.d.includes(' Q '));

    const spline: CableEdge = {
      ...straight,
      routingType: 'curved',
      controlPoints: [{ x: 150, y: 50 }, { x: 260, y: 180 }]
    };
    const cRes = computeCablePath(spline, r1, r2);
    assert.ok(cRes.d.includes(' C '));

    const meters = estimateCableLengthMeters(straight, r1, r2, 30, 1.15);
    assert.ok(meters >= 10);
  });

  // 5b. Cable Bundle Grouping & Export Parity Tests
  await runTest('cableRouting: groups bidirectional & shared-corridor cables into non-overlapping bundles', () => {
    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
      node_a: { x: 100, y: 100, width: 64, height: 64 },
      node_b: { x: 460, y: 180, width: 64, height: 64 },
      node_c: { x: 105, y: 380, width: 64, height: 64 }
    };
    const getRect = (id: string) => boxes[id] || null;

    const baseCable: Omit<CableEdge, 'id' | 'cableCode' | 'sourceNodeId' | 'targetNodeId'> = {
      diagramMode: 'topology',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#2563eb',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 20,
      status: 'active'
    };

    const cables: CableEdge[] = [
      { ...baseCable, id: 'c_1', cableCode: 'LAN-01', sourceNodeId: 'node_a', targetNodeId: 'node_b', routingType: 'orthogonal' },
      { ...baseCable, id: 'c_2', cableCode: 'LAN-02', sourceNodeId: 'node_b', targetNodeId: 'node_a', routingType: 'orthogonal' },
      { ...baseCable, id: 'c_3', cableCode: 'LAN-03', sourceNodeId: 'node_a', targetNodeId: 'node_b', routingType: 'curved', bandwidth: '10G' },
      { ...baseCable, id: 'c_single', cableCode: 'LAN-99', sourceNodeId: 'node_a', targetNodeId: 'node_c', routingType: 'straight' },
      {
        ...baseCable,
        id: 'c_manual',
        cableCode: 'LAN-MAN',
        sourceNodeId: 'node_a',
        targetNodeId: 'node_b',
        routingType: 'straight',
        controlPoints: [{ x: 280, y: 40 }]
      }
    ];

    const layout = computeCableBundleLayout(cables, getRect);
    assert.equal(layout.bundles.length, 1);
    const bundle = layout.bundles[0];
    assert.equal(bundle.cables.length, 3);
    assert.equal(bundle.totalMeters, 60);
    assert.ok(bundle.summaryLabel.includes('×3 Cáp'));

    // Orthogonal & curved strands inside the bundle must have distinct midPoints and symmetric offsets
    const p1 = layout.cablePaths.get('c_1')!;
    const p2 = layout.cablePaths.get('c_2')!;
    const p3 = layout.cablePaths.get('c_3')!;
    assert.notEqual(p1.midPoint.x, p2.midPoint.x);
    assert.notEqual(p2.d, p3.d);
    assert.equal(layout.cableOffsets.get('c_2'), 0); // Middle strand of 3
    assert.ok((layout.cableOffsets.get('c_1') || 0) < 0);
    assert.ok((layout.cableOffsets.get('c_3') || 0) > 0);

    // Straight bundled helper separates parallel strands along canonical normal
    const sPos = computeBundledCablePath(
      { ...cables[3], sourceNodeId: 'node_a', targetNodeId: 'node_b' },
      boxes.node_a,
      boxes.node_b,
      8,
      bundle.normal
    );
    const sNeg = computeBundledCablePath(
      { ...cables[3], sourceNodeId: 'node_a', targetNodeId: 'node_b' },
      boxes.node_a,
      boxes.node_b,
      -8,
      bundle.normal
    );
    assert.notEqual(sPos.midPoint.y, sNeg.midPoint.y);

    // Single cable and cable with manual controlPoints remain unbundled
    assert.equal(layout.cableToBundleId.has('c_single'), false);
    assert.equal(layout.cableOffsets.get('c_single'), 0);
    assert.equal(layout.cableToBundleId.has('c_manual'), false);
    assert.equal(layout.cableOffsets.get('c_manual'), 0);

    // SVG export renders consolidated bundle summary label and suppresses individual bundled badges
    const proj = createEnterpriseTopologyProject();
    const firstTwoNodes = proj.nodes.filter(n => n.type !== 'rack').slice(0, 2);
    assert.equal(firstTwoNodes.length, 2);
    proj.settings.showCableCodes = true;
    proj.cables = [
      {
        ...baseCable,
        id: 'exp_b1',
        cableCode: 'MEMBER-ALPHA',
        sourceNodeId: firstTwoNodes[0].id,
        targetNodeId: firstTwoNodes[1].id,
        routingType: 'straight'
      },
      {
        ...baseCable,
        id: 'exp_b2',
        cableCode: 'MEMBER-BETA',
        sourceNodeId: firstTwoNodes[1].id,
        targetNodeId: firstTwoNodes[0].id,
        routingType: 'straight'
      }
    ];
    const bundledSvg = generatePureSvgMarkup(proj, { darkTheme: false, includeTitleBlock: false });
    assert.ok(bundledSvg.includes('×2 Cáp'));
    assert.equal(bundledSvg.includes('MEMBER-ALPHA'), false);
    assert.equal(bundledSvg.includes('MEMBER-BETA'), false);
  });

  // 6. Pure SVG, DXF, HTML Viewer, NetworkScanner Import Tests
  await runTest('exporters & scanner: Pure SVG (no foreignObject), DXF CAD, HTML Viewer & NetworkScanner import', () => {
    const enterprise = createEnterpriseTopologyProject();
    const bounds = computePureDiagramBounds(enterprise);
    assert.ok(bounds.width >= 480 && bounds.height >= 360);

    const svg = generatePureSvgMarkup(enterprise, { darkTheme: false, includeTitleBlock: true });
    assert.ok(svg.startsWith('<svg '));
    assert.equal(svg.includes('<foreignObject'), false);

    const dxf = generateProjectDxf(enterprise);
    assert.ok(dxf.includes('ENTITIES'));
    assert.ok(dxf.includes('ROOMS'));
    assert.ok(dxf.includes('DEVICES'));
    assert.ok(dxf.includes('CABLES'));
    assert.ok(dxf.trim().endsWith('EOF'));

    const html = generateStandaloneViewerHtml(enterprise);
    assert.ok(html.includes('<!doctype html>'));
    assert.ok(html.includes(enterprise.name));
    assert.ok(html.includes('<svg '));

    const scanJson = JSON.stringify({
      hosts: [
        { ip: '172.16.1.1', hostname: 'CORE-RTR-01', vendor: 'MikroTik', type: 'router', vlan: 1 },
        { ip: '172.16.1.10', hostname: 'SW-ACC-01', vendor: 'Cisco', type: 'switch', gateway: '172.16.1.1', vlan: 10 },
        { ip: '172.16.1.21', hostname: 'CAM-GATE-01', vendor: 'Hikvision', type: 'camera', uplinkIp: '172.16.1.10', vlan: 20 },
        { ip: '172.16.1.31', hostname: 'AP-LOBBY-01', vendor: 'Ubiquiti', type: 'ap', uplinkIp: '172.16.1.10', vlan: 10 }
      ]
    });
    const imported = importNetworkScannerData(scanJson, enterprise);
    assert.equal(imported.importedCount, 4);
    assert.ok(imported.cables.length >= enterprise.cables.length + 2);
  });

  // 7. Smart Alignment Guides (Nodes + Container Edges) & Canvas Background Tests
  await runTest('snapGuides & canvasBackgrounds: aligns horizontally/vertically with nodes & containers and renders SVG background presets', () => {
    const dragged = { x: 204, y: 153, width: 100, height: 50 };
    const targets = [
      { id: 'node_other', x: 200, y: 320, width: 160, height: 50, sourceKind: 'node' as const, label: 'Switch-01' },
      { id: 'room_container', x: 50, y: 150, width: 420, height: 300, sourceKind: 'container' as const, label: 'Server Room' }
    ];

    const res = computeSmartSnap(dragged, targets, 8);
    assert.equal(res.dx, -4); // snaps left edge x=204 -> x=200 of node_other
    assert.equal(res.dy, -3); // snaps top edge y=153 -> y=150 of room_container
    assert.equal(res.guides.length, 2);

    const vGuide = res.guides.find(g => g.orientation === 'vertical');
    const hGuide = res.guides.find(g => g.orientation === 'horizontal');
    assert.ok(vGuide);
    assert.ok(hGuide);
    assert.equal(vGuide.pos, 200);
    assert.equal(vGuide.kind, 'edge');
    assert.equal(vGuide.sourceKind, 'node');
    assert.equal(hGuide.pos, 150);
    assert.equal(hGuide.kind, 'edge');
    assert.equal(hGuide.sourceKind, 'container');

    // Center alignment with container centerline (x=260, y=300)
    const centerRes = computeSmartSnap({ x: 212, y: 278, width: 100, height: 50 }, targets, 8);
    const vCenter = centerRes.guides.find(g => g.orientation === 'vertical');
    const hCenter = centerRes.guides.find(g => g.orientation === 'horizontal');
    assert.equal(vCenter?.kind, 'center');
    assert.equal(vCenter?.pos, 260);
    assert.equal(hCenter?.kind, 'center');
    assert.equal(hCenter?.pos, 300);

    // Canvas Background presets & SVG parity
    const blueprint = CANVAS_BACKGROUND_PRESETS.find(p => p.id === 'blueprint_blue');
    assert.ok(blueprint);
    const proj = createEnterpriseTopologyProject();
    proj.settings.backgroundPreset = blueprint.id;
    proj.settings.backgroundColor = blueprint.backgroundColor;
    proj.settings.backgroundPattern = blueprint.pattern;
    proj.settings.showGrid = true;

    const appearance = resolveCanvasAppearance(proj.settings);
    assert.equal(appearance.backgroundColor, '#0f294a');
    assert.equal(appearance.isDarkCanvas, true);
    assert.equal(appearance.pattern, 'lines');

    const bpSvg = generatePureSvgMarkup(proj, { includeTitleBlock: false });
    assert.ok(bpSvg.includes('#0f294a'));
    assert.ok(bpSvg.includes('<path d="M '));
  });

  // 8. Custom Cable Colors, Signal Presets, Brand Logos & SVG Export Parity Tests
  await runTest('cableColors & deviceIcons: normalizes colors, tracks distinct bundle colors, and exports custom cable/shape/logo SVG', () => {
    assert.equal(normalizeCableColor('  #EC4899  '), '#ec4899');
    assert.equal(normalizeCableColor('invalid-color', '#0284c7'), '#0284c7');
    assert.equal(getDefaultCableColorForType('POWER_AC'), '#dc2626');
    assert.equal(getDefaultCableColorForType('FIBER_SM_OS2'), '#f59e0b');
    assert.ok(CABLE_SIGNAL_COLOR_PRESETS.length >= 8);
    assert.ok(DEVICE_ICON_OPTIONS.length >= 20);
    assert.ok(BRAND_LOGO_OPTIONS.length >= 12);

    const boxes: Record<string, { x: number; y: number; width: number; height: number }> = {
      n1: { x: 100, y: 100, width: 120, height: 60 },
      n2: { x: 420, y: 120, width: 120, height: 60 }
    };
    const bundleLayout = computeCableBundleLayout(
      [
        {
          id: 'cb_red',
          cableCode: 'PWR-01',
          diagramMode: 'topology',
          sourceNodeId: 'n1',
          targetNodeId: 'n2',
          cableType: 'POWER_AC',
          bandwidth: '1G',
          color: '#dc2626',
          routingType: 'straight',
          lineStyle: 'solid',
          strokeWidth: 2,
          lengthMeters: 10,
          status: 'active'
        },
        {
          id: 'cb_pink',
          cableCode: 'HA-01',
          diagramMode: 'topology',
          sourceNodeId: 'n1',
          targetNodeId: 'n2',
          cableType: 'DAC_10G',
          bandwidth: '10G',
          color: '#ec4899',
          routingType: 'straight',
          lineStyle: 'solid',
          strokeWidth: 2,
          lengthMeters: 10,
          status: 'active'
        }
      ],
      id => boxes[id] || null
    );
    assert.equal(bundleLayout.bundles.length, 1);
    assert.deepEqual(bundleLayout.bundles[0].distinctColors.sort(), ['#dc2626', '#ec4899']);

    const proj = createEnterpriseTopologyProject();
    const targetNode = proj.nodes.find(n => n.type !== 'rack')!;
    targetNode.width = 180;
    targetNode.height = 120;
    targetNode.style.shape = 'circle';
    targetNode.customIcon = 'logo_cisco';
    targetNode.customImageUrl = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
    proj.cables[0].color = '#ec4899';

    const svg = generatePureSvgMarkup(proj, { includeTitleBlock: false });
    assert.ok(svg.includes('#ec4899'));
    assert.ok(svg.includes('data:image/svg+xml;base64'));
    assert.ok(svg.includes('rx="90"'));
  });

  // 9. Snap-to-Grid Auto-Align & Isometric 2D Icon Library Tests
  await runTest('snapGuides & isometricIcons: auto-aligns multi-node horizontal/vertical on grid & resolves isometric icons', () => {
    const nodes = [
      { id: 'n1', x: 113, y: 127, width: 80, height: 60 },
      { id: 'n2', x: 254, y: 189, width: 80, height: 60 },
      { id: 'n3', x: 182, y: 155, width: 80, height: 60, locked: true }
    ];

    const hRes = computeSnapToGridAutoAlign(nodes, 'horizontal', 20, { evenSpacing: true });
    assert.equal(hRes.has('n3'), false); // locked node untouched
    const hn1 = hRes.get('n1')!;
    const hn2 = hRes.get('n2')!;
    assert.equal(hn1.y % 20, 0);
    assert.equal(hn2.y % 20, 0);
    assert.equal(hn1.y, hn2.y); // aligned onto same horizontal row
    assert.equal(hn1.x % 20, 0);
    assert.equal(hn2.x % 20, 0);
    assert.ok(hn2.x >= hn1.x + 80); // non-overlapping grid spacing

    const vRes = computeSnapToGridAutoAlign(nodes, 'vertical', 20, { evenSpacing: true });
    const vn1 = vRes.get('n1')!;
    const vn2 = vRes.get('n2')!;
    assert.equal(vn1.x, vn2.x); // aligned onto same vertical column
    assert.equal(vn1.x % 20, 0);
    assert.equal(vn1.y % 20, 0);
    assert.equal(vn2.y % 20, 0);
    assert.ok(vn2.y >= vn1.y + 60);

    const gridOnly = computeSnapToGridAutoAlign(nodes, 'grid-only', 20);
    assert.deepEqual(gridOnly.get('n1'), { x: 120, y: 120 });
    assert.deepEqual(gridOnly.get('n2'), { x: 260, y: 180 });

    assert.equal(ISOMETRIC_ICON_OPTIONS.length, 5);
    assert.ok(getIsometricIconOption('iso_switch_network'));
    assert.ok(getIsometricIconOption('iso_patch_panel'));
    assert.ok(getIsometricIconOption('iso_ups_unit'));
    assert.ok(getIsometricIconOption('iso_router_firewall'));
    assert.ok(getIsometricIconOption('iso_server_rack'));

    const proj = createEnterpriseTopologyProject();
    const firstNode = proj.nodes.find(n => n.type !== 'rack')!;
    firstNode.customImageUrl = undefined;
    firstNode.customIcon = 'iso_switch_network';
    const isoSvg = generatePureSvgMarkup(proj, { includeTitleBlock: false });
    assert.ok(isoSvg.includes('SWITCH'));
  });

  // 10. Legend Generator & Direct Cable Text Label Export Tests
  await runTest('legendGenerator & cableLabels: aggregates components/icons/cables, persists custom labels & exports SVG/DXF', () => {
    const proj = createEnterpriseTopologyProject();
    const deviceNodes = proj.nodes.filter(n => n.type !== 'rack' && n.type !== 'legend');
    assert.ok(deviceNodes.length >= 2);
    deviceNodes[0].customIcon = 'logo_cisco';
    deviceNodes[1].customImageUrl = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';

    // Assign a full-length custom text label to a non-bundled cable
    const firstNonBundledCable = proj.cables[0];
    assert.ok(firstNonBundledCable);
    firstNonBundledCable.label = 'Uplink-10G-Core-VLAN20';
    proj.cables = [firstNonBundledCable];
    proj.settings.showCableCodes = false; // custom cable label should still render even when cableCode badge toggle is off

    const legendData = buildProjectLegendData(proj, {
      scope: 'all',
      includeCables: true,
      title: 'CHÚ GIẢI HỆ THỐNG MẠNG'
    });
    assert.equal(legendData.totalDevices, proj.nodes.filter(n => n.type !== 'legend' && n.type !== 'text').length);
    assert.equal(legendData.totalCables, 1);
    assert.ok(legendData.components.some(c => c.customIcon === 'logo_cisco'));
    assert.ok(legendData.components.some(c => c.customImageUrl?.startsWith('data:image/svg+xml')));
    assert.ok(legendData.cables.length >= 1);

    const recSize = computeRecommendedLegendSize(legendData);
    assert.ok(recSize.width >= 300 && recSize.height >= 150);

    // Place legend node on canvas and verify pure SVG & DXF output + storage migration preservation
    proj.nodes.push({
      id: 'node_legend_test',
      diagramMode: proj.activeMode,
      floorId: proj.activeFloorId,
      type: 'legend',
      label: 'CHÚ GIẢI HỆ THỐNG MẠNG',
      x: 900,
      y: 80,
      width: recSize.width,
      height: recSize.height,
      rotation: 0,
      style: {
        backgroundColor: '#ffffff',
        borderColor: '#1d4ed8',
        borderWidth: 2,
        borderStyle: 'solid',
        opacity: 1
      },
      customData: {
        legendScope: 'all',
        legendIncludeCables: true,
        legendTitle: 'CHÚ GIẢI HỆ THỐNG MẠNG'
      }
    });

    const migrated = migrateAndValidateProject(proj);
    assert.equal(migrated.ok, true);
    if (!migrated.ok) throw new Error('Expected valid migration');
    const savedLegend = migrated.project.nodes.find(n => n.type === 'legend');
    assert.ok(savedLegend);
    assert.equal(savedLegend.customData?.legendTitle, 'CHÚ GIẢI HỆ THỐNG MẠNG');
    assert.equal(migrated.project.cables[0].label, 'Uplink-10G-Core-VLAN20');

    const svg = generatePureSvgMarkup(migrated.project, { includeTitleBlock: false });
    assert.equal(svg.includes('<foreignObject'), false);
    assert.ok(svg.includes('CHÚ GIẢI HỆ THỐNG MẠNG'));
    assert.ok(svg.includes('Uplink-10G-Core-VLAN20'));

    const dxf = generateProjectDxf(migrated.project);
    assert.ok(dxf.includes('Uplink-10G-Core-VLAN20'));
  });

  // 11. Overlap Warning Detection & Real-Time Cable Length Calculation Tests
  await runTest('snapGuides & cableRouting: detects node overlaps (ignoring adjacent edge-touch) & calculates real-time cable length breakdown', () => {
    const overlapCheck = detectOverlappingNodes([
      { id: 'n_a', x: 100, y: 100, width: 120, height: 80 },
      { id: 'n_b', x: 180, y: 140, width: 100, height: 60 }, // overlaps n_a by 40x40
      { id: 'n_touch', x: 220, y: 100, width: 80, height: 35 } // touches n_a right edge (x=220), no overlap with n_b (y+h=135 < 140)
    ]);
    assert.equal(overlapCheck.overlappingNodeIds.has('n_a'), true);
    assert.equal(overlapCheck.overlappingNodeIds.has('n_b'), true);
    assert.equal(overlapCheck.overlappingNodeIds.has('n_touch'), false);
    assert.equal(overlapCheck.pairs.length, 1);
    assert.deepEqual(overlapCheck.pairs[0].overlapRect, { x: 180, y: 140, width: 40, height: 40 });
    assert.equal(overlapCheck.overlapCountByNodeId.get('n_a'), 1);

    const r1 = { x: 0, y: 0, width: 100, height: 40 };     // center (50, 20)
    const r2 = { x: 350, y: 20, width: 100, height: 40 };  // center (400, 40)
    const straightCable: CableEdge = {
      id: 'cab_len_1',
      cableCode: 'LEN-01',
      diagramMode: 'topology',
      sourceNodeId: 's1',
      targetNodeId: 's2',
      cableType: 'CAT6A_STP',
      bandwidth: '10G',
      color: '#2563eb',
      routingType: 'straight',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 10,
      status: 'active'
    };

    const bd1 = computeRealTimeCableLengthBreakdown(straightCable, r1, r2, {
      pxPerMeter: 35,
      slackFactor: 1.0,
      floorLevelDiff: 0
    });
    // Horizontal distance ~350.6px / 35 px/m = ~10.02m
    assert.ok(bd1.pathPixels >= 350 && bd1.pathPixels <= 352);
    assert.ok(Math.abs(bd1.horizontalMeters - 10.02) < 0.1);
    assert.equal(bd1.verticalRiseMeters, 0);
    assert.equal(bd1.isCrossFloor, false);

    // Cross-floor curved cable with control point & +15% slack
    const curvedCrossFloor: CableEdge = {
      ...straightCable,
      routingType: 'curved',
      controlPoints: [{ x: 225, y: 160 }]
    };
    const bd2 = computeRealTimeCableLengthBreakdown(curvedCrossFloor, r1, r2, {
      pxPerMeter: 25,
      slackFactor: 1.15,
      floorLevelDiff: 2,
      floorHeightMeters: 4
    });
    assert.ok(bd2.pathPixels > bd1.pathPixels); // curved detour is longer than straight line
    assert.equal(bd2.verticalRiseMeters, 8);
    assert.equal(bd2.isCrossFloor, true);
    assert.equal(bd2.waypointCount, 1);
    assert.ok(bd2.slackMeters > 0);
    assert.ok(bd2.totalEstimatedMeters > bd2.horizontalMeters + bd2.verticalRiseMeters);
  });

  // 12. Cable Labeling Layer, Auto Path Orientation, Custom Rotation & Font Size Tests
  await runTest('cableLabeling: auto-orients along path, supports manual rotation & font size, persists & renders Cable Labeling SVG overlay', () => {
    assert.equal(normalizeReadableAngleDeg(100, 100), 45);
    assert.equal(normalizeReadableAngleDeg(-100, -100), 45); // never upside down
    assert.equal(normalizeReadableAngleDeg(0, 100), -90);
    assert.equal(normalizeReadableAngleDeg(0, -100), -90);

    const rA = { x: 0, y: 0, width: 100, height: 40 };
    const rB = { x: 200, y: 200, width: 100, height: 40 };
    const baseCable: CableEdge = {
      id: 'cab_lbl_1',
      cableCode: 'LBL-01',
      diagramMode: 'topology',
      sourceNodeId: 'a',
      targetNodeId: 'b',
      cableType: 'FIBER_SM_OS2',
      bandwidth: '10G',
      color: '#f59e0b',
      routingType: 'straight',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 20,
      status: 'active',
      label: 'Backbone-OS2'
    };

    const diagPath = computeCablePath(baseCable, rA, rB);
    assert.equal(diagPath.midAngleDeg, 45);
    const autoTransform = resolveCableLabelTransform(baseCable, diagPath);
    assert.equal(autoTransform.isAutoOriented, true);
    assert.equal(autoTransform.angleDeg, 45);
    assert.equal(autoTransform.text, 'Backbone-OS2');
    assert.equal(autoTransform.fontSize, 9.5);

    const verticalOrthoPath = computeCablePath({ ...baseCable, routingType: 'orthogonal' }, rA, rB);
    assert.equal(verticalOrthoPath.midAngleDeg, -90);

    const curvedPath = computeCablePath({ ...baseCable, routingType: 'curved' }, rA, rB);
    assert.ok(curvedPath.midAngleDeg > 0 && curvedPath.midAngleDeg < 90);

    const customStyledCable: CableEdge = {
      ...baseCable,
      labelAutoOrient: false,
      labelRotation: -25,
      labelFontSize: 15
    };
    const customTransform = resolveCableLabelTransform(customStyledCable, diagPath);
    assert.equal(customTransform.isAutoOriented, false);
    assert.equal(customTransform.angleDeg, -25);
    assert.equal(customTransform.fontSize, 15);
    assert.ok(customTransform.badgeHeight >= 28);

    // Project storage persistence + SVG Cable Labeling overlay & layer toggle
    const proj = createEnterpriseTopologyProject();
    proj.cables = [
      {
        ...proj.cables[0],
        label: 'Trunk-Core-Rotated',
        labelAutoOrient: false,
        labelRotation: -25,
        labelFontSize: 15
      }
    ];
    const migrated = migrateAndValidateProject(proj);
    assert.equal(migrated.ok, true);
    if (!migrated.ok) throw new Error('Expected valid migration');
    assert.equal(migrated.project.cables[0].labelRotation, -25);
    assert.equal(migrated.project.cables[0].labelFontSize, 15);
    assert.equal(migrated.project.cables[0].labelAutoOrient, false);

    const svgVisible = generatePureSvgMarkup(migrated.project, { includeTitleBlock: false });
    assert.ok(svgVisible.includes('data-layer="cable-labeling"'));
    assert.ok(svgVisible.includes('rotate(-25.0)'));
    assert.ok(svgVisible.includes('font-size="15"'));
    assert.ok(svgVisible.includes('Trunk-Core-Rotated'));

    migrated.project.settings.hiddenLayers = ['cable_labels'];
    const svgHidden = generatePureSvgMarkup(migrated.project, { includeTitleBlock: false });
    assert.equal(svgHidden.includes('data-layer="cable-labeling"'), false);
    assert.equal(svgHidden.includes('Trunk-Core-Rotated'), false);
  });

  // 13. Cable Auto-Route Obstacle-Avoidance Algorithm Tests
  await runTest('cableRouting: computeAutoRoutedWaypoints avoids interior obstacles with orthogonal bends & lane spread', () => {
    const src = { x: 40, y: 200, width: 120, height: 60 }; // center (100, 230)
    const tgt = { x: 640, y: 200, width: 120, height: 60 }; // center (700, 230)
    const blocker = { id: 'obs_rack', x: 300, y: 120, width: 160, height: 220 }; // directly blocks horizontal y=230

    const res = computeAutoRoutedWaypoints(src, tgt, [blocker], { clearancePx: 22 });
    assert.equal(res.routingType, 'orthogonal');
    assert.equal(res.usedFallback, false);
    assert.ok(res.avoidedObstacles >= 1);
    assert.ok(res.controlPoints.length >= 2);

    const routedCable: CableEdge = {
      id: 'cab_auto_1',
      cableCode: 'AUTO-01',
      diagramMode: 'topology',
      sourceNodeId: 'src',
      targetNodeId: 'tgt',
      cableType: 'CAT6A_STP',
      bandwidth: '10G',
      color: '#0284c7',
      routingType: res.routingType,
      controlPoints: res.controlPoints,
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 15,
      status: 'active'
    };
    const path = computeCablePath(routedCable, src, tgt);
    assert.ok(path.pts.length >= 4);

    // Every segment along the routed path must be strictly horizontal or vertical
    // and must NOT pass through the interior of the blocker obstacle
    for (let i = 0; i < path.pts.length - 1; i++) {
      const a = path.pts[i];
      const b = path.pts[i + 1];
      const isOrtho = Math.abs(a.x - b.x) < 0.01 || Math.abs(a.y - b.y) < 0.01;
      assert.equal(isOrtho, true, `Expected orthogonal segment between (${a.x},${a.y}) and (${b.x},${b.y})`);

      const minX = Math.min(a.x, b.x);
      const maxX = Math.max(a.x, b.x);
      const minY = Math.min(a.y, b.y);
      const maxY = Math.max(a.y, b.y);
      const hitsBlockerInterior =
        maxX > blocker.x && minX < blocker.x + blocker.width &&
        maxY > blocker.y && minY < blocker.y + blocker.height;
      assert.equal(hitsBlockerInterior, false, 'Auto-routed segment must not pierce blocker interior');
    }

    // Parallel lane separation when occupiedSegments are passed for a second cable
    const occupied = path.pts.slice(0, -1).map((p, idx) => ({ a: p, b: path.pts[idx + 1] }));
    const resSecond = computeAutoRoutedWaypoints(src, tgt, [blocker], {
      clearancePx: 22,
      corridorPenalty: 25,
      occupiedSegments: occupied
    });
    assert.equal(resSecond.routingType, 'orthogonal');
    assert.ok(resSecond.controlPoints.length >= 2);
  });

  // 14. Port Status Synchronization & Hidden Node Migration Tests
  await runTest('store & storage: syncAssetPortsWithCables links/unlinks ports & migrateAndValidateProject preserves node.hidden', () => {
    const proj = createEnterpriseTopologyProject();
    const deviceNodes = proj.nodes.filter(n => n.type !== 'rack' && n.assetId && (proj.assets[n.assetId]?.ports?.length || 0) >= 2);
    assert.ok(deviceNodes.length >= 2);

    const nSrc = deviceNodes[0];
    const nTgt = deviceNodes[1];
    const aSrc = proj.assets[nSrc.assetId!];
    const aTgt = proj.assets[nTgt.assetId!];
    const pSrc = aSrc.ports[0];
    const pTgt = aTgt.ports[0];

    const linkedCable: CableEdge = {
      id: 'cab_port_sync_1',
      cableCode: 'SYNC-01',
      diagramMode: 'topology',
      sourceNodeId: nSrc.id,
      sourcePortId: pSrc.id,
      targetNodeId: nTgt.id,
      targetPortId: pTgt.id,
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#155eef',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 12,
      status: 'active'
    };

    const syncedUp = syncAssetPortsWithCables(proj.assets, proj.nodes, [linkedCable]);
    const updatedSrcPort = syncedUp[aSrc.id].ports.find(p => p.id === pSrc.id)!;
    const updatedTgtPort = syncedUp[aTgt.id].ports.find(p => p.id === pTgt.id)!;
    assert.equal(updatedSrcPort.status, 'up');
    assert.equal(updatedSrcPort.connectedCableId, 'cab_port_sync_1');
    assert.deepEqual(updatedSrcPort.connectedTarget, { deviceId: aTgt.id, portId: pTgt.id });
    assert.equal(updatedTgtPort.status, 'up');
    assert.equal(updatedTgtPort.connectedCableId, 'cab_port_sync_1');
    assert.deepEqual(updatedTgtPort.connectedTarget, { deviceId: aSrc.id, portId: pSrc.id });

    // Removing the cable resets both ports back to 'unlinked'
    const syncedDown = syncAssetPortsWithCables(syncedUp, proj.nodes, []);
    const clearedSrcPort = syncedDown[aSrc.id].ports.find(p => p.id === pSrc.id)!;
    const clearedTgtPort = syncedDown[aTgt.id].ports.find(p => p.id === pTgt.id)!;
    assert.equal(clearedSrcPort.status, 'unlinked');
    assert.equal(clearedSrcPort.connectedCableId, undefined);
    assert.equal(clearedSrcPort.connectedTarget, undefined);
    assert.equal(clearedTgtPort.status, 'unlinked');

    // Hidden node preservation across migration
    proj.nodes[0].hidden = true;
    proj.nodes[1].hidden = false;
    const migrated = migrateAndValidateProject(proj);
    assert.equal(migrated.ok, true);
    if (!migrated.ok) throw new Error('Expected valid migration');
    assert.equal(migrated.project.nodes[0].hidden, true);
    assert.equal(migrated.project.nodes[1].hidden, undefined);
  });

  // 15. A4 Technical Drawing PDF Scale Metrics & Hidden Node Export Exclusion Tests
  await runTest('pdfExporter & svgExport: computes accurate A4 scale ratios/bars & excludes hidden nodes', () => {
    const landscape = computeA4ScaleMetrics(
      { minX: 0, minY: 0, width: 1200, height: 600 },
      30,
      'landscape',
      { includeLegendPanel: true }
    );
    assert.equal(landscape.pageWidthMm, 297);
    assert.equal(landscape.pageHeightMm, 210);
    assert.equal(landscape.pxPerMeter, 30);
    assert.equal(landscape.realWorldWidthMeters, 40);
    assert.equal(landscape.realWorldHeightMeters, 20);
    // Exact 2:1 world aspect ratio preserved on A4 sheet
    const ratio = landscape.renderedDrawWidthMm / landscape.renderedDrawHeightMm;
    assert.ok(Math.abs(ratio - 2.0) < 0.02);
    assert.ok(landscape.scaleRatioLabel.startsWith('1:'));
    assert.ok(landscape.scaleBar.totalMeters > 0);
    assert.ok(landscape.scaleBar.barWidthMm >= 18 && landscape.scaleBar.barWidthMm <= 64);

    const portrait = computeA4ScaleMetrics(
      { minX: 0, minY: 0, width: 800, height: 1200 },
      40,
      'portrait',
      { includeLegendPanel: false }
    );
    assert.equal(portrait.pageWidthMm, 210);
    assert.equal(portrait.pageHeightMm, 297);
    assert.ok(portrait.renderedDrawHeightMm > portrait.renderedDrawWidthMm);

    // Hidden node should be omitted from pure SVG export (and therefore A4 PDF raster)
    const proj = createEnterpriseTopologyProject();
    const targetNode = proj.nodes.find(n => n.type !== 'rack')!;
    const hiddenLabel = 'SECRET_HIDDEN_NODE_XYZ';
    targetNode.label = hiddenLabel;
    targetNode.hidden = true;
    const svg = generatePureSvgMarkup(proj, { darkTheme: false, includeTitleBlock: false });
    assert.equal(svg.includes(hiddenLabel), false);
  });

  // 16. Topology-Based Auto IP Assignment & Subnet Validation Tests
  await runTest('ipAutoAssign: validates subnet masks/ranges & numbers devices along topology BFS skipping passive nodes', () => {
    assert.equal(parseSubnetMaskToPrefix('255.255.255.0'), 24);
    assert.equal(parseSubnetMaskToPrefix('255.255.252.0'), 22);
    assert.equal(parseSubnetMaskToPrefix('255.255.255.128'), 25);
    assert.equal(parseSubnetMaskToPrefix('255.0.255.0'), null);
    assert.equal(prefixToSubnetMask(27), '255.255.255.224');

    const badSubnet = validateIpPlanConfig({
      ipRangeStart: '10.10.1.5',
      ipRangeEnd: '10.10.2.50',
      ipSubnetMask: '255.255.255.0',
      ipGateway: '10.10.1.1'
    });
    assert.equal(badSubnet.valid, false);

    const badRangeOrder = validateIpPlanConfig({
      ipRangeStart: '192.168.10.50',
      ipRangeEnd: '192.168.10.10',
      ipSubnetMask: '255.255.255.0',
      ipGateway: '192.168.10.1'
    });
    assert.equal(badRangeOrder.valid, false);

    const validPlan = validateIpPlanConfig({
      ipRangeStart: '10.20.0.10',
      ipRangeEnd: '10.20.0.30',
      ipSubnetMask: '255.255.255.192',
      ipGateway: '10.20.0.1'
    });
    assert.equal(validPlan.valid, true);
    assert.equal(validPlan.cidrNotation, '10.20.0.0/26');
    assert.equal(validPlan.availableHostCount, 21);

    // Build a small topology: Cloud -> Router -> PatchPanel (passive) -> AccessSwitch -> AP
    const proj = createEnterpriseTopologyProject();
    proj.settings.ipRangeStart = '10.50.0.1';
    proj.settings.ipRangeEnd = '10.50.0.20';
    proj.settings.ipSubnetMask = '255.255.255.0';
    proj.settings.ipGateway = '10.50.0.1';

    const makeAsset = (id: string, name: string, category: DeviceAsset['category'], ip = ''): DeviceAsset => ({
      id,
      name,
      assetTag: id.toUpperCase(),
      serialNumber: `SN-${id.toUpperCase()}`,
      category,
      vendor: 'Test',
      model: 'M1',
      ipAddress: ip,
      macAddress: '00:11:22:33:44:55',
      subnetMask: '',
      gateway: '',
      vlan: '1',
      status: 'online',
      powerWatts: 10,
      ports: []
    });

    proj.assets = {
      a_cloud: makeAsset('a_cloud', 'ISP Cloud', 'cloud'),
      a_gw: makeAsset('a_gw', 'Edge Router', 'router'),
      a_pp: makeAsset('a_pp', 'Patch Panel 24P', 'patch_panel'),
      a_sw: makeAsset('a_sw', 'Access Switch', 'switch'),
      a_ap: makeAsset('a_ap', 'WiFi AP', 'ap', '10.50.0.15')
    };

    const baseNode = (id: string, assetId: string, label: string, x: number, type: 'device' | 'cloud' = 'device') => ({
      id,
      diagramMode: 'topology' as const,
      floorId: proj.activeFloorId,
      type,
      assetId,
      label,
      x,
      y: 100,
      width: 120,
      height: 50,
      rotation: 0,
      style: { backgroundColor: '#155EEF', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid' as const, opacity: 1 }
    });

    proj.nodes = [
      baseNode('n_ap', 'a_ap', 'WiFi AP', 600),
      baseNode('n_sw', 'a_sw', 'Access Switch', 420),
      baseNode('n_pp', 'a_pp', 'Patch Panel 24P', 280),
      baseNode('n_gw', 'a_gw', 'Edge Router', 150),
      baseNode('n_cloud', 'a_cloud', 'ISP Cloud', 20, 'cloud')
    ];

    const makeCable = (id: string, s: string, t: string): CableEdge => ({
      id,
      cableCode: id.toUpperCase(),
      diagramMode: 'topology',
      sourceNodeId: s,
      targetNodeId: t,
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#155eef',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 10,
      status: 'active'
    });

    proj.cables = [
      makeCable('c1', 'n_cloud', 'n_gw'),
      makeCable('c2', 'n_gw', 'n_pp'),
      makeCable('c3', 'n_pp', 'n_sw'),
      makeCable('c4', 'n_sw', 'n_ap')
    ];

    // Preserve existing valid AP IP (10.50.0.15) first
    const resPreserve = autoAssignTopologyIps(proj, { preserveExistingValid: true });
    assert.equal(resPreserve.ok, true);
    assert.equal(resPreserve.preservedCount, 1);
    assert.equal(resPreserve.assignedCount, 2);
    assert.equal(resPreserve.updatedAssets.a_cloud.ipAddress, '');
    assert.equal(resPreserve.updatedAssets.a_pp.ipAddress, '');
    assert.equal(resPreserve.updatedAssets.a_gw.ipAddress, '10.50.0.1');
    assert.equal(resPreserve.updatedAssets.a_sw.ipAddress, '10.50.0.2');
    assert.equal(resPreserve.updatedAssets.a_ap.ipAddress, '10.50.0.15');
    assert.equal(resPreserve.updatedAssets.a_sw.subnetMask, '255.255.255.0');
    assert.equal(resPreserve.updatedAssets.a_sw.gateway, '10.50.0.1');

    // Full renumber along topology order: Router -> (PatchPanel skipped) -> Switch -> AP
    const resFull = autoAssignTopologyIps(proj, { preserveExistingValid: false });
    assert.equal(resFull.ok, true);
    assert.equal(resFull.assignedCount, 3);
    assert.equal(resFull.updatedAssets.a_gw.ipAddress, '10.50.0.1');
    assert.equal(resFull.updatedAssets.a_sw.ipAddress, '10.50.0.2');
    assert.equal(resFull.updatedAssets.a_ap.ipAddress, '10.50.0.3');
  });

  // 17. Project Cable Material BOM Summary Tests
  await runTest('cableRouting: computeProjectCableSummary aggregates counts, meters, reserve, and rolls per type', () => {
    const emptyBom = computeProjectCableSummary([]);
    assert.equal(emptyBom.totalCount, 0);
    assert.equal(emptyBom.totalMeters, 0);
    assert.equal(emptyBom.totalWithReserveMeters, 0);
    assert.equal(emptyBom.byType.length, 0);

    const sampleCables: CableEdge[] = [
      {
        id: 'cab1',
        cableCode: 'C-01',
        diagramMode: 'topology',
        sourceNodeId: 'n1',
        targetNodeId: 'n2',
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#2563eb',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 200,
        status: 'active'
      },
      {
        id: 'cab2',
        cableCode: 'C-02',
        diagramMode: 'topology',
        sourceNodeId: 'n1',
        targetNodeId: 'n3',
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#2563eb',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 150,
        status: 'active'
      },
      {
        id: 'cab3',
        cableCode: 'F-01',
        diagramMode: 'fiber',
        sourceNodeId: 'n1',
        targetNodeId: 'n4',
        cableType: 'FIBER_SM_OS2',
        bandwidth: '10G',
        color: '#f59e0b',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 150,
        status: 'active'
      }
    ];

    const bom = computeProjectCableSummary(sampleCables);
    assert.equal(bom.totalCount, 3);
    assert.equal(bom.totalMeters, 500);
    assert.equal(bom.totalWithReserveMeters, 550);
    assert.equal(bom.byType.length, 2);
    assert.equal(bom.byType[0].cableType, 'CAT6_UTP');
    assert.equal(bom.byType[0].count, 2);
    assert.equal(bom.byType[0].totalMeters, 350);
    assert.equal(bom.byType[0].percentage, 70);
    assert.equal(bom.byType[0].estimatedRolls305m, 2);
    assert.equal(bom.byType[1].cableType, 'FIBER_SM_OS2');
    assert.equal(bom.byType[1].count, 1);
    assert.equal(bom.byType[1].totalMeters, 150);
    assert.equal(bom.byType[1].percentage, 30);
    assert.equal(bom.byType[1].estimatedRolls305m, undefined);
  });

  // 18. Project PoE Power Consumption & PSE Budget Tests
  await runTest('poeCalculator: separates PD consumption from PSE budget, respects overrides, and detects overload', () => {
    const proj = createEnterpriseTopologyProject();
    proj.nodes = [];
    proj.cables = [];
    proj.racks = [];

    const makeDevice = (
      id: string,
      name: string,
      category: DeviceAsset['category'],
      partial: Partial<DeviceAsset> = {}
    ): DeviceAsset => ({
      id,
      name,
      category,
      vendor: 'Test',
      model: 'Model-X',
      assetTag: id.toUpperCase(),
      serialNumber: `SN-${id}`,
      ipAddress: '10.10.0.10',
      subnetMask: '255.255.255.0',
      gateway: '10.10.0.1',
      macAddress: '00:11:22:33:44:55',
      vlan: '10',
      status: 'online',
      powerWatts: 0,
      ports: [],
      ...partial
    });

    const swPoe = makeDevice('dev_sw_poe', 'SW-POE-01', 'switch', {
      powerWatts: 380,
      poeBudgetWatts: 100,
      ports: [
        { id: 'p1', name: 'Gi1/0/1', type: 'RJ45_1G', speed: '1 Gbps', poe: true, status: 'up' },
        { id: 'p2', name: 'Gi1/0/2', type: 'RJ45_1G', speed: '1 Gbps', poe: true, status: 'up' }
      ]
    });
    const cam1 = makeDevice('dev_cam_1', 'CAM-01', 'camera', {
      powerWatts: 12,
      ports: [{ id: 'p1', name: 'RJ45_PoE', type: 'RJ45_1G', speed: '1 Gbps', poe: true, status: 'up' }]
    });
    const camDc = makeDevice('dev_cam_dc', 'CAM-DC-02', 'camera', {
      powerWatts: 15,
      poeEnabled: false
    });
    const ap1 = makeDevice('dev_ap_1', 'AP-WIFI6-01', 'ap', {
      powerWatts: 25,
      ports: [{ id: 'p1', name: 'Eth0_PoE', type: 'RJ45_10G', speed: '2.5 Gbps', poe: true, poeWatts: 24, status: 'up' }]
    });
    const voipPhone = makeDevice('dev_voip_1', 'VOIP-01', 'workstation', {
      powerWatts: 65,
      poeWatts: 14,
      ports: [{ id: 'p1', name: 'LAN_PoE', type: 'RJ45_1G', speed: '1 Gbps', poe: true, status: 'up' }]
    });
    const orphanCam = makeDevice('dev_cam_orphan', 'CAM-DELETED', 'camera', {
      powerWatts: 20
    });

    assert.equal(isPseDevice(swPoe), true);
    assert.equal(isPoeConsumerDevice(swPoe), false);
    assert.equal(isPoeConsumerDevice(cam1), true);
    assert.equal(isPoeConsumerDevice(camDc), false);
    assert.equal(isPoeConsumerDevice(voipPhone), true);
    assert.equal(classifyPoeStandard(12).id, '802.3af');
    assert.equal(classifyPoeStandard(24).id, '802.3at');
    assert.equal(classifyPoeStandard(45).id, '802.3bt-3');

    proj.assets = {
      [swPoe.id]: swPoe,
      [cam1.id]: cam1,
      [camDc.id]: camDc,
      [ap1.id]: ap1,
      [voipPhone.id]: voipPhone,
      [orphanCam.id]: orphanCam
    };

    const mkNode = (id: string, assetId: string) => ({
      id,
      diagramMode: 'topology' as const,
      floorId: proj.activeFloorId,
      type: 'device' as const,
      assetId,
      label: id,
      x: 100,
      y: 100,
      width: 120,
      height: 50,
      rotation: 0,
      style: { backgroundColor: '#155EEF', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid' as const, opacity: 1 }
    });

    // Only active nodes count (orphanCam excluded); cam1(12W) + ap1(port poeWatts 24W) + voipPhone(asset poeWatts 14W) = 50W
    proj.nodes = [
      mkNode('n_sw', swPoe.id),
      mkNode('n_cam1', cam1.id),
      mkNode('n_camdc', camDc.id),
      mkNode('n_ap1', ap1.id),
      mkNode('n_voip', voipPhone.id)
    ];

    const summary = computeProjectPoeSummary(proj);
    assert.equal(summary.poweredDeviceCount, 3);
    assert.equal(summary.totalPoeWatts, 50);
    assert.equal(summary.totalPoeBudgetWatts, 100);
    assert.equal(summary.headroomWatts, 50);
    assert.equal(summary.utilizationPct, 50);
    assert.equal(summary.status, 'nominal');

    // Push load above 100W PSE budget -> overload + engineeringValidator error
    proj.assets[ap1.id] = { ...ap1, poeWatts: 85 };
    const overloadSummary = computeProjectPoeSummary(proj);
    assert.equal(overloadSummary.totalPoeWatts, 111); // 12 + 85 + 14
    assert.equal(overloadSummary.headroomWatts, -11);
    assert.equal(overloadSummary.status, 'overload');

    const audit = runEngineeringAudit(proj);
    assert.equal(audit.summary.totalPoeWattsEstimate, 111);
    assert.ok(audit.issues.some(i => i.id === 'poe_budget_overload' && i.severity === 'error'));
  });

  // 19. Per-Switch PoE Consumption vs Budget Breakdown Tests
  await runTest('poeCalculator: computeSwitchPoeBreakdown attributes connected & patch-routed PDs per switch and detects overload', () => {
    const proj = createEnterpriseTopologyProject();
    proj.nodes = [];
    proj.cables = [];
    proj.racks = [];

    const makeDev = (
      id: string,
      name: string,
      category: DeviceAsset['category'],
      partial: Partial<DeviceAsset> = {}
    ): DeviceAsset => ({
      id,
      name,
      category,
      vendor: 'Cisco',
      model: 'C9300-24P',
      assetTag: id.toUpperCase(),
      serialNumber: `SN-${id}`,
      ipAddress: '10.20.0.10',
      subnetMask: '255.255.255.0',
      gateway: '10.20.0.1',
      macAddress: '00:11:22:33:44:66',
      vlan: '10',
      status: 'online',
      powerWatts: 0,
      ports: [],
      ...partial
    });

    const sw1 = makeDev('sw_1', 'SW-FL1-01', 'switch', {
      poeBudgetWatts: 120,
      ports: [{ id: 'p1', name: 'Gi1/0/1', type: 'RJ45_1G', speed: '1 Gbps', poe: true, status: 'up' }]
    });
    const sw2 = makeDev('sw_2', 'SW-FL2-01', 'switch', {
      poeBudgetWatts: 30,
      ports: [{ id: 'p1', name: 'Gi1/0/1', type: 'RJ45_1G', speed: '1 Gbps', poe: true, status: 'up' }]
    });
    const patch = makeDev('pp_1', 'PATCH-01', 'patch_panel');
    const ap1 = makeDev('ap_1', 'AP-01', 'ap', { poeWatts: 22 });
    const cam1 = makeDev('cam_1', 'CAM-01', 'camera', { poeWatts: 15 });
    const cam2 = makeDev('cam_2', 'CAM-02', 'camera', { poeWatts: 35 });
    const orphanAp = makeDev('ap_unwired', 'AP-UNWIRED', 'ap', { poeWatts: 18 });

    proj.assets = {
      [sw1.id]: sw1,
      [sw2.id]: sw2,
      [patch.id]: patch,
      [ap1.id]: ap1,
      [cam1.id]: cam1,
      [cam2.id]: cam2,
      [orphanAp.id]: orphanAp
    };

    const mkNode = (id: string, assetId: string) => ({
      id,
      diagramMode: 'topology' as const,
      floorId: proj.activeFloorId,
      type: 'device' as const,
      assetId,
      label: id,
      x: 100,
      y: 100,
      width: 120,
      height: 50,
      rotation: 0,
      style: { backgroundColor: '#155EEF', borderColor: '#334155', borderWidth: 2, borderStyle: 'solid' as const, opacity: 1 }
    });

    proj.nodes = [
      mkNode('n_sw1', sw1.id),
      mkNode('n_sw2', sw2.id),
      mkNode('n_pp', patch.id),
      mkNode('n_ap1', ap1.id),
      mkNode('n_cam1', cam1.id),
      mkNode('n_cam2', cam2.id),
      mkNode('n_orphan', orphanAp.id)
    ];

    const mkCable = (id: string, src: string, tgt: string): CableEdge => ({
      id,
      cableCode: id.toUpperCase(),
      diagramMode: 'topology',
      sourceNodeId: src,
      targetNodeId: tgt,
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#155EEF',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 15,
      status: 'active'
    });

    // sw1 <- ap1 (direct), sw1 <- patch <- cam1 (2-hop through passive patch panel), sw2 <- cam2 (overloads 30W budget!)
    proj.cables = [
      mkCable('c1', 'n_sw1', 'n_ap1'),
      mkCable('c2', 'n_sw1', 'n_pp'),
      mkCable('c3', 'n_pp', 'n_cam1'),
      mkCable('c4', 'n_sw2', 'n_cam2')
    ];

    const breakdown = computeSwitchPoeBreakdown(proj);
    assert.equal(breakdown.switches.length, 2);

    const b1 = breakdown.switches.find(s => s.assetId === 'sw_1')!;
    const b2 = breakdown.switches.find(s => s.assetId === 'sw_2')!;
    assert.equal(b1.consumedWatts, 37); // 22 + 15
    assert.equal(b1.budgetWatts, 120);
    assert.equal(b1.headroomWatts, 83);
    assert.equal(b1.status, 'nominal');
    assert.equal(b1.connectedPds.length, 2);

    assert.equal(b2.consumedWatts, 35);
    assert.equal(b2.budgetWatts, 30);
    assert.equal(b2.headroomWatts, -5);
    assert.equal(b2.status, 'overload');

    assert.equal(breakdown.unassignedPds.length, 1);
    assert.equal(breakdown.unassignedPds[0].assetId, 'ap_unwired');
    assert.equal(breakdown.unassignedWatts, 18);
    assert.equal(breakdown.totalConsumedWatts, 90);
    assert.equal(breakdown.totalBudgetWatts, 150);
  });

  // 20. Project Package (.hachihi.json) Deep Round-Trip Export -> SHA-256 -> Import Equality Tests
  await runTest('projectPackage: deep round-trip preserves full ProjectState, embedded images, custom devices, and revisions', async () => {
    const base = createEnterpriseTopologyProject();
    const rackProj = createServerRackProject();

    const embeddedBgDataUrl =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
    const customImageDataUrl =
      'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNiIgaGVpZ2h0PSIxNiI+PHJlY3Qgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2IiBmaWxsPSIjMTU1RUVGIi8+PC9zdmc+';

    // Compose rich multi-mode project covering topology, floorplan, rack, cctv, wifi, electrical, VLANs, subnets, patchLinks
    base.settings.backgroundImageUrl = embeddedBgDataUrl;
    base.settings.isDarkMode = true;
    base.settings.ipRangeStart = '10.99.0.10';
    base.settings.ipRangeEnd = '10.99.0.200';
    base.settings.ipSubnetMask = '255.255.255.0';
    base.settings.ipGateway = '10.99.0.1';
    base.racks = rackProj.racks;
    base.assets = { ...base.assets, ...rackProj.assets };
    base.vlans = [
      { id: 'vlan_10', vlanId: 10, name: 'MGMT', color: '#155EEF', purpose: 'Management VLAN' }
    ];
    base.subnets = [
      { id: 'sub_10', name: 'Core Subnet', cidr: '10.99.0.0/24', gateway: '10.99.0.1', vlanId: 10, notes: 'Core Subnet' }
    ];
    base.patchLinks = [
      {
        id: 'pl_1',
        patchPanelAssetId: Object.keys(base.assets)[0],
        patchPort: 'P01',
        targetDeviceName: 'CORE-SW-01',
        targetPort: 'Gi1/0/1',
        cableCode: 'CORE-PP01',
        vlan: '10'
      }
    ];

    const customPreset: CustomDevicePreset = {
      id: 'custom_edge_gw_x1',
      createdAt: '2026-06-01T08:00:00.000Z',
      name: 'Edge Gateway Custom X1',
      category: 'router',
      vendor: 'HachihiCustomVendor',
      model: 'EGW-X1-999',
      defaultUHeight: 1,
      powerWatts: 48,
      weightKg: 3.5,
      defaultPorts: [
        { name: 'Eth0', type: 'RJ45_1G', speed: '1 Gbps', poe: false },
        { name: 'SFP1', type: 'SFP_PLUS_10G', speed: '10 Gbps', poe: false }
      ],
      description: 'Custom Edge Gateway preset',
      defaultWidth: 140,
      defaultHeight: 60,
      color: '#155EEF',
      iconName: 'Router'
    };

    const customAssetId = 'ast_custom_egw';
    base.assets[customAssetId] = {
      id: customAssetId,
      name: 'EGW-CUSTOM-01',
      category: 'router',
      vendor: customPreset.vendor,
      model: customPreset.model,
      assetTag: 'TAG-CUSTOM-01',
      serialNumber: 'SN-CUSTOM-99',
      ipAddress: '10.99.0.1',
      subnetMask: '255.255.255.0',
      gateway: '10.99.0.254',
      macAddress: 'AA:BB:CC:DD:EE:01',
      vlan: '10',
      status: 'online',
      powerWatts: 48,
      poeBudgetWatts: 180,
      customImageUrl: customImageDataUrl,
      ports: [
        { id: 'p_eth0', name: 'Eth0', type: 'RJ45_1G', speed: '1 Gbps', poe: false, status: 'up' }
      ]
    };

    base.nodes.push(
      {
        id: 'nd_custom_1',
        diagramMode: 'topology',
        floorId: base.activeFloorId,
        type: 'device',
        assetId: customAssetId,
        label: 'EGW-CUSTOM-01',
        x: 360,
        y: 260,
        width: 140,
        height: 60,
        rotation: 0,
        customImageUrl: customImageDataUrl,
        style: { backgroundColor: '#155EEF', borderColor: '#1e293b', borderWidth: 2, borderStyle: 'solid', opacity: 1 }
      },
      {
        id: 'nd_wifi_1',
        diagramMode: 'wifi',
        floorId: base.activeFloorId,
        type: 'device',
        label: 'AP-MIMO-01',
        x: 520,
        y: 300,
        width: 80,
        height: 80,
        rotation: 0,
        customData: { coverageRadiusMeters: 18 },
        style: { backgroundColor: '#0284c7', borderColor: '#0369a1', borderWidth: 2, borderStyle: 'solid', opacity: 1 }
      },
      {
        id: 'nd_elec_1',
        diagramMode: 'electrical',
        floorId: base.activeFloorId,
        type: 'device',
        label: 'MSB-PANEL-01',
        x: 200,
        y: 420,
        width: 130,
        height: 70,
        rotation: 0,
        style: { backgroundColor: '#f59e0b', borderColor: '#b45309', borderWidth: 2, borderStyle: 'solid', opacity: 1 }
      }
    );

    if (base.cables.length > 0) {
      base.cables[0].controlPoints = [{ x: 240, y: 180 }, { x: 320, y: 240 }];
      base.cables[0].label = 'UPLINK-TRUNK-01';
    }

    const extraLibraryPreset: CustomDevicePreset = {
      id: 'custom_lib_spare',
      createdAt: '2026-06-01T08:30:00.000Z',
      name: 'Spare Industrial Switch',
      category: 'switch',
      vendor: 'SpareTech',
      model: 'IND-SW-12',
      defaultUHeight: 1,
      powerWatts: 30,
      weightKg: 2.2,
      defaultPorts: [
        { name: 'Gi0/1', type: 'RJ45_1G', speed: '1 Gbps', poe: true }
      ],
      description: 'Spare industrial switch in custom library',
      defaultWidth: 140,
      defaultHeight: 56,
      color: '#0f172a',
      iconName: 'Network'
    };

    const revisions: ProjectRevision[] = [
      {
        id: 'rev_snap_1',
        projectId: base.id,
        label: 'Chốt thiết kế giai đoạn 1',
        createdAt: '2026-06-01T10:00:00.000Z',
        author: 'Kỹ sư A',
        nodeCount: base.nodes.length,
        assetCount: Object.keys(base.assets).length,
        rackCount: base.racks.length,
        cableCount: base.cables.length,
        snapshot: structuredClone(base)
      }
    ];

    const preMig = migrateAndValidateProject(base);
    assert.equal(preMig.ok, true);
    if (!preMig.ok) throw new Error('Expected valid fixture migration');

    const pkgResult = await createProjectPackage(preMig.project, {
      includeRevisions: true,
      includeFullCustomLibrary: true,
      embedExternalImages: true,
      revisionsOverride: revisions,
      customLibraryOverride: [customPreset, extraLibraryPreset],
      exportedBy: 'Kỹ sư A'
    });

    assert.equal(pkgResult.pkg.manifest.format, PACKAGE_FORMAT_TAG);
    assert.equal(pkgResult.pkg.manifest.formatVersion, PACKAGE_FORMAT_VERSION);
    assert.equal(pkgResult.pkg.checksum.algorithm, 'SHA-256');
    assert.equal(pkgResult.pkg.checksum.digest.length, 64);

    const inspection = await inspectProjectImportPayload(pkgResult.jsonString, [], 'export_test.hachihi.json');
    assert.equal(inspection.ok, true);
    if (!inspection.ok || inspection.kind !== 'package') {
      throw new Error('Expected valid package inspection');
    }

    assert.equal(inspection.integrityStatus, 'valid');
    assert.equal(inspection.isNewerFormat, false);
    assert.equal(inspection.isNewerSchema, false);
    assert.equal(inspection.skippedFields.length, 0);
    assert.equal(inspection.revisions.length, 1);
    assert.ok(inspection.usedCustomDevices.some(d => d.id === customPreset.id));
    assert.equal(inspection.fullCustomLibrary.length, 2);
    assert.equal(inspection.embeddedImageCount, 2);

    // Deep equality check across every structural collection of ProjectState (JSON-canonical to ignore explicit undefined keys)
    const canonicalClone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
    assert.deepEqual(canonicalClone(inspection.project.buildings), canonicalClone(pkgResult.pkg.project.buildings));
    assert.deepEqual(canonicalClone(inspection.project.floors), canonicalClone(pkgResult.pkg.project.floors));
    assert.deepEqual(canonicalClone(inspection.project.rooms), canonicalClone(pkgResult.pkg.project.rooms));
    assert.deepEqual(canonicalClone(inspection.project.racks), canonicalClone(pkgResult.pkg.project.racks));
    assert.deepEqual(canonicalClone(inspection.project.assets), canonicalClone(pkgResult.pkg.project.assets));
    assert.deepEqual(canonicalClone(inspection.project.nodes), canonicalClone(pkgResult.pkg.project.nodes));
    assert.deepEqual(canonicalClone(inspection.project.cables), canonicalClone(pkgResult.pkg.project.cables));
    assert.deepEqual(canonicalClone(inspection.project.vlans), canonicalClone(pkgResult.pkg.project.vlans));
    assert.deepEqual(canonicalClone(inspection.project.subnets), canonicalClone(pkgResult.pkg.project.subnets));
    assert.deepEqual(canonicalClone(inspection.project.patchLinks), canonicalClone(pkgResult.pkg.project.patchLinks));
    assert.deepEqual(canonicalClone(inspection.project.settings), canonicalClone(pkgResult.pkg.project.settings));
    assert.equal(inspection.project.activeMode, pkgResult.pkg.project.activeMode);
  });

  // 21. Project Package Tampering Detection & Newer Version Warning Tests
  await runTest('projectPackage: detects SHA-256 tampering and warns on newer format/schema versions', async () => {
    const base = createEnterpriseTopologyProject();
    const { pkg } = await createProjectPackage(base, {
      includeRevisions: false,
      includeFullCustomLibrary: false,
      revisionsOverride: [],
      customLibraryOverride: []
    });

    // Mutate project name without updating checksum -> tampered
    const tampered = structuredClone(pkg);
    tampered.project.name = `${tampered.project.name} (TAMPERED)`;
    const tamperedRes = await inspectProjectImportPayload(JSON.stringify(tampered), []);
    assert.equal(tamperedRes.ok, true);
    if (!tamperedRes.ok || tamperedRes.kind !== 'package') throw new Error('Expected package result');
    assert.equal(tamperedRes.integrityStatus, 'tampered');

    // Mutate manifest formatVersion & schemaVersion higher than current app -> newer version warning
    const newer = structuredClone(pkg);
    newer.manifest.formatVersion = PACKAGE_FORMAT_VERSION + 2;
    newer.manifest.schemaVersion = CURRENT_SCHEMA_VERSION + 3;
    const newerRes = await inspectProjectImportPayload(JSON.stringify(newer), []);
    assert.equal(newerRes.ok, true);
    if (!newerRes.ok || newerRes.kind !== 'package') throw new Error('Expected package result');
    assert.equal(newerRes.isNewerFormat, true);
    assert.equal(newerRes.isNewerSchema, true);
    assert.ok(Boolean(newerRes.newerVersionReason));
  });

  // 22. Unknown Field Reporting, Legacy Raw V3 JSON Import, & Conflict-Safe New ID Cloning Tests
  await runTest('projectPackage: reports skipped unknown fields, imports legacy raw JSON, and clones safely on ID conflict', async () => {
    const base = createEnterpriseTopologyProject();
    const rawWithUnknown = {
      ...structuredClone(base),
      schemaVersion: 3,
      experimentalFutureField: { foo: 'bar' },
      settings: {
        ...base.settings,
        unknownSettingBeta: true
      }
    };

    const existingList: ProjectSummary[] = [
      {
        id: base.id,
        name: base.name,
        author: base.author,
        version: base.version,
        lastModified: base.lastModified,
        lastSavedAt: base.lastModified,
        nodeCount: base.nodes.length,
        assetCount: Object.keys(base.assets).length,
        rackCount: base.racks.length,
        cableCount: base.cables.length
      }
    ];

    const rawRes = await inspectProjectImportPayload(JSON.stringify(rawWithUnknown), existingList, 'legacy_v3.json');
    assert.equal(rawRes.ok, true);
    if (!rawRes.ok || rawRes.kind !== 'raw_project') {
      throw new Error('Expected legacy raw_project inspection');
    }

    assert.equal(rawRes.integrityStatus, 'legacy_raw');
    assert.ok(rawRes.skippedFields.includes('project.experimentalFutureField'));
    assert.ok(rawRes.skippedFields.includes('settings.unknownSettingBeta'));
    assert.equal(rawRes.conflictingProject?.id, base.id);

    // Safe "Import as New Copy" generates fresh project ID & remaps all revision IDs
    const fakeRev: ProjectRevision = {
      id: 'rev_old_1',
      projectId: rawRes.project.id,
      label: 'Snapshot 1',
      createdAt: '2026-05-01T00:00:00.000Z',
      author: 'Tester',
      nodeCount: 1,
      assetCount: 1,
      rackCount: 0,
      cableCount: 0,
      snapshot: structuredClone(rawRes.project)
    };
    const cloned = cloneProjectForNewImport(rawRes.project, [fakeRev]);
    assert.notEqual(cloned.project.id, rawRes.project.id);
    assert.ok(cloned.project.id.startsWith('proj_'));
    assert.equal(cloned.revisions.length, 1);
    assert.equal(cloned.revisions[0].projectId, cloned.project.id);
    assert.equal(cloned.revisions[0].snapshot.id, cloned.project.id);
    assert.notEqual(cloned.revisions[0].id, fakeRev.id);
  });

  // 23. Quick Export Current View with White Background Tests
  await runTest('svgExport: computeViewportDiagramBounds & whiteBackground override enforce #ffffff on dark projects', () => {
    const bounds = computeViewportDiagramBounds({ x: -100, y: 50 }, 0.5, { w: 800, h: 600 });
    assert.ok(bounds);
    assert.equal(bounds.minX, 200);
    assert.equal(bounds.minY, -100);
    assert.equal(bounds.width, 1600);
    assert.equal(bounds.height, 1200);

    assert.equal(computeViewportDiagramBounds({ x: 0, y: 0 }, 0, { w: 800, h: 600 }), undefined);
    assert.equal(computeViewportDiagramBounds({ x: 0, y: 0 }, 1, { w: 0, h: 600 }), undefined);

    const proj = createEnterpriseTopologyProject();
    proj.settings.isDarkMode = true;
    proj.settings.backgroundPreset = 'dark_noc';
    proj.settings.backgroundColor = '#0b1220';

    const svgWhite = generatePureSvgMarkup(proj, {
      darkTheme: false,
      whiteBackground: true,
      boundsOverride: bounds,
      includeTitleBlock: false
    });
    assert.ok(svgWhite.includes(`viewBox="200 -100 1600 1200"`));
    assert.ok(svgWhite.includes(`fill="#ffffff"`));
    assert.equal(svgWhite.includes(`#0b1220`), false);
    assert.equal(svgWhite.includes(`url(#pure-grid)`), false);
  });

  // 24. Export BOM CSV (Assets, Cable Lengths, Front/Rear Rack Components, UTF-8 BOM & RFC-4180 Safety)
  await runTest('bomCsvExporter: builds UTF-8 BOM CSV with grouped assets, cable lengths, rack components, and safe escaping', () => {
    assert.equal(escapeBomCsvCell('plain'), 'plain');
    assert.equal(escapeBomCsvCell('a,b'), '"a,b"');
    assert.equal(escapeBomCsvCell('say "hi"'), '"say ""hi"""');
    assert.equal(escapeBomCsvCell('line1\nline2'), '"line1\nline2"');
    assert.equal(escapeBomCsvCell('=1+1'), "'=1+1");
    assert.equal(escapeBomCsvCell('+cmd'), "'+cmd");
    assert.equal(escapeBomCsvCell(-12.5), '-12.5');

    const proj = createEnterpriseTopologyProject();
    const rackProj = createServerRackProject();
    proj.name = 'Core Office, "Phase 1"';
    proj.floors = [
      {
        id: 'fl_test_1',
        buildingId: 'bld_1',
        level: 1,
        name: 'Tầng 1 - Phòng Máy Chủ',
        description: '',
        widthMeters: 25,
        depthMeters: 16
      }
    ];
    proj.activeFloorId = 'fl_test_1';
    proj.racks = structuredClone(rackProj.racks);
    if (proj.racks.length > 0) {
      proj.racks[0].floorId = 'fl_test_1';
    }
    proj.assets = { ...proj.assets, ...rackProj.assets };

    // Mount a rear-side PDU component inside the first rack to verify both front & rear components appear
    if (proj.racks.length > 0) {
      proj.assets['ast_rear_pdu'] = {
        id: 'ast_rear_pdu',
        name: '=PDU-REAR, 01',
        category: 'pdu',
        vendor: 'APC',
        model: 'AP8953',
        assetTag: 'PDU-R01',
        serialNumber: 'SN-PDU-R01',
        ipAddress: '',
        subnetMask: '',
        gateway: '',
        macAddress: '',
        vlan: '',
        floorId: 'fl_test_1',
        rackId: proj.racks[0].id,
        rackSide: 'rear',
        rackUnitStart: 2,
        rackUnitHeight: 1,
        powerWatts: 15,
        weightKg: 4.5,
        status: 'online',
        ports: []
      };
      proj.racks[0].rearSlots = { ...(proj.racks[0].rearSlots || {}), 2: 'ast_rear_pdu' };
    }

    const res = buildBomCsvContent(proj, '2026-11-14T10:00:00.000Z', { reservePct: 15 });
    assert.ok(res.csvWithBom.startsWith('\uFEFF'));
    assert.ok(res.filename.endsWith('_BOM.csv'));
    assert.ok(res.summary.assetCount >= Object.keys(proj.assets).length);
    assert.equal(res.summary.cableCount, proj.cables.length);
    assert.equal(res.summary.rackCount, proj.racks.length);
    assert.ok(res.summary.rackComponentCount >= 1);

    // Uniform clean spreadsheet headers & categories
    assert.ok(res.csv.startsWith('STT,Nhóm Hạng Mục,Mã SKU,Phân Loại,Hãng Sản Xuất,Model / Quy Cách'));
    assert.ok(res.csv.includes('Đơn Giá (VNĐ),Thành Tiền (VNĐ)'));
    assert.ok(res.csv.includes('Thiết bị & Tủ Rack'));
    assert.ok(res.csv.includes('Dây cáp & Đấu nối'));
    assert.ok(res.csv.includes('Thành phần Tủ Rack'));
    assert.ok(res.csv.includes('TỔNG CỘNG DỰ ÁN'));
    assert.ok(res.csv.includes('+15%'));

    // Escaped project name & formula-neutralized rear rack component name
    assert.ok(res.csv.includes('"Core Office, ""Phase 1"""'));
    assert.ok(res.csv.includes(`"'=PDU-REAR, 01 (PDU-R01)"`));
    assert.ok(res.csv.includes('Mặt sau (Rear)'));
    assert.ok(res.csv.includes('Mặt trước (Front)'));

    // Test BOM aggregator KPIs, reserve %, and search filter + TSV clipboard output
    const stats15 = computeProjectBomStats(proj, { reservePct: 15 });
    assert.ok(stats15.kpis.totalCableWithReserveMeters >= stats15.kpis.rawCableMeters);
    assert.ok(stats15.kpis.recommendedUpsVa > 0);
    assert.ok(stats15.floorRows.length >= 1);

    const filtered = computeProjectBomStats(proj, { searchQuery: 'AP8953' });
    assert.equal(filtered.deviceRows.length, 1);
    assert.equal(filtered.deviceRows[0].model, 'AP8953');

    const tsv = formatBomTsvForClipboard(proj, { reservePct: 15 });
    assert.ok(tsv.includes('\t'));
    assert.ok(tsv.startsWith('STT\tNhóm Hạng Mục\t'));
  });

  // 25. Layer Policy Lock Enforcement Tests
  await runTest('layerPolicy: resolves layers and enforces lockedLayers for nodes, rooms, cables & read-only mode', () => {
    const rackNode = { type: 'rack' as const, assetId: undefined, locked: false };
    const textNode = { type: 'text' as const, assetId: undefined, locked: false };
    const deviceNode = { type: 'device' as const, assetId: 'ast_sw1', locked: false };

    assert.equal(resolveNodeLayer(rackNode), 'racks');
    assert.equal(resolveNodeLayer(textNode), 'labels');
    assert.equal(resolveNodeLayer(deviceNode), 'devices');

    const lockDevicesSettings = { lockedLayers: ['devices' as const, 'rooms' as const] };
    assert.equal(isNodeEffectivelyLocked(deviceNode, lockDevicesSettings), true);
    assert.equal(isNodeEffectivelyLocked(rackNode, lockDevicesSettings), false);
    assert.equal(isRoomEffectivelyLocked({ locked: false }, lockDevicesSettings), true);
    assert.equal(isCableEffectivelyLocked({ id: 'cab_1' }, lockDevicesSettings), false);

    // Individual node/room lock or read-only mode always forces lock
    assert.equal(isNodeEffectivelyLocked({ ...rackNode, locked: true }, {}), true);
    assert.equal(isNodeEffectivelyLocked(rackNode, {}, undefined, true), true);
    assert.equal(isCableEffectivelyLocked({ id: 'cab_1' }, {}, true), true);
  });

  // 26. Help Catalog Accent-Insensitive Search Tests
  await runTest('helpCatalog: strips Vietnamese diacritics and matches unaccented technical queries', () => {
    assert.equal(stripVietnameseDiacritics('Khóa lớp & Tỉ lệ Đường dây'), 'khoa lop & ti le duong day');

    const lockResults = searchHelpCatalog('khoa lop');
    assert.ok(lockResults.some(t => t.id === 'help-layer-lock'));

    const bomResults = searchHelpCatalog('bom vat tu');
    assert.ok(bomResults.some(t => t.id === 'help-bom'));

    const scaleResults = searchHelpCatalog('ti le');
    assert.ok(scaleResults.some(t => t.id === 'help-scale-measure'));

    const filteredByCat = searchHelpCatalog('', 'tu-rack');
    assert.ok(filteredByCat.length >= 2);
    assert.ok(filteredByCat.every(t => t.category === 'tu-rack'));
  });

  // 27. Brand & Single-Source SemVer 3.1.1 Versioning Tests
  await runTest('appInfo & projectPackage: stamps single-source version 3.1.1 and HACHIHI brand constants', async () => {
    assert.equal(APP_VERSION, '3.1.1');
    assert.equal(BRAND_INFO.websiteUrl, 'https://hachihi.vn');
    assert.equal(BRAND_INFO.hotlineDisplay, '093 384 2126');

    const proj = createEnterpriseTopologyProject();
    const { pkg } = await createProjectPackage(proj, {
      includeRevisions: false,
      includeFullCustomLibrary: false,
      revisionsOverride: [],
      customLibraryOverride: []
    });
    assert.equal(pkg.manifest.appVersion, APP_VERSION);
  });

  // 28. BOM v3.1 Precision, Inferred Accessories, Copper/Fiber Loss & Detailed Live-Formula Excel Tests
  await runTest('bomAggregator & excelService: computes copper/fiber loss, service loop, inferred accessories, TIA warnings & 6-sheet BOM workbook', async () => {
    const proj = createEnterpriseTopologyProject();
    const firstTwo = proj.nodes.filter(n => n.type !== 'rack');
    assert.ok(firstTwo.length >= 2);

    // Ensure project has copper > 100m, fiber, and rack components for full BOM verification
    proj.cables = [
      {
        id: 'cab_cu_long',
        cableCode: 'CU-LONG-01',
        diagramMode: 'topology',
        sourceNodeId: firstTwo[0].id,
        targetNodeId: firstTwo[1].id,
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#2563eb',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 120,
        status: 'active'
      },
      {
        id: 'cab_fb_1',
        cableCode: 'FB-TRUNK-01',
        diagramMode: 'topology',
        sourceNodeId: firstTwo[0].id,
        targetNodeId: firstTwo[1].id,
        cableType: 'FIBER_SM_OS2',
        bandwidth: '10G',
        color: '#f59e0b',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 80,
        status: 'active'
      }
    ];

    const stats = computeProjectBomStats(proj, {
      copperLossPct: 15,
      fiberLossPct: 10,
      serviceLoopMetersPerEnd: 3,
      copperSpoolMeters: 305,
      fiberSpoolMeters: 1000
    });

    const copperRow = stats.cableRows.find(r => r.cableType === 'CAT6_UTP')!;
    const fiberRow = stats.cableRows.find(r => r.cableType === 'FIBER_SM_OS2')!;
    assert.ok(copperRow);
    assert.ok(fiberRow);
    assert.equal(copperRow.serviceLoopMeters, 6);
    assert.equal(copperRow.lossPct, 15);
    // (120 + 6) * 1.15 = 144.9m
    assert.equal(copperRow.totalWithReserveMeters, 144.9);

    assert.equal(fiberRow.serviceLoopMeters, 6);
    assert.equal(fiberRow.lossPct, 10);
    // (80 + 6) * 1.10 = 94.6m
    assert.equal(fiberRow.totalWithReserveMeters, 94.6);

    // 3-way reconciliation & TIA 100m warning
    assert.equal(stats.precision.isConsistent, true);
    assert.equal(stats.precision.routeTotalMeters, 200);
    assert.equal(stats.precision.typeTotalMeters, 200);
    assert.equal(stats.precision.floorTotalMeters, 200);
    assert.ok(stats.precision.warnings.some(w => w.code === 'TIA_COPPER_100M'));

    // Inferred accessories with provenance
    const accIds = new Set(stats.inferredAccessories.map(a => a.id));
    assert.ok(accIds.has('acc_keystone_copper'));
    assert.ok(accIds.has('acc_fiber_pigtail_lc'));
    assert.ok(accIds.has('acc_tia606_labels'));

    // Detailed BOM workbook: 7 sheets & live formulas referencing Gia_Dinh_BOM
    const bomWb = buildDetailedBomExcelWorkbook(proj);
    assert.deepEqual(bomWb.worksheets.map(s => s.name), [
      'Tong_Hop',
      'Chi_Tiet_BOM',
      'Theo_Tang',
      'Cap_Tung_Tuyen',
      'Phu_Kien_Suy_Ra',
      'Theo_He_Thong',
      'Gia_Dinh_BOM'
    ]);

    const routesWs = bomWb.getWorksheet('Cap_Tung_Tuyen')!;
    const row2Drop = routesWs.getCell('H2').value as { formula?: string };
    const row2Loop = routesWs.getCell('I2').value as { formula?: string };
    const row2Loss = routesWs.getCell('J2').value as { formula?: string };
    const row2Total = routesWs.getCell('K2').value as { formula?: string };
    assert.equal(row2Drop.formula, 'Gia_Dinh_BOM!$B$8*2');
    assert.equal(row2Loop.formula, 'Gia_Dinh_BOM!$B$2*2');
    assert.equal(row2Loss.formula, 'Gia_Dinh_BOM!$B$3');
    assert.equal(row2Total.formula, 'ROUND((F2+G2+H2+I2)*(1+J2/100),1)');

    const row3Loss = routesWs.getCell('J3').value as { formula?: string };
    assert.equal(row3Loss.formula, 'Gia_Dinh_BOM!$B$4');

    // Legacy 6-sheet project workbook also stays intact for Test #3 compatibility
    const legacyWb = buildProjectExcelWorkbook(proj);
    assert.equal(legacyWb.worksheets.length, 6);
  });

  // 29. Sample Project Category & Multi-Floor Office Topology Template Tests
  await runTest('templates: Sample Project category provides multi-floor office topology with rack assignments, IP subnetting & zero audit issues', () => {
    const sampleTpl = ARCHITECTURE_TEMPLATES.find(t => t.id === 'tpl_sample_multifloor_office');
    assert.ok(sampleTpl);
    assert.equal(sampleTpl.categoryName, 'Dự án mẫu (Sample Project)');
    assert.equal(sampleTpl.badge, 'Sample Project');

    const sample = createMultiFloorSampleOfficeProject();
    assert.equal(sample.buildings.length, 1);
    assert.equal(sample.floors.length, 3);
    assert.equal(sample.rooms.length, 4);
    assert.equal(sample.racks.length, 3);
    assert.equal((sample.vlans || []).length, 5);
    assert.equal((sample.subnets || []).length, 5);
    assert.ok((sample.patchLinks || []).length >= 4);

    // Every floor has assigned rooms/assets, and racks have valid slot assignments
    for (const rk of sample.racks) {
      const rackStats = getRackStatistics(rk, sample.assets);
      assert.ok(rackStats.frontUsedUnits > 0);
      assert.equal(rackStats.overflowItems.length, 0);
      assert.equal(rackStats.isOverweight, false);
    }

    // Zero node overlaps on canvas
    const overlapReport = detectOverlappingNodes(
      sample.nodes.map(n => ({ id: n.id, x: n.x, y: n.y, width: n.width, height: n.height }))
    );
    assert.equal(overlapReport.pairs.length, 0);

    // Clean migration & zero engineering errors or warnings
    const migrated = migrateAndValidateProject(sample);
    assert.equal(migrated.ok, true);

    const audit = runEngineeringAudit(sample);
    assert.equal(audit.summary.errorCount, 0, `Unexpected audit errors: ${audit.issues.map(i => i.title).join('; ')}`);
    assert.equal(audit.summary.warningCount, 0, `Unexpected audit warnings: ${audit.issues.map(i => i.title).join('; ')}`);
  });

  // 30. Hand-Verified BOM Arithmetic Tests (Group 2)
  await runTest('bomAggregator: matches exact hand-verified device counts, wattage, UPS VA, cable loop/loss & spool math', () => {
    const base = createEnterpriseTopologyProject();
    const defaultNodeStyle = {
      backgroundColor: '#1d4ed8',
      borderColor: '#334155',
      borderWidth: 2,
      borderStyle: 'solid' as const,
      opacity: 1
    };
    const handProject: ProjectState = {
      ...base,
      floors: [
        {
          id: 'fl_1',
          buildingId: base.activeBuildingId,
          name: 'Tầng 1',
          description: 'Mặt bằng tầng 1',
          level: 1,
          widthMeters: 30,
          depthMeters: 20
        }
      ],
      activeFloorId: 'fl_1',
      rooms: [],
      racks: [
        {
          id: 'rk_1',
          name: 'Rack-01',
          floorId: 'fl_1',
          totalUnits: 42,
          widthMm: 600,
          depthMm: 1000,
          maxLoadKg: 800,
          x: 100,
          y: 100,
          slots: { 40: 'a_sw1', 38: 'a_sw2' },
          rearSlots: {}
        }
      ],
      assets: {
        a_rk1: {
          id: 'a_rk1',
          assetTag: 'RK-01',
          serialNumber: 'SN-RK01',
          name: 'Rack-01',
          category: 'rack',
          vendor: 'HACHIHI',
          model: 'SR-42U-600x1000',
          ipAddress: '',
          subnetMask: '',
          gateway: '',
          macAddress: '',
          vlan: '',
          rackUnitHeight: 42,
          powerWatts: 0,
          weightKg: 110,
          ports: [],
          status: 'online',
          floorId: 'fl_1'
        },
        a_sw1: {
          id: 'a_sw1',
          assetTag: 'SW-01',
          serialNumber: 'SN-SW01',
          name: 'SW-01',
          category: 'switch',
          vendor: 'Cisco',
          model: 'C9200-24P',
          ipAddress: '10.0.0.11',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.1',
          macAddress: '00:1A:2B:00:00:11',
          vlan: '10',
          rackUnitHeight: 1,
          powerWatts: 250,
          weightKg: 4.5,
          ports: [],
          status: 'online',
          floorId: 'fl_1',
          rackId: 'rk_1'
        },
        a_sw2: {
          id: 'a_sw2',
          assetTag: 'SW-02',
          serialNumber: 'SN-SW02',
          name: 'SW-02',
          category: 'switch',
          vendor: 'Cisco',
          model: 'C9200-24P',
          ipAddress: '10.0.0.12',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.1',
          macAddress: '00:1A:2B:00:00:12',
          vlan: '10',
          rackUnitHeight: 1,
          powerWatts: 250,
          weightKg: 4.5,
          ports: [],
          status: 'online',
          floorId: 'fl_1',
          rackId: 'rk_1'
        },
        a_cam1: {
          id: 'a_cam1',
          assetTag: 'CAM-01',
          serialNumber: 'SN-CAM01',
          name: 'CAM-01',
          category: 'camera',
          vendor: 'Hikvision',
          model: 'DS-2CD2143',
          ipAddress: '10.0.0.21',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.1',
          macAddress: '00:1A:2B:00:00:21',
          vlan: '20',
          powerWatts: 15,
          weightKg: 0.8,
          ports: [],
          status: 'online',
          floorId: 'fl_1'
        },
        a_cam2: {
          id: 'a_cam2',
          assetTag: 'CAM-02',
          serialNumber: 'SN-CAM02',
          name: 'CAM-02',
          category: 'camera',
          vendor: 'Hikvision',
          model: 'DS-2CD2143',
          ipAddress: '10.0.0.22',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.1',
          macAddress: '00:1A:2B:00:00:22',
          vlan: '20',
          powerWatts: 15,
          weightKg: 0.8,
          ports: [],
          status: 'online',
          floorId: 'fl_1'
        },
        a_cam3: {
          id: 'a_cam3',
          assetTag: 'CAM-03',
          serialNumber: 'SN-CAM03',
          name: 'CAM-03',
          category: 'camera',
          vendor: 'Hikvision',
          model: 'DS-2CD2143',
          ipAddress: '10.0.0.23',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.1',
          macAddress: '00:1A:2B:00:00:23',
          vlan: '20',
          powerWatts: 15,
          weightKg: 0.8,
          ports: [],
          status: 'online',
          floorId: 'fl_1'
        }
      },
      nodes: [
        { id: 'n_rk1', type: 'rack', assetId: 'a_rk1', diagramMode: 'topology', floorId: 'fl_1', x: 100, y: 100, width: 180, height: 300, rotation: 0, label: 'Rack-01', style: defaultNodeStyle },
        { id: 'n_sw1', type: 'device', assetId: 'a_sw1', diagramMode: 'topology', floorId: 'fl_1', x: 350, y: 100, width: 80, height: 60, rotation: 0, label: 'SW-01', style: defaultNodeStyle },
        { id: 'n_sw2', type: 'device', assetId: 'a_sw2', diagramMode: 'topology', floorId: 'fl_1', x: 350, y: 220, width: 80, height: 60, rotation: 0, label: 'SW-02', style: defaultNodeStyle },
        { id: 'n_cam1', type: 'device', assetId: 'a_cam1', diagramMode: 'topology', floorId: 'fl_1', x: 550, y: 100, width: 80, height: 60, rotation: 0, label: 'CAM-01', style: defaultNodeStyle }
      ],
      cables: [
        {
          id: 'c_cu_1',
          cableCode: 'CU-01',
          diagramMode: 'topology',
          sourceNodeId: 'n_sw1',
          targetNodeId: 'n_cam1',
          cableType: 'CAT6_UTP',
          bandwidth: '1G',
          color: '#0284c7',
          routingType: 'orthogonal',
          lineStyle: 'solid',
          strokeWidth: 2,
          lengthMeters: 180,
          status: 'active'
        },
        {
          id: 'c_cu_2',
          cableCode: 'CU-02',
          diagramMode: 'topology',
          sourceNodeId: 'n_sw2',
          targetNodeId: 'n_cam1',
          cableType: 'CAT6_UTP',
          bandwidth: '1G',
          color: '#0284c7',
          routingType: 'orthogonal',
          lineStyle: 'solid',
          strokeWidth: 2,
          lengthMeters: 160,
          status: 'active'
        },
        {
          id: 'c_fb_1',
          cableCode: 'FB-01',
          diagramMode: 'topology',
          sourceNodeId: 'n_sw1',
          targetNodeId: 'n_sw2',
          cableType: 'FIBER_SM_OS2',
          bandwidth: '10G',
          color: '#f59e0b',
          routingType: 'orthogonal',
          lineStyle: 'solid',
          strokeWidth: 2,
          lengthMeters: 400,
          status: 'active'
        }
      ]
    };

    const stats = computeProjectBomStats(handProject, {
      copperLossPct: 15,
      fiberLossPct: 10,
      serviceLoopMetersPerEnd: 3,
      copperSpoolMeters: 305,
      fiberSpoolMeters: 1000
    });

    assert.equal(stats.kpis.deviceCount, 5);
    assert.equal(stats.kpis.rackCount, 1);
    assert.equal(stats.kpis.totalPowerWatts, 545);
    assert.equal(stats.kpis.recommendedUpsVa, 886);
    assert.equal(stats.kpis.totalWeightKg, 121.4);
    assert.equal(stats.kpis.rawCableMeters, 740);
    assert.equal(stats.kpis.totalCableWithReserveMeters, 851.4);

    const cuRow = stats.cableRows.find(r => r.cableType === 'CAT6_UTP')!;
    assert.equal(cuRow.rawMeters, 340);
    assert.equal(cuRow.serviceLoopMeters, 12);
    assert.equal(cuRow.totalWithReserveMeters, 404.8);
    assert.equal(cuRow.estimatedSpools, 2);

    const fbRow = stats.cableRows.find(r => r.cableType === 'FIBER_SM_OS2')!;
    assert.equal(fbRow.rawMeters, 400);
    assert.equal(fbRow.serviceLoopMeters, 6);
    assert.equal(fbRow.totalWithReserveMeters, 446.6);
    assert.equal(fbRow.estimatedSpools, 1);
    assert.equal(stats.precision.isConsistent, true);
  });

  // 31. Layer Policy Trays, Counts & SVG Hidden Layer Filter Tests (Group 1)
  await runTest('layerPolicy & svgExport: includes trays & semantic layers, enforces tray locks, counts objects per layer & filters hidden SVG layers', () => {
    assert.ok(LAYER_CATALOG.some(l => l.id === 'trays'));
    assert.ok(LAYER_CATALOG.some(l => l.id === 'network'));
    assert.ok(LAYER_CATALOG.some(l => l.id === 'iot'));
    assert.ok(LAYER_CATALOG.some(l => l.id === 'electrical'));
    assert.equal(LAYER_CATALOG.length, 12);

    assert.equal(isTrayEffectivelyLocked({ id: 'tr_1', locked: false }, { lockedLayers: ['trays'] }), true);
    assert.equal(isTrayEffectivelyLocked({ id: 'tr_1', locked: true }, {}), true);
    assert.equal(isTrayEffectivelyLocked({ id: 'tr_1', locked: false }, {}, true), true);
    assert.equal(isTrayEffectivelyLocked({ id: 'tr_1', locked: false }, {}), false);

    const sample = createMultiFloorSampleOfficeProject();
    sample.cableTrays = [
      { id: 'tray_1', name: 'Máng trục chính', floorId: sample.activeFloorId, kind: 'network_tray', widthPx: 24, points: [{ x: 100, y: 100 }, { x: 400, y: 100 }] }
    ];
    const counts = computeLayerObjectCounts(sample, sample.activeFloorId);
    assert.equal(counts.trays, 1);
    assert.ok(counts.racks >= 1);
    assert.ok(counts.devices >= 1);
    assert.ok(counts.cables >= 1);

    const hiddenSvg = generatePureSvgMarkup({
      ...sample,
      settings: {
        ...sample.settings,
        hiddenLayers: ['cables', 'cable_labels']
      }
    });
    assert.ok(!hiddenSvg.includes('data-layer="cable-labeling"'));
  });

  // 32. Unified Command Center Accent-Insensitive Matching Tests (Group 3)
  await runTest('helpCatalog: matches unaccented Vietnamese commands & help topics for unified Command Center', () => {
    assert.equal(matchesAccentInsensitiveQuery('Xem Thống kê Vật tư & Dự toán (BOM)', 'bom vat tu'), true);
    assert.equal(matchesAccentInsensitiveQuery('In / Xuất bản vẽ PDF A4', 'xuat pdf'), true);
    assert.equal(matchesAccentInsensitiveQuery('Tự định tuyến toàn bộ tuyến cáp', 'tu dinh tuyen'), true);
    assert.equal(matchesAccentInsensitiveQuery('Kiểm tra kỹ thuật · Kiểm tra trùng IP', 'ip trung'), true);

    const wireGuide = searchHelpCatalog('huong dan noi day');
    assert.ok(wireGuide.some(t => t.id === 'help-drag-connect'));
  });

  // 33. Auto-Routing Obstacle Avoidance & Manual Control Point Preservation Tests (Group 4)
  await runTest('cableRouting: auto-routes around obstacles cleanly and preserves manual controlPoints during bundling', () => {
    const src = { x: 40, y: 180, width: 80, height: 60 };
    const tgt = { x: 440, y: 180, width: 80, height: 60 };
    const obstacle = { id: 'obs_mid', x: 230, y: 130, width: 100, height: 160 };

    const routed = computeAutoRoutedWaypoints(src, tgt, [obstacle], { clearancePx: 20 });
    assert.equal(routed.routingType, 'orthogonal');
    assert.ok(routed.avoidedObstacles >= 1);
    assert.ok(routed.controlPoints.length >= 2);

    const path = computeCablePath(
      {
        id: 'cab_auto',
        cableCode: 'AUTO-01',
        diagramMode: 'topology',
        sourceNodeId: 's',
        targetNodeId: 't',
        cableType: 'CAT6_UTP',
        bandwidth: '1G',
        color: '#0284c7',
        routingType: 'orthogonal',
        lineStyle: 'solid',
        strokeWidth: 2,
        lengthMeters: 10,
        status: 'active',
        controlPoints: routed.controlPoints
      },
      src,
      tgt
    );
    assert.ok(path.lengthPx > 400);

    const manualCable: CableEdge = {
      id: 'cab_manual',
      cableCode: 'MAN-01',
      diagramMode: 'topology',
      sourceNodeId: 's',
      targetNodeId: 't',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#0284c7',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 15,
      status: 'active',
      controlPoints: [{ x: 280, y: 80 }]
    };
    const bundle = computeCableBundleLayout([manualCable], id => (id === 's' ? src : tgt));
    assert.equal(bundle.cableOffsets.get('cab_manual'), 0);
  });

  // 34. Feedback URL Safety Tests
  await runTest('appInfo: buildFeedbackFormUrl returns null when unconfigured without emitting placeholder entry IDs', () => {
    assert.equal(isFeedbackFormConfigured(), false);
    assert.equal(buildFeedbackFormUrl({ activeMode: 'topology', deviceType: 'Desktop' }), null);
  });

  // 35. Security Payload Limits, SVG Guard & Populated Feedback Prefill Tests (A3 & A5)
  await runTest('security & appInfo: enforces import payload/entity caps, blocks unsafe SVG images/use & formats feedback prefill URL cleanly', async () => {
    assert.equal(
      formatFeedbackPrefillUrl('https://docs.google.com/forms/d/e/test/viewform', {}, { activeMode: 'fiber', deviceType: 'Desktop' }),
      'https://docs.google.com/forms/d/e/test/viewform?usp=pp_url'
    );
    const fullPrefill = formatFeedbackPrefillUrl(
      'https://docs.google.com/forms/d/e/test/viewform',
      {
        version: 'entry.1001',
        build: 'entry.1002',
        mode: 'entry.1003',
        device: 'entry.1004'
      },
      { activeMode: 'floorplan', deviceType: 'Tablet', version: '3.1.1', buildHash: 'abc123' }
    );
    assert.ok(fullPrefill?.includes('entry.1001=3.1.1'));
    assert.ok(fullPrefill?.includes('entry.1002=abc123'));
    assert.ok(fullPrefill?.includes('entry.1003=floorplan'));
    assert.ok(fullPrefill?.includes('entry.1004=Tablet'));

    // Reject dangerous <image> and <use> SVG patterns
    assert.equal(isSafeSvgContent('<svg><image href="https://evil.example/track.png"/></svg>'), false);
    assert.equal(isSafeSvgContent('<svg><use xlink:href="https://evil.example/sprite.svg#x"/></svg>'), false);
    assert.equal(isSafeSvgContent('<svg viewBox="0 0 24 24"><rect width="24" height="24" fill="#155eef"/></svg>'), true);

    // Reject oversized file size checks & project node limit
    const sizeFail = checkImportPayloadSize({ size: MAX_IMPORT_JSON_BYTES + 1024 }, MAX_IMPORT_JSON_BYTES, 'test.hachihi.json');
    assert.equal(sizeFail.ok, false);
    const scannerSample = createMultiFloorSampleOfficeProject();
    assert.throws(() => {
      const fakeBigScanner = 'x'.repeat(MAX_SCANNER_FILE_BYTES + 128);
      importNetworkScannerData(fakeBigScanner, scannerSample);
    }, /vượt quá giới hạn an toàn/i);

    const tooManyNodes = Array.from({ length: MAX_PROJECT_NODES + 1 }, (_, i) => ({
      id: `n_${i}`,
      diagramMode: 'topology',
      type: 'device',
      label: `N${i}`,
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: 0,
      style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
    }));
    const capRes = migrateAndValidateProject({ assets: {}, nodes: tooManyNodes });
    assert.equal(capRes.ok, false);
  });

  // 36. Deep 8-Mode + CableTray + Directory + Unknown-Field Round-Trip Package Tests (D6)
  await runTest('projectPackage: preserves all 8 design modes, cableTrays, VLAN/Subnet/PatchLink & reports unknown fields on round-trip', async () => {
    const base = createMultiFloorSampleOfficeProject();
    const modes: Array<ProjectState['activeMode']> = [
      'topology',
      'floorplan',
      'rack',
      'fiber',
      'cctv',
      'wifi',
      'electrical',
      'multisite'
    ];
    modes.forEach((mode, idx) => {
      base.nodes.push({
        id: `mode_node_${idx}`,
        diagramMode: mode,
        floorId: base.activeFloorId,
        type: 'text',
        label: `Mode ${mode}`,
        x: 100 + idx * 40,
        y: 120,
        width: 120,
        height: 48,
        rotation: 0,
        style: { backgroundColor: '#0284c7', borderColor: '#0f172a', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' }
      });
    });
    base.cableTrays = [
      {
        id: 'tray_rt_1',
        name: 'Máng cáp trục chính',
        floorId: base.activeFloorId,
        kind: 'network_tray',
        widthPx: 32,
        points: [{ x: 50, y: 50 }, { x: 450, y: 50 }]
      }
    ];
    base.vlans = [{ id: 'v10', vlanId: 10, name: 'VLAN 10 Data' }];
    base.subnets = [{ id: 's10', name: 'Office LAN', cidr: '10.10.10.0/24', vlanId: 10, gateway: '10.10.10.1' }];
    base.patchLinks = [{ id: 'p1', patchPanelAssetId: 'pp_1', patchPort: 'P01', targetDeviceName: 'SW-01', targetPort: 'Gi1/0/1' }];

    const { jsonString } = await createProjectPackage(base, { embedExternalImages: false });
    const parsedPkg = JSON.parse(jsonString) as Record<string, unknown>;
    (parsedPkg.project as Record<string, unknown>).experimentalExtension = 'kept_in_skipped_report';

    const inspected = await inspectProjectImportPayload(parsedPkg, []);
    assert.equal(inspected.ok, true);
    if (inspected.ok && inspected.kind === 'package') {
      assert.equal(inspected.project.cableTrays?.length, 1);
      assert.equal(inspected.project.cableTrays?.[0].name, 'Máng cáp trục chính');
      assert.equal(inspected.project.vlans?.length, 1);
      assert.equal(inspected.project.subnets?.length, 1);
      assert.equal(inspected.project.patchLinks?.length, 1);
      for (const m of modes) {
        assert.ok(inspected.project.nodes.some(n => n.diagramMode === m));
      }
      assert.ok(inspected.skippedFields.includes('project.experimentalExtension'));
    }
  });

  // 37. Three Benchmark BOM Projects + Vertical Drop/Rise + B4 IDs + B5 Warnings (B9)
  await runTest('bomAggregator: verifies 3 benchmark projects (small office, 2-floor cross-riser, mixed PoE deficit & B4/B5 trace)', () => {
    // Benchmark 1: Small single-floor office (Router + PoE Switch + 2 AP + 3 Cameras + 5x Cat6 @ 20m = 100m raw)
    const bm1 = createEnterpriseTopologyProject();
    bm1.floors = [{ id: 'f1', buildingId: 'b1', name: 'Tầng 1', level: 1, widthMeters: 30, depthMeters: 20, description: 'VP nhỏ' }];
    bm1.buildings = [{ id: 'b1', name: 'VP', totalFloors: 1, basementFloors: 0, floorHeightMeters: 3.5, widthMeters: 30, depthMeters: 20, wallThicknessMm: 200, layoutStyle: 'rectangle' }];
    bm1.racks = [];
    bm1.rooms = [];
    bm1.assets = {
      a_rtr: { id: 'a_rtr', name: 'RTR-01', category: 'router', vendor: 'MikroTik', model: 'RB5009', assetTag: 'R1', serialNumber: '', ipAddress: '192.168.1.1', subnetMask: '255.255.255.0', gateway: '', macAddress: '', vlan: '1', status: 'online', powerWatts: 20, weightKg: 1.2, floorId: 'f1', ports: [] },
      a_sw: { id: 'a_sw', name: 'SW-POE-01', category: 'switch', vendor: 'Cisco', model: 'C1200-24P', assetTag: 'S1', serialNumber: '', ipAddress: '192.168.1.2', subnetMask: '255.255.255.0', gateway: '192.168.1.1', macAddress: '', vlan: '1', status: 'online', powerWatts: 180, poeBudgetWatts: 195, weightKg: 4.0, floorId: 'f1', ports: [] },
      a_ap1: { id: 'a_ap1', name: 'AP-01', category: 'ap', vendor: 'Ubiquiti', model: 'U6-Pro', assetTag: 'A1', serialNumber: '', ipAddress: '192.168.1.11', subnetMask: '255.255.255.0', gateway: '192.168.1.1', macAddress: '', vlan: '10', status: 'online', powerWatts: 13, weightKg: 0.5, floorId: 'f1', ports: [] },
      a_ap2: { id: 'a_ap2', name: 'AP-02', category: 'ap', vendor: 'Ubiquiti', model: 'U6-Pro', assetTag: 'A2', serialNumber: '', ipAddress: '192.168.1.12', subnetMask: '255.255.255.0', gateway: '192.168.1.1', macAddress: '', vlan: '10', status: 'online', powerWatts: 13, weightKg: 0.5, floorId: 'f1', ports: [] },
      a_cam1: { id: 'a_cam1', name: 'CAM-01', category: 'camera', vendor: 'Hikvision', model: 'DS-2CD2143', assetTag: 'C1', serialNumber: '', ipAddress: '192.168.1.21', subnetMask: '255.255.255.0', gateway: '192.168.1.1', macAddress: '', vlan: '20', status: 'online', powerWatts: 8, weightKg: 0.4, floorId: 'f1', ports: [] },
      a_cam2: { id: 'a_cam2', name: 'CAM-02', category: 'camera', vendor: 'Hikvision', model: 'DS-2CD2143', assetTag: 'C2', serialNumber: '', ipAddress: '192.168.1.22', subnetMask: '255.255.255.0', gateway: '192.168.1.1', macAddress: '', vlan: '20', status: 'online', powerWatts: 8, weightKg: 0.4, floorId: 'f1', ports: [] }
    };
    bm1.nodes = [
      { id: 'nr1', diagramMode: 'topology', floorId: 'f1', type: 'device', assetId: 'a_rtr', label: 'RTR-01', x: 50, y: 50, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' } },
      { id: 'ns1', diagramMode: 'topology', floorId: 'f1', type: 'device', assetId: 'a_sw', label: 'SW-POE-01', x: 250, y: 50, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' } },
      { id: 'na1', diagramMode: 'topology', floorId: 'f1', type: 'device', assetId: 'a_ap1', label: 'AP-01', x: 450, y: 50, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' } },
      { id: 'na2', diagramMode: 'topology', floorId: 'f1', type: 'device', assetId: 'a_ap2', label: 'AP-02', x: 450, y: 150, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' } },
      { id: 'nc1', diagramMode: 'topology', floorId: 'f1', type: 'device', assetId: 'a_cam1', label: 'CAM-01', x: 650, y: 50, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' } },
      { id: 'nc2', diagramMode: 'topology', floorId: 'f1', type: 'device', assetId: 'a_cam2', label: 'CAM-02', x: 650, y: 150, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1, textColor: '#fff' } }
    ];
    bm1.cables = [
      { id: 'c1', cableCode: 'CAB-01', diagramMode: 'topology', sourceNodeId: 'nr1', targetNodeId: 'ns1', sourcePortId: 'eth1', targetPortId: 'Gi1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 5, status: 'active' },
      { id: 'c2', cableCode: 'CAB-02', diagramMode: 'topology', sourceNodeId: 'ns1', targetNodeId: 'na1', sourcePortId: 'Gi2', targetPortId: 'eth0', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 25, status: 'active' },
      { id: 'c3', cableCode: 'CAB-03', diagramMode: 'topology', sourceNodeId: 'ns1', targetNodeId: 'na2', sourcePortId: 'Gi3', targetPortId: 'eth0', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 25, status: 'active' },
      { id: 'c4', cableCode: 'CAB-04', diagramMode: 'topology', sourceNodeId: 'ns1', targetNodeId: 'nc1', sourcePortId: 'Gi4', targetPortId: 'eth0', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 20, status: 'active' },
      { id: 'c5', cableCode: 'CAB-05', diagramMode: 'topology', sourceNodeId: 'ns1', targetNodeId: 'nc2', sourcePortId: 'Gi5', targetPortId: 'eth0', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 25, status: 'active' }
    ];
    const s1 = computeProjectBomStats(bm1, { copperLossPct: 15, serviceLoopMetersPerEnd: 3, dropHeightMeters: 1.5 });
    // 5 cables * (2*3 loop + 2*1.5 drop) = 45m extra + 100m raw = 145m * 1.15 = 166.8m -> 1 spool (305m)
    assert.equal(s1.kpis.deviceCount, 6);
    assert.equal(s1.kpis.rawCableMeters, 100);
    assert.equal(s1.cableRows[0].dropHeightMeters, 15);
    assert.equal(s1.cableRows[0].serviceLoopMeters, 30);
    assert.equal(s1.cableRows[0].totalWithReserveMeters, 166.8);
    assert.equal(s1.cableRows[0].estimatedSpools, 1);
    assert.equal(s1.cableRows[0].cableIds.length, 5);
    const apGroup = s1.deviceRows.find(d => d.model === 'U6-Pro')!;
    assert.equal(apGroup.nodeIds.length, 2);

    // Benchmark 2: Two-floor cross-riser Fiber trunk (level 1 -> level 3, floorHeight = 4m => +8m vertical rise)
    const bm2 = structuredClone(bm1);
    bm2.floors = [
      { id: 'f1', buildingId: 'b1', name: 'Tầng 1', level: 1, widthMeters: 30, depthMeters: 20, description: '' },
      { id: 'f3', buildingId: 'b1', name: 'Tầng 3', level: 3, widthMeters: 30, depthMeters: 20, description: '' }
    ];
    bm2.buildings = [{ id: 'b1', name: 'Tower', totalFloors: 3, basementFloors: 0, floorHeightMeters: 4, widthMeters: 30, depthMeters: 20, wallThicknessMm: 200, layoutStyle: 'rectangle' }];
    bm2.nodes[2].floorId = 'f3';
    bm2.cables = [
      { id: 'cf1', cableCode: 'FO-01', diagramMode: 'fiber', sourceNodeId: 'ns1', targetNodeId: 'na1', sourcePortId: 'SFP1', targetPortId: 'SFP1', cableType: 'FIBER_MM_OM4', bandwidth: '10G', color: '#f59e0b', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 42, status: 'active' }
    ];
    const s2 = computeProjectBomStats(bm2, { fiberLossPct: 10, serviceLoopMetersPerEnd: 3, dropHeightMeters: 1 });
    // (42 horizontal + 8 cross-floor + 2 drop + 6 loop) = 58 * 1.10 = 63.8m
    assert.equal(s2.cableRows[0].verticalRiseMeters, 8);
    assert.equal(s2.cableRows[0].dropHeightMeters, 2);
    assert.equal(s2.cableRows[0].totalWithReserveMeters, 63.8);
    assert.equal(s2.precision.deltaMeters, 0);

    // Benchmark 3: Multi-floor sample office -> verify B5 warnings & 3-way reconciliation
    const bm3 = createMultiFloorSampleOfficeProject();
    // Inject a standard unspec device and unported cable to verify B5 warnings
    bm3.assets['a_unspec'] = {
      id: 'a_unspec', name: 'TB-CHUA-SPEC', category: 'switch', vendor: 'Generic', model: 'Standard',
      assetTag: '', serialNumber: '', ipAddress: '', subnetMask: '255.255.255.0', gateway: '', macAddress: '',
      vlan: '1', status: 'online', powerWatts: 0, weightKg: 1, floorId: bm3.activeFloorId, ports: []
    };
    bm3.cables.push({
      id: 'c_auto_port', cableCode: 'AUTO-PORT', diagramMode: 'topology',
      sourceNodeId: bm3.nodes[0].id, targetNodeId: bm3.nodes[1].id,
      cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid',
      strokeWidth: 2, lengthMeters: 15, status: 'active'
    });
    const s3 = computeProjectBomStats(bm3);
    assert.equal(s3.precision.isConsistent, true);
    assert.ok(s3.precision.warnings.some(w => w.code === 'MISSING_PORT_ASSIGNMENT'));
    assert.ok(s3.precision.warnings.some(w => w.code === 'MISSING_DEVICE_SPECS'));
  });

  // 38. Standard Network Templates (LAN / WAN / Core-Dist)
  await runTest('standardNetworkTemplates: validates all 5 templates pass audit & BOM reconciliation', () => {
    const stdIds = [
      'tpl_std_lan_star',
      'tpl_std_lan_vlan_dmz',
      'tpl_std_wan_dual_isp',
      'tpl_std_core_dist_3tier',
      'tpl_std_collapsed_core'
    ];
    for (const id of stdIds) {
      const entry = ARCHITECTURE_TEMPLATES.find(t => t.id === id);
      assert.ok(entry, `Missing template ${id}`);
      const proj = entry.createProject();
      assert.ok(proj.nodes.length >= 4, `${id} should have nodes`);
      assert.ok(proj.cables.length >= 3, `${id} should have cables`);
      const audit = runEngineeringAudit(proj);
      const errors = audit.issues.filter(i => i.severity === 'error');
      assert.equal(errors.length, 0, `${id} audit errors: ${errors.map(e => e.title).join('; ')}`);
      const bom = computeProjectBomStats(proj);
      assert.equal(bom.precision.isConsistent, true, `${id} BOM reconciliation failed`);
    }
  });

  // 39. Group B: Tray BOM, SKU/Pricing Catalog Overrides, Multi-View Breakdown, Spool Optimization & BOM Diff
  await runTest('bomAggregator & bomPricingCatalog: tray BOM, SKU pricing overrides, multi-view, FFD spools & version diff', () => {
    const base = createMultiFloorSampleOfficeProject();
    base.cableTrays = [
      {
        id: 'tray_bom_1',
        name: 'Máng cáp trục tầng 1',
        floorId: base.floors[0].id,
        kind: 'network_tray',
        widthPx: 36,
        points: [
          { x: 100, y: 100 },
          { x: 400, y: 100 },
          { x: 400, y: 250 }
        ]
      }
    ];
    // Raw pixel length = 300 + 150 = 450px @ scale 30px/m = 15m -> expect acc_tray_straight
    const stats = computeProjectBomStats(base, {
      priceOverrides: { 'cable::CAT6_UTP': 15_000 }
    });
    assert.ok(stats.inferredAccessories.some(a => a.id === 'acc_tray_straight' && a.orderQty >= 15));
    assert.ok(stats.floorRows.length >= 2);
    assert.ok(stats.roomRows.length >= 1);
    assert.ok(stats.systemRows.length >= 1);
    assert.ok(stats.rackSummaryRows.length >= 1);
    assert.ok(stats.kpis.estimatedGrandTotalVnd > 0);

    // Pricing catalog lookup & safe localStorage guard
    const skuEntry = resolveDeviceSkuAndPrice('k1', 'switch', 'Cisco', 'Catalyst C9300-48P', { 'CS-C9300-48P': 70_000_000 });
    assert.equal(skuEntry.sku, 'CS-C9300-48P');
    assert.equal(skuEntry.unitPriceVnd, 70_000_000);
    const cabSku = resolveCableSkuAndPrice('CAT6_UTP', { 'cable::CAT6_UTP': 19_000 });
    assert.equal(cabSku.unitPriceVnd, 19_000);
    saveBomPriceOverrides({ 'cable::CAT6_UTP': 19_000 });
    void loadBomPriceOverrides();
    clearBomPriceOverrides();

    // FFD Spool cut optimizer
    const spoolPlans = optimizeCableSpools(base);
    assert.ok(spoolPlans.length >= 1);
    for (const plan of spoolPlans) {
      assert.ok(plan.optimizedSpools >= 1);
      assert.ok(plan.overallUtilizationPct > 0 && plan.overallUtilizationPct <= 100);
    }

    // Compare two BOM versions
    const modified = structuredClone(base);
    modified.cables.push({
      id: 'c_extra_diff',
      cableCode: 'DIFF-01',
      diagramMode: 'topology',
      sourceNodeId: modified.nodes[0].id,
      targetNodeId: modified.nodes[1].id,
      sourcePortId: 'Gi1/0/20',
      targetPortId: 'Gi1/0/20',
      cableType: 'CAT6_UTP',
      bandwidth: '1G',
      color: '#0284c7',
      routingType: 'orthogonal',
      lineStyle: 'solid',
      strokeWidth: 2,
      lengthMeters: 50,
      status: 'active'
    });
    const modifiedStats = computeProjectBomStats(modified);
    const diff = compareProjectBoms(stats, modifiedStats);
    assert.ok(diff.kpis.cableMetersDelta > 0);
    assert.ok(diff.kpis.estimatedCostDeltaVnd > 0);
  });

  // 40. Group E (E2-E5): Free U Blocks, PDU Outlets, L2 Loop Detector, Bulk CSV IP, Optical Loss & UPS/Outage
  await runTest('Group E2-E5: rack free blocks, PDU outlets, L2 loop detection, bulk IP CSV, optical budget & UPS runtime', () => {
    const rackProj = createServerRackProject();
    const rack = rackProj.racks[0];
    const freeBlocks = findContiguousFreeUBlocks(rack, rackProj.assets, 2, 'front');
    assert.ok(freeBlocks.length >= 1);
    assert.ok(freeBlocks.every(b => b.size >= 2));

    const pduSummary = computeRackPduOutletSummary(rack, rackProj.assets);
    assert.ok(pduSummary.poweredDeviceCount >= 1);

    // L2 Switching Loop Detection (3 switches in a triangle)
    const loopProj = createEnterpriseTopologyProject();
    const swAssets = Object.values(loopProj.assets).filter(a => a.category === 'switch' || a.category === 'core_switch');
    const swNodes = swAssets
      .map(a => loopProj.nodes.find(n => n.assetId === a.id && n.diagramMode === 'topology'))
      .filter((n): n is NonNullable<typeof n> => Boolean(n));
    if (swNodes.length >= 3) {
      loopProj.cables.push(
        { id: 'lp1', cableCode: 'LP1', diagramMode: 'topology', sourceNodeId: swNodes[0].id, targetNodeId: swNodes[1].id, cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 5, status: 'active' },
        { id: 'lp2', cableCode: 'LP2', diagramMode: 'topology', sourceNodeId: swNodes[1].id, targetNodeId: swNodes[2].id, cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 5, status: 'active' },
        { id: 'lp3', cableCode: 'LP3', diagramMode: 'topology', sourceNodeId: swNodes[2].id, targetNodeId: swNodes[0].id, cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'orthogonal', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 5, status: 'active' }
      );
      const loops = detectL2SwitchingLoops(loopProj);
      assert.ok(loops.length >= 1, 'Expected triangle switching loop to be detected');
    }

    // Bulk static IP CSV import
    const firstAsset = Object.values(loopProj.assets)[0];
    const bulkRes = parseAndApplyBulkStaticIpsCsv(
      `target,ipAddress,subnetMask,gateway,vlan\n${firstAsset.name},10.99.0.10,255.255.255.0,10.99.0.1,99\nbad_device,999.1.1.1`,
      loopProj
    );
    assert.equal(bulkRes.updatedCount, 1);
    assert.equal(bulkRes.updatedAssets[firstAsset.id].ipAddress, '10.99.0.10');
    assert.ok(bulkRes.errors.length >= 1);

    // Optical link budget
    const smOk = computeOpticalLinkBudget({ cableType: 'FIBER_SM_OS2', lengthMeters: 1000, connectorCount: 2, spliceCount: 2 });
    assert.equal(smOk.status, 'nominal');
    assert.ok(smOk.totalLossDb < 2);
    const mmBad = computeOpticalLinkBudget({ cableType: 'FIBER_MM_OM4', lengthMeters: 1500, connectorCount: 4, spliceCount: 4 });
    assert.equal(mmBad.status, 'exceeded');

    // UPS battery runtime & branch outage simulator
    const ups = computeUpsBatteryRuntime({ totalLoadWatts: 500, batteryAh: 100, batteryVoltageV: 48, batteryCount: 1 });
    assert.ok(ups.runtimeMinutes > 300);
    assert.equal(ups.status, 'adequate');
    const starProj = ARCHITECTURE_TEMPLATES.find(t => t.id === 'tpl_std_lan_star')!.createProject();
    const swNode = starProj.nodes.find(n => n.assetId && starProj.assets[n.assetId]?.category === 'switch')!;
    const outage = simulateBranchOutage(starProj, [swNode.id]);
    assert.ok(outage.affectedDownstreamDevices.length >= 1);
    assert.ok(outage.lostTotalWatts > 0);
  });

  // 41. Group E (E6-E7): Wall Attenuation, Tray-Aware Routing, Scanner Diff-Merge & Revision Diff
  await runTest('Group E6-E7: wall RSSI attenuation, tray routing, scanner diff-merge & detailed revision diff', () => {
    const proj = createMultiFloorSampleOfficeProject();
    const wallSegments = collectFloorWallSegments(proj, proj.activeFloorId);
    assert.ok(wallSegments.length >= 4);
    const crossing = computeSegmentWallCrossings({ x: 0, y: 0 }, { x: 2000, y: 2000 }, wallSegments);
    assert.ok(crossing.crossingCount >= 1);
    assert.ok(crossing.totalAttenuationDb > 0);

    const openRssi = estimateWifiRssiDbm({ x: 50, y: 50 }, { x: 150, y: 50 }, 20, 30, []);
    const blockedRssi = estimateWifiRssiDbm({ x: 50, y: 50 }, { x: 150, y: 50 }, 20, 30, [
      { x1: 100, y1: 0, x2: 100, y2: 100, material: 'concrete', opaque: true }
    ]);
    assert.ok(blockedRssi.estimatedRssiDbm <= openRssi.estimatedRssiDbm - 12);

    // Tray-aware auto-routed waypoints
    const routed = computeAutoRoutedWaypoints(
      { x: 50, y: 200, width: 100, height: 50 },
      { x: 500, y: 220, width: 100, height: 50 },
      [{ id: 'obs1', x: 250, y: 170, width: 120, height: 150 }],
      {
        preferredTrays: [
          { id: 't1', name: 'Máng T1', floorId: proj.activeFloorId, kind: 'network_tray', widthPx: 16, points: [{ x: 100, y: 126 }, { x: 550, y: 126 }] }
        ]
      }
    );
    assert.ok(routed.controlPoints.some(pt => Math.abs(pt.y - 126) <= 2), 'Expected cable waypoint to route through tray anchor y=126');

    // NetworkScanner diff-merge
    const csv = 'Name,IP,MAC,Vendor,Category\nCORE-SW-NEW,10.10.10.250,AA:BB:CC:DD:EE:01,Cisco,switch';
    const merge1 = diffMergeNetworkScannerData(csv, proj);
    assert.equal(merge1.addedCount, 1);
    const afterMerge = { ...proj, assets: merge1.assets, nodes: merge1.nodes, cables: merge1.cables };
    const csvUpdate = 'Name,IP,MAC,Vendor,Category\nCORE-SW-RENAMED,10.10.10.250,AA:BB:CC:DD:EE:01,Cisco,switch';
    const merge2 = diffMergeNetworkScannerData(csvUpdate, afterMerge);
    assert.equal(merge2.updatedCount, 1);

    // Detailed revision diff
    const revSnap = structuredClone(proj);
    const curProj = structuredClone(proj);
    const firstKey = Object.keys(curProj.assets)[0];
    curProj.assets[firstKey] = { ...curProj.assets[firstKey], name: 'RENAMED-ASSET-DIFF' };
    const revDiff = computeDetailedRevisionDiff(curProj, revSnap);
    assert.ok(revDiff.modifiedAssets.length >= 1);
    assert.equal(revDiff.summary.addedAssets, 0);
  });

  // 42. Draggable Reference Guide Lines: Smart Snap & Package Persistence
  await runTest('snapGuides & projectPackage: snaps dragged nodes to horizontal/vertical reference guide lines and persists guideLines', async () => {
    const snapRes = computeSmartSnap(
      { x: 196, y: 147, width: 100, height: 50 },
      [],
      8,
      [
        { orientation: 'vertical', pos: 200 },
        { orientation: 'horizontal', pos: 150 }
      ]
    );
    assert.equal(snapRes.dx, 4);
    assert.equal(snapRes.dy, 3);
    assert.equal(snapRes.guides.length, 2);
    assert.ok(snapRes.guides.every(g => g.sourceKind === 'guide'));

    const sample = createMultiFloorSampleOfficeProject();
    sample.settings.guideLines = [
      { id: 'g_h1', orientation: 'horizontal', pos: 240, floorId: sample.activeFloorId },
      { id: 'g_v1', orientation: 'vertical', pos: 360, floorId: sample.activeFloorId }
    ];
    const mig = migrateAndValidateProject(sample);
    assert.equal(mig.ok, true);
    if (mig.ok) {
      assert.equal(mig.project.settings.guideLines?.length, 2);
      assert.equal(mig.project.settings.guideLines?.[0].pos, 240);
      assert.equal(mig.project.settings.guideLines?.[1].orientation, 'vertical');
    }

    const { jsonString } = await createProjectPackage(sample, {
      includeRevisions: false,
      includeFullCustomLibrary: false,
      embedExternalImages: false,
      revisionsOverride: [],
      customLibraryOverride: []
    });
    const parsed = await inspectProjectImportPayload(jsonString, []);
    assert.equal(parsed.ok, true);
    if (parsed.ok && parsed.kind === 'package') {
      assert.equal(parsed.skippedFields.length, 0);
      assert.equal(parsed.project.settings.guideLines?.length, 2);
    }
  });

  // 43. Hierarchical Router Tree Excel Template, Parser, Layouts (Vertical/Horizontal/By-Floor) & New/Merge Project Builder
  await runTest('excelTreeImporter: builds 2-sheet template, parses parent-child uplinks, computes non-overlapping layouts & merges safely', async () => {
    // 1) Built-in 4-tier/4-floor sample matches 10 nodes, 9 links, 4 floors, depth 4
    const sample = buildSampleRouterTreePreview();
    assert.equal(sample.nodes.length, 10);
    assert.equal(sample.links.length, 9);
    assert.equal(sample.floors.length, 4);
    assert.equal(sample.maxDepth, 4);
    assert.deepEqual(sample.rootNames, ['Router-A1']);
    assert.ok(sample.links.some(l => l.isCrossFloor));

    // 2) Generated .xlsx workbook contains 2 sheets and round-trips through XLSX parser cleanly
    const wb = buildRouterTreeTemplateWorkbook();
    assert.deepEqual(wb.worksheets.map(ws => ws.name), ['So_Do_Router_Cay', 'Huong_Dan_Nhap']);
    const xlsxBuf = await wb.xlsx.writeBuffer();
    const parsedXlsx = await parseRouterTreeExcelPayload(xlsxBuf, 'HACHIHI_Mau_So_Do_Router_Da_Tang.xlsx');
    assert.equal(parsedXlsx.nodes.length, 10);
    assert.equal(parsedXlsx.links.length, 9);
    assert.equal(parsedXlsx.floors.length, 4);
    assert.equal(parsedXlsx.maxDepth, 4);

    // 3) CSV with redundant comma-separated parent uplinks and missing parent warning
    const csvPayload = [
      'Tên Thiết Bị,Router Cha (Uplink),Loại Thiết Bị,Hãng,Model,IP,VLAN,Tầng / Khu Vực,Loại Cáp Kết Nối,Cổng Cha,Cổng Con,Công Suất (W),Ghi Chú',
      'Core-01,,router,MikroTik,CCR2116,10.0.0.1,10,Tầng 1,Quang OS2 (10G),,,85,Root',
      'Core-02,,router,MikroTik,CCR2116,10.0.0.2,10,Tầng 1,Quang OS2 (10G),,,85,Backup Root',
      'Dist-01,"Core-01, Core-02",core_switch,Cisco,C9500,10.1.0.1,10,Tầng 2,Quang OS2 (10G),SFP+1,SFP+1,140,Dual uplink',
      'Edge-01,Missing-Parent,switch,Aruba,6200F,10.2.0.1,20,Tầng 3,Cat6A STP (10G),eth1,wan1,65,Missing parent test'
    ].join('\n');
    const parsedCsv = await parseRouterTreeExcelPayload(new TextEncoder().encode(csvPayload), 'custom_tree.csv');
    assert.equal(parsedCsv.nodes.length, 4);
    // Dist-01 has 2 links (Core-01 & Core-02); Edge-01 missing parent warns
    assert.equal(parsedCsv.links.length, 2);
    assert.ok(parsedCsv.warnings.some(w => w.includes('Missing-Parent')));

    // 4) Non-overlapping coordinates across all 3 layout modes
    for (const mode of ['vertical', 'horizontal', 'by_floor'] as const) {
      const layout = computeRouterTreeLayout(parsedXlsx, mode);
      assert.equal(layout.positions.size, 10);
      const rects = Array.from(layout.positions.entries()).map(([id, box]) => ({ id, ...box }));
      const overlaps = detectOverlappingNodes(rects);
      assert.equal(overlaps.pairs.length, 0, `Expected 0 overlapping nodes in ${mode} layout`);
      if (mode === 'by_floor') {
        assert.equal(layout.floorBands.length, 4);
      }
    }

    // 5) Build new_project & merge into existingProject
    const builtNew = buildProjectFromRouterTree(parsedXlsx, {
      layoutMode: 'by_floor',
      applyMode: 'new_project',
      projectName: 'Sơ đồ Router 4 Tầng'
    });
    assert.equal(builtNew.createdNodesCount, 10);
    assert.equal(builtNew.createdCablesCount, 9);
    assert.equal(builtNew.floorCount, 4);
    assert.equal(builtNew.project.floors.length, 4);
    assert.equal(builtNew.project.rooms.length, 4);
    assert.equal(builtNew.project.cables.length, 9);
    const mig = migrateAndValidateProject(builtNew.project);
    assert.equal(mig.ok, true);

    const existing = createEnterpriseTopologyProject();
    const prevNodeCount = existing.nodes.length;
    const prevCableCount = existing.cables.length;
    const builtMerge = buildProjectFromRouterTree(parsedCsv, {
      layoutMode: 'horizontal',
      applyMode: 'merge',
      existingProject: existing
    });
    assert.equal(builtMerge.project.nodes.length, prevNodeCount + 4);
    assert.equal(builtMerge.project.cables.length, prevCableCount + 2);
  });

  // 44. Auto-Layering (Network / IoT / Electrical), Scalable Legend Table & Adjustable Wi-Fi Coverage Radius
  await runTest('auto-layering, scalable legend & adjustable Wi-Fi coverage work end-to-end across policy, SVG export & migration', () => {
    const sample = createMultiFloorSampleOfficeProject();
    const floorId = sample.activeFloorId;

    // Add IoT Sensor and Electrical UPS/PDU alongside existing switches/APs
    const sensorAssetId = 'asset_sensor_test';
    const upsAssetId = 'asset_ups_test';
    const apAssetId = 'asset_ap_test';
    const baseStyle = {
      backgroundColor: '#0d9488',
      borderColor: '#115e59',
      borderWidth: 2,
      borderStyle: 'solid' as const,
      opacity: 1
    };
    const netDefaults = {
      serialNumber: 'SN-TEST-001',
      ipAddress: '',
      subnetMask: '255.255.255.0',
      gateway: '10.1.0.1',
      macAddress: '00:11:22:33:44:55',
      vlan: '10'
    };
    sample.assets[sensorAssetId] = {
      ...netDefaults,
      id: sensorAssetId,
      name: 'Cảm biến Nhiệt độ Tầng 1',
      assetTag: 'IOT-SNS-01',
      status: 'online',
      category: 'sensor',
      vendor: 'Aqara',
      model: 'TH-Sensor',
      ports: [],
      powerWatts: 2
    };
    sample.assets[upsAssetId] = {
      ...netDefaults,
      id: upsAssetId,
      name: 'UPS Online 3kVA',
      assetTag: 'PWR-UPS-01',
      status: 'online',
      category: 'ups',
      vendor: 'APC',
      model: 'SRT3000',
      ports: [],
      powerWatts: 120
    };
    sample.assets[apAssetId] = {
      ...netDefaults,
      id: apAssetId,
      name: 'AP Wi-Fi 6 Sảnh',
      assetTag: 'WIFI-AP-01',
      status: 'online',
      category: 'ap',
      vendor: 'UniFi',
      model: 'U6-Pro',
      ipAddress: '10.1.0.88',
      ports: [],
      powerWatts: 18,
      wifiSpecs: {
        ssid: 'HACHIHI-PRO',
        bands: '2.4GHz + 5GHz',
        channel24: 6,
        channel5: 36,
        txPowerDbm: 23,
        coverageRadiusMeters: 24.5,
        maxClients: 200,
        standard: 'Wi-Fi 6 (802.11ax)'
      }
    };

    const sensorNode = {
      id: 'node_sensor_test',
      type: 'device' as const,
      diagramMode: 'topology' as const,
      floorId,
      x: 160,
      y: 160,
      width: 112,
      height: 82,
      rotation: 0,
      style: baseStyle,
      label: 'Cảm biến Nhiệt độ',
      assetId: sensorAssetId
    };
    const upsNode = {
      id: 'node_ups_test',
      type: 'device' as const,
      diagramMode: 'topology' as const,
      floorId,
      x: 320,
      y: 160,
      width: 112,
      height: 82,
      rotation: 0,
      style: baseStyle,
      label: 'UPS 3kVA',
      assetId: upsAssetId
    };
    const apNode = {
      id: 'node_ap_test',
      type: 'device' as const,
      diagramMode: 'topology' as const,
      floorId,
      x: 520,
      y: 260,
      width: 112,
      height: 82,
      rotation: 0,
      style: baseStyle,
      label: 'AP Wi-Fi 6 Sảnh',
      assetId: apAssetId,
      customData: { coverageRadiusMeters: 24.5 }
    };
    sample.nodes.push(sensorNode, upsNode, apNode);

    // 1) Classify devices by semantic type
    const swNode = sample.nodes.find(n => n.type === 'device' && sample.assets[n.assetId || '']?.category === 'switch') || sample.nodes[0];
    assert.equal(classifyDeviceLayer(swNode, sample.assets), 'network');
    assert.equal(classifyDeviceLayer(sensorNode, sample.assets), 'iot');
    assert.equal(classifyDeviceLayer(apNode, sample.assets), 'iot');
    assert.equal(classifyDeviceLayer(upsNode, sample.assets), 'electrical');

    // Unset layerId remains backward-compatible as 'devices'
    assert.equal(resolveNodeLayer(sensorNode, sample.assets), 'devices');

    // 2) Auto-layering assigns semantic layerId, updates counts & respects hidden/locked semantic layers
    const plan = computeAutoLayeringPlan(sample);
    assert.ok(plan.summary.updatedCount >= 3);
    const layeredProject: ProjectState = {
      ...sample,
      nodes: plan.nodes,
      settings: {
        ...sample.settings,
        autoLayeringEnabled: true,
        lockedLayers: ['electrical'],
        hiddenLayers: ['iot']
      }
    };
    const counts = computeLayerObjectCounts(layeredProject, floorId);
    assert.ok(counts.network >= 1);
    assert.ok(counts.iot >= 2);
    assert.ok(counts.electrical >= 1);

    const layeredSensor = layeredProject.nodes.find(n => n.id === 'node_sensor_test')!;
    const layeredUps = layeredProject.nodes.find(n => n.id === 'node_ups_test')!;
    assert.equal(resolveNodeLayer(layeredSensor, layeredProject.assets), 'iot');
    assert.equal(resolveNodeLayer(layeredUps, layeredProject.assets), 'electrical');
    assert.equal(isNodeEffectivelyLocked(layeredUps, layeredProject.settings, layeredProject.assets, false), true);
    assert.equal(isNodeEffectivelyLocked(layeredSensor, layeredProject.settings, layeredProject.assets, false), false);

    // 3) Hidden 'iot' layer hides sensor & AP in pure SVG export, while visible AP with Wi-Fi coverage renders exact radius
    const hiddenIotSvg = generatePureSvgMarkup(layeredProject);
    assert.ok(!hiddenIotSvg.includes('Cảm biến Nhiệt độ'));

    const visibleWifiProject: ProjectState = {
      ...layeredProject,
      settings: {
        ...layeredProject.settings,
        showCoverageRadius: true,
        hiddenLayers: []
      }
    };
    const wifiSvg = generatePureSvgMarkup(visibleWifiProject);
    const expectedRadiusPx = String(24.5 * (visibleWifiProject.settings.scale || 30));
    assert.ok(wifiSvg.includes(`r="${expectedRadiusPx}"`), `Expected Wi-Fi SVG circle radius ${expectedRadiusPx}`);

    // 4) Scalable Legend metrics: compact vs wide 2-column & pure SVG clipPath
    const compactLegend = computeLegendLayoutMetrics(230, 140, 6);
    assert.equal(compactLegend.columns, 1);
    assert.equal(compactLegend.isCompact, true);
    assert.ok(compactLegend.scale < 0.85);

    const wideLegend = computeLegendLayoutMetrics(620, 420, 6);
    assert.equal(wideLegend.columns, 2);
    assert.equal(wideLegend.isCompact, false);
    assert.ok(wideLegend.scale >= 1.1);

    visibleWifiProject.nodes.push({
      id: 'node_legend_scaled',
      type: 'legend',
      diagramMode: visibleWifiProject.activeMode,
      floorId,
      x: 80,
      y: 420,
      width: 600,
      height: 360,
      rotation: 0,
      style: {
        backgroundColor: '#ffffff',
        borderColor: '#1d4ed8',
        borderWidth: 2,
        borderStyle: 'solid',
        opacity: 1
      },
      label: 'BẢNG CHÚ GIẢI KÝ HIỆU THIẾT BỊ',
      customData: { legendScale: 1.25 }
    });
    const legendSvg = generatePureSvgMarkup(visibleWifiProject);
    assert.ok(legendSvg.includes('legend-clip-0'));
    assert.ok(legendSvg.includes('BẢNG CHÚ GIẢI KÝ HIỆU THIẾT BỊ'));

    // 5) Migration preserves semantic node.layerId, legendScale, and autoLayeringEnabled
    const migrated = migrateAndValidateProject(visibleWifiProject);
    assert.equal(migrated.ok, true);
    assert.equal(migrated.project.settings.autoLayeringEnabled, true);
    assert.equal(
      migrated.project.nodes.find(n => n.id === 'node_sensor_test')?.layerId,
      'iot'
    );
    assert.equal(
      migrated.project.nodes.find(n => n.id === 'node_legend_scaled')?.customData?.legendScale,
      1.25
    );
  });

  // 45. Text/ASCII Tree Paste Parser, Project Router Tree Round-Trip Export, Help Shortcuts, Recent 10 MRU & Unified Layer Selection
  await runTest('text-tree paste, project router tree round-trip, help shortcuts, recent 10 MRU & layer selection', async () => {
    // 1) Parse ASCII / indented box-drawing tree with floor heading
    const asciiTree = [
      'Tầng 1',
      '└── Router 01 (10.0.0.1)',
      '     ├── Switch 01',
      '     │    ├── PC 01',
      '     │    ├── PC 02',
      '     │    └── Camera 01',
      '     └── Switch 02',
      '          ├── AP 01',
      '          └── Camera 02'
    ].join('\n');
    const parsedAscii = parseRouterTreeTextPayload(asciiTree, 'paste_tree.txt');
    assert.equal(parsedAscii.nodes.length, 8);
    assert.equal(parsedAscii.links.length, 7);
    assert.deepEqual(parsedAscii.rootNames, ['Router 01']);
    assert.ok(parsedAscii.nodes.every(n => n.floorName === 'Tầng 1'));
    const pc01 = parsedAscii.nodes.find(n => n.name === 'PC 01');
    const cam02 = parsedAscii.nodes.find(n => n.name === 'Camera 02');
    assert.equal(pc01?.category, 'workstation');
    assert.deepEqual(pc01?.parents, ['Switch 01']);
    assert.equal(cam02?.category, 'camera');
    assert.deepEqual(cam02?.parents, ['Switch 02']);

    // 2) Parse pasted Excel TSV (headered + headerless) and semicolon CSV
    const headeredTsv = [
      'Tên Thiết Bị\tRouter Cha\tLoại Thiết Bị\tĐịa Chỉ IP\tTầng / Khu Vực',
      'RTR-CORE\t\trouter\t10.10.0.1\tTầng 1',
      'SW-DIST\tRTR-CORE\tswitch\t10.10.1.2\tTầng 2'
    ].join('\n');
    const parsedTsv = parseRouterTreeTextPayload(headeredTsv, 'paste.tsv');
    assert.equal(parsedTsv.nodes.length, 2);
    assert.equal(parsedTsv.links.length, 1);
    assert.equal(parsedTsv.links[0].parentName, 'RTR-CORE');
    assert.equal(parsedTsv.links[0].childName, 'SW-DIST');

    const headerlessTsv = [
      'Gateway-01\t\trouter\t192.168.10.1\tTầng Trệt',
      'AP-Sanh\tGateway-01\tap\t192.168.10.20\tTầng Trệt'
    ].join('\n');
    const parsedHeaderlessTsv = parseRouterTreeTextPayload(headerlessTsv, 'paste_no_header.tsv');
    assert.equal(parsedHeaderlessTsv.nodes.length, 2);
    assert.equal(parsedHeaderlessTsv.nodes[1].category, 'ap');
    assert.deepEqual(parsedHeaderlessTsv.nodes[1].parents, ['Gateway-01']);

    const semicolonCsv = [
      'Tên Thiết Bị;Router Cha;Loại Thiết Bị;Địa Chỉ IP;Tầng / Khu Vực',
      'FW-01;;firewall;172.16.0.1;DC',
      'SW-01;FW-01;switch;172.16.0.2;DC'
    ].join('\n');
    const parsedSemicolon = parseRouterTreeTextPayload(semicolonCsv, 'semi.csv');
    assert.equal(parsedSemicolon.nodes.length, 2);
    assert.equal(parsedSemicolon.nodes[0].category, 'firewall');
    assert.equal(parsedSemicolon.links.length, 1);

    // 3) Extract Router Tree from ProjectState (with cycle safety) & round-trip through Excel workbook
    const enterprise = createEnterpriseTopologyProject();
    const extracted = extractRouterTreeFromProject(enterprise);
    assert.ok(extracted.nodes.length >= 3);
    assert.ok(extracted.links.length >= 2);
    const wb = buildRouterTreeExportWorkbook(enterprise);
    assert.deepEqual(wb.worksheets.map(ws => ws.name), ['So_Do_Router_Cay', 'Huong_Dan_Nhap']);
    const roundTripBuf = await wb.xlsx.writeBuffer();
    const roundTripParsed = await parseRouterTreeExcelPayload(roundTripBuf, 'roundtrip_tree.xlsx');
    assert.equal(roundTripParsed.nodes.length, extracted.nodes.length);
    assert.equal(roundTripParsed.links.length, extracted.links.length);

    // 4) Help catalog suggestions & custom keymap shortcut search
    assert.ok(HELP_SUGGESTIONS.length >= 6);
    assert.ok(searchHelpCatalog('dan van ban').some(t => t.id === 'help-excel-tree'));
    const customKeymap = { ...getDefaultShortcutKeymap(), command_palette: 'Alt+Space' };
    const shortcutMatches = searchHelpShortcuts('bang lenh', customKeymap);
    assert.ok(shortcutMatches.some(m => m.id === 'command_palette' && m.combo === 'Alt+Space'));

    // 5) Recent Actions MRU: dedupe, count increment, and strict MAX_RECENT_ACTIONS = 10 cap
    assert.equal(MAX_RECENT_ACTIONS, 10);
    let recent: RecentActionEntry[] = [];
    const actionIds: ReplayableActionId[] = [
      'auto_route_all',
      'fit_screen',
      'generate_legend',
      'auto_assign_ip',
      'auto_layer',
      'open_audit',
      'open_bom',
      'open_export',
      'export_pdf_a4',
      'open_excel_tree',
      'export_excel_tree',
      'toggle_3d'
    ];
    actionIds.forEach((id, idx) => {
      recent = pushRecentAction(recent, id, undefined, 1_000_000 + idx * 1000);
    });
    assert.equal(recent.length, 10);
    assert.equal(recent[0].id, 'toggle_3d');
    assert.equal(recent.some(e => e.id === 'auto_route_all'), false);
    // Re-trigger an existing entry -> promotes to index 0 and increments count
    recent = pushRecentAction(recent, 'open_bom', undefined, 2_000_000);
    assert.equal(recent.length, 10);
    assert.equal(recent[0].id, 'open_bom');
    assert.equal(recent[0].count, 2);

    // 6) Unified layer object selection policy (network, iot, electrical, racks, rooms, cables & hidden layer guard)
    const sample = createMultiFloorSampleOfficeProject();
    const planned = computeAutoLayeringPlan(sample);
    const layerProj: ProjectState = { ...sample, nodes: planned.nodes };
    const netSel = resolveSelectableTargetForLayer(layerProj, 'network');
    assert.equal(netSel.type, 'node');
    const rackSel = resolveSelectableTargetForLayer(layerProj, 'racks');
    assert.ok(rackSel.type === 'node' || rackSel.type === 'none');
    const cableSel = resolveSelectableTargetForLayer(layerProj, 'cables');
    assert.equal(cableSel.type, 'edge');
    const hiddenSelProj: ProjectState = {
      ...layerProj,
      settings: { ...layerProj.settings, hiddenLayers: ['cables', 'rooms'] }
    };
    assert.equal(resolveSelectableTargetForLayer(hiddenSelProj, 'cables').type, 'none');
    assert.equal(resolveSelectableTargetForLayer(hiddenSelProj, 'rooms').type, 'none');
  });

  // 46. UI/UX 4.0 Workspace Presets & Accent-Insensitive Device/Port Catalog Search Tests
  await runTest('workspacePresets & deviceCatalog: resolves 4 presets, unhides required layers, and searches devices by Vietnamese unaccented text and port specs', () => {
    assert.equal(WORKSPACE_PRESETS.length, 4);
    const elecPreset = getWorkspacePresetMeta('electrical_design');
    assert.equal(elecPreset.targetMode, 'electrical');
    assert.equal(elecPreset.preferredRightTab, 'power');

    const auditPreset = getWorkspacePresetMeta('audit_review');
    assert.equal(auditPreset.leftCollapsed, true);
    assert.equal(auditPreset.rightCollapsed, false);
    assert.equal(auditPreset.showIpAddresses, true);

    const nextHidden = computeNextHiddenLayersForPreset(
      ['electrical', 'cables', 'rooms', 'trays'],
      elecPreset
    );
    assert.equal(nextHidden.includes('electrical'), false);
    assert.equal(nextHidden.includes('cables'), false);
    assert.equal(nextHidden.includes('rooms'), true);

    // Accent-insensitive Vietnamese search in catalog
    const sensorHits = searchDeviceCatalog(DEVICE_CATALOG, 'cam bien');
    assert.ok(sensorHits.some(d => d.category === 'sensor' || d.category === 'iot'));

    const powerHits = searchDeviceCatalog(DEVICE_CATALOG, 'phan phoi nguon');
    assert.ok(powerHits.some(d => d.category === 'pdu' || d.category === 'ups'));

    // Port spec search (SFP+, QSFP28, RJ45, PoE)
    const qsfpHits = searchDeviceCatalog(DEVICE_CATALOG, 'QSFP28');
    assert.ok(qsfpHits.some(d => d.category === 'core_switch'));

    const sfpHits = searchDeviceCatalog(DEVICE_CATALOG, 'SFP+');
    assert.ok(sfpHits.length >= 2);
  });

  // 47. P0 UPS Real Wattage & Battery Runtime Validation + upsSpecs Migration Tests
  await runTest('engineeringValidator & projectStorage: uses real UPS capacity (no 1500W floor) and battery-spec runtime', () => {
    const base = createEnterpriseTopologyProject();
    const floorId = base.activeFloorId;
    const makeUpsProject = (upsWatts: number, upsSpecs?: DeviceAsset['upsSpecs']): ProjectState => {
      const proj = structuredClone(base);
      proj.assets = {
        a_load: {
          id: 'a_load',
          assetTag: 'SW-01',
          serialNumber: '',
          name: 'SW-Core',
          category: 'switch',
          vendor: 'Cisco',
          model: 'C9200',
          ipAddress: '10.0.0.1',
          subnetMask: '255.255.255.0',
          gateway: '10.0.0.254',
          macAddress: '',
          vlan: '1',
          powerWatts: 300,
          ports: [],
          status: 'online',
          floorId
        },
        a_ups: {
          id: 'a_ups',
          assetTag: 'UPS-01',
          serialNumber: '',
          name: 'UPS Test',
          category: 'ups',
          vendor: 'APC',
          model: 'Smart-UPS',
          ipAddress: '',
          subnetMask: '',
          gateway: '',
          macAddress: '',
          vlan: '',
          powerWatts: upsWatts,
          upsSpecs,
          ports: [],
          status: 'online',
          floorId
        }
      };
      proj.nodes = [
        {
          id: 'n_load',
          diagramMode: 'topology',
          floorId,
          type: 'device',
          assetId: 'a_load',
          label: 'SW-Core',
          x: 100,
          y: 100,
          width: 100,
          height: 60,
          rotation: 0,
          style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1 }
        },
        {
          id: 'n_ups',
          diagramMode: 'topology',
          floorId,
          type: 'device',
          assetId: 'a_ups',
          label: 'UPS Test',
          x: 260,
          y: 100,
          width: 100,
          height: 60,
          rotation: 0,
          style: { backgroundColor: '#155eef', borderColor: '#334155', borderWidth: 1, borderStyle: 'solid', opacity: 1 }
        }
      ];
      proj.cables = [];
      return proj;
    };

    // 1) Undeclared UPS (0W, no upsSpecs) -> upsCapacityWatts === 0 (never inflated to 1500), runtime === 0, emits both warnings
    const zeroUpsAudit = runEngineeringAudit(makeUpsProject(0));
    assert.equal(zeroUpsAudit.summary.upsCapacityWatts, 0);
    assert.equal(zeroUpsAudit.summary.estimatedUpsRuntimeMinutes, 0);
    assert.ok(zeroUpsAudit.issues.some(i => i.id === 'ups_missing_capacity_a_ups'));
    assert.ok(zeroUpsAudit.issues.some(i => i.id === 'ups_missing_battery_specs_a_ups'));

    // 2) Declared 600W UPS without battery specs -> keeps exact 600W (not 1500W) and keeps runtime 0 (no 0.45*60 guess)
    const noBatteryAudit = runEngineeringAudit(makeUpsProject(600));
    assert.equal(noBatteryAudit.summary.upsCapacityWatts, 600);
    assert.equal(noBatteryAudit.summary.estimatedUpsRuntimeMinutes, 0);
    assert.ok(!noBatteryAudit.issues.some(i => i.id === 'ups_missing_capacity_a_ups'));
    assert.ok(noBatteryAudit.issues.some(i => i.id === 'ups_missing_battery_specs_a_ups'));

    // 3) Declared 1200W UPS with real battery specs -> matches computeUpsBatteryRuntime formula
    const realSpecs = { batteryAh: 9, batteryVoltageV: 12, batteryCount: 4, inverterEfficiency: 0.85, dodFactor: 0.8 };
    const fullUpsProj = makeUpsProject(1200, realSpecs);
    const fullAudit = runEngineeringAudit(fullUpsProj);
    const expectedBattery = computeUpsBatteryRuntime({ totalLoadWatts: 300, ...realSpecs });
    assert.equal(fullAudit.summary.upsCapacityWatts, 1200);
    assert.equal(fullAudit.summary.estimatedUpsRuntimeMinutes, expectedBattery.runtimeMinutes);
    assert.ok(!fullAudit.issues.some(i => i.id === 'ups_missing_battery_specs_a_ups'));

    // 4) Migration preserves valid upsSpecs and strips invalid zero-capacity ones
    const migratedValid = migrateAndValidateProject(fullUpsProj);
    assert.equal(migratedValid.ok, true);
    if (migratedValid.ok) {
      assert.equal(migratedValid.project.assets['a_ups']?.upsSpecs?.batteryAh, 9);
      assert.equal(migratedValid.project.assets['a_ups']?.upsSpecs?.batteryCount, 4);
    }
    const invalidProj = makeUpsProject(600, { batteryAh: 0, batteryVoltageV: 12, batteryCount: 2 });
    const migratedInvalid = migrateAndValidateProject(invalidProj);
    assert.equal(migratedInvalid.ok, true);
    if (migratedInvalid.ok) {
      assert.equal(migratedInvalid.project.assets['a_ups']?.upsSpecs, undefined);
    }
  });

  // 50. 3D Scene Node customData.locked Persistence & Camera Rotation Matrix XYZ Axis Helper Tests
  await runTest('network3D & layerPolicy: persists locked in customData, blocks drag, and projects corner XYZ axes from camera rotation matrix', () => {
    const proj = createEnterpriseTopologyProject();
    const target = proj.nodes.find(n => n.type !== 'rack')!;
    target.locked = undefined;
    target.customData = { ...(target.customData || {}), locked: true };

    assert.equal(isNodePositionLocked(target), true);
    assert.equal(isNodeEffectivelyLocked(target, proj.settings, proj.assets, false), true);

    const migrated = migrateAndValidateProject(proj);
    assert.equal(migrated.ok, true);
    if (migrated.ok) {
      const migratedNode = migrated.project.nodes.find(n => n.id === target.id)!;
      assert.equal(migratedNode.customData?.locked, true);
      assert.equal(migratedNode.locked, true);
      assert.equal(isNodePositionLocked(migratedNode), true);
    }

    target.locked = false;
    target.customData = { ...(target.customData || {}), locked: false };
    assert.equal(isNodePositionLocked(target), false);
    assert.equal(isNodeEffectivelyLocked(target, proj.settings, proj.assets, false), false);

    // Global 3D drag lock defaults to true -> drag blocked; when unlocked -> unlocked nodes can drag, locked nodes stay blocked
    assert.equal(canDragNodeIn3DScene(target, proj.settings, proj.assets), false);
    assert.equal(
      canDragNodeIn3DScene(target, proj.settings, proj.assets, { isSceneDragLocked: true }),
      false
    );
    assert.equal(
      canDragNodeIn3DScene(target, proj.settings, proj.assets, { isSceneDragLocked: false }),
      true
    );
    target.customData = { ...(target.customData || {}), locked: true };
    assert.equal(
      canDragNodeIn3DScene(target, proj.settings, proj.assets, { isSceneDragLocked: false }),
      false
    );

    // Camera along +Z looking at origin -> +X right, +Y up, +Z closest to viewer
    const cam = new THREE.PerspectiveCamera(42, 1.5, 0.2, 180);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    const rotFront = extractCameraRotationMatrix(cam);
    const axesFront = projectCornerAxesFromCameraMatrix(rotFront, 38, 22, 9);
    const xFront = axesFront.find(a => a.axis === 'X')!;
    const yFront = axesFront.find(a => a.axis === 'Y')!;
    const zFront = axesFront.find(a => a.axis === 'Z')!;
    assert.ok(xFront.px > 58); // +X points right
    assert.ok(yFront.py < 18); // +Y points up
    assert.ok(zFront.depth > 0.99); // +Z points toward viewer
    assert.equal(axesFront[axesFront.length - 1].axis, 'Z'); // Z sorted last (foreground)

    // Orbit camera to +X side looking at origin -> +Z points left, +X points toward viewer
    cam.position.set(10, 0, 0);
    cam.lookAt(0, 0, 0);
    const rotSide = extractCameraRotationMatrix(cam);
    const axesSide = projectCornerAxesFromCameraMatrix(rotSide, 38, 22, 9);
    const xSide = axesSide.find(a => a.axis === 'X')!;
    const zSide = axesSide.find(a => a.axis === 'Z')!;
    assert.ok(xSide.depth > 0.99);
    assert.ok(zSide.px < 18); // +Z points left in right-side view
    assert.equal(axesSide[axesSide.length - 1].axis, 'X');

    // Top-down camera -> +Y points toward viewer
    cam.position.set(0.01, 20, 0.01);
    cam.lookAt(0, 0, 0);
    const rotTop = extractCameraRotationMatrix(cam);
    const axesTop = projectCornerAxesFromCameraMatrix(rotTop, 38, 22, 9);
    assert.equal(axesTop[axesTop.length - 1].axis, 'Y');
  });

  // 51. 3D Visual Lock Indicators & 3D Cable Routing Curves (Orthogonal Bo Góc / Straight / Curved)
  await runTest('proceduralDevices: attaches 3D lock rim/padlock only to locked items and builds valid orthogonal/straight/curved 3D cables', () => {
    const proj = createEnterpriseTopologyProject();
    const deviceNodes = proj.nodes.filter(n => n.type !== 'rack');
    assert.ok(deviceNodes.length >= 2);
    const lockedNode = deviceNodes[0];
    const unlockedNode = deviceNodes[1];
    lockedNode.locked = true;
    lockedNode.customData = { ...(lockedNode.customData || {}), locked: true };
    unlockedNode.locked = false;
    unlockedNode.customData = { ...(unlockedNode.customData || {}), locked: false };

    const dummyTex = new THREE.Texture();
    const lockTex = new THREE.Texture();
    const root = new THREE.Group();
    const populated = populateInfrastructure3DWorld(root, proj, undefined, {
      showRooms: false,
      showCables: true,
      explodeSpread: 0,
      castShadow: false,
      shadowTex: dummyTex,
      lockBadgeTex: lockTex
    });

    const lockedGroup = populated.nodeGroups.get(lockedNode.id)?.group;
    const unlockedGroup = populated.nodeGroups.get(unlockedNode.id)?.group;
    assert.ok(lockedGroup);
    assert.ok(unlockedGroup);
    assert.ok(lockedGroup.getObjectByName('locked_indicator_ring'));
    assert.ok(lockedGroup.getObjectByName('locked_rim_frame'));
    assert.ok(lockedGroup.getObjectByName('locked_padlock_sprite'));
    assert.equal(unlockedGroup.getObjectByName('locked_indicator_ring'), undefined);
    assert.equal(unlockedGroup.getObjectByName('locked_rim_frame'), undefined);
    assert.equal(unlockedGroup.getObjectByName('locked_padlock_sprite'), undefined);

    if (populated.cableEntries.length > 0) {
      const firstCableEntry = populated.cableEntries[0];
      assert.equal(firstCableEntry.mesh.userData.selectType, 'edge');
      assert.equal(firstCableEntry.mesh.userData.cableId, firstCableEntry.cable.id);
      assert.ok(Number.isFinite(firstCableEntry.midWorld.x));
      assert.ok(Number.isFinite(firstCableEntry.midWorld.y));
    }

    // Verify all 3 routing geometries build valid finite TubeGeometry vertices + midWorld
    for (const routingType of ['orthogonal', 'straight', 'curved'] as const) {
      const curveRes = build3DCableCurve(
        { routingType, strokeWidth: 2 },
        { x: -3, z: -2 },
        { x: 4, z: 3 },
        false,
        true,
        0,
        1,
        0
      );
      assert.ok(Number.isFinite(curveRes.midWorld.x));
      assert.ok(Number.isFinite(curveRes.midWorld.y));
      assert.ok(Number.isFinite(curveRes.midWorld.z));

      const geo = build3DCableGeometry(
        { routingType, strokeWidth: 2 },
        { x: -3, z: -2 },
        { x: 4, z: 3 },
        false,
        true,
        0,
        1,
        0
      );
      const posAttr = geo.getAttribute('position');
      assert.ok(posAttr && posAttr.count > 20);
      assert.ok(Number.isFinite(posAttr.getX(0)));
      geo.dispose();
    }

    dummyTex.dispose();
    lockTex.dispose();
  });

  // 52. Floating Control Bars Clamping & Edge-or-Free Drop Behavior
  await runTest('useFloatingPanel: clamps movable bars inside viewport bounds and resolves edge-snap vs free drop', () => {
    const clampedTopLeft = clampFloatingPosition({ x: -120, y: -40 }, 300, 50, 1200, 800, 8);
    assert.deepEqual(clampedTopLeft, { x: 8, y: 8 });

    const clampedBottomRight = clampFloatingPosition({ x: 1180, y: 790 }, 300, 50, 1200, 800, 8);
    assert.deepEqual(clampedBottomRight, { x: 892, y: 742 });

    // Oversized panel still stays anchored at padding without negative coords
    const oversized = clampFloatingPosition({ x: 50, y: 50 }, 500, 200, 400, 150, 8);
    assert.deepEqual(oversized, { x: 8, y: 8 });

    // Edge snaps
    assert.equal(resolveEdgeOrFreeDrop(60, 400, 220, 44, 1200, 800).mode, 'left');
    assert.equal(resolveEdgeOrFreeDrop(1140, 400, 220, 44, 1200, 800).mode, 'right');
    assert.equal(resolveEdgeOrFreeDrop(600, 740, 220, 44, 1200, 800).mode, 'bottom');

    // Free placement anywhere away from edges stays clamped inside container
    const freeDrop = resolveEdgeOrFreeDrop(600, 220, 240, 48, 1200, 800);
    assert.equal(freeDrop.mode, 'free');
    assert.ok(freeDrop.freePos);
    assert.equal(freeDrop.freePos.x, 480);
    assert.equal(freeDrop.freePos.y, 196);
  });

  // 53. Tòa nhà HACHIHI 2 Template (7 Floors B1 + G + 5, 2D CAD, Rack Elevation & Multi-Floor 3D Cutaway)
  await runTest('hachihi2BuildingTemplate: passes 2D/Audit/Rack checks and renders 7-floor 3D cutaway with inter-floor riser cables', () => {
    const tplEntry = ARCHITECTURE_TEMPLATES.find(t => t.id === 'tpl_building_hachihi2');
    assert.ok(tplEntry, 'Expected tpl_building_hachihi2 registered in ARCHITECTURE_TEMPLATES');

    const proj = createHachihi2BuildingProject();
    assert.equal(proj.floors.length, 7);
    assert.deepEqual(
      [...proj.floors].sort((a, b) => a.level - b.level).map(f => f.level),
      [-1, 0, 1, 2, 3, 4, 5]
    );
    assert.equal(proj.racks.length, 7);
    assert.ok(proj.racks.some(r => r.name === 'Main Rack Tầng 4 (42U)' && r.totalUnits === 42));
    assert.equal(proj.racks.filter(r => r.totalUnits === 12).length, 6);
    assert.equal(proj.vlans?.length, 6);
    assert.equal(proj.subnets?.length, 6);
    assert.ok((proj.cableTrays || []).length >= 14);

    // Migration round-trip safety
    const migrated = migrateAndValidateProject(proj);
    assert.equal(migrated.ok, true);

    // Engineering Audit: 0 errors, 0 warnings
    const audit = runEngineeringAudit(proj);
    assert.equal(
      audit.summary.errorCount,
      0,
      `Expected 0 audit errors, got: ${audit.issues.filter(i => i.severity === 'error').map(i => i.id + ': ' + i.title).join('; ')}`
    );
    assert.equal(
      audit.summary.warningCount,
      0,
      `Expected 0 audit warnings, got: ${audit.issues.filter(i => i.severity === 'warning').map(i => i.id + ': ' + i.title).join('; ')}`
    );

    // 0 overlapping nodes per floor in 2D floorplan
    const floorplanRacks = proj.nodes.filter(n => n.type === 'rack' && n.diagramMode === 'floorplan');
    for (const flr of proj.floors) {
      const floorNodes = proj.nodes.filter(
        n =>
          n.floorId === flr.id &&
          !isRackMountedTopologyShadowNode(n, proj.assets, floorplanRacks, proj.racks)
      );
      const overlaps = detectOverlappingNodes(floorNodes, -4);
      assert.equal(
        overlaps.pairs.length,
        0,
        `Expected 0 overlaps on floor ${flr.name}, found ${overlaps.pairs.length}`
      );
    }

    // Rack Elevation mode separates overlapping multi-floor racks cleanly
    const laidOutRacks = layoutRackNodesForElevationMode(floorplanRacks, proj.racks);
    assert.equal(laidOutRacks.length, 7);
    assert.equal(detectOverlappingNodes(laidOutRacks, 0).pairs.length, 0);

    // Multi-floor 3D cutaway builds 7 stacked floor levels & finite inter-floor riser cable geometry
    const dummyTex = new THREE.Texture();
    const lockTex = new THREE.Texture();
    const root = new THREE.Group();
    const populated = populateInfrastructure3DWorld(root, proj, undefined, {
      showRooms: true,
      showCables: true,
      explodeSpread: 0,
      castShadow: false,
      shadowTex: dummyTex,
      lockBadgeTex: lockTex,
      viewAllFloors: true
    });
    assert.equal(populated.isMultiFloorCutaway, true);
    assert.ok(populated.bounds.maxY - populated.bounds.minY >= 18);

    const floorYValues = new Set(
      Array.from(populated.nodeGroups.values()).map(entry => Math.round(entry.floorY * 100) / 100)
    );
    assert.equal(floorYValues.size, 7);

    // Verify all 7 racks + vertical inter-floor riser cables exist and have finite coordinates
    const rackEntries = Array.from(populated.nodeGroups.values()).filter(e => e.node.type === 'rack');
    assert.equal(rackEntries.length, 7);

    const interFloorCables = populated.cableEntries.filter(
      ce => Math.abs(ce.srcFloorY - ce.tgtFloorY) > 0.2
    );
    assert.equal(interFloorCables.length, 6);
    for (const ce of populated.cableEntries) {
      assert.ok(Number.isFinite(ce.midWorld.x));
      assert.ok(Number.isFinite(ce.midWorld.y));
      assert.ok(Number.isFinite(ce.midWorld.z));
      const posAttr = ce.mesh.geometry.getAttribute('position');
      assert.ok(posAttr && posAttr.count > 10);
      assert.ok(Number.isFinite(posAttr.getX(0)));
    }

    // Pure SVG export produces crisp 2D CAD markup without errors
    const svg = generatePureSvgMarkup(proj);
    assert.ok(svg.includes('<svg'));
    assert.ok(svg.includes('Máy Chấm Công'));

    disposeObjectTree(root, new Set([dummyTex, lockTex]));
    dummyTex.dispose();
    lockTex.dispose();
  });

  // 54. Unified Export Service, Strict 3D Capture & Multi-Paper Technical PDF
  await runTest('exportService & pdfExporter: enforces 2D-only SVG/DXF guards, strict 3D failure, and A4-A1 3D/Both PDFs', async () => {
    const proj = createEnterpriseTopologyProject();
    const tinyPngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=';
    const tinyPngUrl = `data:image/png;base64,${tinyPngBase64}`;
    const tinyPngBytes = Uint8Array.from(Buffer.from(tinyPngBase64, 'base64'));
    const tinyBlob = new Blob([tinyPngBytes], { type: 'image/png' });

    // 1) SVG and DXF must reject '3d' scope explicitly
    assert.throws(() => runExportSvg(proj, '3d'), /2D CAD/);
    assert.throws(() => runExportDxf(proj, '3d'), /2D CAD/);

    // 2) Strict 3D capture never silently falls back to 2D when inactive or failing
    await assert.rejects(() => capture3DSnapshotStrict(undefined), /chế độ 3D/i);
    await assert.rejects(
      () =>
        capture3DSnapshotStrict(async () => ({
          blob: new Blob([], { type: 'image/png' }),
          dataUrl: '',
          width: 0,
          height: 0,
          preset: 'iso',
          background: 'light'
        })),
      /không hợp lệ/i
    );

    // 3) Multi-angle capture preserves exact requested presets sequentially
    const calledPresets: Array<string | undefined> = [];
    const capturedAngles = await capture3DAnglesStrict(
      async opts => {
        calledPresets.push(opts?.preset);
        return {
          blob: tinyBlob,
          dataUrl: tinyPngUrl,
          width: 1920,
          height: 1080,
          preset: opts?.preset || 'iso',
          background: opts?.background || 'light'
        };
      },
      ['iso', 'top', 'front']
    );
    assert.deepEqual(calledPresets, ['iso', 'top', 'front']);
    assert.equal(capturedAngles.length, 3);

    // 4) Technical PDF fails loudly if 3D/Both requested without captures
    await assert.rejects(
      () =>
        buildTechnicalPdfArtifact(proj, {
          contentScope: '3d',
          paperSize: 'A4',
          includeDiagram: true,
          captures3D: []
        }),
      /ảnh chụp 3D/i
    );

    // 5) 3D-only multi-angle PDF on A3 generates valid PDF binary with 3 view pages + appendices
    const pdf3D = await buildTechnicalPdfArtifact(proj, {
      contentScope: '3d',
      paperSize: 'A3',
      orientation: 'landscape',
      includeDiagram: true,
      includeLegendPanel: true,
      includeRackElevation: true,
      includeTables: true,
      captures3D: capturedAngles
    });
    assert.ok(pdf3D.filename.endsWith('_A3_3D_Technical.pdf'));
    assert.ok(pdf3D.uint8.byteLength > 500);
    const header3D = Buffer.from(pdf3D.uint8.slice(0, 5)).toString('ascii');
    assert.equal(header3D, '%PDF-');
    assert.equal(
      pdf3D.pageCount,
      3 + (proj.racks.length > 0 ? 1 : 0) + (Object.keys(proj.assets).length > 0 || proj.cables.length > 0 ? 1 : 0)
    );
    assert.equal(pdf3D.scaleMetrics.pageWidthMm, 420);
    assert.equal(pdf3D.scaleMetrics.pageHeightMm, 297);

    // 6) Combined 'both' on A1 scales drawing box larger than A4 and includes 2D + 3D pages
    const bounds = computePureDiagramBounds(proj);
    const a4Metrics = computeA4ScaleMetrics(bounds, proj.settings.scale, 'landscape', { paperSize: 'A4' });
    const a1Metrics = computeA4ScaleMetrics(bounds, proj.settings.scale, 'landscape', { paperSize: 'A1' });
    assert.ok(a1Metrics.drawAreaWidthMm > a4Metrics.drawAreaWidthMm);
    assert.ok(a1Metrics.renderedDrawWidthMm > a4Metrics.renderedDrawWidthMm);

    const pdfBoth = await buildTechnicalPdfArtifact(proj, {
      contentScope: 'both',
      paperSize: 'A1',
      orientation: 'landscape',
      includeDiagram: true,
      includeLegendPanel: true,
      includeRackElevation: false,
      includeTables: false,
      captures3D: [capturedAngles[0]]
    });
    assert.ok(pdfBoth.filename.endsWith('_A1_2D_3D_Technical.pdf'));
    assert.equal(pdfBoth.pageCount, 2);
    assert.equal(pdfBoth.scaleMetrics.pageWidthMm, 841);

    // 7) Aspect ratio fitting preserves 16:9 within box cleanly
    const fitted = fitBoxPreserveAspectRatio(1920, 1080, 200, 150);
    assert.equal(fitted.width, 200);
    assert.ok(Math.abs(fitted.height - 112.5) < 0.05);
  });

  await runTest('3D Rack Dimensions, U-Slot Mapping & Ventilation/Airflow Analysis', () => {
    const rack42: ServerRack = {
      id: 'rack_test_vent',
      name: 'Rack Server 42U',
      totalUnits: 42,
      widthMm: 800,
      depthMm: 1000,
      maxLoadKg: 1200,
      x: 100,
      y: 100,
      slots: {
        1: 'srv_1',
        3: 'srv_2',
        5: 'srv_3',
        30: 'ups_high'
      },
      rearSlots: {
        40: 'pdu_rear'
      }
    };

    const makeDev = (
      id: string,
      name: string,
      category: DeviceAsset['category'],
      uHeight: number,
      powerWatts: number
    ): DeviceAsset => ({
      id,
      name,
      category,
      vendor: 'Dell',
      model: 'R760',
      assetTag: `TAG-${id}`,
      serialNumber: `SN-${id}`,
      ipAddress: '10.0.0.1',
      macAddress: '00:11:22:33:44:55',
      subnetMask: '255.255.255.0',
      gateway: '10.0.0.254',
      vlan: '10',
      status: 'online',
      rackUnitHeight: uHeight,
      powerWatts,
      weightKg: 20,
      ports: []
    });

    const testAssets: Record<string, DeviceAsset> = {
      srv_1: makeDev('srv_1', 'Node-01', 'server', 2, 950),
      srv_2: makeDev('srv_2', 'Node-02', 'server', 2, 950),
      srv_3: makeDev('srv_3', 'Node-03', 'server', 2, 950),
      ups_high: makeDev('ups_high', 'UPS High', 'ups', 2, 450),
      pdu_rear: makeDev('pdu_rear', 'Rear PDU', 'pdu', 1, 20)
    };

    // Metric geometry checks
    const dims = getRackDimensions3D(rack42);
    assert.equal(dims.totalUnits, 42);
    assert.ok(Math.abs(dims.width - 0.8) < 0.001);
    assert.ok(Math.abs(dims.depth - 1.0) < 0.001);
    assert.ok(uSlotToCenterY(10, 2) > uSlotToCenterY(1, 2));
    assert.ok(Math.abs(uSlotToCenterY(2, 1) - uSlotToCenterY(1, 1) - UNIT_HEIGHT_M) < 0.0001);

    // Airflow analysis with perforated door & 4 fans vs choked glass door & 0 fans
    const perforatedRes = analyzeRackAirflow(rack42, testAssets, {
      doorType: 'perforated',
      fanCount: 4
    });
    assert.equal(perforatedRes.totalWatts, 3320);
    assert.ok(perforatedRes.totalBtuPerHour > 11000);
    assert.ok(perforatedRes.hotspots.length >= 1, 'Dense stacked 950W servers should flag hotspot');
    assert.ok(
      perforatedRes.bypassGaps.some(g => g.startU === 7 && g.endU === 29),
      'Large U7-U29 open gap should flag unblanked bypass recirculation'
    );
    assert.ok(
      perforatedRes.recommendations.some(r => r.id.startsWith('high_ups_')),
      'UPS mounted at U30 should trigger high-center-of-gravity warning'
    );

    const glassChokedRes = analyzeRackAirflow(rack42, testAssets, {
      doorType: 'glass',
      fanCount: 0
    });
    assert.equal(glassChokedRes.status, 'critical');
    assert.ok(glassChokedRes.effectiveCoolingCfm < perforatedRes.effectiveCoolingCfm);
    assert.ok(glassChokedRes.estimatedExhaustTempC > perforatedRes.estimatedExhaustTempC);
  });

  // 56. Interactive 3D Standalone HTML Viewer Export
  await runTest('htmlViewerExporter: embeds offline Three.js runtime, 7 camera directions, multi-floor cutaway & safe JSON', () => {
    const building = createHachihi2BuildingProject();
    const firstAssetId = Object.keys(building.assets)[0];
    const maliciousProject: ProjectState = {
      ...building,
      name: `${building.name} </script><script>alert(1)</script>`,
      assets: firstAssetId
        ? {
            ...building.assets,
            [firstAssetId]: {
              ...building.assets[firstAssetId],
              name: `Core Switch </script>`
            }
          }
        : building.assets
    };

    const html3d = generateStandaloneViewerHtml(maliciousProject, {
      contentScope: '3d',
      background3D: 'dark'
    });

    assert.ok(html3d.includes('HachihiViewer3D'), 'Offline Three.js runtime must be embedded');
    assert.ok(html3d.includes('id="tab3D" class="active"'), '3D scope must activate Không gian 3D tab');
    assert.ok(html3d.includes('id="view3D" class="viewport-3d"'), '3D viewport must be visible on load');
    assert.ok(html3d.includes('data-preset="back"'), 'Must include Mặt sau camera direction');
    assert.ok(html3d.includes('data-preset="left"'), 'Must include Bên trái camera direction');
    assert.ok(html3d.includes('data-preset="right"'), 'Must include Bên phải camera direction');
    assert.ok(html3d.includes('id="btnAutoRotate"'), 'Must include Xoay 360° auto-rotate button');
    assert.ok(html3d.includes('id="selFloor3d"'), 'Multi-floor project must expose floor selector in 3D viewer');
    assert.ok(html3d.includes('id="rngExplode3d"'), 'Must expose Giãn tầng slider');

    const jsonMatch = html3d.match(
      /<script type="application\/json" id="hachihi-project-data">([\s\S]*?)<\/script>/
    );
    assert.ok(jsonMatch && jsonMatch[1], 'Embedded JSON payload script block must exist');
    assert.equal(
      jsonMatch[1].includes('</script>'),
      false,
      'Embedded JSON must escape closing script tags'
    );
    const parsed = JSON.parse(jsonMatch[1]);
    assert.equal(parsed.settings.isDarkMode, true);
    assert.ok(parsed.name.includes('</script>'), 'Decoded project name preserves original string');

    const html2d = generateStandaloneViewerHtml(building, { contentScope: '2d' });
    assert.ok(html2d.includes('id="tabDiag" class="active"'), '2D scope starts on Sơ đồ 2D tab');
    assert.ok(html2d.includes('id="tab3D"'), '2D scope still allows switching to 3D tab');
  });

  // 57. P0 #1 — SaveCoordinator Single-Flight Queue, Dirty Versioning & Failure Retention
  await runTest('saveCoordinator (P0#1): prevents stale save clears, re-drains mid-save edits, retains dirty on error, flushes cleanly', async () => {
    const writes: Array<{ val: string; version: number }> = [];
    let releaseFirst!: () => void;
    let blockFirst = true;
    let failNext = false;

    const coordinator = createSaveCoordinator<{ id: string; text: string }>({
      debounceMs: 10,
      onPersist: async (snap, version) => {
        if (blockFirst) {
          blockFirst = false;
          await new Promise<void>(resolve => {
            releaseFirst = resolve;
          });
        }
        if (failNext) {
          return { ok: false, error: 'IndexedDB Quota Exceeded' };
        }
        writes.push({ val: snap.text, version });
        return { ok: true };
      }
    });

    // 1) Schedule v1 and start flush; while v1 is in-flight, markDirty v2
    const p1 = coordinator.saveNow({ id: 'p1', text: 'v1' });
    // Yield a microtask so onPersist enters await
    await new Promise(r => setTimeout(r, 5));
    coordinator.markDirty({ id: 'p1', text: 'v2-mid-save' });
    assert.equal(coordinator.getStatus().hasUnsavedChanges, true);

    releaseFirst();
    const res1 = await p1;
    assert.equal(res1.ok, true);
    // Coordinator must have automatically drained v2 without clearing dirty prematurely!
    assert.equal(writes.length, 2);
    assert.equal(writes[1].val, 'v2-mid-save');
    assert.equal(coordinator.getStatus().hasUnsavedChanges, false);
    assert.equal(coordinator.getStatus().dirtyVersion, coordinator.getStatus().committedVersion);

    // 2) Persist failure keeps hasUnsavedChanges=true and sets storageError; subsequent save succeeds
    failNext = true;
    const failRes = await coordinator.saveNow({ id: 'p1', text: 'v3-fail' });
    assert.equal(failRes.ok, false);
    assert.equal(coordinator.getStatus().hasUnsavedChanges, true);
    assert.equal(coordinator.getStatus().storageError, 'IndexedDB Quota Exceeded');

    failNext = false;
    const retryRes = await coordinator.flush({ id: 'p1', text: 'v3-recovered' });
    assert.equal(retryRes.ok, true);
    assert.equal(coordinator.getStatus().hasUnsavedChanges, false);
    assert.equal(coordinator.getStatus().storageError, null);
    assert.equal(writes[writes.length - 1].val, 'v3-recovered');

    coordinator.dispose();
  });

  // 58. P0 #2 — 3-Tier Emergency Recovery Ring & Checksum Integrity Verification
  await runTest('projectStorage (P0#2): maintains 3-snapshot rotating ring, verifies FNV-1a checksum & rejects tampered envelopes', () => {
    const storeMap = new Map<string, string>();
    const prevLS = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    (globalThis as unknown as { localStorage: Storage }).localStorage = {
      get length() {
        return storeMap.size;
      },
      clear: () => storeMap.clear(),
      getItem: (k: string) => (storeMap.has(k) ? storeMap.get(k)! : null),
      key: (i: number) => Array.from(storeMap.keys())[i] ?? null,
      removeItem: (k: string) => {
        storeMap.delete(k);
      },
      setItem: (k: string, v: string) => {
        storeMap.set(k, String(v));
      }
    };

    try {
      clearRecoverySnapshots();
      const base = createEnterpriseTopologyProject();
      // Save 4 snapshots -> ring must cap to 3 newest
      for (let i = 1; i <= 4; i++) {
        const clone: ProjectState = {
          ...structuredClone(base),
          name: `Project Snap ${i}`,
          lastModified: new Date(1_750_000_000_000 + i * 60_000).toISOString()
        };
        const res = saveRecoverySnapshot(clone, i === 4 ? 'crash_guard' : 'autosave');
        assert.equal(res.ok, true);
      }

      const listed = listRecoverySnapshots();
      assert.equal(listed.length, 3);
      assert.ok(listed.every(e => e.ok));
      if (listed[0].ok) {
        assert.equal(listed[0].envelope.projectName, 'Project Snap 4');
        assert.equal(listed[0].envelope.checksum, computeProjectChecksum(listed[0].envelope.project));
      }

      // Corrupt primary recovery + newest ring entry -> list rejects tampered & loads valid fallback (#3)
      const rawRing = JSON.parse(storeMap.get(RECOVERY_SNAPSHOTS_KEY)!) as Array<Record<string, unknown>>;
      rawRing[0] = {
        ...rawRing[0],
        checksum: 'fnv1a-deadbeef'
      };
      storeMap.set(RECOVERY_SNAPSHOTS_KEY, JSON.stringify(rawRing));
      storeMap.set(RECOVERY_STORAGE_KEY, JSON.stringify(rawRing[0]));

      const afterTamper = listRecoverySnapshots();
      assert.equal(afterTamper[0].ok, false);
      const latestValid = loadLatestValidRecoverySnapshot();
      assert.ok(latestValid, 'Should gracefully fall back to valid snapshot #3');
      assert.equal(latestValid.envelope.projectName, 'Project Snap 3');
      assert.equal(safeLoadFromStorage(RECOVERY_STORAGE_KEY), null);

      const reVerified = verifyRecoveryEnvelope(rawRing[1]);
      assert.equal(reVerified.ok, true);
    } finally {
      if (prevLS === undefined) {
        delete (globalThis as unknown as { localStorage?: Storage }).localStorage;
      } else {
        (globalThis as unknown as { localStorage: Storage }).localStorage = prevLS;
      }
    }
  });

  // 59. P0 #3 — Power-Domain-Aware UPS Engine, VA * PF, Spec Sanity & Peukert Derating
  await runTest('engineeringValidator & poeCalculator (P0#3): enforces VA*PF, isolates UPS domains, catches W>VA & applies Peukert derating', () => {
    const base = createEnterpriseTopologyProject();
    base.floors = [
      { id: 'flr_1', buildingId: 'b1', level: 1, name: 'Tầng 1', description: '', widthMeters: 20, depthMeters: 15 },
      { id: 'flr_4', buildingId: 'b1', level: 4, name: 'Tầng 4', description: '', widthMeters: 20, depthMeters: 15 }
    ];
    base.racks = [];

    // 1) resolveUpsActiveWatts never equates VA = W (3000VA * 0.8 PF = 2400W)
    const ups3kva: DeviceAsset = {
      id: 'ups_f1',
      name: 'UPS-F1-3KVA',
      category: 'ups',
      vendor: 'APC',
      model: 'SMT3000',
      assetTag: 'UPS-F1',
      serialNumber: 'SN-U1',
      ipAddress: '10.0.1.5',
      macAddress: '00:00:00:00:01:01',
      subnetMask: '255.255.255.0',
      gateway: '10.0.1.1',
      vlan: '10',
      status: 'online',
      powerWatts: 0,
      weightKg: 30,
      floorId: 'flr_1',
      upsSpecs: {
        ratedVa: 3000,
        powerFactor: 0.8,
        batteryAh: 9,
        batteryVoltageV: 12,
        batteryCount: 8,
        inverterEfficiency: 0.85,
        dodFactor: 0.8
      },
      ports: []
    };
    const resolved3kva = resolveUpsActiveWatts(ups3kva);
    assert.equal(resolved3kva.activeWatts, 2400);
    assert.equal(resolved3kva.hasInvalidSpecs, false);

    // Invalid specs W > VA flags warning and caps at VA * PF
    const impossibleUps: DeviceAsset = { ...ups3kva, id: 'ups_bad', powerWatts: 3500 };
    const resolvedImpossible = resolveUpsActiveWatts(impossibleUps);
    assert.equal(resolvedImpossible.hasInvalidSpecs, true);
    assert.equal(resolvedImpossible.activeWatts, 2400);

    // 2) Cross-floor overload isolation: Floor 1 has 2600W load on 2400W UPS; Floor 4 has idle 2400W UPS
    const upsF4: DeviceAsset = { ...ups3kva, id: 'ups_f4', name: 'UPS-F4-3KVA', ipAddress: '10.0.4.5', floorId: 'flr_4' };
    const loadF1: DeviceAsset = {
      ...ups3kva,
      id: 'srv_f1',
      name: 'SRV-F1-HEAVY',
      category: 'server',
      ipAddress: '10.0.1.10',
      powerWatts: 2600,
      floorId: 'flr_1',
      upsSpecs: undefined
    };

    const domainProj: ProjectState = {
      ...base,
      assets: {
        ups_f1: ups3kva,
        ups_f4: upsF4,
        srv_f1: loadF1
      },
      nodes: [
        { id: 'n_u1', diagramMode: 'floorplan', floorId: 'flr_1', type: 'device', assetId: 'ups_f1', label: 'UPS F1', x: 50, y: 50, width: 80, height: 50, rotation: 0, style: { backgroundColor: '#fff', borderColor: '#000', borderWidth: 1, borderStyle: 'solid', opacity: 1 } },
        { id: 'n_s1', diagramMode: 'floorplan', floorId: 'flr_1', type: 'device', assetId: 'srv_f1', label: 'SRV F1', x: 180, y: 50, width: 80, height: 50, rotation: 0, style: { backgroundColor: '#fff', borderColor: '#000', borderWidth: 1, borderStyle: 'solid', opacity: 1 } },
        { id: 'n_u4', diagramMode: 'floorplan', floorId: 'flr_4', type: 'device', assetId: 'ups_f4', label: 'UPS F4', x: 50, y: 50, width: 80, height: 50, rotation: 0, style: { backgroundColor: '#fff', borderColor: '#000', borderWidth: 1, borderStyle: 'solid', opacity: 1 } }
      ],
      cables: []
    };

    const audit = runEngineeringAudit(domainProj);
    assert.ok(
      audit.issues.some(i => i.id === 'ups_overload_floor:flr_1' && i.severity === 'error'),
      'Overloaded Floor 1 UPS must be reported even when Floor 4 UPS is completely idle'
    );
    assert.equal(audit.summary.upsCapacityWatts, 4800);

    // 3) Peukert derating reduces usable energy under high C-rate load vs nominal C/20 linear
    const heavyBank = computeUpsBatteryRuntime({
      totalLoadWatts: 1200,
      batteryAh: 9,
      batteryVoltageV: 12,
      batteryCount: 4,
      inverterEfficiency: 0.85,
      dodFactor: 0.8
    });
    const linearUsableWh = Math.round(9 * 12 * 4 * 0.85 * 0.8);
    assert.ok((heavyBank.derateFactor ?? 1) < 0.85);
    assert.ok(heavyBank.usableEnergyWh < linearUsableWh);
  });

  // 60. P0 #4 — Trustworthy L2 Switching Loop Classification (2+ switches, routed exclusion, no text bypass)
  await runTest('engineeringValidator (P0#4): detects 2-switch parallel loops, refuses text bypass, trusts structured LACP/STP & excludes L3 routed links', () => {
    const makeSw = (id: string, name: string, stpMode?: 'rstp' | 'none'): DeviceAsset => ({
      id,
      name,
      category: 'switch',
      vendor: 'Cisco',
      model: 'C9300',
      assetTag: id,
      serialNumber: `SN-${id}`,
      ipAddress: `10.10.0.${id === 'sw1' ? 1 : 2}`,
      macAddress: '00:11:22:33:44:55',
      subnetMask: '255.255.255.0',
      gateway: '10.10.0.254',
      vlan: '10',
      status: 'online',
      powerWatts: 120,
      weightKg: 4,
      l2Config: stpMode ? { role: 'access', stpMode } : undefined,
      ports: [
        { id: 'p1', name: 'Gi1/0/1', type: 'RJ45_1G', speed: '1G', poe: false, status: 'up' },
        { id: 'p2', name: 'Gi1/0/2', type: 'RJ45_1G', speed: '1G', poe: false, status: 'up' }
      ]
    });

    const base = createEnterpriseTopologyProject();
    base.racks = [];
    base.assets = { sw1: makeSw('sw1', 'SW-1'), sw2: makeSw('sw2', 'SW-2') };
    base.nodes = [
      { id: 'n_sw1', diagramMode: 'topology', type: 'device', assetId: 'sw1', label: 'SW-1', x: 50, y: 50, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#fff', borderColor: '#000', borderWidth: 1, borderStyle: 'solid', opacity: 1 } },
      { id: 'n_sw2', diagramMode: 'topology', type: 'device', assetId: 'sw2', label: 'SW-2', x: 250, y: 50, width: 120, height: 50, rotation: 0, style: { backgroundColor: '#fff', borderColor: '#000', borderWidth: 1, borderStyle: 'solid', opacity: 1 } }
    ];
    base.cables = [
      { id: 'c1', cableCode: 'LINK-1', diagramMode: 'topology', sourceNodeId: 'n_sw1', sourcePortId: 'p1', targetNodeId: 'n_sw2', targetPortId: 'p1', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'straight', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 3, status: 'active' },
      { id: 'c2', cableCode: 'LINK-2', diagramMode: 'topology', sourceNodeId: 'n_sw1', sourcePortId: 'p2', targetNodeId: 'n_sw2', targetPortId: 'p2', cableType: 'CAT6_UTP', bandwidth: '1G', color: '#0284c7', routingType: 'straight', lineStyle: 'solid', strokeWidth: 2, lengthMeters: 3, status: 'active' }
    ];

    // 1) Bare 2-switch parallel cables -> suspected_loop + audit error
    const bareLoops = detectL2SwitchingLoops(base);
    assert.equal(bareLoops.length, 1);
    assert.equal(bareLoops[0].kind, 'parallel_links');
    assert.equal(bareLoops[0].status, 'suspected_loop');
    assert.ok(runEngineeringAudit(base).issues.some(i => i.severity === 'error' && i.id.startsWith('l2_loop_')));

    // 2) Free-text "RSTP/LACP" note alone -> NEVER silent pass, flagged as unverified warning
    const textOnly = structuredClone(base);
    textOnly.cables[0].notes = 'RSTP LACP enabled';
    const textLoops = detectL2SwitchingLoops(textOnly);
    assert.equal(textLoops[0].status, 'unverified');
    assert.ok(runEngineeringAudit(textOnly).issues.some(i => i.severity === 'warning' && i.id.startsWith('l2_loop_')));

    // 3) Structured LACP port_mode + matching lacpGroup -> protected_redundancy (0 L2 loop issues)
    const lacpProj = structuredClone(base);
    lacpProj.assets.sw1.ports.forEach(p => {
      p.portMode = 'lacp_member';
      p.lacpGroup = 'Po1';
    });
    lacpProj.assets.sw2.ports.forEach(p => {
      p.portMode = 'lacp_member';
      p.lacpGroup = 'Po1';
    });
    const lacpLoops = detectL2SwitchingLoops(lacpProj);
    assert.equal(lacpLoops[0].status, 'protected_redundancy');
    assert.equal(runEngineeringAudit(lacpProj).issues.some(i => i.id.startsWith('l2_loop_')), false);

    // 4) Routed L3 ports -> excluded cleanly from L2 graph (0 loops)
    const routedProj = structuredClone(base);
    routedProj.assets.sw1.ports.forEach(p => {
      p.portMode = 'routed';
    });
    assert.equal(detectL2SwitchingLoops(routedProj).length, 0);
  });

  // 61. P0 #5 — Unified AI API Security Layer (Validation, Origin, IP Spoof Prevention, Fail-Closed Redis, Error Sanitization)
  await runTest('server chat security (P0#5): validates bounds, stops IP/Origin spoofing, verifies secret & enforces fail-closed limiter', async () => {
    // 1) Validation boundaries
    assert.equal(validateChatRequest({ message: 'Kiểm tra tủ rack MDF' }).ok, true);
    assert.equal(validateChatRequest({ message: '' }).ok, false);
    assert.equal(validateChatRequest({ message: 'x'.repeat(5000) }).ok, false);
    assert.equal(validateChatRequest({ message: 'ok' }, 600 * 1024).ok, false);

    const sysPrompt = buildSystemInstruction('rack_power', { projectName: 'HACHIHI Test', deviceCount: 12, rackCount: 2 });
    assert.ok(sysPrompt.includes('HACHIHI Test'));

    // 2) Trusted client IP extraction ignores spoofed left XFF entry when platform headers exist
    assert.equal(
      extractTrustedClientIp({
        'x-forwarded-for': '1.2.3.4, 5.6.7.8',
        'x-vercel-forwarded-for': '203.0.113.99'
      }),
      '203.0.113.99'
    );
    assert.equal(
      extractTrustedClientIp({ 'x-forwarded-for': '9.9.9.9, 198.51.100.7' }),
      '198.51.100.7'
    );

    // 3) Origin allowlist & optional timing-safe secret
    assert.equal(isOriginAllowed({ host: 'app.hachihi.vn', origin: 'https://app.hachihi.vn' }, {}), true);
    assert.equal(isOriginAllowed({ host: 'app.hachihi.vn', origin: 'https://evil.example.com' }, {}), false);
    assert.equal(verifyOptionalChatSecret({}, undefined), true);
    assert.equal(verifyOptionalChatSecret({}, 'top-secret'), false);
    assert.equal(verifyOptionalChatSecret({ 'x-hachihi-token': 'top-secret' }, 'top-secret'), true);

    // 4) Rate limiting & fail-closed Redis behavior (minimum per-minute safety floor is 3)
    resetInMemoryRateLimitState();
    const cfgMem = getAiRuntimeConfig({ CHAT_RATE_LIMIT_PER_MIN: '3', CHAT_RATE_LIMIT_PER_HOUR: '10', CHAT_DAILY_LIMIT: '50' });
    assert.equal((await checkRateLimitShared('192.0.2.10', { config: cfgMem, now: 100_000 })).allowed, true);
    assert.equal((await checkRateLimitShared('192.0.2.10', { config: cfgMem, now: 100_100 })).allowed, true);
    assert.equal((await checkRateLimitShared('192.0.2.10', { config: cfgMem, now: 100_150 })).allowed, true);
    const blocked = await checkRateLimitShared('192.0.2.10', { config: cfgMem, now: 100_200 });
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.statusCode, 429);

    await recordDailyTokenUsage(1_000, { config: cfgMem, now: 100_200 });

    const cfgRedisFailClosed = getAiRuntimeConfig({
      NODE_ENV: 'production',
      UPSTASH_REDIS_REST_URL: 'https://redis.invalid',
      UPSTASH_REDIS_REST_TOKEN: 'tok'
    });
    const redisOutage = await checkRateLimitShared('192.0.2.11', {
      config: cfgRedisFailClosed,
      fetchImpl: async () => {
        throw new Error('Redis connection refused');
      }
    });
    assert.equal(redisOutage.allowed, false);
    assert.equal(redisOutage.statusCode, 503);

    // 5) Sanitized error mapping never leaks raw API keys
    const keyErr = classifyAndSanitizeAiError(new Error('403 API_KEY_INVALID AIzaSySecretLeak123'));
    assert.equal(keyErr.statusCode, 403);
    assert.equal(keyErr.error.includes('AIzaSySecretLeak123'), false);
    const timeoutErr = classifyAndSanitizeAiError(new Error('GEMINI_TIMEOUT'));
    assert.equal(timeoutErr.statusCode, 504);
  });

  // 62. Unlocked 3D Device Addition Policy & 3D World-to-Canvas Floor Plane Coordinate Round-Trip
  await runTest('3D unlocked device insertion policy & floor elevation coordinate conversion', () => {
    // 1) Insertion gating policy across 2D, locked 3D, unlocked 3D, and read-only
    assert.equal(canAddDevicesInScene({ isReadOnlyMode: false, is3DView: false, is3DDragLocked: true }), true);
    assert.equal(canAddDevicesInScene({ isReadOnlyMode: false, is3DView: true, is3DDragLocked: true }), false);
    assert.equal(canAddDevicesInScene({ isReadOnlyMode: false, is3DView: true, is3DDragLocked: false }), true);
    assert.equal(canAddDevicesInScene({ isReadOnlyMode: true, is3DView: true, is3DDragLocked: false }), false);
    assert.equal(canAddDevicesInScene({ isReadOnlyMode: true, is3DView: false, is3DDragLocked: false }), false);

    // 2) Exact inverse mapping between canvas (x, y) and 3D world (wx, wz)
    const origin = { centerX: 620, centerY: 410 };
    const worldPt = canvasToWorldXZ(945, 275, origin);
    const backToCanvas = worldXZToCanvas(worldPt.x, worldPt.z, origin);
    assert.ok(Math.abs(backToCanvas.x - 945) < 1e-6);
    assert.ok(Math.abs(backToCanvas.y - 275) < 1e-6);

    // 3) Multi-floor cutaway elevation resolves floor Y matching stacked storey offset
    const multiFloor = createMultiFloorSampleOfficeProject();
    multiFloor.activeMode = 'floorplan';
    const floor0Y = getFloorElevationY(multiFloor, multiFloor.floors[0].id, 1, true);
    const floor1Y = getFloorElevationY(multiFloor, multiFloor.floors[1].id, 1, true);
    assert.equal(floor0Y, 0);
    assert.ok(Math.abs(floor1Y - (3.25 + 1.15)) < 1e-6);
    assert.equal(getFloorElevationY(multiFloor, multiFloor.floors[1].id, 1, false), 0);
  });

  // 63. Bidirectional 2D <-> 3D Selection Sync & Canonical Resolution
  await runTest('selectionSync: canonically resolves 2D/3D clicks, multi-select highlights, rack shadow mapping & floor/inspector sync', () => {
    const proj = createMultiFloorSampleOfficeProject();
    const targetRack = proj.racks[0];
    assert.ok(targetRack);

    // Ensure a floorplan rack node links to targetRack on the same floor
    const rackNode = proj.nodes.find(
      n => n.type === 'rack' && (n.customData?.rackId === targetRack.id || n.id === targetRack.id)
    );
    assert.ok(rackNode);

    // 1) Clicking a rack node in 2D or 3D canonicalizes to { type: 'rack', id: targetRack.id }
    assert.deepEqual(resolveCanonicalSelection('node', rackNode.id, proj), {
      type: 'rack',
      id: targetRack.id
    });
    assert.deepEqual(resolveCanonicalSelection('rack', rackNode.id, proj), {
      type: 'rack',
      id: targetRack.id
    });

    // 2) Orphaned rack node without matching ServerRack falls back cleanly to 'node'
    const orphanProj = structuredClone(proj);
    orphanProj.racks = [];
    assert.deepEqual(resolveCanonicalSelection('rack', rackNode.id, orphanProj), {
      type: 'node',
      id: rackNode.id
    });

    // 3) Inspector targets resolve both selectedRack and its diagram node when selection is 'rack'
    const rackTargets = resolveInspectorTargets({ type: 'rack', id: targetRack.id }, proj);
    assert.equal(rackTargets.selectedRack?.id, targetRack.id);
    assert.equal(rackTargets.selectedNode?.id, rackNode.id);

    // 4) 3D highlighting resolves multi-select additionalIds, cables, and rack-mounted shadow topology nodes
    const shadowMap = new Map<string, string>([['topo_shadow_sw', rackNode.id]]);
    const multiHl = resolve3DHighlightedIds(
      { type: 'node', id: 'n_cam_1', additionalIds: ['n_cam_2', 'topo_shadow_sw'] },
      proj,
      shadowMap
    );
    assert.equal(multiHl.highlightedNodeIds.has('n_cam_1'), true);
    assert.equal(multiHl.highlightedNodeIds.has('n_cam_2'), true);
    assert.equal(multiHl.highlightedNodeIds.has('topo_shadow_sw'), true);
    assert.equal(multiHl.highlightedNodeIds.has(rackNode.id), true);

    const cableId = proj.cables[0]?.id;
    assert.ok(cableId);
    const cableHl = resolve3DHighlightedIds({ type: 'edge', id: cableId }, proj);
    assert.equal(cableHl.highlightedCableIds.has(cableId), true);

    // 5) Mounted asset resolves to its diagram node if present, or to its enclosing rack & floor if unrendered on canvas
    const mountedAssetId = Object.values(proj.assets).find(a => a.rackId === targetRack.id)?.id;
    assert.ok(mountedAssetId);
    const noNodeProj = structuredClone(proj);
    noNodeProj.nodes = noNodeProj.nodes.filter(n => n.assetId !== mountedAssetId);
    const rackFallbackTarget = resolveTargetSelectionForAssetOrNode(mountedAssetId, noNodeProj);
    assert.ok(rackFallbackTarget);
    assert.equal(rackFallbackTarget.selection.type, 'rack');
    assert.equal(rackFallbackTarget.rack?.id, targetRack.id);
    assert.equal(resolveSelectionFloorId({ type: 'rack', id: targetRack.id }, proj), targetRack.floorId);

    const linkedNode = proj.nodes.find(n => n.assetId === mountedAssetId);
    if (linkedNode) {
      const nodeTarget = resolveTargetSelectionForAssetOrNode(mountedAssetId, proj);
      assert.ok(nodeTarget);
      assert.equal(nodeTarget.selection.type, 'node');
      assert.equal(nodeTarget.node?.assetId, mountedAssetId);
    }

    // 6) Inspector auto-focus triggers on entity selection changes and ignores empty/same selections
    assert.equal(
      shouldFocusInspectorOnSelectionChange({ type: 'none' }, { type: 'node', id: 'n_1' }),
      true
    );
    assert.equal(
      shouldFocusInspectorOnSelectionChange({ type: 'node', id: 'n_1' }, { type: 'node', id: 'n_1' }),
      false
    );
    assert.equal(
      shouldFocusInspectorOnSelectionChange({ type: 'node', id: 'n_1' }, { type: 'canvas' }),
      false
    );
  });

  // 64. Refined 2D Grid Intersection Snapping Algorithm (within 10px Euclidean threshold)
  await runTest('snapGuides: highlights and snaps to nearest grid intersection only within 10px while respecting guide locks', () => {
    assert.equal(DEFAULT_GRID_SNAP_THRESHOLD_PX, 10);

    // 1) Point within 10px of (200, 140) on 20px grid -> snaps cleanly
    const nearSnap = computeGridIntersectionSnap(206, 134, 20); // dist = sqrt(36 + 36) = ~8.485px <= 10px
    assert.equal(nearSnap.snapped, true);
    assert.equal(nearSnap.gridX, 200);
    assert.equal(nearSnap.gridY, 140);
    assert.equal(nearSnap.dx, -6);
    assert.equal(nearSnap.dy, 6);
    assert.ok(nearSnap.distance <= 10);

    // 2) Point at exact 10px Euclidean distance (6-8-10 triple & 190->200) -> snaps
    const pythagoreanBoundary = computeGridIntersectionSnap(206, 132, 20); // hypot(-6, 8) = 10
    assert.equal(pythagoreanBoundary.snapped, true);
    assert.equal(pythagoreanBoundary.gridX, 200);
    assert.equal(pythagoreanBoundary.gridY, 140);
    assert.equal(pythagoreanBoundary.distance, 10);

    const halfGridBoundary = computeGridIntersectionSnap(190, 140, 20); // Math.round(9.5) = 10 -> 200
    assert.equal(halfGridBoundary.snapped, true);
    assert.equal(halfGridBoundary.gridX, 200);
    assert.equal(halfGridBoundary.gridY, 140);
    assert.equal(halfGridBoundary.distance, 10);

    // 3) Point outside 10px Euclidean radius (e.g. dx=8, dy=8 -> dist=~11.31px > 10px) -> does NOT snap
    const outsideSnap = computeGridIntersectionSnap(208, 148, 20);
    assert.equal(outsideSnap.snapped, false);
    assert.ok(outsideSnap.distance > 10);

    // 4) Respects minCoord=10 clamp on a 20px grid (minimum valid grid intersection >= 10 is 20)
    const minClamped = computeGridIntersectionSnap(12, 14, 20, 10, { minCoord: 10 });
    assert.equal(minClamped.gridX, 20);
    assert.equal(minClamped.gridY, 20);
    assert.equal(minClamped.snapped, true); // hypot(8, 6) = 10

    // 5) Refined drag snap disables grid highlight when snapToGrid is false
    const noGridRes = computeRefined2DDragSnap(
      { x: 204, y: 143, width: 100, height: 60 },
      [],
      { gridSize: 20, snapToGrid: false }
    );
    assert.equal(noGridRes.gridSnap, null);
    assert.equal(noGridRes.dx, 0);
    assert.equal(noGridRes.dy, 0);

    // 6) Refined drag snap coordinates with smart alignment guides:
    //    If vertical guide aligns dragged node to an off-grid X (e.g. target x=205), grid intersection highlight is suppressed
    const offGridTarget = { id: 't_off', x: 205, y: 300, width: 100, height: 60 };
    const offGridAligned = computeRefined2DDragSnap(
      { x: 204, y: 142, width: 100, height: 60 },
      [offGridTarget],
      { gridSize: 20, snapToGrid: true }
    );
    assert.ok(offGridAligned.guides.some(g => g.orientation === 'vertical'));
    assert.equal(offGridAligned.gridSnap, null);

    //    If vertical guide aligns dragged node to an ON-grid X (e.g. target x=200), grid intersection highlights (200, 140)
    const onGridTarget = { id: 't_on', x: 200, y: 300, width: 100, height: 60 };
    const onGridAligned = computeRefined2DDragSnap(
      { x: 202, y: 144, width: 100, height: 60 },
      [onGridTarget],
      { gridSize: 20, snapToGrid: true }
    );
    assert.ok(onGridAligned.guides.some(g => g.orientation === 'vertical'));
    assert.ok(onGridAligned.gridSnap);
    assert.equal(onGridAligned.gridSnap?.gridX, 200);
    assert.equal(onGridAligned.gridSnap?.gridY, 140);
    assert.equal(202 + onGridAligned.dx, 200);
    assert.equal(144 + onGridAligned.dy, 140);
  });

  console.log(`\nALL ${passed} TEST SUITES PASSED`);
}

main().catch(err => {
  console.error('TEST FAILURE:', err);
  process.exit(1);
});
