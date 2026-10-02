import { describe, expect, it } from "vitest";
import type { RecordingRegion } from "../src/lib/recordingRegion";
import {
	type CaptureDisplay,
	findPositionOutside,
	getCapturedRect,
	getTopCenter,
	rectsIntersect,
} from "./captureArea";

const left: CaptureDisplay = { id: 1, bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
const right: CaptureDisplay = { id: 2, bounds: { x: 1920, y: 0, width: 1280, height: 1024 } };

describe("getCapturedRect", () => {
	it("uses the bounds of the selected display", () => {
		expect(
			getCapturedRect({ id: "screen:1:0", display_id: "2", sourceType: "screen" }, [
				left,
				right,
			]),
		).toEqual(right.bounds);
	});

	it("offsets an area by its display origin", () => {
		const captureRegion: RecordingRegion = {
			x: 100,
			y: 50,
			width: 640,
			height: 480,
			displayId: "2",
			displayBounds: right.bounds,
		};
		expect(getCapturedRect({ display_id: "2", captureRegion }, [left, right])).toEqual({
			x: 2020,
			y: 50,
			width: 640,
			height: 480,
		});
	});

	it("treats window capture, the Wayland portal and unknown displays as not on screen", () => {
		expect(getCapturedRect(null, [left])).toBeNull();
		expect(getCapturedRect({ id: "window:42:0", sourceType: "window" }, [left])).toBeNull();
		expect(
			getCapturedRect({ id: "screen:linux-portal", display_id: "1", sourceType: "screen" }, [
				left,
			]),
		).toBeNull();
		expect(getCapturedRect({ display_id: "9", sourceType: "screen" }, [left])).toBeNull();
	});
});

describe("rectsIntersect", () => {
	const box = { x: 100, y: 100, width: 100, height: 100 };

	it("detects overlap", () => {
		expect(rectsIntersect(box, { x: 150, y: 150, width: 100, height: 100 })).toBe(true);
	});

	it("does not count touching edges", () => {
		expect(rectsIntersect(box, { x: 200, y: 100, width: 50, height: 50 })).toBe(false);
		expect(rectsIntersect(box, { x: 100, y: 200, width: 50, height: 50 })).toBe(false);
	});
});

describe("findPositionOutside", () => {
	const size = { width: 400, height: 60 };
	const margin = 20;

	it("prefers a display the recording does not touch", () => {
		expect(findPositionOutside(left.bounds, [left.bounds, right.bounds], size, margin)).toEqual(
			getTopCenter(right.bounds, size, margin),
		);
	});

	it("uses the bottom edge of a display when an area covers the top", () => {
		const area = { x: 400, y: 0, width: 800, height: 700 };
		expect(findPositionOutside(area, [left.bounds], size, margin)).toEqual({ x: 760, y: 1000 });
	});

	it("uses the top edge when an area only covers the bottom", () => {
		const area = { x: 400, y: 300, width: 800, height: 780 };
		expect(findPositionOutside(area, [left.bounds], size, margin)).toEqual({ x: 760, y: 20 });
	});

	it("returns null when the recording leaves no room", () => {
		expect(findPositionOutside(left.bounds, [left.bounds], size, margin)).toBeNull();
	});
});
