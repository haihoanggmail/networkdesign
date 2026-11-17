import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  detectSoftwareGl,
  createContactShadowTexture,
  createLockBadgeTexture,
  createWorldAxesHelper,
  setupStudioEnvironment
} from './studioEnvironment';
import {
  populateInfrastructure3DWorld,
  disposeObjectTree
} from './proceduralDevices';
import {
  extractCameraRotationMatrix,
  projectCornerAxesFromCameraMatrix
} from './axisHelperProjection';

const HachihiViewer3D = {
  THREE,
  OrbitControls,
  detectSoftwareGl,
  createContactShadowTexture,
  createLockBadgeTexture,
  createWorldAxesHelper,
  setupStudioEnvironment,
  populateInfrastructure3DWorld,
  disposeObjectTree,
  extractCameraRotationMatrix,
  projectCornerAxesFromCameraMatrix
};

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).HachihiViewer3D = HachihiViewer3D;
}

export default HachihiViewer3D;
