import { afterEach, describe, expect, it, vi } from "vitest";
import { cropRecordingStream, getRecordingRegion, getRegionCropPixels } from "./regionCapture";
import type { RecordingRegion } from "@/lib/recordingRegion";

const region: RecordingRegion = {
	x: 100,
	y: 50,
	width: 800,
	height: 600,
	displayId: "secondary",
	displayBounds: { x: -1920, y: -100, width: 1920, height: 1080 },
};
const source = { id: "screen:42:0", display_id: "secondary", captureRegion: region };

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("recording region validation and pixel conversion", () => {
	it("leaves whole-screen sources unchanged", () => {
		expect(getRecordingRegion({ id: "screen:42:0" })).toBeNull();
	});
	it("snapshots the rectangle and its display bounds", () => {
		const snapshot = getRecordingRegion(source)!;
		expect(snapshot).toEqual(region);
		expect(snapshot).not.toBe(region);
		expect(snapshot.displayBounds).not.toBe(region.displayBounds);
	});
	it.each([
		"window:42:0",
		"screen:linux-portal",
		"screen:fallback:42",
	])("rejects an ambiguous/non-monitor source %s before capture", (id) => {
		expect(() => getRecordingRegion({ ...source, id })).toThrow("specific monitor");
	});
	it("rejects region metadata belonging to a different display", () => {
		expect(() => getRecordingRegion({ ...source, display_id: "primary" })).toThrow(
			"different monitor",
		);
	});
	it.each([
		{ x: -1 },
		{ y: -1 },
		{ width: 2000 },
		{ height: 1500 },
		{ width: 0 },
		{ x: Number.NaN },
		{ width: Number.POSITIVE_INFINITY },
		{ displayBounds: undefined },
	])("rejects invalid bounds %j instead of recording an uncropped monitor", (change) => {
		expect(() =>
			getRecordingRegion({ ...source, captureRegion: { ...region, ...change } }),
		).toThrow();
	});
	it.each([
		1, 1.25, 2,
	])("uses captured dimensions, including %s scale on a negative-origin secondary monitor", (scale) => {
		const pixels = getRegionCropPixels(region, 1920 * scale, 1080 * scale);
		expect(pixels.x).toBe(100 * scale);
		expect(pixels.y).toBe(Math.ceil(50 * scale));
		expect(pixels.width).toBe(800 * scale);
		expect(pixels.height % 2).toBe(0);
		expect(pixels.y + pixels.height).toBeLessThanOrEqual(650 * scale);
	});
	it("maps a primary-monitor rectangle independently of desktop origin", () => {
		expect(
			getRegionCropPixels(
				{ ...region, displayBounds: { ...region.displayBounds, x: 0, y: 0 } },
				1920,
				1080,
			),
		).toEqual({ x: 100, y: 50, width: 800, height: 600 });
	});
	it("rounds inward and aligns output to even pixels without including outline strips", () => {
		const crop = getRegionCropPixels(
			{ ...region, x: 100.5, y: 50.5, width: 801, height: 601 },
			2400,
			1350,
		);
		expect(crop.x).toBeGreaterThanOrEqual(100.5 * 1.25);
		expect(crop.y).toBeGreaterThanOrEqual(50.5 * 1.25);
		expect(crop.x + crop.width).toBeLessThanOrEqual(901.5 * 1.25);
		expect(crop.y + crop.height).toBeLessThanOrEqual(651.5 * 1.25);
		expect(crop.width % 2).toBe(0);
		expect(crop.height % 2).toBe(0);
	});
	it("rejects unusable dimensions and areas", () => {
		expect(() => getRegionCropPixels(region, 0, 0)).toThrow("no usable video");
		expect(() => getRegionCropPixels({ ...region, width: 1 }, 1920, 1080)).toThrow("too small");
	});
});

function setup() {
	const sourceVideoTrack = Object.assign(new EventTarget(), {
		kind: "video",
		readyState: "live",
		stop: vi.fn(),
	});
	const audioTrack = { kind: "audio", stop: vi.fn() };
	const croppedTrack = { kind: "video", stop: vi.fn() };
	class MockStream {
		constructor(private tracks: (typeof audioTrack)[]) {}
		getTracks() {
			return this.tracks;
		}
		getVideoTracks() {
			return this.tracks.filter((track) => track.kind === "video");
		}
		getAudioTracks() {
			return this.tracks.filter((track) => track.kind === "audio");
		}
	}
	vi.stubGlobal("MediaStream", MockStream);
	const input = new MockStream([sourceVideoTrack, audioTrack]) as unknown as MediaStream;
	const drawImage = vi.fn();
	const video = {
		play: vi.fn().mockResolvedValue(undefined),
		pause: vi.fn(),
		videoWidth: 3840,
		videoHeight: 2160,
		srcObject: null,
		requestVideoFrameCallback: vi.fn().mockReturnValue(1),
		cancelVideoFrameCallback: vi.fn(),
	};
	const canvas = {
		width: 0,
		height: 0,
		getContext: vi.fn().mockReturnValue({ drawImage }),
		captureStream: vi.fn().mockReturnValue(new MockStream([croppedTrack])),
	};
	vi.stubGlobal("document", {
		createElement: (tag: string) => (tag === "video" ? video : canvas),
	});
	return { input, sourceVideoTrack, audioTrack, croppedTrack, video, canvas, drawImage };
}

describe("region stream lifecycle", () => {
	it("records only the region and preserves original audio tracks", async () => {
		const { input, audioTrack, sourceVideoTrack, croppedTrack, video, canvas, drawImage } =
			setup();
		const result = await cropRecordingStream(input, region);
		expect(canvas.width).toBe(1600);
		expect(canvas.height).toBe(1200);
		expect(drawImage).toHaveBeenCalledExactlyOnceWith(
			video,
			200,
			100,
			1600,
			1200,
			0,
			0,
			1600,
			1200,
		);
		expect(result.stream.getTracks()).toEqual([croppedTrack, audioTrack]);
		expect(canvas.captureStream).toHaveBeenCalledWith(60);
		result.dispose();
		result.dispose();
		expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(1);
		expect(video.srcObject).toBeNull();
		expect(croppedTrack.stop).toHaveBeenCalledOnce();
		expect(sourceVideoTrack.stop).not.toHaveBeenCalled();
		expect(audioTrack.stop).not.toHaveBeenCalled();
	});
	it("cleans up a failed playback start without stopping caller-owned input tracks", async () => {
		const { input, video, sourceVideoTrack } = setup();
		video.play.mockRejectedValue(new Error("source unavailable"));
		await expect(cropRecordingStream(input, region)).rejects.toThrow("source unavailable");
		expect(video.pause).toHaveBeenCalledOnce();
		expect(video.srcObject).toBeNull();
		expect(sourceVideoTrack.stop).not.toHaveBeenCalled();
	});
	it("fails closed when canvas capture is unavailable", async () => {
		const { input, video, canvas } = setup();
		canvas.getContext.mockReturnValue(null);
		await expect(cropRecordingStream(input, region)).rejects.toThrow("unavailable");
		expect(canvas.captureStream).not.toHaveBeenCalled();
		expect(video.srcObject).toBeNull();
	});
	it("disposes canvas output when the original source ends, without assuming output stop emits ended", async () => {
		const { input, sourceVideoTrack, video, croppedTrack, audioTrack } = setup();
		const result = await cropRecordingStream(input, region);
		sourceVideoTrack.readyState = "ended";
		sourceVideoTrack.dispatchEvent(new Event("ended"));
		expect(croppedTrack.stop).toHaveBeenCalledOnce();
		expect(video.cancelVideoFrameCallback).toHaveBeenCalledWith(1);
		expect(video.srcObject).toBeNull();
		// The owner must stop the recorder/audio explicitly; crop helper doesn't own audio.
		expect(audioTrack.stop).not.toHaveBeenCalled();
		result.dispose();
		sourceVideoTrack.dispatchEvent(new Event("ended"));
		expect(croppedTrack.stop).toHaveBeenCalledOnce();
	});

	it("rejects promptly if source ends while playback is still initializing", async () => {
		const { input, sourceVideoTrack, video, canvas } = setup();
		video.play.mockReturnValue(new Promise(() => {}));
		const result = cropRecordingStream(input, region);
		sourceVideoTrack.readyState = "ended";
		sourceVideoTrack.dispatchEvent(new Event("ended"));
		await expect(result).rejects.toThrow("Screen sharing ended");
		expect(canvas.captureStream).not.toHaveBeenCalled();
		expect(video.srcObject).toBeNull();
	});

	it("rejects an already-ended source before starting its player", async () => {
		const { input, sourceVideoTrack, video } = setup();
		sourceVideoTrack.readyState = "ended";
		await expect(cropRecordingStream(input, region)).rejects.toThrow(
			"Screen sharing has ended",
		);
		expect(video.play).not.toHaveBeenCalled();
	});

	it("times out and releases its player when the source never starts", async () => {
		vi.useFakeTimers();
		const { input, video } = setup();
		video.play.mockReturnValue(new Promise(() => {}));
		const rejected = expect(cropRecordingStream(input, region)).rejects.toThrow("Timed out");
		await vi.advanceTimersByTimeAsync(10000);
		await rejected;
		expect(video.srcObject).toBeNull();
	});
});
