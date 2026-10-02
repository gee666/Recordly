import type { Span } from "dnd-timeline";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { toast } from "sonner";
import { type RippledClips, retimeSpan } from "../clipRipple";
import { planClipSpeedChange } from "../clipSpeedChange";
import {
	findSpeedSectionRoll,
	planSpeedSectionInsert,
	planSpeedSectionRemove,
	planSpeedSectionRoll,
	planSpeedSectionSlide,
	SPEED_SECTION_DEFAULT_SOURCE_MS,
	SPEED_SECTION_DEFAULT_SPEED,
} from "../speedSection";
import { TIMELINE_MIN_ITEM_DURATION_MS } from "../timeline/core/time";
import type { AnnotationRegion, AudioRegion, ClipRegion, ZoomRegion } from "../types";
import { supportsPreviewPlaybackRate } from "../videoPlayback/playbackRate";

type Translator = (
	key: string,
	fallback?: string,
	params?: Record<string, string | number>,
) => string;

interface UseClipSpeedCommandsParams {
	clipRegions: ClipRegion[];
	setClipRegions: Dispatch<SetStateAction<ClipRegion[]>>;
	setZoomRegions: Dispatch<SetStateAction<ZoomRegion[]>>;
	setAnnotationRegions: Dispatch<SetStateAction<AnnotationRegion[]>>;
	setAudioRegions: Dispatch<SetStateAction<AudioRegion[]>>;
	selectedClipId: string | null;
	selectedSpeedSectionId: string | null;
	selectSpeedSection: (clipId: string | null) => void;
	nextClipIdRef: MutableRefObject<number>;
	t: Translator;
}

export function useClipSpeedCommands({
	clipRegions,
	setClipRegions,
	setZoomRegions,
	setAnnotationRegions,
	setAudioRegions,
	selectedClipId,
	selectedSpeedSectionId,
	selectSpeedSection,
	nextClipIdRef,
	t,
}: UseClipSpeedCommandsParams) {
	/** Zooms, annotations and attached audio follow the footage they sit on. */
	const applyRipple = useCallback(
		({ clipRegions: nextClips, retime }: RippledClips) => {
			setClipRegions(nextClips);
			setZoomRegions((current) => current.map((zoom) => retimeSpan(zoom, retime)));
			setAnnotationRegions((current) =>
				current.map((annotation) => retimeSpan(annotation, retime)),
			);
			setAudioRegions((current) =>
				current.map((audio) =>
					audio.detachedFromVideo ? audio : retimeSpan(audio, retime),
				),
			);
		},
		[setAnnotationRegions, setAudioRegions, setClipRegions, setZoomRegions],
	);

	const ensurePreviewableSpeed = useCallback(
		(speed: number) => {
			if (supportsPreviewPlaybackRate(speed)) return true;
			toast.error(
				t(
					"editor.timeline.unsupportedSpeed",
					"This speed is not supported for preview on this device.",
				),
			);
			return false;
		},
		[t],
	);

	const changeSpeed = useCallback(
		(clipId: string | null, speed: number) => {
			if (!clipId || !Number.isFinite(speed) || speed <= 0) return;
			if (!ensurePreviewableSpeed(speed)) return;
			const plan = planClipSpeedChange({ clipRegions, selectedClipId: clipId, speed });
			if (plan) applyRipple(plan);
		},
		[applyRipple, clipRegions, ensurePreviewableSpeed],
	);

	const handleClipSpeedChange = useCallback(
		(speed: number) => changeSpeed(selectedClipId, speed),
		[changeSpeed, selectedClipId],
	);

	/** Like deleting a zoom: the footage stays, only the speed-up goes away. */
	const handleSpeedSectionDelete = useCallback(
		(clipId: string) => {
			const plan = planSpeedSectionRemove(clipRegions, clipId);
			if (plan) applyRipple(plan);
			selectSpeedSection(null);
		},
		[applyRipple, clipRegions, selectSpeedSection],
	);

	const handleSpeedSectionSpeedChange = useCallback(
		(speed: number) => {
			if (!selectedSpeedSectionId) return;
			if (speed === 1) handleSpeedSectionDelete(selectedSpeedSectionId);
			else changeSpeed(selectedSpeedSectionId, speed);
		},
		[changeSpeed, handleSpeedSectionDelete, selectedSpeedSectionId],
	);

	const handleSpeedUpSection = useCallback(
		(atMs: number) => {
			if (!ensurePreviewableSpeed(SPEED_SECTION_DEFAULT_SPEED)) return;
			const plan = planSpeedSectionInsert({
				clipRegions,
				atMs,
				speed: SPEED_SECTION_DEFAULT_SPEED,
				sourceSpanMs: SPEED_SECTION_DEFAULT_SOURCE_MS,
				minDurationMs: TIMELINE_MIN_ITEM_DURATION_MS,
				createId: () => `clip-${nextClipIdRef.current++}`,
			});
			if (plan.kind === "blocked") {
				toast.info(
					plan.reason === "no-clip"
						? t(
								"editor.timeline.speedUpNoClip",
								"Move the playhead over the video to speed up a section.",
							)
						: t(
								"editor.timeline.speedUpTooShort",
								"Not enough footage left in this clip to speed up.",
							),
				);
				return;
			}
			if (plan.kind === "inserted") applyRipple(plan);
			selectSpeedSection(plan.sectionId);
		},
		[applyRipple, clipRegions, ensurePreviewableSpeed, nextClipIdRef, selectSpeedSection, t],
	);

	/** Handles edge drags on speed sections; returns false for any other clip edit. */
	const handleSpeedSectionRoll = useCallback(
		(id: string, span: Span) => {
			const roll = findSpeedSectionRoll(clipRegions, id, span);
			if (!roll) return false;
			const plan = planSpeedSectionRoll(clipRegions, roll, TIMELINE_MIN_ITEM_DURATION_MS);
			if (plan) applyRipple(plan);
			return true;
		},
		[applyRipple, clipRegions],
	);

	/** Edge drags on the speed row roll a boundary; dragging the body slides the section. */
	const handleSpeedSectionSpanChange = useCallback(
		(clipId: string, span: Span) => {
			if (handleSpeedSectionRoll(clipId, span)) return;
			const plan = planSpeedSectionSlide(
				clipRegions,
				clipId,
				span.start,
				TIMELINE_MIN_ITEM_DURATION_MS,
			);
			if (plan) applyRipple(plan);
		},
		[applyRipple, clipRegions, handleSpeedSectionRoll],
	);

	return {
		handleClipSpeedChange,
		handleSpeedSectionSpeedChange,
		handleSpeedUpSection,
		handleSpeedSectionRoll,
		handleSpeedSectionSpanChange,
		handleSpeedSectionDelete,
	};
}
