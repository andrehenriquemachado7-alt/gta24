/* ============================================================
   QUINTAL 3D — OrbitCam (terceira pessoa estilo GTA)
   Anti-clipping: amostra o segmento jogador->câmera contra os
   Box3 do mundo + terreno; se algo entra no caminho, a câmera
   dá zoom-in automático até ficar livre.
   ============================================================ */
import * as THREE from "three";
import { CAM, clamp, damp } from "../core/constants";
import type { Physics } from "./physics";

export class OrbitCam {
  yaw = 0;
  pitch = 0.32;
  private curDist = CAM.DIST;
  private target = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private probe = new THREE.Vector3();
  private dir = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, private physics: Physics) {}

  drag(dx: number, dy: number) {
    this.yaw -= dx * CAM.SENS;
    this.pitch = clamp(this.pitch + dy * CAM.SENS, CAM.PITCH_MIN, CAM.PITCH_MAX);
  }

  update(dt: number, playerPos: THREE.Vector3) {
    // foco no peito/cabeça
    this.target.set(playerPos.x, playerPos.y + CAM.HEIGHT, playerPos.z);

    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, sp, Math.cos(this.yaw) * cp);
    this.desired.copy(this.target).addScaledVector(this.dir, CAM.DIST);

    // ---- raycaster reverso: 8 amostras entre o jogador e a câmera ----
    let maxT = 1;
    const step = 1 / 8;
    for (let i = 1; i <= 8; i++) {
      const t = i * step;
      this.probe.lerpVectors(this.target, this.desired, t);
      if (this.physics.pointBlocked(this.probe)) {
        maxT = Math.max(0, t - step * 0.6);
        break;
      }
    }
    const goalDist = Math.max(CAM.MIN_DIST, CAM.DIST * maxT);
    this.curDist = damp(this.curDist, goalDist, 14, dt);

    this.camera.position.copy(this.target).addScaledVector(this.dir, this.curDist);
    // nunca deixa a câmera afundar no chão
    const floor = this.physics.terrainH(this.camera.position.x, this.camera.position.z) + 0.35;
    if (this.camera.position.y < floor) this.camera.position.y = floor;
    this.camera.lookAt(this.target);
  }

  /** direção horizontal p/ mover o jogador relativa à câmera */
  forwardInto(out: THREE.Vector3) {
    out.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
  rightInto(out: THREE.Vector3) {
    out.set(-Math.cos(this.yaw), 0, Math.sin(this.yaw));
  }
  /** raio saindo do centro da tela (p/ plantio com raycaster) */
  screenCenterRay(out: THREE.Raycaster) {
    out.setFromCamera(new THREE.Vector2(0, 0), this.camera);
  }
}
