// ======= Vector3 (Enhanced) =======
class Vector3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x; this.y = y; this.z = z;
  }
  add(v) { return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z); }
  subtract(v) { return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z); }
  multiply(s) { return new Vector3(this.x * s, this.y * s, this.z * s); }
  length() { return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2); }
  normalize() { const len = this.length(); return len > 0 ? this.multiply(1 / len) : new Vector3(); }
  distanceTo(v) { return this.subtract(v).length(); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) {
    return new Vector3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }
  clone() { return new Vector3(this.x, this.y, this.z); }
  lerp(v, t) { return this.add(v.subtract(this).multiply(t)); }
  angleTo(v) { return Math.acos(Math.max(-1, Math.min(1, this.dot(v) / (this.length() * v.length())))); }
  toString() { return `Vector3(${this.x.toFixed(2)}, ${this.y.toFixed(2)}, ${this.z.toFixed(2)})`; }
}

// ======= TargetDetector =======
class TargetDetector {
  constructor(options = {}) {
    this.scanRadius = options.scanRadius || 360;
    this.scanFOV = options.scanFOV || 180;
    this.detectionThreshold = options.detectionThreshold || 0.7;
    this.minTargetSize = options.minTargetSize || 0.1;
    this.maxTargetSize = options.maxTargetSize || 2.5;
    this.priorityTargets = options.priorityTargets || ["enemy", "hostile"];
    this.ignoredTargets = options.ignoredTargets || ["friendly", "neutral"];
    this.lastScanTime = 0;
    this.scanCooldown = options.scanCooldown || 50;
    this.cachedResults = [];
  }

  scanArea(playerPos, playerDir, entities) {
    const now = Date.now();
    if (now - this.lastScanTime < this.scanCooldown) return this.cachedResults;

    const results = [];
    const halfFOV = (this.scanFOV * Math.PI) / 360;

    for (const ent of entities) {
      if (!this.isValidTarget(ent)) continue;

      const toTarget = ent.position.subtract(playerPos);
      const distance = toTarget.length();
      if (distance > this.scanRadius) continue;

      const angle = Math.acos(Math.max(-1, Math.min(1,
        playerDir.normalize().dot(toTarget.normalize())
      )));
      if (angle > halfFOV) continue;

      const target = this.analyzeEntity(ent, playerPos, distance);
      if (target.confidence > this.detectionThreshold) results.push(target);
    }

    this.cachedResults = results.sort((a, b) => b.priority - a.priority);
    this.lastScanTime = now;
    return this.cachedResults;
  }

  isValidTarget(entity) {
    if (!entity || !entity.isAlive || entity.isPlayer) return false;
    if (this.ignoredTargets.includes(entity.type)) return false;
    return true;
  }

  analyzeEntity(entity, playerPos, distance) {
    const velocity = entity.velocity || new Vector3();
    let confidence = 0;
    let priority = 0;
    const size = this.estimateTargetSize(entity);
    if (size >= this.minTargetSize && size <= this.maxTargetSize) confidence += 0.2;
    confidence += Math.max(0, 1 - distance / this.scanRadius) * 0.3;
    const speed = velocity.length();
    if (speed > 0.1) confidence += Math.min(speed * 0.1, 0.2);
    const head = this.estimateHeadPosition(entity);
    if (this.isHeadVisible(head, playerPos)) confidence += 0.3;
    if (this.priorityTargets.includes(entity.type)) {
      priority += 100;
      confidence += 0.1;
    }
    if (entity.health && entity.maxHealth) {
      const healthRatio = entity.health / entity.maxHealth;
      priority += (1 - healthRatio) * 50;
    }
    return {
      entity,
      headPosition: head,
      distance,
      velocity,
      confidence: Math.min(confidence, 1),
      priority,
      targetType: entity.type || "unknown",
      lastSeen: Date.now()
    };
  }

  estimateHeadPosition(entity) {
    if (entity.bones?.head?.worldPosition) return entity.bones.head.worldPosition.clone();
    if (entity.skeleton?.joints?.head) return entity.skeleton.joints.head.clone();
    if (entity.boundingBox) {
      return new Vector3(
        entity.position.x,
        entity.boundingBox.max.y - 0.1,
        entity.position.z
      );
    }
    const headOffset = entity.headOffset || new Vector3(0, 1.7, 0);
    return entity.position.add(headOffset);
  }

  estimateTargetSize(entity) {
    if (entity.boundingBox) {
      const size = entity.boundingBox.max.subtract(entity.boundingBox.min);
      return Math.max(size.x, size.y, size.z);
    }
    return entity.size || 1.0;
  }

  isHeadVisible(headPos, playerPos) {
    return true;
  }
}

// (Part 2: AimLockSystem, TargetingSystem, Profiles, and Main Usage will be continued)


// ======= AimLockSystem =======
class AimLockSystem {
  constructor(options = {}) {
    this.lockStrength = options.lockStrength || 1.0;
    this.smoothing = options.smoothing || 0.15;
    this.maxLockDistance = options.maxLockDistance || 1000;
    this.lockDuration = options.lockDuration || 5000;
    this.enablePrediction = options.enablePrediction ?? true;
    this.predictionMultiplier = options.predictionMultiplier || 1.0;
    this.aimBone = options.aimBone || "head";

    this.humanization = {
      enabled: options.humanization?.enabled ?? true,
      jitter: options.humanization?.jitter || 0.02,
      delay: options.humanization?.delay || 0.05,
      variation: options.humanization?.variation || 0.1
    };

    this.isLocked = false;
    this.lockedTarget = null;
    this.lockStartTime = 0;
    this.lastAimPosition = new Vector3();
    this.humanizationOffset = new Vector3();
  }

  lockOnTarget(target, playerPos) {
    const distance = target.headPosition.distanceTo(playerPos);
    if (distance > this.maxLockDistance) return false;
    this.isLocked = true;
    this.lockedTarget = target;
    this.lockStartTime = Date.now();
    this.lastAimPosition = this.getAimPosition(target);
    console.log(`🎯 Locked onto ${target.targetType} at ${distance.toFixed(1)}m`);
    return true;
  }

  updateAimLock(playerPos, deltaTime = 0.016) {
    if (!this.isLocked || !this.lockedTarget) return null;
    const now = Date.now();
    if (now - this.lockStartTime > this.lockDuration) return this.releaseLock();
    if (!this.isTargetValid(this.lockedTarget)) return this.releaseLock();

    let aimPos = this.getPredictedAim(this.lockedTarget, playerPos);
    let smoothAim = this.smooth(this.lastAimPosition, aimPos, deltaTime);

    if (this.humanization.enabled) {
      smoothAim = this.applyHumanization(smoothAim, deltaTime);
    }

    this.lastAimPosition = smoothAim.clone();

    return {
      target: this.lockedTarget,
      aimPosition: smoothAim,
      mouseMovement: this.toMouseDelta(smoothAim, playerPos),
      lockStrength: this.lockStrength,
      lockTime: now - this.lockStartTime
    };
  }

  getAimPosition(target) {
    switch (this.aimBone) {
      case "head":
        return target.headPosition;
      case "chest":
        return target.entity.position.add(new Vector3(0, 1.0, 0));
      case "auto":
        const distance = target.distance;
        const speed = target.velocity.length();
        return (distance > 200 || speed > 5)
          ? target.entity.position.add(new Vector3(0, 1.0, 0))
          : target.headPosition;
      default:
        return target.headPosition;
    }
  }

  getPredictedAim(target, playerPos) {
    let aim = this.getAimPosition(target);
    if (this.enablePrediction && target.velocity.length() > 0.1) {
      const dist = aim.distanceTo(playerPos);
      const bulletSpeed = 1000;
      const timeToTarget = dist / bulletSpeed;
      const prediction = target.velocity.multiply(timeToTarget * this.predictionMultiplier);
      aim = aim.add(prediction);
    }
    return aim;
  }

  smooth(current, target, dt) {
    const smoothFactor = Math.min(dt * (this.smoothing * 10), 1.0);
    return current.lerp(target, smoothFactor);
  }

  applyHumanization(aimPos, dt) {
    const jitter = new Vector3(
      (Math.random() - 0.5) * this.humanization.jitter,
      (Math.random() - 0.5) * this.humanization.jitter,
      (Math.random() - 0.5) * this.humanization.jitter
    );
    this.humanizationOffset = this.humanizationOffset.lerp(jitter, dt * 5);
    return aimPos.add(this.humanizationOffset);
  }

  toMouseDelta(aim, origin) {
    const direction = aim.subtract(origin).normalize();
    const pitch = Math.asin(-direction.y);
    const yaw = Math.atan2(direction.x, direction.z);
    return {
      deltaX: yaw * this.lockStrength,
      deltaY: pitch * this.lockStrength
    };
  }

  isTargetValid(target) {
    if (!target || !target.entity) return false;
    if (!target.entity.isAlive) return false;
    if (Date.now() - target.lastSeen > 1000) return false;
    return true;
  }

  releaseLock() {
    if (this.isLocked) console.log("🔓 Released lock");
    this.isLocked = false;
    this.lockedTarget = null;
    this.lockStartTime = 0;
    this.humanizationOffset = new Vector3();
    return null;
  }

  sendMouseInput(dx, dy) {
    const smoothDx = dx * 0.8 + (Math.random() - 0.5) * 0.1;
    const smoothDy = dy * 0.8 + (Math.random() - 0.5) * 0.1;
    console.log(`🖱️ Mouse: ΔX=${smoothDx.toFixed(3)}, ΔY=${smoothDy.toFixed(3)}`);
  }
}

// ======= TargetingSystem =======
class TargetingSystem {
  constructor(options = {}) {
    this.detector = new TargetDetector(options.detection || {});
    this.aimLock = new AimLockSystem(options.aimLock || {});
    this.autoLockEnabled = options.autoLock ?? true;
    this.updateInterval = options.updateInterval || 16;
    this.triggerBot = options.triggerBot || false;
    this.isActive = false;
    this.lastUpdate = 0;
    this.stats = {
      locksAcquired: 0,
      timeActive: 0,
      lastActivation: 0
    };
  }

  fireButtonPressed() {
    this.isActive = true;
    this.stats.lastActivation = Date.now();
    console.log("🎯 Targeting System ACTIVATED");
  }

  fireButtonReleased() {
    if (this.isActive) {
      this.stats.timeActive += Date.now() - this.stats.lastActivation;
    }
    this.aimLock.releaseLock();
    this.isActive = false;
    console.log("🔓 Targeting System DEACTIVATED");
  }

  update(gameState) {
  const now = Date.now(); // ✅ Đã sửa lỗi tại đây
  if (now - this.lastUpdate < this.updateInterval) return;
  this.lastUpdate = now;

  if (!this.isActive) return;

  const { playerPos, playerDirection, gameEntities } = gameState;
  const targets = this.detector.scanArea(playerPos, playerDirection, gameEntities);

  if (!this.aimLock.isLocked && targets.length > 0 && this.autoLockEnabled) {
    const bestTarget = this.selectBestTarget(targets);
    if (bestTarget && this.aimLock.lockOnTarget(bestTarget, playerPos)) {
      this.stats.locksAcquired++;
    }
  }

  const result = this.aimLock.updateAimLock(playerPos);
  if (result) {
    this.aimLock.sendMouseInput(result.mouseMovement.deltaX, result.mouseMovement.deltaY);
    if (this.triggerBot && this.shouldTrigger(result)) {
      this.triggerFire();
    }
  }
}
  selectBestTarget(targets) {
    return targets.reduce((best, current) => {
      if (!best) return current;
      if (current.confidence > best.confidence) return current;
      if (current.confidence === best.confidence && current.priority > best.priority) return current;
      if (current.confidence === best.confidence && current.priority === best.priority && current.distance < best.distance) return current;
      return best;
    }, null);
  }

  shouldTrigger(aimResult) {
    const threshold = 0.05;
    const distance = aimResult.aimPosition.distanceTo(aimResult.target.headPosition);
    return distance < threshold;
  }

  triggerFire() {
    console.log("🔫 AUTO FIRE!");
  }

  getStats() {
    return {
      ...this.stats,
      isActive: this.isActive,
      currentTarget: this.aimLock.lockedTarget?.targetType || "none",
      accuracy: this.stats.locksAcquired > 0
        ? (this.stats.locksAcquired / (this.stats.timeActive / 1000)).toFixed(2)
        : 0
    };
  }
}

// ======= Profiles =======
const profiles = {
  balanced: {
    detection: { scanRadius: 400, scanFOV: 120, detectionThreshold: 0.7 },
    aimLock: { lockStrength: 0.6, smoothing: 0.1, enablePrediction: true },
    autoLock: true
  }
};

// ======= Usage Example =======
const targetingSystem = new TargetingSystem(profiles.balanced);

const currentGameState = {
  playerPos: new Vector3(0, 0, 0),
  playerDirection: new Vector3(0, 0, 1),
  gameEntities: [
    {
      isAlive: true,
      isPlayer: false,
      type: "enemy",
      position: new Vector3(10, 0, 20),
      velocity: new Vector3(1, 0, 0),
      health: 80,
      maxHealth: 100,
      boundingBox: {
        min: new Vector3(-0.5, 0, -0.5),
        max: new Vector3(0.5, 1.8, 0.5)
      }
    }
  ]
};

let frameCount = 0;
setInterval(() => {
  targetingSystem.update(currentGameState);
  frameCount++;
  if (frameCount % 60 === 0) {
    const stats = targetingSystem.getStats();
    console.log("📊 Stats:", stats);
  }
}, 16);

// Simulate shoot button
setTimeout(() => targetingSystem.fireButtonPressed(), 1000);
setTimeout(() => targetingSystem.fireButtonReleased(), 6000);
