import assert from 'node:assert/strict';
import * as THREE from 'three';
import { extractCameraRotationMatrix, projectCornerAxesFromCameraMatrix } from '../../components/canvas/three/axisHelperProjection';
import {
  build3DCableCurve,
  build3DCableGeometry,
  disposeObjectTree,
  populateInfrastructure3DWorld
} from '../../components/canvas/three/proceduralDevices';
import { clampFloatingPosition, resolveEdgeOrFreeDrop } from '../../hooks/useFloatingPanel';
import {
  applyGlobalShadowMapping,
  applySceneWireframeMode,
  getPixelRatioForQuality,
  getShadowMapSizeForQuality
} from '../../components/canvas/three/studioEnvironment';
import { ThreeResourceRegistry } from '../../components/canvas/three/resourceRegistry';
import { migrateAndValidateProject } from '../projectStorage';
import {
  generatePureSvgMarkup,
  generateCompositeBuildingSvgMarkup,
  computePureDiagramBounds,
  computeViewportDiagramBounds
} from '../svgExport';
import { generateProjectDxf } from '../dxfExporter';
import { generateStandaloneViewerHtml, generateStandaloneViewerHtmlAsync } from '../htmlViewerExporter';
import { importNetworkScannerData } from '../scannerImport';
import { createEnterpriseTopologyProject, createMultiFloorSampleOfficeProject } from '../../data/templates';
import { createHachihi2BuildingProject } from '../../data/hachihi2BuildingTemplate';
import {
  buildTechnicalPdfArtifact,
  computeA4ScaleMetrics,
  fitBoxPreserveAspectRatio
} from '../pdfExporter';
import { capture3DAnglesStrict, capture3DSnapshotStrict } from '../../services/export/capture3D';
import { runExportSvg } from '../../services/export/exportSvg';
import { runExportDxf } from '../../services/export/exportDxf';
import { ExportService } from '../../services/export/exportService';
import {
  canDragNodeIn3DScene,
  isNodeEffectivelyLocked,
  isNodePositionLocked
} from '../layerPolicy';
import type { ProjectState } from '../../types/infrastructure';
import { runStandaloneSuite, type TestFn } from './testHarness';

export async function runExportersAnd3DTests(runTest: TestFn): Promise<void> {
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

  // 56. Interactive 3D Standalone HTML Viewer Export
  await runTest('htmlViewerExporter: embeds offline Three.js runtime, 7 camera directions, multi-floor cutaway & safe JSON', async () => {
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

    const html3d = await generateStandaloneViewerHtmlAsync(maliciousProject, {
      contentScope: '3d',
      background3D: 'dark'
    });

    assert.ok(html3d.includes('HachihiViewer3D'), 'Offline Three.js runtime must be embedded');
    assert.ok(html3d.includes('applyGlobalShadowMapping'), 'Updated 3D runtime helpers must be bundled');
    assert.ok(html3d.includes('id="tab3D" class="active"'), '3D scope must activate Không gian 3D tab');
    assert.ok(html3d.includes('id="view3D" class="viewport-3d"'), '3D viewport must be visible on load');
    assert.ok(html3d.includes('data-preset="back"'), 'Must include Mặt sau camera direction');
    assert.ok(html3d.includes('data-preset="left"'), 'Must include Bên trái camera direction');
    assert.ok(html3d.includes('data-preset="right"'), 'Must include Bên phải camera direction');
    assert.ok(html3d.includes('id="btnAutoRotate"'), 'Must include Xoay 360° auto-rotate button');
    assert.ok(html3d.includes('id="selFloor3d"'), 'Multi-floor project must expose floor selector in 3D viewer');
    assert.ok(html3d.includes('id="rngExplode3d"'), 'Must expose Giãn tầng slider');

    // Collapsible status bar & all other panels + 3D parity + global Dark Mode
    assert.ok(html3d.includes('id="hudTopLeft" class="hud-card" data-collapsed="true"'), 'Top-left status bar starts compact/collapsed');
    assert.ok(html3d.includes('id="btnToggleHudTopLeft"'), 'Status bar must include expand/collapse toggle');
    assert.ok(html3d.includes('id="btnToggleHeader"'), 'Header must be collapsible');
    assert.ok(html3d.includes('id="btnToggleToolbar"'), 'Toolbar must be collapsible');
    assert.ok(html3d.includes('id="btnToggleGizmo"'), 'XYZ gizmo panel must be collapsible');
    assert.ok(html3d.includes('id="btnCollapseDock"'), 'Bottom 3D control dock must be collapsible');
    assert.ok(html3d.includes('id="inspCollapse"'), '3D inspector card must be collapsible');
    assert.ok(html3d.includes('id="btnToggleFooter"'), 'Footer must be collapsible');
    assert.ok(html3d.includes('id="togWireframe3d"'), 'Must expose Wireframe toggle in 3D dock');
    assert.ok(html3d.includes('id="togShadows3d"'), 'Must expose Shadows toggle in 3D dock');
    assert.ok(html3d.includes('id="togThermal3d"'), 'Must expose Thermal 3D heatmap toggle in 3D dock');
    assert.ok(html3d.includes('id="btn3dTheme"'), 'Must expose global dark/light mode toggle button');
    assert.ok(html3d.includes('body.theme-dark'), 'Must include global dark mode CSS styles across views');
    assert.ok(html3d.includes('id="selFloor2d"'), 'Multi-floor project must expose floor selector in 2D viewer');

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

    const html2d = await generateStandaloneViewerHtmlAsync(building, { contentScope: '2d' });
    assert.ok(html2d.includes('id="tabDiag" class="active"'), '2D scope starts on Sơ đồ 2D tab');
    assert.ok(html2d.includes('id="tab3D"'), '2D scope still allows switching to 3D tab');
    assert.ok(html2d.includes('data-layer="rack"'), '2D pure SVG must include rack layer');
    assert.ok(html2d.includes('U dùng ·'), '2D pure SVG rack must include U usage footer');
    assert.equal(html2d.includes('<foreignObject'), false, 'Exported 2D SVG must remain pure vector without foreignObject');
  });

  // 63. Global Shadow Mapping Toggle, Wireframe Mode & Render Quality Helpers
  await runTest('studioEnvironment: toggles global Three.js shadow mapping, wireframe mode & quality tiers cleanly', () => {
    assert.equal(getShadowMapSizeForQuality('low'), 512);
    assert.equal(getShadowMapSizeForQuality('medium'), 1024);
    assert.equal(getShadowMapSizeForQuality('high'), 2048);

    assert.equal(getPixelRatioForQuality('low', 2, false), 1);
    assert.equal(getPixelRatioForQuality('medium', 2, false), 1.35);
    assert.equal(getPixelRatioForQuality('high', 3, false), 2);
    assert.equal(getPixelRatioForQuality('low', 2, true), 0.75);
    assert.equal(getPixelRatioForQuality('high', 2, true), 1);

    const scene = new THREE.Scene();
    const keyLight = new THREE.DirectionalLight(0xffffff, 2);
    keyLight.userData.supportsShadow = true;
    keyLight.castShadow = true;
    scene.add(keyLight);

    const floorMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshStandardMaterial()
    );
    floorMesh.name = 'studio_floor';
    scene.add(floorMesh);

    const rackMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 2, 1),
      new THREE.MeshStandardMaterial()
    );
    rackMesh.name = 'rack_body';
    scene.add(rackMesh);

    const contactShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.MeshBasicMaterial()
    );
    contactShadow.name = 'contact_shadow';
    scene.add(contactShadow);

    const mockRenderer = {
      shadowMap: { enabled: true, autoUpdate: true, needsUpdate: false }
    } as unknown as THREE.WebGLRenderer;

    // Disable global shadows
    applyGlobalShadowMapping(mockRenderer, scene, false);
    assert.equal(mockRenderer.shadowMap.enabled, false);
    assert.equal(mockRenderer.shadowMap.autoUpdate, false);
    assert.equal(keyLight.castShadow, false);
    assert.equal(floorMesh.receiveShadow, false);
    assert.equal(rackMesh.castShadow, false);
    assert.equal(rackMesh.receiveShadow, false);

    // Re-enable global shadows
    applyGlobalShadowMapping(mockRenderer, scene, true);
    assert.equal(mockRenderer.shadowMap.enabled, true);
    assert.equal(mockRenderer.shadowMap.autoUpdate, true);
    assert.equal(mockRenderer.shadowMap.needsUpdate, true);
    assert.equal(keyLight.castShadow, true);
    assert.equal(floorMesh.receiveShadow, true);
    assert.equal(floorMesh.castShadow, false);
    assert.equal(rackMesh.castShadow, true);
    assert.equal(rackMesh.receiveShadow, true);
    assert.equal(contactShadow.castShadow, false);

    // Wireframe toggle enables wireframe on scene meshes while skipping contact_shadow, then restores cleanly
    applySceneWireframeMode(scene, true);
    assert.equal((rackMesh.material as THREE.MeshStandardMaterial).wireframe, true);
    assert.equal((contactShadow.material as THREE.MeshBasicMaterial).wireframe, false);

    applySceneWireframeMode(scene, false);
    assert.equal((rackMesh.material as THREE.MeshStandardMaterial).wireframe, false);

    disposeObjectTree(scene);
  });

  // 68. ThreeResourceRegistry Deduplication, Material Pooling & Zero-Leak Rebuild Lifecycle
  await runTest('proceduralDevices & ThreeResourceRegistry: pools shared materials & disposes cleanly across 2D<->3D rebuilds', () => {
    const registry = new ThreeResourceRegistry();
    const shadowTex = new THREE.Texture();
    const lockBadgeTex = new THREE.Texture();
    registry.pinTexture(shadowTex);
    registry.pinTexture(lockBadgeTex);

    const project = createEnterpriseTopologyProject();
    const worldRoot = new THREE.Group();

    // First build
    populateInfrastructure3DWorld(worldRoot, project, undefined, {
      showRooms: true,
      showCables: true,
      explodeSpread: 0,
      castShadow: false,
      shadowTex,
      lockBadgeTex,
      registry,
      registryScope: 'world'
    });
    const statsAfterFirst = registry.getStats();
    assert.ok(statsAfterFirst.activeGeometries > 0);
    assert.ok(statsAfterFirst.activeMaterials > 0);
    assert.equal(statsAfterFirst.pinnedTextures, 2);

    // Rebuild world (simulates mode/project switch or 2D<->3D rebuild)
    const disposedFirst = registry.disposeScope('world');
    assert.equal(disposedFirst.geometries, statsAfterFirst.activeGeometries);
    assert.equal(disposedFirst.materials, statsAfterFirst.activeMaterials);
    assert.equal(registry.getStats().activeGeometries, 0);
    assert.equal(registry.getStats().activeMaterials, 0);
    assert.equal(registry.getStats().pinnedTextures, 2);
    worldRoot.clear();

    populateInfrastructure3DWorld(worldRoot, project, undefined, {
      showRooms: true,
      showCables: true,
      explodeSpread: 0.4,
      castShadow: false,
      shadowTex,
      lockBadgeTex,
      registry,
      registryScope: 'world'
    });
    assert.ok(registry.getStats().activeGeometries > 0);

    // Full unmount cleanup releases world AND pinned textures
    registry.disposeAll();
    const finalStats = registry.getStats();
    assert.equal(finalStats.activeGeometries, 0);
    assert.equal(finalStats.activeMaterials, 0);
    assert.equal(finalStats.activeTextures, 0);
    assert.equal(finalStats.pinnedTextures, 0);
    assert.ok(finalStats.totalDisposedCount > 0);
    worldRoot.clear();
  });

  // 69. Multi-Floor 2D Whole-Building SVG & HTML Viewer Selector Across All Design Modes
  await runTest('htmlViewerExporter & svgExport: exposes floor & mode 2D selectors including whole-building view in topology and floorplan modes', async () => {
    const topoMultiFloor = createMultiFloorSampleOfficeProject();
    assert.equal(topoMultiFloor.activeMode, 'topology');
    assert.ok(topoMultiFloor.floors.length > 1);

    const htmlTopo2d = await generateStandaloneViewerHtmlAsync(topoMultiFloor, { contentScope: '2d' });
    assert.ok(htmlTopo2d.includes('id="selFloor2d"'), 'Topology multi-floor project must still expose #selFloor2d');
    assert.ok(htmlTopo2d.includes('id="selMode2d"'), 'Multi-view project must expose #selMode2d');
    assert.ok(
      htmlTopo2d.includes('<option value="__ALL__" selected>Toàn bộ tòa nhà'),
      'Topology 2D export must default to whole-building overview while allowing per-floor switching'
    );
    for (const fl of topoMultiFloor.floors) {
      assert.ok(
        htmlTopo2d.includes(`data-floor2d-id="${fl.id}"`),
        `Must embed 2D SVG template for floor ${fl.id}`
      );
    }
    assert.equal(htmlTopo2d.includes('<foreignObject'), false);

    const hachihi2 = createHachihi2BuildingProject();
    const compositeSvg = generateCompositeBuildingSvgMarkup(hachihi2, { includeTitleBlock: true });
    assert.equal(compositeSvg.includes('<foreignObject'), false);
    for (const fl of hachihi2.floors) {
      assert.ok(
        compositeSvg.includes(`data-floor-id="${fl.id}"`),
        `Composite whole-building SVG must render floor card for ${fl.id}`
      );
    }

    const htmlH2 = await generateStandaloneViewerHtmlAsync(hachihi2, { contentScope: '2d' });
    assert.ok(htmlH2.includes('id="selFloor2d"'));
    assert.ok(htmlH2.includes('id="selMode2d"'));
    assert.ok(htmlH2.includes('<option value="__ALL__">Toàn bộ tòa nhà'));
    assert.ok(htmlH2.includes('data-view2d-mode="floorplan" data-floor2d-id="__ALL__"'));
    assert.ok(htmlH2.includes('data-view2d-mode="topology" data-floor2d-id="__ALL__"'));
    assert.ok(htmlH2.includes('data-view2d-mode="rack" data-floor2d-id="__ALL__"'));
  });

  // 70. ExportService Multi-Floor Metadata, #floorNavBar, window.HachihiProjectData & Multi-Floor PDF/DXF
  await runTest('ExportService: serializes floor context to window.HachihiProjectData, renders #floorNavBar, and builds multi-floor PDF/DXF', async () => {
    const hachihi2 = createHachihi2BuildingProject();
    const floorMeta = ExportService.scanProjectFloors(hachihi2, 'all');
    assert.equal(floorMeta.hasMultipleFloors, true);
    assert.equal(floorMeta.totalFloors, hachihi2.floors.length);
    assert.equal(floorMeta.resolvedFloorId, '__ALL__');
    assert.ok(floorMeta.floors.every(f => f.nodeCount >= 0 && typeof f.roomCount === 'number'));

    const serialized = ExportService.serializeFloorContext(hachihi2, hachihi2.floors[0].id);
    assert.equal(serialized.activeFloorScope, hachihi2.floors[0].id);
    assert.equal(serialized.floors.length, hachihi2.floors.length);
    assert.ok(serialized.floorLayerIds[hachihi2.floors[0].id]);

    const viewerHtml = await ExportService.generateHtmlViewerString(hachihi2, {
      contentScope: 'both',
      floorScope: 'all'
    });
    assert.ok(viewerHtml.includes('id="floorNavBar"'), 'Exported HTML must render clickable #floorNavBar');
    assert.ok(viewerHtml.includes('data-floor-nav="__ALL__"'));
    assert.ok(viewerHtml.includes('window.HachihiProjectData'), 'Exported HTML must hydrate window.HachihiProjectData');
    assert.ok(viewerHtml.includes('id="hachihi-floor-metadata"'));
    assert.ok(viewerHtml.includes('window.HachihiFloorNav'));
    assert.ok(viewerHtml.includes('data-floor-layer='));
    for (const fl of hachihi2.floors) {
      assert.ok(viewerHtml.includes(`data-floor-nav="${fl.id}"`));
    }

    // Single-floor project should not show unnecessary #floorNavBar
    const singleFloorProj = createMultiFloorSampleOfficeProject();
    singleFloorProj.floors = singleFloorProj.floors.slice(0, 1);
    const singleHtml = await ExportService.generateHtmlViewerString(singleFloorProj, { contentScope: '2d' });
    assert.equal(singleHtml.includes('id="floorNavBar"'), false);
    assert.ok(singleHtml.includes('window.HachihiProjectData'));

    // Multi-floor PDF produces overview + per-floor sheets when floorScope === 'all', vs 1 sheet when scoped
    const pdfAll = await buildTechnicalPdfArtifact(hachihi2, {
      contentScope: '2d',
      floorScope: 'all',
      paperSize: 'A3',
      orientation: 'landscape',
      includeDiagram: true,
      includeRackElevation: false,
      includeTables: false
    });
    assert.equal(pdfAll.pageCount, 1 + hachihi2.floors.length);

    const pdfSingleFloor = await buildTechnicalPdfArtifact(hachihi2, {
      contentScope: '2d',
      floorScope: hachihi2.floors[0].id,
      paperSize: 'A3',
      orientation: 'landscape',
      includeDiagram: true,
      includeRackElevation: false,
      includeTables: false
    });
    assert.equal(pdfSingleFloor.pageCount, 1);

    // Multi-floor DXF emits TANG headings, single-floor DXF excludes other floors' nodes
    const dxfAll = generateProjectDxf(hachihi2, { floorScope: 'all' });
    assert.ok(dxfAll.includes('TANG:'));
    const targetFloor = hachihi2.floors[0];
    const otherFloorNode = hachihi2.nodes.find(n => !n.hidden && n.floorId && n.floorId !== targetFloor.id);
    const dxfSingle = generateProjectDxf(hachihi2, { floorScope: targetFloor.id });
    if (otherFloorNode) {
      assert.equal(dxfSingle.includes(otherFloorNode.label), false);
    }
  });
}

runStandaloneSuite(import.meta.url, runExportersAnd3DTests);
