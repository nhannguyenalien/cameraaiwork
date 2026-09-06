function createViewerLimiter() {
  const active = new Map();

  return {
    reserve(camera, limit) {
      const current = active.get(camera) || 0;
      if (current >= limit) return false;
      active.set(camera, current + 1);
      return true;
    },
    release(camera) {
      const next = Math.max(0, (active.get(camera) || 1) - 1);
      if (next) active.set(camera, next);
      else active.delete(camera);
    },
    count(camera) {
      return active.get(camera) || 0;
    },
  };
}

module.exports = { createViewerLimiter };
