import {
	type ClipRegion,
	getClipSourceEndMs,
	getClipSourceStartMs,
	sortClipRegions,
} from "./types";

/** Maps a pre-edit timeline position to where the same moment sits after the edit. */
export type TimelineRetime = (timeMs: number) => number;

export interface ClipChainEdit {
	/** Clips being replaced: adjacent on the timeline, reading one continuous source range. */
	previous: ClipRegion[];
	/** Their replacements, covering the same source range from the same timeline start. */
	next: ClipRegion[];
}

export interface RippledClips {
	clipRegions: ClipRegion[];
	retime: TimelineRetime;
}

interface Breakpoint {
	oldMs: number;
	newMs: number;
}

function timelineAtSource(chain: ClipRegion[], sourceMs: number): number {
	const clip =
		chain.find(
			(candidate) =>
				sourceMs >= getClipSourceStartMs(candidate) &&
				sourceMs <= getClipSourceEndMs(candidate),
		) ?? chain[chain.length - 1];
	const speed = clip.speed > 0 ? clip.speed : 1;
	return clip.startMs + (sourceMs - getClipSourceStartMs(clip)) / speed;
}

function buildBreakpoints({ previous, next }: ClipChainEdit): Breakpoint[] {
	const sourceBoundaries = new Set<number>();
	for (const clip of [...previous, ...next]) {
		sourceBoundaries.add(getClipSourceStartMs(clip));
		sourceBoundaries.add(getClipSourceEndMs(clip));
	}
	return [...sourceBoundaries]
		.map((sourceMs) => ({
			oldMs: timelineAtSource(previous, sourceMs),
			newMs: timelineAtSource(next, sourceMs),
		}))
		.sort((left, right) => left.oldMs - right.oldMs);
}

function createRetime(breakpoints: Breakpoint[]): TimelineRetime {
	const first = breakpoints[0];
	const last = breakpoints[breakpoints.length - 1];
	return (timeMs) => {
		if (timeMs <= first.oldMs) return timeMs;
		if (timeMs >= last.oldMs) return Math.round(timeMs + last.newMs - last.oldMs);
		const upperIndex = breakpoints.findIndex((point) => point.oldMs >= timeMs);
		const lower = breakpoints[upperIndex - 1];
		const upper = breakpoints[upperIndex];
		const ratio = (timeMs - lower.oldMs) / (upper.oldMs - lower.oldMs);
		return Math.round(lower.newMs + ratio * (upper.newMs - lower.newMs));
	};
}

/**
 * Replaces a chain of clips and ripples everything after it, so retiming a
 * section never opens a black gap or pushes footage into the next clip.
 */
export function rippleClipChainEdit(clipRegions: ClipRegion[], edit: ClipChainEdit): RippledClips {
	const previous = sortClipRegions(edit.previous);
	const next = sortClipRegions(edit.next);
	const replacedIds = new Set(previous.map((clip) => clip.id));
	const oldEndMs = previous[previous.length - 1].endMs;
	const offsetMs = next[next.length - 1].endMs - oldEndMs;

	const shifted = clipRegions
		.filter((clip) => !replacedIds.has(clip.id))
		.map((clip) =>
			clip.startMs >= oldEndMs && offsetMs !== 0
				? {
						...clip,
						startMs: clip.startMs + offsetMs,
						endMs: clip.endMs + offsetMs,
						sourceStartMs: getClipSourceStartMs(clip),
					}
				: clip,
		);

	return {
		clipRegions: sortClipRegions([...shifted, ...next]),
		retime: createRetime(buildBreakpoints({ previous, next })),
	};
}

/** Moves a timeline-anchored item so it stays on the footage it was placed over. */
export function retimeSpan<T extends { startMs: number; endMs: number }>(
	region: T,
	retime: TimelineRetime,
): T {
	const startMs = retime(region.startMs);
	const endMs = Math.max(startMs + 1, retime(region.endMs));
	return startMs === region.startMs && endMs === region.endMs
		? region
		: { ...region, startMs, endMs };
}
