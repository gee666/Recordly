import type { Span } from "dnd-timeline";
import { type RippledClips, rippleClipChainEdit } from "./clipRipple";
import {
	type ClipRegion,
	findClipAtTimelineTime,
	getClipSourceEndMs,
	getClipSourceStartMs,
} from "./types";

/**
 * A speed section is a sped-up clip carved out of the footage. Each one is an
 * ordinary clip with a non-1x speed, so preview and export need nothing new.
 */
export const SPEED_SECTION_DEFAULT_SPEED = 2;
/** Footage a new section covers before the user drags its edges. */
export const SPEED_SECTION_DEFAULT_SOURCE_MS = 4000;
export const SPEED_SECTION_PRESETS = [1, 1.5, 2, 3, 4, 8] as const;

export type SpeedSectionInsertPlan =
	| ({ kind: "inserted"; sectionId: string } & RippledClips)
	| { kind: "existing"; sectionId: string }
	| { kind: "blocked"; reason: "no-clip" | "too-short" };

function safeSpeed(clip: ClipRegion) {
	return Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
}

export function isSpeedSection(clip: ClipRegion) {
	return safeSpeed(clip) !== 1;
}

/** Carves a sped-up section out of the 1x clip under the playhead. */
export function planSpeedSectionInsert(params: {
	clipRegions: ClipRegion[];
	atMs: number;
	speed: number;
	sourceSpanMs: number;
	minDurationMs: number;
	createId: () => string;
}): SpeedSectionInsertPlan {
	const { clipRegions, atMs, speed, sourceSpanMs, minDurationMs, createId } = params;
	const clip = findClipAtTimelineTime(atMs, clipRegions);
	if (!clip) return { kind: "blocked", reason: "no-clip" };
	if (isSpeedSection(clip)) return { kind: "existing", sectionId: clip.id };

	const startMs = Math.round(atMs);
	const sectionSourceMs = Math.min(sourceSpanMs, clip.endMs - startMs);
	if (sectionSourceMs / speed < minDurationMs) return { kind: "blocked", reason: "too-short" };

	// The clip plays at 1x, so timeline and source offsets inside it are equal.
	const sourceAt = (timeMs: number) => getClipSourceStartMs(clip) + (timeMs - clip.startMs);
	const head: ClipRegion[] =
		startMs > clip.startMs ? [{ ...clip, id: createId(), endMs: startMs }] : [];
	const section: ClipRegion = {
		...clip,
		id: createId(),
		speed,
		startMs,
		endMs: startMs + Math.round(sectionSourceMs / speed),
		sourceStartMs: sourceAt(startMs),
	};
	const tailSourceMs = clip.endMs - startMs - sectionSourceMs;
	const next: ClipRegion[] = [
		...head,
		section,
		...(tailSourceMs > 0
			? [
					{
						...clip,
						id: createId(),
						startMs: section.endMs,
						endMs: section.endMs + tailSourceMs,
						sourceStartMs: sourceAt(startMs + sectionSourceMs),
					},
				]
			: []),
	];

	return {
		kind: "inserted",
		sectionId: section.id,
		...rippleClipChainEdit(clipRegions, { previous: [clip], next }),
	};
}

export interface SpeedSectionRoll {
	/** The earlier clip of the pair whose shared boundary moves. */
	first: ClipRegion;
	second: ClipRegion;
	boundaryMs: number;
}

function readsOnFrom(earlier: ClipRegion, later: ClipRegion) {
	// Section boundaries are rounded to whole timeline ms, which costs up to `speed` ms of source.
	const toleranceMs = Math.max(safeSpeed(earlier), safeSpeed(later)) + 1;
	return (
		Math.abs(later.startMs - earlier.endMs) <= 1 &&
		Math.abs(getClipSourceStartMs(later) - getClipSourceEndMs(earlier)) <= toleranceMs
	);
}

/**
 * Dragging one edge of a speed section moves its boundary with the footage
 * next to it, so the section grows or shrinks over the recording instead of
 * trimming footage away. Returns null for moves and for ordinary clips.
 */
export function findSpeedSectionRoll(
	clipRegions: ClipRegion[],
	id: string,
	span: Span,
): SpeedSectionRoll | null {
	const section = clipRegions.find((clip) => clip.id === id);
	if (!section || !isSpeedSection(section)) return null;

	const startMs = Math.round(span.start);
	const endMs = Math.round(span.end);
	const startMoved = startMs !== section.startMs;
	const endMoved = endMs !== section.endMs;
	if (startMoved === endMoved) return null;

	if (endMoved) {
		const following = clipRegions.find((clip) => clip.id !== id && readsOnFrom(section, clip));
		return following ? { first: section, second: following, boundaryMs: endMs } : null;
	}
	const preceding = clipRegions.find((clip) => clip.id !== id && readsOnFrom(clip, section));
	return preceding ? { first: preceding, second: section, boundaryMs: startMs } : null;
}

export function planSpeedSectionRoll(
	clipRegions: ClipRegion[],
	roll: SpeedSectionRoll,
	minDurationMs: number,
): RippledClips | null {
	const { first, second, boundaryMs } = roll;
	const firstSpeed = safeSpeed(first);
	const secondSpeed = safeSpeed(second);
	const firstSourceStart = getClipSourceStartMs(first);
	const secondSourceEnd = getClipSourceEndMs(second);
	const minBoundary = firstSourceStart + minDurationMs * firstSpeed;
	const maxBoundary = secondSourceEnd - minDurationMs * secondSpeed;
	if (minBoundary > maxBoundary) return null;

	const boundarySource = Math.min(
		maxBoundary,
		Math.max(minBoundary, firstSourceStart + (boundaryMs - first.startMs) * firstSpeed),
	);
	const nextFirst: ClipRegion = {
		...first,
		endMs: Math.round(first.startMs + (boundarySource - firstSourceStart) / firstSpeed),
	};
	const nextSecond: ClipRegion = {
		...second,
		startMs: nextFirst.endMs,
		sourceStartMs: Math.round(boundarySource),
		endMs: nextFirst.endMs + Math.round((secondSourceEnd - boundarySource) / secondSpeed),
	};

	return rippleClipChainEdit(clipRegions, {
		previous: [first, second],
		next: [nextFirst, nextSecond],
	});
}
