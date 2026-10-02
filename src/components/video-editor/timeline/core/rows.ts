import {
	ANNOTATION_ROW_ID,
	ANNOTATION_ROW_PREFIX,
	AUDIO_ROW_ID,
	AUDIO_ROW_PREFIX,
	SPEED_ROW_ID,
} from "./constants";

export function getAnnotationTrackRowId(trackIndex: number) {
	return `${ANNOTATION_ROW_ID}-${Math.max(0, Math.floor(trackIndex))}`;
}

export function isAnnotationTrackRowId(rowId: string) {
	return rowId === ANNOTATION_ROW_ID || rowId.startsWith(ANNOTATION_ROW_PREFIX);
}

export function getAnnotationTrackIndex(rowId: string) {
	if (rowId === ANNOTATION_ROW_ID) {
		return 0;
	}

	const parsed = Number.parseInt(rowId.slice(ANNOTATION_ROW_PREFIX.length), 10);
	return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

export function getAudioTrackRowId(trackIndex: number) {
	return `${AUDIO_ROW_PREFIX}${Math.max(0, Math.floor(trackIndex))}`;
}

export function isAudioTrackRowId(rowId: string) {
	return rowId === AUDIO_ROW_ID || rowId.startsWith(AUDIO_ROW_PREFIX);
}

export function getAudioTrackIndex(rowId: string) {
	if (rowId === AUDIO_ROW_ID) {
		return 0;
	}

	const parsed = Number.parseInt(rowId.slice(AUDIO_ROW_PREFIX.length), 10);
	return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

// Speed-row items mirror sped-up clips, so their ids must not collide with clip ids.
const SPEED_SECTION_ITEM_PREFIX = `${SPEED_ROW_ID}:`;

export function getSpeedSectionItemId(clipId: string) {
	return `${SPEED_SECTION_ITEM_PREFIX}${clipId}`;
}

/** The clip a speed-row item stands for, or null for any other timeline item. */
export function getSpeedSectionClipId(itemId: string) {
	return itemId.startsWith(SPEED_SECTION_ITEM_PREFIX)
		? itemId.slice(SPEED_SECTION_ITEM_PREFIX.length)
		: null;
}
