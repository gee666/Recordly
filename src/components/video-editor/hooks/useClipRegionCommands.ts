import type { Span } from "dnd-timeline";
import { type Dispatch, type MutableRefObject, type SetStateAction, useCallback } from "react";
import { changeClipSpan } from "../clipSpanChange";
import { planClipSplit } from "../clipSplit";
import type {
	AnnotationRegion,
	AudioRegion,
	ClipRegion,
	EditorEffectSection,
	ZoomRegion,
} from "../types";
import { useClipSpeedCommands } from "./useClipSpeedCommands";

type Translator = (
	key: string,
	fallback?: string,
	params?: Record<string, string | number>,
) => string;

interface UseClipRegionCommandsParams {
	sourceDurationMs: number;
	clipRegions: ClipRegion[];
	setClipRegions: Dispatch<SetStateAction<ClipRegion[]>>;
	setZoomRegions: Dispatch<SetStateAction<ZoomRegion[]>>;
	setAnnotationRegions: Dispatch<SetStateAction<AnnotationRegion[]>>;
	setAudioRegions: Dispatch<SetStateAction<AudioRegion[]>>;
	selectedClipId: string | null;
	setSelectedClipId: Dispatch<SetStateAction<string | null>>;
	setSelectedZoomId: Dispatch<SetStateAction<string | null>>;
	setSelectedAnnotationId: Dispatch<SetStateAction<string | null>>;
	setSelectedAudioId: Dispatch<SetStateAction<string | null>>;
	setSelectedCaptionId: Dispatch<SetStateAction<string | null>>;
	setActiveEffectSection: Dispatch<SetStateAction<EditorEffectSection>>;
	nextClipIdRef: MutableRefObject<number>;
	t: Translator;
}

export function useClipRegionCommands({
	sourceDurationMs,
	clipRegions,
	setClipRegions,
	setZoomRegions,
	setAnnotationRegions,
	setAudioRegions,
	selectedClipId,
	setSelectedClipId,
	setSelectedZoomId,
	setSelectedAnnotationId,
	setSelectedAudioId,
	setSelectedCaptionId,
	setActiveEffectSection,
	nextClipIdRef,
	t,
}: UseClipRegionCommandsParams) {
	const handleSelectClip = useCallback(
		(id: string | null) => {
			setSelectedClipId(id);
			if (id) {
				setActiveEffectSection("clip");
				setSelectedZoomId(null);
				setSelectedAnnotationId(null);
				setSelectedAudioId(null);
				setSelectedCaptionId(null);
			} else {
				setActiveEffectSection((section) => (section === "clip" ? "scene" : section));
			}
		},
		[
			setActiveEffectSection,
			setSelectedAnnotationId,
			setSelectedAudioId,
			setSelectedCaptionId,
			setSelectedClipId,
			setSelectedZoomId,
		],
	);

	const { handleClipSpeedChange, handleSpeedUpSection, handleSpeedSectionRoll } =
		useClipSpeedCommands({
			clipRegions,
			setClipRegions,
			setZoomRegions,
			setAnnotationRegions,
			setAudioRegions,
			selectedClipId,
			selectClip: handleSelectClip,
			nextClipIdRef,
			t,
		});

	const handleClipSplit = useCallback(
		(splitMs: number) => {
			const plan = planClipSplit({
				clipRegions,
				splitMs,
				createId: () => `clip-${nextClipIdRef.current++}`,
			});
			if (!plan) return;
			setClipRegions((current) =>
				current.flatMap((clip) =>
					clip.id === plan.targetId ? [plan.left, plan.right] : [clip],
				),
			);
			if (selectedClipId === plan.targetId) setSelectedClipId(plan.left.id);
		},
		[clipRegions, nextClipIdRef, selectedClipId, setClipRegions, setSelectedClipId],
	);

	const handleClipSpanChange = useCallback(
		(id: string, span: Span) => {
			if (handleSpeedSectionRoll(id, span)) return;
			const oldClip = clipRegions.find((clip) => clip.id === id);
			const newStart = Math.round(span.start);
			const newEnd = Math.round(span.end);

			if (oldClip) {
				const startDelta = newStart - oldClip.startMs;
				const endDelta = newEnd - oldClip.endMs;
				if (Math.abs(startDelta - endDelta) < 1 && Math.abs(startDelta) > 0) {
					setZoomRegions((current) =>
						current.map((zoom) =>
							zoom.startMs < oldClip.endMs && zoom.endMs > oldClip.startMs
								? {
										...zoom,
										startMs: zoom.startMs + startDelta,
										endMs: zoom.endMs + startDelta,
									}
								: zoom,
						),
					);
				}
			}

			setClipRegions((current) =>
				current.map((clip) => {
					if (clip.id !== id) return clip;
					return changeClipSpan(clip, newStart, newEnd, sourceDurationMs);
				}),
			);
		},
		[clipRegions, handleSpeedSectionRoll, setClipRegions, setZoomRegions, sourceDurationMs],
	);

	const handleClipMutedChange = useCallback(
		(muted: boolean) => {
			if (!selectedClipId) return;
			setClipRegions((current) =>
				current.map((clip) => (clip.id === selectedClipId ? { ...clip, muted } : clip)),
			);
		},
		[selectedClipId, setClipRegions],
	);
	const handleClipShowSourceAudioChange = useCallback(
		(showSourceAudio: boolean) => {
			if (!selectedClipId) return;
			setClipRegions((current) =>
				current.map((clip) =>
					clip.id === selectedClipId ? { ...clip, showSourceAudio } : clip,
				),
			);
		},
		[selectedClipId, setClipRegions],
	);

	const handleClipDelete = useCallback(
		(id: string) => {
			// Other tracks have their own timeline positions; deleting footage is not a ripple edit.
			setClipRegions((current) => current.filter((clip) => clip.id !== id));
			if (selectedClipId === id) setSelectedClipId(null);
		},
		[selectedClipId, setClipRegions, setSelectedClipId],
	);

	return {
		handleSelectClip,
		handleClipSplit,
		handleClipSpanChange,
		handleClipSpeedChange,
		handleSpeedUpSection,
		handleClipMutedChange,
		handleClipShowSourceAudioChange,
		handleClipDelete,
	};
}
