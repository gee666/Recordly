import { describe, expect, it } from "vitest";
import { findSpeedSectionRoll, planSpeedSectionInsert, planSpeedSectionRoll } from "./speedSection";
import type { ClipRegion } from "./types";

function createIds() {
	let next = 10;
	return () => `clip-${next++}`;
}

function insertAt(clipRegions: ClipRegion[], atMs: number, sourceSpanMs = 4_000) {
	return planSpeedSectionInsert({
		clipRegions,
		atMs,
		speed: 2,
		sourceSpanMs,
		minDurationMs: 100,
		createId: createIds(),
	});
}

const recording: ClipRegion[] = [{ id: "clip-1", startMs: 0, endMs: 10_000, speed: 1 }];

describe("planSpeedSectionInsert", () => {
	it("carves a sped-up section at the playhead and ripples the rest in", () => {
		const plan = insertAt(recording, 3_000);
		if (plan.kind !== "inserted") throw new Error(`unexpected ${plan.kind}`);

		expect(plan.clipRegions).toEqual([
			{ id: "clip-10", startMs: 0, endMs: 3_000, speed: 1 },
			{ id: "clip-11", startMs: 3_000, endMs: 5_000, sourceStartMs: 3_000, speed: 2 },
			{ id: "clip-12", startMs: 5_000, endMs: 8_000, sourceStartMs: 7_000, speed: 1 },
		]);
		expect(plan.sectionId).toBe("clip-11");
		expect(plan.retime(2_000)).toBe(2_000);
		expect(plan.retime(5_000)).toBe(4_000);
		expect(plan.retime(9_000)).toBe(7_000);
	});

	it("shifts later clips, keeping their footage and the gaps between them", () => {
		const plan = insertAt(
			[
				{ id: "clip-1", startMs: 0, endMs: 6_000, speed: 1 },
				{ id: "clip-2", startMs: 7_000, endMs: 9_000, speed: 1 },
			],
			0,
		);
		if (plan.kind !== "inserted") throw new Error(`unexpected ${plan.kind}`);

		expect(plan.clipRegions.at(-1)).toEqual({
			id: "clip-2",
			startMs: 5_000,
			endMs: 7_000,
			sourceStartMs: 7_000,
			speed: 1,
		});
	});

	it("only covers the footage left in the clip", () => {
		const plan = insertAt(recording, 9_000);
		if (plan.kind !== "inserted") throw new Error(`unexpected ${plan.kind}`);

		expect(plan.clipRegions.at(-1)).toEqual({
			id: "clip-11",
			startMs: 9_000,
			endMs: 9_500,
			sourceStartMs: 9_000,
			speed: 2,
		});
	});

	it("selects the existing section instead of nesting speed-ups", () => {
		const clips: ClipRegion[] = [{ id: "fast", startMs: 0, endMs: 2_000, speed: 2 }];
		expect(insertAt(clips, 500)).toEqual({ kind: "existing", sectionId: "fast" });
	});

	it("refuses gaps and slivers too short to edit", () => {
		expect(insertAt(recording, 12_000)).toEqual({ kind: "blocked", reason: "no-clip" });
		expect(insertAt(recording, 9_900)).toEqual({ kind: "blocked", reason: "too-short" });
	});
});

describe("speed section edge rolls", () => {
	const plan = insertAt(recording, 3_000);
	if (plan.kind !== "inserted") throw new Error(`unexpected ${plan.kind}`);
	const clips = plan.clipRegions;

	it("grows the section over the following footage when its end is dragged right", () => {
		const roll = findSpeedSectionRoll(clips, "clip-11", { start: 3_000, end: 6_000 });
		if (!roll) throw new Error("expected a roll");
		const result = planSpeedSectionRoll(clips, roll, 100);

		expect(result?.clipRegions.slice(1)).toEqual([
			{ id: "clip-11", startMs: 3_000, endMs: 6_000, sourceStartMs: 3_000, speed: 2 },
			{ id: "clip-12", startMs: 6_000, endMs: 7_000, sourceStartMs: 9_000, speed: 1 },
		]);
		expect(result?.retime(7_000)).toBe(6_000);
	});

	it("grows the section over the preceding footage when its start is dragged left", () => {
		const roll = findSpeedSectionRoll(clips, "clip-11", { start: 1_000, end: 5_000 });
		if (!roll) throw new Error("expected a roll");
		const result = planSpeedSectionRoll(clips, roll, 100);

		expect(result?.clipRegions).toEqual([
			{ id: "clip-10", startMs: 0, endMs: 1_000, speed: 1 },
			{ id: "clip-11", startMs: 1_000, endMs: 4_000, sourceStartMs: 1_000, speed: 2 },
			{ id: "clip-12", startMs: 4_000, endMs: 7_000, sourceStartMs: 7_000, speed: 1 },
		]);
	});

	it("keeps the neighbour from being consumed entirely", () => {
		const roll = findSpeedSectionRoll(clips, "clip-11", { start: 3_000, end: 20_000 });
		if (!roll) throw new Error("expected a roll");
		const result = planSpeedSectionRoll(clips, roll, 100);

		expect(result?.clipRegions.at(-1)).toMatchObject({ sourceStartMs: 9_900 });
	});

	it("leaves moves, 1x clips and isolated sections to the normal clip edit", () => {
		expect(findSpeedSectionRoll(clips, "clip-11", { start: 3_500, end: 5_500 })).toBeNull();
		expect(findSpeedSectionRoll(clips, "clip-12", { start: 4_000, end: 8_000 })).toBeNull();
		const isolated: ClipRegion[] = [{ id: "fast", startMs: 0, endMs: 2_000, speed: 2 }];
		expect(findSpeedSectionRoll(isolated, "fast", { start: 0, end: 3_000 })).toBeNull();
	});
});
