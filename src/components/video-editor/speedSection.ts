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

function findPreceding(clipRegions: ClipRegion[], clip: ClipRegion) {
	return clipRegions.find((other) => other.id !== clip.id && readsOnFrom(other, clip)) ?? null;
}

function findFollowing(clipRegions: ClipRegion[], clip: ClipRegion) {
	return clipRegions.find((other) => other.id !== clip.id && readsOnFrom(clip, other)) ?? null;
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
		const following = findFollowing(clipRegions, section);
		return following ? { first: section, second: following, boundaryMs: endMs } : null;
	}
	const preceding = findPreceding(clipRegions, section);
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

/**
 * Moving a whole section slides it along the recording: it keeps the amount
 * of footage it covers, and the clips on either side give and take the rest.
 */
export function planSpeedSectionSlide(
	clipRegions: ClipRegion[],
	sectionId: string,
	startMs: number,
	minDurationMs: number,
): RippledClips | null {
	const section = clipRegions.find((clip) => clip.id === sectionId);
	if (!section || !isSpeedSection(section)) return null;
	const preceding = findPreceding(clipRegions, section);
	const following = findFollowing(clipRegions, section);
	if (!preceding || !following) return null;

	const precedingSpeed = safeSpeed(preceding);
	const followingSpeed = safeSpeed(following);
	const precedingSourceStart = getClipSourceStartMs(preceding);
	const followingSourceEnd = getClipSourceEndMs(following);
	const sectionSourceMs = getClipSourceEndMs(section) - getClipSourceStartMs(section);
	const minSource = precedingSourceStart + minDurationMs * precedingSpeed;
	const maxSource = followingSourceEnd - sectionSourceMs - minDurationMs * followingSpeed;
	if (minSource > maxSource) return null;

	const sectionSource = Math.min(
		maxSource,
		Math.max(minSource, precedingSourceStart + (startMs - preceding.startMs) * precedingSpeed),
	);
	const nextPreceding: ClipRegion = {
		...preceding,
		endMs: Math.round(
			preceding.startMs + (sectionSource - precedingSourceStart) / precedingSpeed,
		),
	};
	const nextSection: ClipRegion = {
		...section,
		startMs: nextPreceding.endMs,
		sourceStartMs: Math.round(sectionSource),
		endMs: nextPreceding.endMs + Math.round(sectionSourceMs / safeSpeed(section)),
	};
	const followingSource = sectionSource + sectionSourceMs;
	const nextFollowing: ClipRegion = {
		...following,
		startMs: nextSection.endMs,
		sourceStartMs: Math.round(followingSource),
		endMs:
			nextSection.endMs + Math.round((followingSourceEnd - followingSource) / followingSpeed),
	};

	return rippleClipChainEdit(clipRegions, {
		previous: [preceding, section, following],
		next: [nextPreceding, nextSection, nextFollowing],
	});
}

function canRejoin(neighbour: ClipRegion | null, section: ClipRegion) {
	return (
		neighbour !== null &&
		!isSpeedSection(neighbour) &&
		Boolean(neighbour.muted) === Boolean(section.muted) &&
		Boolean(neighbour.showSourceAudio) === Boolean(section.showSourceAudio)
	);
}

/** Plays a section at 1x again and joins it back to the footage around it. */
export function planSpeedSectionRemove(
	clipRegions: ClipRegion[],
	sectionId: string,
): RippledClips | null {
	const section = clipRegions.find((clip) => clip.id === sectionId);
	if (!section || !isSpeedSection(section)) return null;
	const preceding = findPreceding(clipRegions, section);
	const following = findFollowing(clipRegions, section);
	const head = canRejoin(preceding, section) ? preceding : null;
	const tail = canRejoin(following, section) ? following : null;

	const base = head ?? section;
	const sourceStartMs = getClipSourceStartMs(base);
	const sourceEndMs = getClipSourceEndMs(tail ?? section);
	const rejoined: ClipRegion = {
		...base,
		speed: 1,
		sourceStartMs,
		endMs: base.startMs + (sourceEndMs - sourceStartMs),
	};

	return rippleClipChainEdit(clipRegions, {
		previous: [head, section, tail].filter((clip): clip is ClipRegion => clip !== null),
		next: [rejoined],
	});
}
