'use strict';

class MetricsCache {
    constructor() { this.values = new Map(); }
    clear() { this.values.clear(); }
    update(vitals, now = Date.now()) {
        for (const [key, value] of Object.entries(vitals || {})) {
            if (value == null || key === 'arterialPressureTraceSamples') continue;
            this.values.set(key, { value, at: now });
        }
    }
    snapshot(now = Date.now()) {
        const result = {};
        for (const [key, entry] of this.values) {
            const ttl = key.startsWith('breathing') ? 30000 : /^(face|blinking|talking|arterial)/.test(key) ? 3000 : 15000;
            if (now - entry.at < ttl) result[key] = entry.value;
        }
        return result;
    }
}
module.exports = { MetricsCache };
