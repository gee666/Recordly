import { describe, expect, it } from "vitest";
import { retimeSpan, rippleClipChainEdit } from "./clipRipple";
import type { ClipRegion } from "./types";

describe("rippleClipChainEdit", () => {
	const before: ClipRegion = { id: "before", startMs: 0, endMs: 1_000, speed: 1 };
	const target: ClipRegion = { id: "target", startMs: 1_000, endMs: 5_000, speed: 1 };
	const after: ClipRegion = { id: "after", startMs: 6_000, endMs: 8_000, speed: 1 };

	it("replaces the chain and moves only the clips after it", () => {
		const result = rippleClipChainEdit([after, before, target], {
			previous: [target],
			next: [{ ...target, endMs: 3_000, speed: 2 }],
		});

		expect(result.clipRegions).toEqual([
			before,
			{ ...target, endMs: 3_000, speed: 2 },
			{ ...after, startMs: 4_000, endMs: 6_000, sourceStartMs: 6_000 },
		]);
	});

	it("maps every timeline position to the same moment of footage", () => {
		const { retime } = rippleClipChainEdit([before, target, after], {
			previous: [target],
			next: [{ ...target, endMs: 3_000, speed: 2 }],
		});

		expect(retime(500)).toBe(500);
		expect(retime(3_000)).toBe(2_000);
		expect(retime(5_500)).toBe(3_500);
		expect(retime(7_000)).toBe(5_000);
	});
});

describe("retimeSpan", () => {
	it("keeps unchanged regions by reference and never collapses a region", () => {
		const region = { id: "zoom", startMs: 100, endMs: 200 };
		expect(retimeSpan(region, (timeMs) => timeMs)).toBe(region);
		expect(retimeSpan(region, () => 50)).toEqual({ id: "zoom", startMs: 50, endMs: 51 });
	});
});
