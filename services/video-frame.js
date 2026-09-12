'use strict';

// LiveKit rotation is a clockwise quarter-turn enum, not a degree value.
function orientFrame(frame, rotation = 0) {
    const { width, height, data } = frame;
    if (![0, 1, 2, 3].includes(rotation)) throw new Error('Unknown video rotation');
    if (!rotation) return { width, height, rgba: data };
    const w = rotation % 2 ? height : width;
    const h = rotation % 2 ? width : height;
    const rgba = Buffer.alloc(w * h * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const dx = rotation === 1 ? height - 1 - y : rotation === 2 ? width - 1 - x : y;
            const dy = rotation === 1 ? x : rotation === 2 ? height - 1 - y : width - 1 - x;
            const offset = (y * width + x) * 4;
            rgba.set(data.subarray(offset, offset + 4), (dy * w + dx) * 4);
        }
    }
    return { width: w, height: h, rgba };
}
module.exports = { orientFrame };
