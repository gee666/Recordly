import { type RippledClips, rippleClipChainEdit } from "./clipRipple";
import type { ClipRegion } from "./types";

export function formatClipSpeedLabel(speed: number): string | null {
	if (!Number.isFinite(speed) || speed <= 0 || speed === 1) {
		return null;
	}

	return `${Number.isInteger(speed) ? speed.toFixed(0) : speed.toString()}x`;
}

/**
 * Retimes one clip around its fixed start. Later clips ripple by the length
 * change so the timeline stays gap-free and slowing down never collides.
 */
export function planClipSpeedChange(params: {
	clipRegions: ClipRegion[];
	selectedClipId: string;
	speed: number;
}): RippledClips | null {
	const { clipRegions, selectedClipId, speed } = params;
	if (!selectedClipId || !Number.isFinite(speed) || speed <= 0) {
		return null;
	}

	const clip = clipRegions.find((candidate) => candidate.id === selectedClipId);
	if (!clip) {
		return null;
	}

	const oldSpeed = Number.isFinite(clip.speed) && clip.speed > 0 ? clip.speed : 1;
	const sourceDurationMs = Math.max(0, clip.endMs - clip.startMs) * oldSpeed;
	const retimed: ClipRegion = {
		...clip,
		speed,
		endMs: Math.round(clip.startMs + sourceDurationMs / speed),
	};

	return rippleClipChainEdit(clipRegions, { previous: [clip], next: [retimed] });
}
