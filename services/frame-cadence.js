'use strict';

class FrameCadence {
    constructor() { this.frames = []; this.previous = null; }
    add(timestampUs, arrivalMs) {
        if (!Number.isSafeInteger(timestampUs) || timestampUs <= 0) throw new Error('Invalid media timestamp');
        if (this.previous !== null && timestampUs <= this.previous) return false;
        this.previous = timestampUs;
        this.frames.push({ timestampUs, arrivalMs });
        this.frames = this.frames.filter(frame => frame.arrivalMs >= arrivalMs - 2000);
        return true;
    }
    get ready() {
        if (this.frames.length < 40) return false;
        const first = this.frames[0];
        const last = this.frames.at(-1);
        const arrivalDuration = last.arrivalMs - first.arrivalMs;
        const mediaDuration = (last.timestampUs - first.timestampUs) / 1000;
        if (arrivalDuration < 1500 || mediaDuration < 1500) return false;
        const intervals = this.frames.length - 1;
        return intervals * 1000 / arrivalDuration >= 25
            && intervals * 1000 / mediaDuration >= 25
            && this.frames.every((frame, index) => index === 0 || frame.timestampUs - this.frames[index - 1].timestampUs < 100000);
    }
}
module.exports = { FrameCadence };
