import type { RecordingBounds, RecordingRegion } from "../src/lib/recordingRegion";
import { LINUX_PORTAL_SCREEN_SOURCE_ID } from "./ipc/register/sourceMapping";

export interface CaptureSource {
	id?: string;
	display_id?: string;
	sourceType?: "screen" | "window";
	captureRegion?: RecordingRegion;
}

export interface CaptureDisplay {
	id: number;
	bounds: RecordingBounds;
}

export interface Size {
	width: number;
	height: number;
}

export interface Point {
	x: number;
	y: number;
}

/**
 * Screen rectangle (desktop DIPs) whose pixels the selected source records, or
 * null when it cannot be known or is not a fixed screen area. Window capture
 * records only that window's own content, and the Wayland portal picks its
 * monitor outside the app, so neither can show the controls.
 */
export function getCapturedRect(
	source: CaptureSource | null,
	displays: CaptureDisplay[],
): RecordingBounds | null {
	if (!source || source.sourceType === "window" || source.id === LINUX_PORTAL_SCREEN_SOURCE_ID) {
		return null;
	}
	const { captureRegion } = source;
	if (captureRegion) {
		const { displayBounds } = captureRegion;
		return {
			x: displayBounds.x + captureRegion.x,
			y: displayBounds.y + captureRegion.y,
			width: captureRegion.width,
			height: captureRegion.height,
		};
	}
	const display = displays.find((candidate) => String(candidate.id) === source.display_id);
	return display ? { ...display.bounds } : null;
}

export function rectsIntersect(a: RecordingBounds, b: RecordingBounds): boolean {
	return (
		a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
	);
}

function contains(outer: RecordingBounds, inner: RecordingBounds): boolean {
	return (
		inner.x >= outer.x &&
		inner.y >= outer.y &&
		inner.x + inner.width <= outer.x + outer.width &&
		inner.y + inner.height <= outer.y + outer.height
	);
}

function centeredOn(area: RecordingBounds, size: Size): number {
	return Math.round(area.x + (area.width - size.width) / 2);
}

export function getTopCenter(area: RecordingBounds, size: Size, margin: number): Point {
	return { x: centeredOn(area, size), y: area.y + margin };
}

/**
 * Top-left of a `size` box that fits in one of the work areas without touching
 * `avoid`, or null when the recording covers every usable spot. Work areas the
 * recording does not touch are tried first, then the top and bottom edges of
 * a display that only part of the recording covers.
 */
export function findPositionOutside(
	avoid: RecordingBounds,
	workAreas: RecordingBounds[],
	size: Size,
	margin: number,
): Point | null {
	const untouchedFirst = [...workAreas].sort(
		(a, b) => Number(rectsIntersect(a, avoid)) - Number(rectsIntersect(b, avoid)),
	);
	for (const area of untouchedFirst) {
		const candidates: Point[] = [
			getTopCenter(area, size, margin),
			{ x: centeredOn(area, size), y: area.y + area.height - size.height - margin },
		];
		const fit = candidates.find((point) => {
			const box = { ...point, ...size };
			return contains(area, box) && !rectsIntersect(box, avoid);
		});
		if (fit) return fit;
	}
	return null;
}
