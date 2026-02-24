/**
 * CalibrationManager
 * Handles SeeSo calibration callbacks, logic, and rendering.
 */
export class CalibrationManager {
    constructor(context) {
        this.ctx = context; // { logI, logW, logE, setStatus, setState, requestRender, onCalibrationFinish }

        this.state = {
            point: null,         // {x,y} — current calibration point from SDK
            progress: 0,
            displayProgress: 0,  // Smoothed progress for animation
            running: false,       // true only after OK button clicked (collecting samples)
            pointCount: 0,
            isFinishing: false,
            watchdogTimer: null,
            safetyTimer: null,
            maxWaitTimer: null,
            progressWatchdog: null,
            inFailPopup: false,
        };
        this.seeso = null; // SDK reference stored on bindTo()
        this.rotationAngle = 0;
    }

    // ─── Reset ────────────────────────────────────────────────────────────────
    reset() {
        this.state.pointCount = 0;
        this.state.point = null;
        this.state.progress = 0;
        this.state.displayProgress = 0;
        this.state.isFinishing = false;
        this.state.running = false;
        this.state.inFailPopup = false;
        if (this.state.watchdogTimer) clearTimeout(this.state.watchdogTimer);
        if (this.state.safetyTimer) clearTimeout(this.state.safetyTimer);
        if (this.state.maxWaitTimer) clearTimeout(this.state.maxWaitTimer);
        if (this.state.progressWatchdog) clearInterval(this.state.progressWatchdog);
    }

    // ─── Face Check ───────────────────────────────────────────────────────────
    startFaceCheck() {
        this.ctx.logI("cal", "Starting Face Check Mode");

        const faceScreen = document.getElementById("screen-face-check");
        const calScreen = document.getElementById("screen-calibration");

        if (faceScreen) {
            faceScreen.classList.add("active");
            faceScreen.style.display = "flex";
        }
        if (calScreen) {
            calScreen.classList.remove("active");
            calScreen.style.display = "none";
        }

        this.updateFaceCheckUI(false);

        const btnNext = document.getElementById("btn-face-next");
        if (btnNext) {
            btnNext.onclick = () => {
                this.ctx.logI("cal", "Face Check Passed. Proceeding to Calibration.");

                if (faceScreen) {
                    faceScreen.classList.remove("active");
                    faceScreen.style.display = "none";
                }
                if (calScreen) {
                    calScreen.classList.add("active");
                    calScreen.style.display = "block";
                }

                // Immediately start SDK calibration.
                // SDK fires onCalibrationNextPoint(x,y) → shows actual dot + text + OK button.
                if (this.ctx.onFaceCheckSuccess) {
                    this.ctx.onFaceCheckSuccess();
                }
            };
        }
    }

    handleFaceCheckGaze(trackingState) {
        const isTracking = (trackingState === 0);
        this.updateFaceCheckUI(isTracking);
    }

    updateFaceCheckUI(isTracking) {
        const icon = document.getElementById("face-guide-icon");
        const status = document.getElementById("face-check-status");
        const btn = document.getElementById("btn-face-next");
        const frame = document.querySelector(".face-frame");

        if (isTracking) {
            if (icon) icon.style.opacity = "1";
            if (status) {
                status.textContent = "Perfect! Hold this position.";
                status.style.color = "#00ff00";
            }
            if (btn) {
                btn.disabled = false;
                btn.style.opacity = "1";
                btn.style.cursor = "pointer";
            }
            if (frame) frame.style.borderColor = "#00ff00";
        } else {
            if (icon) icon.style.opacity = "0";
            if (status) {
                status.textContent = "Face not detected...";
                status.style.color = "#aaa";
            }
            if (btn) {
                btn.disabled = true;
                btn.style.opacity = "0.5";
                btn.style.cursor = "not-allowed";
            }
            if (frame) frame.style.borderColor = "rgba(255, 255, 255, 0.3)";
        }
    }

    // ─── Sample Collection Watchdog ───────────────────────────────────────────
    startCollection() {
        const { logI, logW } = this.ctx;

        // Safety timer: force finish if collection takes too long
        if (this.state.safetyTimer) clearTimeout(this.state.safetyTimer);
        this.state.safetyTimer = setTimeout(() => {
            if (this.state.running && !this.state.isFinishing) {
                logW("cal", "[SafetyTimer] Timed out waiting for calibration finish. Force finishing.");
                this.finishSequence();
            }
        }, 12000);

        // Progress watchdog: if no progress events arrive within 3s, show fail popup
        if (this.state.progressWatchdog) clearInterval(this.state.progressWatchdog);
        this.state.lastProgressUpdate = performance.now();
        this.state.progressWatchdog = setInterval(() => {
            if (!this.state.running || this.state.isFinishing) {
                clearInterval(this.state.progressWatchdog);
                return;
            }
            const elapsed = performance.now() - (this.state.lastProgressUpdate || 0);
            if (elapsed > 3000) {
                logW("cal", "[ProgressWatchdog] No progress for 3s → showFailPopup");
                clearInterval(this.state.progressWatchdog);
                this.showFailPopup();
            }
        }, 1000);
    }

    // ─── Fail Popup ───────────────────────────────────────────────────────────
    showFailPopup() {
        this.ctx.logW("cal", "showFailPopup called. Stopping watchdog.");
        this.state.running = false;
        this.state.inFailPopup = true;

        // Hide status text and OK button
        const statusEl = document.getElementById("calibration-status");
        if (statusEl) statusEl.style.display = 'none';
        const btnStart = document.getElementById("btn-calibration-start");
        if (btnStart) btnStart.style.display = 'none';

        const popup = document.getElementById("cal-fail-popup");
        if (popup) {
            popup.style.display = "flex";

            const btnRetry = document.getElementById("btn-cal-retry");
            const btnSkip = document.getElementById("btn-cal-skip");

            if (btnRetry) {
                btnRetry.onclick = () => {
                    popup.style.display = "none";
                    this.retryPoint();
                };
            }
            if (btnSkip) {
                // Skip button hidden — force calibration
                btnSkip.style.display = "none";
                btnSkip.onclick = null;
            }
        } else {
            this.ctx.logE("cal", "Fail popup not found in DOM!");
            this.finishSequence();
        }
    }

    // ─── Retry ────────────────────────────────────────────────────────────────
    retryPoint() {
        this.ctx.logI("cal", "Retrying calibration point (Async)...");

        setTimeout(() => {
            this.state.running = false; // Wait for OK button again
            this.state.progress = 0;
            this.state.displayProgress = 0;
            this.state.inFailPopup = false;

            // Restart entire calibration sequence
            if (this.ctx.onRestart) {
                this.ctx.onRestart();
            } else {
                this.ctx.logE("cal", "onRestart callback missing!");
            }
        }, 100);
    }

    // ─── SDK Binding ──────────────────────────────────────────────────────────
    bindTo(seeso) {
        if (!seeso) return;
        this.seeso = seeso; // Store reference for retryPoint fallback

        const { logI, logW, logE, setStatus, setState, requestRender } = this.ctx;

        // ── 1. Next Point ──
        // SDK fires this for each calibration point.
        // We show the actual point + instruction + OK button, but do NOT auto-collect.
        if (typeof seeso.addCalibrationNextPointCallback === "function") {
            seeso.addCalibrationNextPointCallback((x, y) => {
                this.state.isFinishing = false;
                this.state.pointCount = (this.state.pointCount || 0) + 1;

                // Clear previous watchdogs
                if (this.state.maxWaitTimer) { clearTimeout(this.state.maxWaitTimer); this.state.maxWaitTimer = null; }
                if (this.state.progressWatchdog) { clearInterval(this.state.progressWatchdog); this.state.progressWatchdog = null; }
                if (this.state.watchdogTimer) { clearTimeout(this.state.watchdogTimer); this.state.watchdogTimer = null; }

                // Set point & reset to waiting state (running=false until OK clicked)
                this.state.point = { x, y };
                this.state.running = false;
                this.state.progress = 0;
                this.state.displayProgress = 0;

                logI("cal", `onCalibrationNextPoint (#${this.state.pointCount}) x=${x} y=${y} → waiting for OK`);

                // ── Show instruction text ──
                const statusEl = document.getElementById("calibration-status");
                if (statusEl) {
                    statusEl.textContent = "Look at the dot and press OK to start.";
                    statusEl.style.color = "#fff";
                    statusEl.style.textShadow = "0 0 8px rgba(255,255,255,0.6)";
                    statusEl.style.position = 'absolute';
                    statusEl.style.left = '50%';
                    statusEl.style.transform = 'translateX(-50%)';
                    statusEl.style.top = (y + 60) + 'px';
                    statusEl.style.width = 'auto';
                    statusEl.style.whiteSpace = 'nowrap';
                    statusEl.style.textAlign = 'center';
                    statusEl.style.pointerEvents = 'none';
                    statusEl.style.display = 'block';
                }

                // ── Show OK button ──
                const btn = document.getElementById("btn-calibration-start");
                if (btn) {
                    btn.textContent = "OK";
                    btn.style.position = 'absolute';
                    btn.style.left = '50%';
                    btn.style.transform = 'translateX(-50%)';
                    btn.style.top = (y + 130) + 'px';
                    btn.style.pointerEvents = 'auto';
                    btn.style.display = 'inline-block';

                    // Re-bind for each point
                    btn.onclick = () => {
                        logI("cal", `OK clicked for point #${this.state.pointCount} → startCollectSamples`);

                        // Hide UI immediately
                        btn.style.display = 'none';
                        if (statusEl) statusEl.style.display = 'none';

                        // Start running state & watchdog
                        this.state.running = true;
                        this.startCollection();

                        // Trigger SDK sample collection
                        try {
                            if (typeof seeso.startCollectSamples === "function") {
                                seeso.startCollectSamples();
                            } else {
                                logE("cal", "seeso.startCollectSamples is not a function!");
                            }
                        } catch (e) {
                            logE("cal", "SDK startCollectSamples threw error", e);
                        }
                    };
                }
            });
            logI("sdk", "addCalibrationNextPointCallback bound");
        }

        // ── 2. Progress ──
        if (typeof seeso.addCalibrationProgressCallback === "function") {
            seeso.addCalibrationProgressCallback((progress) => {
                if (this.state.isFinishing) return;

                this.state.lastProgressUpdate = performance.now();
                this.state.progress = progress;

                const pct = Math.round(progress * 100);
                setStatus(`Calibrating... ${pct}%`);
                setState("cal", `running (${pct}%)`);

                if (progress >= 1.0) {
                    if (this.state.progressWatchdog) clearInterval(this.state.progressWatchdog);
                    if (this.state.maxWaitTimer) clearTimeout(this.state.maxWaitTimer);
                }

                requestRender();
            });
            logI("sdk", "addCalibrationProgressCallback bound");
        }

        // ── 3. Finish ──
        if (typeof seeso.addCalibrationFinishCallback === "function") {
            seeso.addCalibrationFinishCallback((calibrationData) => {
                logI("cal", "onCalibrationFinished - Success");

                if (this.state.maxWaitTimer) clearTimeout(this.state.maxWaitTimer);
                if (this.state.progressWatchdog) clearInterval(this.state.progressWatchdog);

                this.state.isFinishing = true;
                this.finishSequence();
            });
            logI("sdk", "addCalibrationFinishCallback bound");
        }
    }

    // ─── Finish ───────────────────────────────────────────────────────────────
    finishSequence() {
        this.state.running = false;
        this.state.point = null;

        if (this.state.watchdogTimer) { clearTimeout(this.state.watchdogTimer); this.state.watchdogTimer = null; }
        if (this.state.safetyTimer) { clearTimeout(this.state.safetyTimer); this.state.safetyTimer = null; }
        if (this.state.maxWaitTimer) { clearTimeout(this.state.maxWaitTimer); this.state.maxWaitTimer = null; }

        this.ctx.requestRender();

        const stage = document.getElementById("stage");
        if (stage) stage.classList.remove("visible");

        const calScreen = document.getElementById("screen-calibration");
        if (calScreen) calScreen.style.display = 'none';

        // [FIX-iOS] Stop calibration RAF loop before game starts
        if (typeof this.ctx.stopCalibrationLoop === 'function') {
            this.ctx.stopCalibrationLoop();
        }

        if (this.ctx.onCalibrationFinish) {
            this.ctx.onCalibrationFinish();
        }
    }

    // ─── Render ───────────────────────────────────────────────────────────────
    render(ctx, width, height, toCanvasLocalPoint) {
        // Nothing to draw if in fail popup or no point yet
        if (this.state.inFailPopup) return;
        if (!this.state.point) return;

        const pt = toCanvasLocalPoint(this.state.point.x, this.state.point.y) || this.state.point;


        // ── ORB RENDER: always show orb when point is set (running=false → progress=0 slow spin) ──
        const target = this.state.progress || 0;
        if (target === 0) {
            this.state.displayProgress = 0;
        } else {
            // [TUNING] 0.1 → 0.28: snappier acceleration right after OK is clicked
            this.state.displayProgress += (target - this.state.displayProgress) * 0.28;
        }

        const p = this.state.displayProgress;
        const cx = pt.x;
        const cy = pt.y;

        if (typeof this.rotationAngle === 'undefined') this.rotationAngle = 0;

        // [TUNING] Base speed 0.05 → 0.13 (more lively while waiting)
        //          Max bonus  0.40 → 0.50 (faster spin during collection)
        const speed = 0.13 + (p * 0.50);
        this.rotationAngle += speed;

        // Color: Blue → Cyan/White as progress increases
        const r = Math.round(p * 100);
        const g = Math.round(100 + p * 155);
        const color = `rgb(${r}, ${g}, 255)`;

        // Rotating ellipse
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.rotationAngle);
        ctx.beginPath();
        ctx.ellipse(0, 0, 7.5, 2.4, 0, 0, Math.PI * 2);
        ctx.lineWidth = 2.25;
        ctx.strokeStyle = color;
        ctx.shadowBlur = 6;
        ctx.shadowColor = color;
        ctx.stroke();
        ctx.restore();

        // Center fixed dot
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fillStyle = "white";
        ctx.shadowBlur = 0;
        ctx.fill();
    }
}
