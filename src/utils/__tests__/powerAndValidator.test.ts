import assert from 'node:assert/strict';
import { DeviceAsset, CableEdge } from '../../types/infrastructure';
import { findContiguousFreeUBlocks, computeRackPduOutletSummary } from '../rackGeometry';
import { migrateAndValidateProject, computeDetailedRevisionDiff } from '../projectStorage';
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
import { computeAutoRoutedWaypoints, computeOpticalLinkBudget } from '../cableRouting';
import { diffMergeNetworkScannerData } from '../scannerImport';
import {
  ARCHITECTURE_TEMPLATES,
  createEnterpriseTopologyProject,
  createMultiFloorSampleOfficeProject,
  createServerRackProject
} from '../../data/templates';
import {
  classifyPoeStandard,
  computeProjectPoeSummary,
  computeSwitchPoeBreakdown,
  isPoeConsumerDevice,
  isPseDevice,
  computeUpsBatteryRuntime,
  simulateBranchOutage
} from '../poeCalculator';
import type { ProjectState } from '../../types/infrastructure';
import { runStandaloneSuite, type TestFn } from './testHarness';

export async function runPowerAndValidatorTests(runTest: TestFn): Promise<void> {
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
}

runStandaloneSuite(import.meta.url, runPowerAndValidatorTests);
