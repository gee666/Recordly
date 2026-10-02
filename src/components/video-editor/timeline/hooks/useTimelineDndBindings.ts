import type { Span } from "dnd-timeline";
import { useCallback, useMemo } from "react";
import { findSpeedSectionRoll } from "../../speedSection";
import type {
	AnnotationRegion,
	AudioRegion,
	CaptionCue,
	ClipRegion,
	TrimRegion,
	ZoomRegion,
} from "../../types";
import {
	getAnnotationTrackIndex,
	getAudioTrackIndex,
	getSpeedSectionClipId,
	isAnnotationTrackRowId,
	isAudioTrackRowId,
} from "../core/rows";
import { spansOverlap } from "../core/spans";
import type { TimelineRenderItem } from "../core/timelineTypes";
import { buildAllRegionSpans, buildTimelineItems, resolveDropRowId } from "../model/timelineModel";

interface UseTimelineDndBindingsParams {
	zoomRegions: ZoomRegion[];
	trimRegions: TrimRegion[];
	clipRegions: ClipRegion[];
	annotationRegions: AnnotationRegion[];
	audioRegions: AudioRegion[];
	captionCues: CaptionCue[];
	onZoomSpanChange: (id: string, span: Span) => void;
	onTrimSpanChange?: (id: string, span: Span) => void;
	onClipSpanChange?: (id: string, span: Span) => void;
	onAnnotationSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onSpeedSectionSpanChange?: (clipId: string, span: Span) => void;
	onAudioSpanChange?: (id: string, span: Span, trackIndex?: number) => void;
	onCaptionSpanChange?: (id: string, span: Span) => void;
}

type TimelineItemKind =
	| "zoom"
	| "trim"
	| "clip"
	| "annotation"
	| "speed"
	| "audio"
	| "caption"
	| null;

export function useTimelineDndBindings({
	zoomRegions,
	trimRegions,
	clipRegions,
	annotationRegions,
	audioRegions,
	captionCues,
	onZoomSpanChange,
	onTrimSpanChange,
	onClipSpanChange,
	onAnnotationSpanChange,
	onSpeedSectionSpanChange,
	onAudioSpanChange,
	onCaptionSpanChange,
}: UseTimelineDndBindingsParams) {
	const resolveItemKind = useCallback(
		(id: string): TimelineItemKind => {
			if (getSpeedSectionClipId(id)) return "speed";
			if (zoomRegions.some((r) => r.id === id)) return "zoom";
			if (trimRegions.some((r) => r.id === id)) return "trim";
			if (clipRegions.some((r) => r.id === id)) return "clip";
			if (annotationRegions.some((r) => r.id === id)) return "annotation";
			if (audioRegions.some((r) => r.id === id)) return "audio";
			if (captionCues.some((c) => c.id === id)) return "caption";
			return null;
		},
		[zoomRegions, trimRegions, clipRegions, annotationRegions, audioRegions, captionCues],
	);

	const resolveTrackIndex = useCallback(
		(kind: "annotation" | "audio", id: string, rowId?: string): number => {
			if (kind === "annotation") {
				return rowId && isAnnotationTrackRowId(rowId)
					? getAnnotationTrackIndex(rowId)
					: (annotationRegions.find((region) => region.id === id)?.trackIndex ?? 0);
			}
			return rowId && isAudioTrackRowId(rowId)
				? getAudioTrackIndex(rowId)
				: (audioRegions.find((region) => region.id === id)?.trackIndex ?? 0);
		},
		[annotationRegions, audioRegions],
	);

	const hasOverlap = useCallback(
		(newSpan: Span, excludeId?: string, rowId?: string): boolean => {
			if (!excludeId) return false;
			const itemKind = resolveItemKind(excludeId);

			// Speed sections cannot overlap: their edits move clip boundaries, never stack clips.
			if (itemKind === "annotation" || itemKind === "speed") return false;

			const checkOverlap = (regions: { id: string; startMs: number; endMs: number }[]) =>
				regions.some((region) => {
					if (region.id === excludeId) return false;
					return spansOverlap(newSpan, { start: region.startMs, end: region.endMs });
				});

			if (itemKind === "zoom") return checkOverlap(zoomRegions);
			if (itemKind === "trim") return checkOverlap(trimRegions);
			if (itemKind === "clip") return checkOverlap(clipRegions);
			// Captions share a single lane and must never overlap, so validate a dragged or
			// resized caption against the other cues just like the other timeline items.
			if (itemKind === "caption") return checkOverlap(captionCues);

			if (itemKind === "audio") {
				const activeTrackIndex = resolveTrackIndex("audio", excludeId, rowId);
				return checkOverlap(
					audioRegions.filter((region) => (region.trackIndex ?? 0) === activeTrackIndex),
				);
			}

			return false;
		},
		[
			resolveItemKind,
			resolveTrackIndex,
			zoomRegions,
			trimRegions,
			clipRegions,
			audioRegions,
			captionCues,
		],
	);

	const resizesIntoNeighbour = useCallback(
		(id: string, span: Span) =>
			findSpeedSectionRoll(clipRegions, getSpeedSectionClipId(id) ?? id, span) !== null,
		[clipRegions],
	);

	const timelineItems = useMemo<TimelineRenderItem[]>(
		() =>
			buildTimelineItems({
				zoomRegions,
				clipRegions,
				annotationRegions,
				audioRegions,
				captionCues,
			}),
		[zoomRegions, clipRegions, annotationRegions, audioRegions, captionCues],
	);

	const allRegionSpans = useMemo(
		() =>
			buildAllRegionSpans({
				zoomRegions,
				clipRegions,
				audioRegions,
			}),
		[zoomRegions, clipRegions, audioRegions],
	);

	const getResolvedDropRowId = useCallback(
		(id: string, proposedRowId: string) => resolveDropRowId(id, proposedRowId, timelineItems),
		[timelineItems],
	);

	const handleItemSpanChange = useCallback(
		(id: string, span: Span, rowId?: string) => {
			const itemKind = resolveItemKind(id);
			if (itemKind === "zoom") {
				onZoomSpanChange(id, span);
			} else if (itemKind === "trim") {
				onTrimSpanChange?.(id, span);
			} else if (itemKind === "clip") {
				onClipSpanChange?.(id, span);
			} else if (itemKind === "annotation") {
				const nextTrackIndex = resolveTrackIndex("annotation", id, rowId);
				onAnnotationSpanChange?.(id, span, nextTrackIndex);
			} else if (itemKind === "speed") {
				const clipId = getSpeedSectionClipId(id);
				if (clipId) onSpeedSectionSpanChange?.(clipId, span);
			} else if (itemKind === "audio") {
				const nextTrackIndex = resolveTrackIndex("audio", id, rowId);
				onAudioSpanChange?.(id, span, nextTrackIndex);
			} else if (itemKind === "caption") {
				onCaptionSpanChange?.(id, span);
			}
		},
		[
			resolveItemKind,
			resolveTrackIndex,
			onZoomSpanChange,
			onTrimSpanChange,
			onClipSpanChange,
			onAnnotationSpanChange,
			onSpeedSectionSpanChange,
			onAudioSpanChange,
			onCaptionSpanChange,
		],
	);

	return {
		hasOverlap,
		resizesIntoNeighbour,
		timelineItems,
		allRegionSpans,
		getResolvedDropRowId,
		handleItemSpanChange,
	};
}
