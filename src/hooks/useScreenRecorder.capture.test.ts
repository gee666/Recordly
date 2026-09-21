import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({
	effects: [] as Array<() => unknown>,
	states: [] as unknown[],
	refs: [] as Array<{ current: unknown }>,
	stateIndex: 0,
	refIndex: 0,
}));
// Minimal hook harness: exercise the production startup callbacks and asynchronous
// preference hydration without needing a browser/DOM or copying recording logic.
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
	useRef: (current: unknown) => {
		const index = lifecycle.refIndex++;
		lifecycle.refs[index] ??= { current };
		return lifecycle.refs[index];
	},
	useState: (initial: unknown) => {
		const index = lifecycle.stateIndex++;
		if (!(index in lifecycle.states)) lifecycle.states[index] = initial;
		return [
			lifecycle.states[index],
			(value: unknown) => {
				lifecycle.states[index] = value;
			},
		];
	},
	useEffect: (effect: () => unknown) => lifecycle.effects.push(effect),
}));
vi.mock("sonner", () => ({ toast: { warning: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { useScreenRecorder } from "./useScreenRecorder";
import * as regionCapture from "./regionCapture";

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

const source = { id: "screen:123:0", name: "Screen", display_id: "123" };
const prefs = {
	success: true,
	webcamEnabled: false,
	webcamDeviceId: "saved-camera",
	microphoneEnabled: false,
	systemAudioEnabled: false,
};

function setup() {
	const cameraError = new DOMException("cannot start video capture", "NotReadableError");
	const track = Object.assign(new EventTarget(), {
		readyState: "live",
		kind: "video",
		stop: vi.fn(() => {
			track.readyState = "ended";
		}), // stop() must NOT dispatch ended.
		applyConstraints: vi.fn().mockResolvedValue(undefined),
		getSettings: () => ({ width: 1920, height: 1080, frameRate: 60 }),
	});
	const screenStream = {
		getTracks: () => [track],
		getVideoTracks: () => [track],
		getAudioTracks: () => [],
	};
	const getUserMedia = vi.fn(async (constraints) => {
		if (constraints.video?.mandatory?.chromeMediaSource === "desktop") return screenStream;
		throw cameraError;
	});
	const api = {
		getPlatform: vi.fn().mockResolvedValue("linux"),
		getSelectedSource: vi.fn().mockResolvedValue(source),
		clearSourceHighlights: vi.fn().mockResolvedValue(undefined),
		getSources: vi.fn().mockResolvedValue([source]),
		getCountdownDelay: vi.fn().mockResolvedValue({ success: true, delay: 0 }),
		startCountdown: vi.fn().mockResolvedValue({ success: true }),
		getRecordingPreferences: vi.fn().mockResolvedValue(prefs),
		setRecordingPreferences: vi.fn().mockResolvedValue({ success: true }),
		setRecordingState: vi.fn().mockResolvedValue({ success: true }),
		isNativeWindowsCaptureAvailable: vi.fn().mockResolvedValue({ available: true }),
		startNativeScreenRecording: vi.fn().mockResolvedValue({ success: true }),
		pauseNativeScreenRecording: vi.fn().mockResolvedValue({ success: true }),
		resumeNativeScreenRecording: vi.fn().mockResolvedValue({ success: true }),
		onSelectedSourceChanged: vi.fn((_callback: (source: unknown) => void) => vi.fn()),
	};
	vi.stubGlobal("window", { electronAPI: api });
	vi.stubGlobal("navigator", { mediaDevices: { getUserMedia, getDisplayMedia: vi.fn() } });
	vi.stubGlobal("alert", vi.fn());
	vi.stubGlobal("document", { createElement: () => ({ canPlayType: () => "probably" }) });
	const recorders: Array<{
		state: string;
		stream: unknown;
		start: () => void;
		stop: ReturnType<typeof vi.fn>;
		onstop?: () => unknown;
	}> = [];
	vi.stubGlobal(
		"MediaRecorder",
		class {
			static isTypeSupported() {
				return true;
			}
			state = "inactive";
			constructor(public stream: unknown) {
				recorders.push(this);
			}
			start() {
				this.state = "recording";
			}
			onstop?: () => unknown;
			requestData = vi.fn();
			stop = vi.fn(() => {
				this.state = "inactive";
				queueMicrotask(() => {
					void this.onstop?.();
				});
			});
		},
	);
	return { api, getUserMedia, track, screenStream, recorders };
}

beforeEach(() => {
	lifecycle.effects = [];
	lifecycle.states = [];
	lifecycle.refs = [];
	lifecycle.stateIndex = 0;
	lifecycle.refIndex = 0;
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
	vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function rerender() {
	lifecycle.stateIndex = 0;
	lifecycle.refIndex = 0;
	return useScreenRecorder();
}

async function hydrate() {
	lifecycle.effects.forEach((effect) => {
		effect();
	});
	await Promise.resolve();
}

function cameraStream() {
	const track = { stop: vi.fn() };
	return { track, stream: { getTracks: () => [track] } };
}

describe("useScreenRecorder camera isolation", () => {
	it("starts X11 screen recording with webcam OFF even when the camera would be busy", async () => {
		const { api, getUserMedia } = setup();
		const hook = useScreenRecorder();
		await hydrate();
		hook.toggleRecording();
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(getUserMedia.mock.calls[0][0].video.mandatory.chromeMediaSource).toBe("desktop");
		expect(api.clearSourceHighlights.mock.invocationCallOrder[0]).toBeLessThan(
			getUserMedia.mock.invocationCallOrder[0],
		);
		expect(alert).not.toHaveBeenCalled();
	});

	it("does not let delayed saved webcam ON preferences override an explicit OFF click", async () => {
		const { api, getUserMedia } = setup();
		const load = deferred<typeof prefs>();
		api.getRecordingPreferences.mockReturnValue(load.promise);
		const hook = useScreenRecorder();
		await hydrate();
		hook.setWebcamEnabled(false);
		load.resolve({ ...prefs, webcamEnabled: true });
		await Promise.resolve();
		hook.toggleRecording();
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(getUserMedia.mock.calls[0][0].video.mandatory.chromeMediaSource).toBe("desktop");
	});

	it("uses the latest OFF setting even if a startup callback predates the toggle", async () => {
		const { api, getUserMedia } = setup();
		api.getRecordingPreferences.mockResolvedValue({ ...prefs, webcamEnabled: true });
		const hook = useScreenRecorder();
		await hydrate();
		hook.setWebcamEnabled(false);
		hook.toggleRecording();
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(alert).not.toHaveBeenCalled();
	});

	it("shows camera-specific Teams advice and aborts when the enabled webcam is busy", async () => {
		const { api, getUserMedia } = setup();
		const hook = useScreenRecorder();
		await hydrate();
		hook.setWebcamEnabled(true);
		hook.toggleRecording();
		await vi.waitFor(() =>
			expect(alert).toHaveBeenCalledWith(expect.stringMatching(/webcam.*Teams.*Webcam off/s)),
		);
		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(getUserMedia.mock.calls[0][0].video.deviceId).toEqual({ exact: "saved-camera" });
		expect(api.setRecordingState).not.toHaveBeenCalledWith(true);
	});

	it.each([
		"countdown",
		"screen",
	])("releases a prepared camera immediately when disabled during %s", async (stage) => {
		const { api, getUserMedia, screenStream, recorders } = setup();
		const camera = cameraStream();
		const pending = deferred<unknown>();
		getUserMedia.mockImplementation(async (constraints) =>
			constraints.video?.mandatory
				? ((stage === "screen"
						? await pending.promise
						: screenStream) as typeof screenStream)
				: (camera.stream as typeof screenStream),
		);
		if (stage === "countdown") api.startCountdown.mockReturnValue(pending.promise);
		const hook = useScreenRecorder();
		await hydrate();
		hook.setWebcamEnabled(true);
		hook.toggleRecording();
		await vi.waitFor(() =>
			stage === "countdown"
				? expect(api.startCountdown).toHaveBeenCalledOnce()
				: expect(getUserMedia).toHaveBeenCalledTimes(2),
		);
		hook.setWebcamEnabled(false);
		expect(camera.track.stop).toHaveBeenCalledOnce(); // Before countdown/capture resolves.
		pending.resolve(stage === "countdown" ? { success: true } : screenStream);
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		expect(recorders.find((recorder) => recorder.stream === camera.stream)?.state).toBe(
			"inactive",
		);
		expect(recorders.find((recorder) => recorder.stream === screenStream)?.state).toBe(
			"recording",
		);
	});

	it.each([
		"countdown",
		"screen",
	])("honors Webcam enabled after initial preparation during %s", async (stage) => {
		const { api, getUserMedia, screenStream, recorders } = setup();
		const camera = cameraStream();
		const pending = deferred<unknown>();
		getUserMedia.mockImplementation(async (constraints) =>
			constraints.video?.mandatory
				? ((stage === "screen"
						? await pending.promise
						: screenStream) as typeof screenStream)
				: (camera.stream as typeof screenStream),
		);
		if (stage === "countdown") api.startCountdown.mockReturnValue(pending.promise);
		const hook = useScreenRecorder();
		await hydrate();
		hook.toggleRecording();
		await vi.waitFor(() =>
			stage === "countdown"
				? expect(api.startCountdown).toHaveBeenCalledOnce()
				: expect(getUserMedia).toHaveBeenCalledOnce(),
		);
		hook.setWebcamEnabled(true);
		pending.resolve(stage === "countdown" ? { success: true } : screenStream);
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		expect(recorders.find((recorder) => recorder.stream === camera.stream)?.state).toBe(
			"recording",
		);
		expect(getUserMedia).toHaveBeenCalledTimes(2);
		expect(alert).not.toHaveBeenCalled();
	});

	it("replaces the prepared camera after device selection changes during countdown", async () => {
		const { api, getUserMedia, screenStream, recorders } = setup();
		const oldCamera = cameraStream();
		const newCamera = cameraStream();
		const pending = deferred<unknown>();
		getUserMedia.mockImplementation(async (constraints) =>
			constraints.video?.mandatory
				? screenStream
				: ((constraints.video.deviceId.exact === "new-camera"
						? newCamera.stream
						: oldCamera.stream) as typeof screenStream),
		);
		api.startCountdown.mockReturnValue(pending.promise);
		const hook = useScreenRecorder();
		await hydrate();
		hook.setWebcamEnabled(true);
		hook.toggleRecording();
		await vi.waitFor(() => expect(api.startCountdown).toHaveBeenCalledOnce());
		hook.setWebcamDeviceId("new-camera");
		expect(oldCamera.track.stop).toHaveBeenCalledOnce();
		pending.resolve({ success: true });
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		expect(recorders.find((recorder) => recorder.stream === newCamera.stream)?.state).toBe(
			"recording",
		);
		expect(recorders.find((recorder) => recorder.stream === oldCamera.stream)?.state).toBe(
			"inactive",
		);
	});

	it("discards an obsolete in-flight camera and acquires the latest device", async () => {
		const { api, getUserMedia, screenStream, recorders } = setup();
		const pending = deferred<unknown>();
		const oldCamera = cameraStream();
		const newCamera = cameraStream();
		getUserMedia.mockImplementation(async (constraints) =>
			constraints.video?.mandatory
				? screenStream
				: ((constraints.video.deviceId.exact === "new-camera"
						? newCamera.stream
						: await pending.promise) as typeof screenStream),
		);
		const hook = useScreenRecorder();
		await hydrate();
		hook.setWebcamEnabled(true);
		hook.toggleRecording();
		await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
		hook.setWebcamDeviceId("new-camera");
		pending.resolve(oldCamera.stream);
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		expect(oldCamera.track.stop).toHaveBeenCalledOnce();
		expect(recorders.find((recorder) => recorder.stream === newCamera.stream)?.state).toBe(
			"recording",
		);
		expect(recorders.some((recorder) => recorder.stream === oldCamera.stream)).toBe(false);
	});

	it.each([
		false,
		true,
	])("reconciles native warm-start countdown when Webcam changes to %s", async (enabled) => {
		const { api, getUserMedia, recorders } = setup();
		api.getPlatform.mockResolvedValue("win32");
		const camera = cameraStream();
		getUserMedia.mockResolvedValue(camera.stream as never);
		const countdown = deferred<unknown>();
		api.startCountdown.mockReturnValue(countdown.promise);
		const hook = useScreenRecorder();
		await hydrate();
		hook.setWebcamEnabled(!enabled);
		hook.toggleRecording();
		await vi.waitFor(() => expect(api.startCountdown).toHaveBeenCalledOnce());
		hook.setWebcamEnabled(enabled);
		if (!enabled) expect(camera.track.stop).toHaveBeenCalledOnce();
		countdown.resolve({ success: true });
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		expect(api.startNativeScreenRecording).toHaveBeenCalledOnce();
		expect(
			recorders.some(
				(recorder) => recorder.stream === camera.stream && recorder.state === "recording",
			),
		).toBe(enabled);
	});

	it("releases a camera acquired after Webcam was turned off and continues screen-only", async () => {
		const { api, getUserMedia } = setup();
		const cameraDevice = cameraStream();
		const camera = deferred<unknown>();
		getUserMedia.mockImplementationOnce(() => camera.promise as Promise<never>);
		const hook = useScreenRecorder();
		await hydrate();
		hook.setWebcamEnabled(true);
		hook.toggleRecording();
		await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
		hook.setWebcamEnabled(false);
		camera.resolve(cameraDevice.stream);
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		expect(cameraDevice.track.stop).toHaveBeenCalledOnce();
		expect(getUserMedia).toHaveBeenCalledTimes(2);
		expect(alert).not.toHaveBeenCalled();
	});
});

const captureRegion = {
	x: 100,
	y: 50,
	width: 800,
	height: 600,
	displayId: "123",
	displayBounds: { x: -1920, y: 0, width: 1920, height: 1080 },
};

describe("useScreenRecorder source selection lock", () => {
	it("exposes a startup lock before source preparation and keeps it through countdown and capture", async () => {
		const { api, getUserMedia, screenStream } = setup();
		const sourceRequest = deferred<unknown>();
		const countdown = deferred<unknown>();
		const screen = deferred<typeof screenStream>();
		api.getSelectedSource.mockReturnValue(sourceRequest.promise);
		api.startCountdown.mockReturnValue(countdown.promise);
		getUserMedia.mockReturnValue(screen.promise);
		const hook = useScreenRecorder();
		await hydrate();
		expect(hook.isStartingRecording).toBe(false);
		hook.toggleRecording();
		expect(rerender().isStartingRecording).toBe(true);
		expect(rerender().recording).toBe(false);
		sourceRequest.resolve(source);
		await vi.waitFor(() => expect(api.startCountdown).toHaveBeenCalledOnce());
		expect(rerender().isStartingRecording).toBe(true);
		countdown.resolve({ success: true });
		await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
		expect(rerender().isStartingRecording).toBe(true);
		screen.resolve(screenStream);
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		expect(rerender().isStartingRecording).toBe(false);
		expect(rerender().recording).toBe(true);
	});

	it("releases the startup lock after preparation fails", async () => {
		const { api } = setup();
		api.getSelectedSource.mockRejectedValue(new Error("source disconnected"));
		const hook = useScreenRecorder();
		await hydrate();
		hook.toggleRecording();
		expect(rerender().isStartingRecording).toBe(true);
		await vi.waitFor(() => expect(rerender().isStartingRecording).toBe(false));
		expect(rerender().recording).toBe(false);
	});

	it.each([
		"monitor",
		"rectangle",
	])("aborts a late %s selection change instead of recording a stale snapshot", async (change) => {
		const { api, getUserMedia } = setup();
		api.getSelectedSource.mockResolvedValue({ ...source, captureRegion });
		const countdown = deferred<unknown>();
		api.startCountdown.mockReturnValue(countdown.promise);
		const hook = useScreenRecorder();
		await hydrate();
		hook.toggleRecording();
		await vi.waitFor(() => expect(api.startCountdown).toHaveBeenCalledOnce());
		const changed =
			change === "monitor"
				? { ...source, id: "screen:456:0" }
				: { ...source, captureRegion: { ...captureRegion, x: 150 } };
		api.onSelectedSourceChanged.mock.calls[0][0](changed);
		countdown.resolve({ success: true });
		await vi.waitFor(() => expect(rerender().isStartingRecording).toBe(false));
		expect(getUserMedia).not.toHaveBeenCalled();
		expect(api.setRecordingState).toHaveBeenCalledWith(false);
		expect(api.setRecordingState).not.toHaveBeenCalledWith(true);
		expect(api.onSelectedSourceChanged.mock.results[0].value).toHaveBeenCalledOnce();
	});

	it("ignores name/thumbnail refreshes of the same source", async () => {
		const { api } = setup();
		const countdown = deferred<unknown>();
		api.startCountdown.mockReturnValue(countdown.promise);
		const hook = useScreenRecorder();
		await hydrate();
		hook.toggleRecording();
		await vi.waitFor(() => expect(api.startCountdown).toHaveBeenCalledOnce());
		api.onSelectedSourceChanged.mock.calls[0][0]({ ...source, name: "Refreshed screen" });
		countdown.resolve({ success: true });
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
	});
});

describe("useScreenRecorder screen sharing ended", () => {
	it("explicitly stops the raw desktop recorder and resets main recording state", async () => {
		const { api, track, recorders } = setup();
		const hook = useScreenRecorder();
		await hydrate();
		hook.toggleRecording();
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		track.readyState = "ended";
		track.dispatchEvent(new Event("ended"));
		expect(recorders[0].stop).toHaveBeenCalledOnce();
		expect(track.stop).toHaveBeenCalled();
		expect(api.setRecordingState).toHaveBeenLastCalledWith(false);
		expect(rerender().recording).toBe(false);
		track.dispatchEvent(new Event("ended"));
		expect(recorders[0].stop).toHaveBeenCalledOnce();
	});

	it.each([
		"ended",
		"onstop",
	])("resets recording state if the browser goes inactive before %s", async (signal) => {
		const { api, track, recorders } = setup();
		const hook = useScreenRecorder();
		await hydrate();
		hook.toggleRecording();
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		recorders[0].state = "inactive";
		if (signal === "ended") {
			track.readyState = "ended";
			track.dispatchEvent(new Event("ended"));
		} else {
			await recorders[0].onstop?.();
		}
		expect(recorders[0].stop).not.toHaveBeenCalled(); // stop() on inactive is illegal.
		expect(api.setRecordingState).toHaveBeenLastCalledWith(false);
		expect(rerender().recording).toBe(false);
		expect(track.stop).toHaveBeenCalled();
	});

	it("stops cropped recording and live microphone even though stopping canvas track emits no ended event", async () => {
		const { api, track, screenStream, getUserMedia, recorders } = setup();
		api.getSelectedSource.mockResolvedValue({ ...source, captureRegion });
		class MockStream {
			constructor(private tracks: Array<{ kind: string; stop: () => void }> = []) {}
			addTrack(track: { kind: string; stop: () => void }) {
				this.tracks.push(track);
			}
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
		const microphone = { kind: "audio", stop: vi.fn() };
		getUserMedia.mockImplementation(async (constraints) =>
			constraints.video === false ? (new MockStream([microphone]) as never) : screenStream,
		);
		const cropTrack = Object.assign(new EventTarget(), {
			kind: "video",
			stop: vi.fn(), // No ended event from stop().
			getSettings: () => ({ width: 800, height: 600, frameRate: 60 }),
		});
		const cropEnded = vi.fn();
		cropTrack.addEventListener("ended", cropEnded);
		const dispose = vi.fn(() => cropTrack.stop());
		vi.spyOn(regionCapture, "cropRecordingStream").mockResolvedValue({
			stream: new MockStream([cropTrack, microphone]) as never,
			dispose,
		});
		let hook = useScreenRecorder();
		await hydrate();
		hook.setMicrophoneEnabled(true);
		hook = rerender();
		hook.toggleRecording();
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		track.readyState = "ended";
		track.dispatchEvent(new Event("ended"));
		expect(recorders[0].stop).toHaveBeenCalledOnce();
		expect(dispose).toHaveBeenCalledOnce();
		expect(microphone.stop).toHaveBeenCalled();
		expect(cropEnded).not.toHaveBeenCalled();
		expect(api.setRecordingState).toHaveBeenLastCalledWith(false);
		expect(rerender().recording).toBe(false);
	});

	it("cancels startup when the screen ends during track configuration", async () => {
		const { api, track, recorders } = setup();
		const configuring = deferred<unknown>();
		track.applyConstraints.mockReturnValue(configuring.promise);
		const hook = useScreenRecorder();
		await hydrate();
		hook.toggleRecording();
		await vi.waitFor(() => expect(track.applyConstraints).toHaveBeenCalledOnce());
		track.readyState = "ended";
		track.dispatchEvent(new Event("ended"));
		configuring.resolve(undefined);
		await vi.waitFor(() => expect(rerender().isStartingRecording).toBe(false));
		expect(recorders).toHaveLength(0);
		expect(api.setRecordingState).toHaveBeenCalledWith(false);
		expect(api.setRecordingState).not.toHaveBeenCalledWith(true);
	});
});

describe("useScreenRecorder rectangle capture integration", () => {
	it("crops the selected monitor before constructing its recorder and bypasses native capture", async () => {
		const { api, screenStream, recorders } = setup();
		api.getPlatform.mockResolvedValue("win32");
		api.getSelectedSource.mockResolvedValue({ ...source, captureRegion });
		const croppedTrack = {
			stop: vi.fn(),
			getSettings: () => ({ width: 800, height: 600, frameRate: 60 }),
		};
		const cropped = {
			getTracks: () => [croppedTrack],
			getVideoTracks: () => [croppedTrack],
			getAudioTracks: () => [],
		};
		const crop = vi
			.spyOn(regionCapture, "cropRecordingStream")
			.mockResolvedValue({ stream: cropped as never, dispose: vi.fn() });
		const hook = useScreenRecorder();
		await hydrate();
		hook.toggleRecording();
		await vi.waitFor(() => expect(api.setRecordingState).toHaveBeenCalledWith(true));
		expect(crop).toHaveBeenCalledExactlyOnceWith(screenStream, captureRegion, 60);
		expect(recorders).toHaveLength(1);
		expect(recorders[0].stream).toBe(cropped);
		expect(api.startNativeScreenRecording).not.toHaveBeenCalled();
		expect(api.isNativeWindowsCaptureAvailable).not.toHaveBeenCalled();
	});

	it("cleans up the crop and original monitor if startup is cancelled while cropping initializes", async () => {
		const { api, screenStream, track, recorders } = setup();
		api.getSelectedSource.mockResolvedValue({ ...source, captureRegion });
		const pending = deferred<Awaited<ReturnType<typeof regionCapture.cropRecordingStream>>>();
		const crop = vi
			.spyOn(regionCapture, "cropRecordingStream")
			.mockReturnValue(pending.promise);
		const dispose = vi.fn();
		const hook = useScreenRecorder();
		await hydrate();
		hook.toggleRecording();
		await vi.waitFor(() => expect(crop).toHaveBeenCalledOnce());
		hook.cancelRecording();
		pending.resolve({ stream: screenStream as never, dispose });
		await vi.waitFor(() => expect(dispose).toHaveBeenCalledOnce());
		expect(track.stop).toHaveBeenCalled();
		expect(recorders).toHaveLength(0);
		expect(api.setRecordingState).not.toHaveBeenCalledWith(true);
	});

	it("fails closed on invalid region metadata without acquiring any media", async () => {
		const { api, getUserMedia } = setup();
		api.getSelectedSource.mockResolvedValue({
			...source,
			captureRegion: { ...captureRegion, width: 4000 },
		});
		const hook = useScreenRecorder();
		await hydrate();
		hook.toggleRecording();
		await vi.waitFor(() =>
			expect(alert).toHaveBeenCalledWith(expect.stringContaining("inside one monitor")),
		);
		expect(getUserMedia).not.toHaveBeenCalled();
		expect(api.setRecordingState).not.toHaveBeenCalledWith(true);
	});
});
