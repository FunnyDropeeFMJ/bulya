// Локальный планировщик. Общий для renderer и детерминированных тестов Node.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.BulyaBehavior = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MODES = {
    calm: { label: 'Спокойный', min: 25000, max: 50000, walkGap: 240000, walkChance: 0.08, distance: 70 },
    normal: { label: 'Обычный', min: 15000, max: 32000, walkGap: 120000, walkChance: 0.14, distance: 100 },
    playful: { label: 'Игривый', min: 10000, max: 24000, walkGap: 60000, walkChance: 0.22, distance: 140 }
  };
  const SMALL = [
    { id: 'look-left', steps: [{ name: 'glance_left' }, { name: 'ear_left' }] },
    { id: 'look-right', steps: [{ name: 'glance_right' }, { name: 'ear_right' }] },
    { id: 'curious', steps: [{ name: 'ear_right' }, { name: 'curious' }] },
    { id: 'content', steps: [{ name: 'wag' }, { name: 'glance_left' }] }
  ];
  const RELAX = [
    { id: 'scratch', steps: [{ name: 'scratch' }, { name: 'ear_left' }] },
    { id: 'stretch', steps: [{ name: 'stretch' }, { name: 'glance_right' }] },
    { id: 'rest', steps: [{ name: 'stretch' }, { name: 'lie', hold: 6500 }, { name: 'stand', hold: 900 }] }
  ];
  class Planner {
    constructor(random = Math.random, now = Date.now()) {
      this.random = random;
      this.nextAt = now + 12000;
      this.lastWalkAt = now;
      this.recent = [];
      this.affectionUntil = 0;
    }
    touch(now) { this.nextAt = Math.max(this.nextAt, now + 10000); }
    interact(now) { this.affectionUntil = now + 45000; this.touch(now); }
    next(context) {
      const { now, idleSeconds = 0, sleeping = false, open = false, busy = false,
        dragging = false, visible = true, suspended = false, reducedMotion = false, ready = true } = context;
      if (!visible || suspended || busy || dragging) return null;
      if (sleeping) return idleSeconds < 5 ? { kind: 'wake' } : null;
      if (!open && ready && idleSeconds >= 300) return { kind: 'sleep' };
      if (!ready || reducedMotion || now < this.nextAt) return null;
      const mode = MODES[context.mode] || MODES.normal;
      const interval = mode.min + this.random() * (mode.max - mode.min);
      this.nextAt = now + (open ? Math.max(35000, interval) : interval);
      const walkDue = now - (this.lastWalkAt ?? 0) >= mode.walkGap;
      if (!open && now >= this.affectionUntil && walkDue && this.random() < mode.walkChance) {
        this.lastWalkAt = now;
        return { kind: 'walk', distance: Math.round(mode.distance * (0.8 + this.random() * 0.4)) };
      }
      const pool = open || now < this.affectionUntil ? SMALL : [...SMALL, ...RELAX];
      const choices = pool.filter(action => !this.recent.includes(action.id));
      const action = choices[Math.min(choices.length - 1, Math.floor(this.random() * choices.length))];
      this.recent = [...this.recent.slice(-1), action.id];
      return { kind: 'sequence', id: action.id, steps: action.steps };
    }
  }
  return { MODES, Planner };
});
