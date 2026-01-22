
// js/velx-spike-detector.js

// ---------- same detector (MAD) ----------
export function median(arr) {
    const a = arr.filter(Number.isFinite).slice().sort((x, y) => x - y);
    const n = a.length;
    if (n === 0) return NaN;
    const mid = Math.floor(n / 2);
    return n % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

export function mad(arr, med) {
    return median(arr.filter(Number.isFinite).map(v => Math.abs(v - med)));
}

/**
 * Detects velocity spikes using Median Absolute Deviation (MAD).
 * @param {Array} samples - Array of objects { ts_ms, velX, ... }
 * @param {Object} options - { k, gapMs, expandOneSample }
 * @returns {Object} { threshold, spikeIntervals, spikeMask }
 */
export function detectVelXSpikes(samples, { k = 3.5, gapMs = 120, expandOneSample = true } = {}) {
    const ts = samples.map(s => Number(s.ts_ms));
    const velX = samples.map(s => Number(s.velX));
    const absVel = velX.map(v => Math.abs(v));

    const med = median(absVel);
    let m = mad(absVel, med);
    let scale = 1.4826 * m;

    // Fallback to SD if MAD is too small (e.g. constant signal)
    if (!Number.isFinite(scale) || scale < 1e-12) {
        const finite = absVel.filter(Number.isFinite);
        const mean = finite.reduce((a, b) => a + b, 0) / Math.max(1, finite.length);
        const varr = finite.reduce((a, v) => { const d = v - mean; return a + d * d; }, 0) / Math.max(1, finite.length - 1);
        const std = Math.sqrt(varr);
        scale = std > 1e-12 ? std : 1.0;
    }

    const threshold = med + k * scale;
    const spikeMask = absVel.map(v => Number.isFinite(v) && v > threshold);

    const idx = [];
    for (let i = 0; i < spikeMask.length; i++) if (spikeMask[i]) idx.push(i);

    let segments = [];
    if (idx.length) {
        let s = idx[0], p = idx[0];
        for (let j = 1; j < idx.length; j++) {
            const i = idx[j];
            if (i === p + 1) p = i;
            else { segments.push([s, p]); s = i; p = i; }
        }
        segments.push([s, p]);
    }

    if (expandOneSample) {
        segments = segments.map(([a, b]) => [Math.max(0, a - 1), Math.min(samples.length - 1, b + 1)]);
    }

    const timeSegments = segments.map(([a, b]) => [ts[a], ts[b], a, b]);
    const merged = [];
    for (const seg of timeSegments) {
        if (!merged.length) merged.push(seg.slice());
        else {
            const last = merged[merged.length - 1];
            if (seg[0] - last[1] <= gapMs) { last[1] = seg[1]; last[3] = seg[3]; }
            else merged.push(seg.slice());
        }
    }

    const spikeIntervals = merged.map(([start_ms, end_ms, aIdx, bIdx]) => {
        let peak = 0;
        for (let i = aIdx; i <= bIdx; i++) peak = Math.max(peak, Math.abs(velX[i]) || 0);
        return { start_ms, end_ms, duration_ms: end_ms - start_ms, peakAbsVelX: peak, startIndex: aIdx, endIndex: bIdx };
    });

    return { threshold, spikeIntervals, spikeMask };
}

// Chart.js plugin generator
export function makeIntervalShadingPlugin(intervals, shade = "rgba(0,0,0,0.12)") {
    return {
        id: "intervalShading",
        beforeDatasetsDraw(chart) {
            const { ctx, chartArea, scales } = chart;
            if (!chartArea) return;
            const x = scales.x;
            ctx.save();
            ctx.fillStyle = shade;

            for (const it of intervals) {
                const x0 = x.getPixelForValue(it.start_ms);
                const x1 = x.getPixelForValue(it.end_ms);
                const left = Math.min(x0, x1);
                const right = Math.max(x0, x1);
                ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
            }
            ctx.restore();
        }
    };
}
