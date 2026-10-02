import { describe, expect, it } from "vitest";

import { formatClipSpeedLabel, planClipSpeedChange } from "./clipSpeedChange";

describe("formatClipSpeedLabel", () => {
	it("returns labels only for non-default positive speeds", () => {
		expect(formatClipSpeedLabel(1)).toBeNull();
		expect(formatClipSpeedLabel(0)).toBeNull();
		expect(formatClipSpeedLabel(-1)).toBeNull();
		expect(formatClipSpeedLabel(Number.POSITIVE_INFINITY)).toBeNull();
		expect(formatClipSpeedLabel(Number.NaN)).toBeNull();
		expect(formatClipSpeedLabel(0.5)).toBe("0.5x");
		expect(formatClipSpeedLabel(2)).toBe("2x");
	});
});

describe("planClipSpeedChange", () => {
	it("returns null for missing clips and invalid speeds", () => {
		const clipRegions = [{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 }];

		expect(
			planClipSpeedChange({ clipRegions, selectedClipId: "missing", speed: 0.5 }),
		).toBeNull();

		for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(
				planClipSpeedChange({ clipRegions, selectedClipId: "clip-1", speed }),
			).toBeNull();
		}
	});

	it("shortens a clip when speeding it up", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 6_000, speed: 1 }],
			selectedClipId: "clip-1",
			speed: 2,
		});

		expect(result?.clipRegions).toEqual([{ id: "clip-1", startMs: 0, endMs: 3_000, speed: 2 }]);
	});

	it("treats invalid stored clip speed as 1x", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 0, endMs: 4_000, speed: Number.NaN }],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		expect(result?.clipRegions).toEqual([
			{ id: "clip-1", startMs: 0, endMs: 8_000, speed: 0.5 },
		]);
	});

	it("pulls later clips in when speeding up, leaving no gap", () => {
		const result = planClipSpeedChange({
			clipRegions: [
				{ id: "clip-1", startMs: 0, endMs: 4_000, speed: 1 },
				{ id: "clip-2", startMs: 4_000, endMs: 6_000, speed: 1 },
			],
			selectedClipId: "clip-1",
			speed: 2,
		});

		expect(result?.clipRegions).toEqual([
			{ id: "clip-1", startMs: 0, endMs: 2_000, speed: 2 },
			{ id: "clip-2", startMs: 2_000, endMs: 4_000, sourceStartMs: 4_000, speed: 1 },
		]);
	});

	it("pushes later clips out when slowing down instead of overlapping them", () => {
		const result = planClipSpeedChange({
			clipRegions: [
				{ id: "clip-1", startMs: 0, endMs: 5_000, speed: 1 },
				{ id: "clip-2", startMs: 5_000, endMs: 10_000, speed: 1 },
			],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		expect(result?.clipRegions).toEqual([
			{ id: "clip-1", startMs: 0, endMs: 10_000, speed: 0.5 },
			{ id: "clip-2", startMs: 10_000, endMs: 15_000, sourceStartMs: 5_000, speed: 1 },
		]);
	});

	it("retimes positions inside the clip and shifts positions after it", () => {
		const result = planClipSpeedChange({
			clipRegions: [{ id: "clip-1", startMs: 1_000, endMs: 5_000, speed: 1 }],
			selectedClipId: "clip-1",
			speed: 0.5,
		});

		expect(result?.retime(500)).toBe(500);
		expect(result?.retime(2_000)).toBe(3_000);
		expect(result?.retime(5_000)).toBe(9_000);
		expect(result?.retime(6_000)).toBe(10_000);
	});
});
