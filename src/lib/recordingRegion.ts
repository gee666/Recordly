export interface RecordingPoint {
	x: number;
	y: number;
}

export interface RecordingBounds {
	x: number;
	y: number;
	width: number;
	height: number;
}

/** All coordinates are Electron DIPs. The rectangle is local to this display. */
export interface RecordingRegion extends RecordingBounds {
	displayId: string;
	displayBounds: RecordingBounds;
}

export function normalizeRecordingRegion(
	bounds: RecordingBounds,
	displayId: string,
	displayBounds: RecordingBounds,
): RecordingRegion | null {
	if (
		![
			bounds.x,
			bounds.y,
			bounds.width,
			bounds.height,
			displayBounds.x,
			displayBounds.y,
			displayBounds.width,
			displayBounds.height,
		].every(Number.isFinite) ||
		displayBounds.width <= 0 ||
		displayBounds.height <= 0
	)
		return null;
	const x = Math.max(0, Math.round(Math.min(bounds.x, bounds.x + bounds.width)));
	const y = Math.max(0, Math.round(Math.min(bounds.y, bounds.y + bounds.height)));
	const right = Math.min(
		displayBounds.width,
		Math.round(Math.max(bounds.x, bounds.x + bounds.width)),
	);
	const bottom = Math.min(
		displayBounds.height,
		Math.round(Math.max(bounds.y, bounds.y + bounds.height)),
	);
	if (right - x < 16 || bottom - y < 16) return null;
	return {
		x,
		y,
		width: right - x,
		height: bottom - y,
		displayId,
		displayBounds: { ...displayBounds },
	};
}

/** The starting monitor owns the gesture. Leaving it clamps the crop instead of
 * switching displays or spanning a mixed-DPI desktop. Inputs are desktop DIPs.
 */
export function getRecordingRegionFromDesktopDrag(
	start: RecordingPoint,
	end: RecordingPoint,
	displayId: string,
	displayBounds: RecordingBounds,
): RecordingRegion | null {
	if (
		start.x < displayBounds.x ||
		start.y < displayBounds.y ||
		start.x >= displayBounds.x + displayBounds.width ||
		start.y >= displayBounds.y + displayBounds.height
	)
		return null;
	return normalizeRecordingRegion(
		{
			x: start.x - displayBounds.x,
			y: start.y - displayBounds.y,
			width: end.x - start.x,
			height: end.y - start.y,
		},
		displayId,
		displayBounds,
	);
}

/** Chromium/X11 can constrain a display-sized popup to (width - 1, height - 1).
 * Cover any remaining pixels with smaller input-catching strips, without changing
 * the coordinate system of the display or leaving clicks to the underlying app.
 */
export function getRecordingOverlayGaps(
	display: RecordingBounds,
	covered: RecordingBounds,
): RecordingBounds[] {
	const left = Math.max(display.x, covered.x);
	const top = Math.max(display.y, covered.y);
	const right = Math.min(display.x + display.width, covered.x + covered.width);
	const bottom = Math.min(display.y + display.height, covered.y + covered.height);
	if (right <= left || bottom <= top)
		throw new Error("Could not place the area picker on its display");
	const gaps = [
		{ x: display.x, y: display.y, width: display.width, height: top - display.y },
		{
			x: display.x,
			y: bottom,
			width: display.width,
			height: display.y + display.height - bottom,
		},
		{ x: display.x, y: top, width: left - display.x, height: bottom - top },
		{ x: right, y: top, width: display.x + display.width - right, height: bottom - top },
	];
	const result: RecordingBounds[] = [];
	const maxWidth = Math.max(1, display.width - 1),
		maxHeight = Math.max(1, display.height - 1);
	for (const gap of gaps) {
		for (let y = gap.y; y < gap.y + gap.height; y += maxHeight) {
			for (let x = gap.x; x < gap.x + gap.width; x += maxWidth) {
				result.push({
					x,
					y,
					width: Math.min(maxWidth, gap.x + gap.width - x),
					height: Math.min(maxHeight, gap.y + gap.height - y),
				});
			}
		}
	}
	return result;
}

export function getRecordingRegionDesktopBounds(region: RecordingRegion): RecordingBounds {
	return {
		x: region.displayBounds.x + region.x,
		y: region.displayBounds.y + region.y,
		width: region.width,
		height: region.height,
	};
}

/** Map DIPs to the actual captured frame, not the primary display's scale factor. */
export function getRecordingRegionCrop(
	region: RecordingRegion,
	frameWidth: number,
	frameHeight: number,
): RecordingBounds {
	if (
		![
			frameWidth,
			frameHeight,
			region.x,
			region.y,
			region.width,
			region.height,
			region.displayBounds.width,
			region.displayBounds.height,
		].every(Number.isFinite) ||
		frameWidth <= 0 ||
		frameHeight <= 0 ||
		region.displayBounds.width <= 0 ||
		region.displayBounds.height <= 0
	) {
		throw new Error("Invalid recording region frame dimensions");
	}
	const scaleX = frameWidth / region.displayBounds.width;
	const scaleY = frameHeight / region.displayBounds.height;
	// Round inward so a fractional-DPI border outside the rectangle cannot enter the crop.
	const x = Math.max(0, Math.ceil(region.x * scaleX));
	const y = Math.max(0, Math.ceil(region.y * scaleY));
	const right = Math.min(frameWidth, Math.floor((region.x + region.width) * scaleX));
	const bottom = Math.min(frameHeight, Math.floor((region.y + region.height) * scaleY));
	if (right <= x || bottom <= y)
		throw new Error("Recording region is outside the captured display");
	return { x, y, width: right - x, height: bottom - y };
}

/** Four separate strips: no border/shadow pixel is painted inside the capture. */
export function getRecordingRegionOutlineBounds(
	region: RecordingRegion,
	thickness = 3,
): RecordingBounds[] {
	const { x, y, width, height } = getRecordingRegionDesktopBounds(region);
	return [
		{ x: x - thickness, y: y - thickness, width: width + thickness * 2, height: thickness },
		{ x: x - thickness, y: y + height, width: width + thickness * 2, height: thickness },
		{ x: x - thickness, y, width: thickness, height },
		{ x: x + width, y, width: thickness, height },
	];
}
