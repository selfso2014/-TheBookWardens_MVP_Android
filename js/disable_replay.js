
// [TEMP] Override to Skip Replay (2026-01-28)
Typewriter.prototype.startGazeReplay = function () {
    console.log("Replay Phase Skipped (Override).");
    if (this.onReplayComplete) this.onReplayComplete();
};
