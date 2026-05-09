export interface HybridErrorScoreOptions {
    nowMs?: number;
    windowMs: number;
    halfLifeMs: number;
}

export interface HybridErrorScoreBreakdown {
    recentCount: number;
    decayedScore: number;
    totalScore: number;
}

function validateHybridScoreOptions(options: HybridErrorScoreOptions): void {
    if (!Number.isFinite(options.windowMs) || options.windowMs < 0) {
        throw new Error("windowMs must be a finite number greater than or equal to 0.");
    }

    if (!Number.isFinite(options.halfLifeMs) || options.halfLifeMs <= 0) {
        throw new Error("halfLifeMs must be a finite number greater than 0.");
    }
}

function calculateDecayRate(halfLifeMs: number): number {
    return Math.log(2) / halfLifeMs;
}

export function getHybridErrorScoreBreakdown(
    timestampsMs: readonly number[],
    options: HybridErrorScoreOptions
): HybridErrorScoreBreakdown {
    validateHybridScoreOptions(options);

    const nowMs = options.nowMs ?? Date.now();
    const decayRate = calculateDecayRate(options.halfLifeMs);

    let recentCount = 0;
    let decayedScore = 0;

    for (const timestampMs of timestampsMs) {
        if (!Number.isFinite(timestampMs)) {
            continue;
        }

        const ageMs = nowMs - timestampMs;

        if (ageMs <= options.windowMs) {
            recentCount += 1;
            continue;
        }

        const tailAgeMs = ageMs - options.windowMs;
        decayedScore += Math.exp(-decayRate * tailAgeMs);
    }

    return {
        recentCount,
        decayedScore,
        totalScore: recentCount + decayedScore
    };
}

export function getHybridErrorScore(
    timestampsMs: readonly number[],
    options: HybridErrorScoreOptions
): number {
    return getHybridErrorScoreBreakdown(timestampsMs, options).totalScore;
}
