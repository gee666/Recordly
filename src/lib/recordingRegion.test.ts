import { describe, expect, it } from "vitest";
import {
	normalizeRecordingRegion,
	getRecordingRegionCrop,
	getRecordingRegionDesktopBounds,
	getRecordingRegionOutlineBounds,
	getRecordingRegionFromDesktopDrag,
	getRecordingOverlayGaps,
} from "./recordingRegion";

const display = { x: -1920, y: -240, width: 1920, height: 1080 };

describe("desktop drag ownership", () => {
	it("keeps negative-origin desktop DIPs local to the display where dragging began", () => {
		expect(
			getRecordingRegionFromDesktopDrag(
				{ x: -1800, y: -100 },
				{ x: -1400, y: 200 },
				"left",
				display,
			),
		).toEqual({
			x: 120,
			y: 140,
			width: 400,
			height: 300,
			displayId: "left",
			displayBounds: display,
		});
	});
	it("clamps an end point across the monitor boundary instead of choosing the ending monitor", () => {
		expect(
			getRecordingRegionFromDesktopDrag(
				{ x: -100, y: 100 },
				{ x: 500, y: 400 },
				"left",
				display,
			),
		).toMatchObject({ displayId: "left", x: 1820, y: 340, width: 100, height: 300 });
	});
	it("clamps a reverse drag above and left of the starting display", () => {
		expect(
			getRecordingRegionFromDesktopDrag(
				{ x: -1600, y: -100 },
				{ x: -2500, y: -600 },
				"left",
				display,
			),
		).toMatchObject({ x: 0, y: 0, width: 320, height: 140 });
	});
	it("rejects a drag whose start does not belong to the display, or has invalid coordinates", () => {
		expect(
			getRecordingRegionFromDesktopDrag(
				{ x: 100, y: 100 },
				{ x: -500, y: 100 },
				"left",
				display,
			),
		).toBeNull();
		expect(
			getRecordingRegionFromDesktopDrag(
				{ x: -100, y: 100 },
				{ x: Infinity, y: 400 },
				"left",
				display,
			),
		).toBeNull();
	});
});

describe("X11 overlay edge coverage", () => {
	it("adds no extra windows when the primary overlay covers the display", () => {
		expect(getRecordingOverlayGaps(display, display)).toEqual([]);
	});
	it("covers every pixel exactly once when Chromium clips the last row and column", () => {
		const area = { x: -20, y: -16, width: 20, height: 16 };
		const primary = { ...area, width: 19, height: 15 };
		const gaps = getRecordingOverlayGaps(area, primary);
		expect(gaps).toHaveLength(3);
		for (const gap of gaps) {
			expect(gap.width).toBeLessThan(area.width);
			expect(gap.height).toBeLessThan(area.height);
		}
		for (let y = area.y; y < 0; y++)
			for (let x = area.x; x < 0; x++) {
				expect(
					[primary, ...gaps].filter(
						(r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height,
					),
				).toHaveLength(1);
			}
	});
	it("fails closed if the native window cannot be positioned on the requested display", () => {
		expect(() =>
			getRecordingOverlayGaps(display, { x: 100, y: 100, width: 200, height: 200 }),
		).toThrow(/place the area picker/);
	});
});

describe("recording region geometry", () => {
	it("normalizes reverse drags on a monitor left of and above the primary display", () => {
		const region = normalizeRecordingRegion(
			{ x: 500, y: 400, width: -300, height: -200 },
			"secondary",
			display,
		)!;
		expect(region).toEqual({
			x: 200,
			y: 200,
			width: 300,
			height: 200,
			displayId: "secondary",
			displayBounds: display,
		});
		expect(getRecordingRegionDesktopBounds(region)).toEqual({
			x: -1720,
			y: -40,
			width: 300,
			height: 200,
		});
	});
	it("clamps to the selected monitor instead of spilling into a neighboring screen", () => {
		expect(
			normalizeRecordingRegion(
				{ x: 1800, y: 900, width: 500, height: 500 },
				"secondary",
				display,
			),
		).toMatchObject({ x: 1800, y: 900, width: 120, height: 180 });
	});
	it("rejects tiny and non-finite rectangles", () => {
		expect(
			normalizeRecordingRegion({ x: 10, y: 10, width: 2, height: 30 }, "secondary", display),
		).toBeNull();
		expect(
			normalizeRecordingRegion(
				{ x: NaN, y: 10, width: 100, height: 100 },
				"secondary",
				display,
			),
		).toBeNull();
	});
	it.each([
		[1920, 1080, 1],
		[3840, 2160, 2],
		[2880, 1620, 1.5],
	])("maps the chosen monitor to a %i × %i captured frame", (width, height, scale) => {
		const region = normalizeRecordingRegion(
			{ x: 200, y: 200, width: 600, height: 400 },
			"secondary",
			display,
		)!;
		expect(getRecordingRegionCrop(region, width, height)).toEqual({
			x: 200 * scale,
			y: 200 * scale,
			width: 600 * scale,
			height: 400 * scale,
		});
	});
	it("rounds fractional-DPI edges inward so outside outline pixels are not captured", () => {
		const region = normalizeRecordingRegion(
			{ x: 101, y: 101, width: 101, height: 101 },
			"secondary",
			display,
		)!;
		expect(getRecordingRegionCrop(region, 2880, 1620)).toEqual({
			x: 152,
			y: 152,
			width: 151,
			height: 151,
		});
	});
	it("puts every outline strip strictly outside the recorded rectangle", () => {
		const region = normalizeRecordingRegion(
			{ x: 0, y: 0, width: 600, height: 400 },
			"secondary",
			display,
		)!;
		const area = getRecordingRegionDesktopBounds(region);
		const strips = getRecordingRegionOutlineBounds(region);
		expect(strips).toHaveLength(4);
		for (const strip of strips) {
			const overlapWidth =
				Math.min(area.x + area.width, strip.x + strip.width) - Math.max(area.x, strip.x);
			const overlapHeight =
				Math.min(area.y + area.height, strip.y + strip.height) - Math.max(area.y, strip.y);
			expect(overlapWidth <= 0 || overlapHeight <= 0).toBe(true);
		}
	});
});
