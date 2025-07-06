// ======= Vector3 =======
class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  add(v) { return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z); }
  subtract(v) { return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z); }
  multiply(s) { return new Vector3(this.x * s, this.y * s, this.z * s); }
  length() { return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2); }
  normalize() { const len = this.length(); return len > 0 ? this.multiply(1 / len) : new Vector3(); }
  distanceTo(v) { return this.subtract(v).length(); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  clone() { return new Vector3(this.x, this.y, this.z); }
}

// ======= TargetDetector =======
class TargetDetector {
  constructor(options = {}) {
    this.scanRadius = options.scanRadius || 360;
    this.scanFOV = options.scanFOV || 180;
    this.detectionThreshold = options.detectionThreshold || 0.7;
    this.minTargetSize = 0.1;
    this.maxTargetSize = 2.5;
  }

  scanArea(playerPos, playerDir, entities) {
    const results = [];
    const halfFOV = (this.scanFOV * Math.PI) / 360;

    for (const ent of entities) {
      if (!ent.isAlive || ent.isPlayer) continue;
      const toTarget = ent.position.subtract(playerPos);
      const distance = toTarget.length();
      if (distance > this.scanRadius) continue;
      const angle = Math.acos(playerDir.normalize().dot(toTarget.normalize()));
      if (angle > halfFOV) continue;
      const target = this.analyzeEntity(ent, playerPos, distance);
      if (target.confidence > this.detectionThreshold) results.push(target);
    }

    return results.sort((a, b) => b.confidence - a.confidence);
  }

  analyzeEntity(entity, playerPos, distance) {
    const velocity = entity.velocity || new Vector3();
    let confidence = 0;

    const size = this.estimateTargetSize(entity);
    if (size >= this.minTargetSize && size <= this.maxTargetSize) confidence += 0.2;
    const distScore = Math.max(0, 1 - distance / this.scanRadius);
    confidence += distScore * 0.3;

    if (velocity.length() > 0.1) confidence += Math.min(velocity.length() * 0.1, 0.2);

    const head = this.estimateHeadPosition(entity);
    if (this.isHeadVisible(head, playerPos)) confidence += 0.3;

    return {
      entity,
      headPosition: head,
      distance,
      velocity,
      confidence: Math.min(confidence, 1),
      targetType: entity.type || 'unknown'
    };
  }

  estimateHeadPosition(entity) {
    if (entity.bones?.head?.worldPosition) return entity.bones.head.worldPosition;
    if (entity.boundingBox) {
      return new Vector3(
        entity.position.x,
        entity.boundingBox.max.y - 0.1,
        entity.position.z
      );
    }
    return entity.position.add(new Vector3(0, 1.7, 0));
  }

  estimateTargetSize(entity) {
    if (entity.boundingBox) {
      const size = entity.boundingBox.max.subtract(entity.boundingBox.min);
      return Math.max(size.x, size.y, size.z);
    }
    return 1.0;
  }

  isHeadVisible(headPos, playerPos) {
    return true; // GameAPI.raycast nếu muốn kiểm tra vật cản
  }
}

// ======= AimLockSystem =======
class AimLockSystem {
  constructor(options = {}) {
    this.lockStrength = options.lockStrength || 1.0;
    this.smoothing = options.smoothing || 0.15;
    this.maxLockDistance = options.maxLockDistance || 1000;
    this.lockDuration = options.lockDuration || 5000;
    this.enablePrediction = options.enablePrediction ?? true;

    this.isLocked = false;
    this.lockedTarget = null;
    this.lockStartTime = 0;
    this.lastAimPosition = new Vector3();
  }

  lockOnTarget(target, playerPos) {
    const distance = target.headPosition.distanceTo(playerPos);
    if (distance > this.maxLockDistance) return false;

    this.isLocked = true;
    this.lockedTarget = target;
    this.lockStartTime = Date.now();
    return true;
  }

  updateAimLock(playerPos, deltaTime = 0.016) {
    if (!this.isLocked || !this.lockedTarget) return null;
    if (Date.now() - this.lockStartTime > this.lockDuration) return this.releaseLock();

    const aimPos = this.getPredictedAim(this.lockedTarget, playerPos);
    const smoothAim = this.smooth(this.lastAimPosition, aimPos, deltaTime);
    this.lastAimPosition = smoothAim.clone();

    return {
      target: this.lockedTarget,
      aimPosition: smoothAim,
      mouseMovement: this.toMouseDelta(smoothAim, playerPos),
      lockStrength: this.lockStrength
    };
  }

  getPredictedAim(target, playerPos) {
    let aim = target.headPosition.clone();
    if (this.enablePrediction) {
      const dist = aim.distanceTo(playerPos);
      const travel = target.velocity.multiply(dist / 1000);
      aim = aim.add(travel);
    }
    return aim;
  }

  smooth(current, target, dt) {
    const f = Math.min(dt * (this.smoothing * 10), 1.0);
    return new Vector3(
      current.x + (target.x - current.x) * f,
      current.y + (target.y - current.y) * f,
      current.z + (target.z - current.z) * f
    );
  }

  toMouseDelta(aim, origin) {
    const dx = aim.x - origin.x;
    const dy = aim.y - origin.y;
    return {
      deltaX: dx * this.lockStrength,
      deltaY: dy * this.lockStrength
    };
  }

  releaseLock() {
    this.isLocked = false;
    this.lockedTarget = null;
    this.lockStartTime = 0;
    return null;
  }

  sendMouseInput(dx, dy) {
    // Tích hợp API chuột tại đây
    console.log(`🖱️ Input: ΔX=${dx.toFixed(2)}, ΔY=${dy.toFixed(2)}`);
  }
}

// ======= TargetingSystem =======
class TargetingSystem {
  constructor(options = {}) {
    this.detector = new TargetDetector(options.detection || {});
    this.aimLock = new AimLockSystem(options.aimLock || {});
    this.autoLockEnabled = options.autoLock ?? true;
    this.updateInterval = options.updateInterval || 16;

    this.isActive = false;
    this.lastUpdate = 0;
  }

  fireButtonPressed() {
    this.isActive = true;
    console.log("🎯 Aimlock ENABLED");
  }

  fireButtonReleased() {
    this.aimLock.releaseLock();
    this.isActive = false;
    console.log("🔓 Aimlock DISABLED");
  }

  update(gameState) {
    const now = performance.now();
    if (now - this.lastUpdate < this.updateInterval || !this.isActive) return;
    this.lastUpdate = now;

    const { playerPos, playerDirection, playerRotation, gameEntities } = gameState;
    const targets = this.detector.scanArea(playerPos, playerDirection, gameEntities);

    if (!this.aimLock.isLocked && targets.length > 0) {
      const target = targets[0];
      if (this.autoLockEnabled) {
        this.aimLock.lockOnTarget(target, playerPos);
      }
    }

    const result = this.aimLock.updateAimLock(playerPos);
    if (result) {
      this.aimLock.sendMouseInput(result.mouseMovement.deltaX, result.mouseMovement.deltaY);
      console.log("🎯 Locked on:", result.target.targetType, "at", result.target.distance.toFixed(2));
    }
  }
}

// ======= Khởi Tạo và Sử Dụng =======
const targetingSystem = new TargetingSystem({
  detection: {
    scanRadius: 360,
    scanFOV: 180,
    detectionThreshold: 0.7
  },
  aimLock: {
    lockStrength: 1.0,
    smoothing: 0.1,
    maxLockDistance: 999,
    enablePrediction: true
  },
  autoLock: true
});

// Game loop mẫu
setInterval(() => {
  targetingSystem.update(mockGameState); // bạn thay bằng trạng thái thực trong game
}, 16);

// Khi bắn:
targetingSystem.fireButtonPressed();

// Khi thả nút:
targetingSystem.fireButtonReleased();
