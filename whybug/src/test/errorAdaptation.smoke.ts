import assert from "node:assert/strict";

import { getHybridErrorScore, getHybridErrorScoreBreakdown } from "../services/errorAdaptation";

function assertClose(actual: number, expected: number, epsilon = 1e-12): void {
    assert.ok(Math.abs(actual - expected) <= epsilon, `expected ${expected}, got ${actual}`);
}

function main(): void {
    const nowMs = 1_000;
    const windowMs = 100;
    const halfLifeMs = 100;

    const timestampsMs = [
        950,
        900,
        800,
        Number.NaN,
    ];

    const breakdown = getHybridErrorScoreBreakdown(timestampsMs, {
        nowMs,
        windowMs,
        halfLifeMs
    });

    assert.equal(breakdown.recentCount, 2);
    assertClose(breakdown.decayedScore, 0.5);
    assertClose(breakdown.totalScore, 2.5);
    assertClose(getHybridErrorScore(timestampsMs, { nowMs, windowMs, halfLifeMs }), 2.5);

    assert.throws(() => getHybridErrorScore([], { nowMs, windowMs: -1, halfLifeMs }));
    assert.throws(() => getHybridErrorScore([], { nowMs, windowMs, halfLifeMs: 0 }));

    console.log("errorAdaptation smoke test passed");
}

main();
