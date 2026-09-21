import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({ effects: [] as Array<() => (() => void) | undefined> }));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useCallback: (callback: unknown) => callback,
	useRef: (current: unknown) => ({ current }),
	useState: (initial: unknown) => [initial, vi.fn()],
	useEffect: (effect: () => (() => void) | undefined) => lifecycle.effects.push(effect),
}));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), dismiss: vi.fn() } }));

import { toast } from "sonner";
import { useWebcamPreviewOverlay } from "./useWebcamPreviewOverlay";

function renderPreview(overrides: Partial<Parameters<typeof useWebcamPreviewOverlay>[0]> = {}) {
	lifecycle.effects = [];
	const hook = useWebcamPreviewOverlay({
		webcamEnabled: true,
		webcamDeviceId: "camera",
		showWebcamControls: true,
		webcamPopoverOpen: true,
		hudOverlayMousePassthroughSupported: false,
		...overrides,
	});
	const cleanups = lifecycle.effects.map((effect) => effect());
	return { hook, cleanup: () => cleanups.forEach((cleanup) => cleanup?.()) };
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function setup() {
	const stop = vi.fn();
	const stream = { getTracks: () => [{ stop }] };
	const getUserMedia = vi.fn().mockResolvedValue(stream);
	vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
	return { getUserMedia, stream, stop };
}

beforeEach(() => {
	vi.clearAllMocks();
	vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("webcam preview camera isolation", () => {
	it.each([
		false,
		true,
		null,
	])("never opens a camera while OFF, even with the device menu open (passthrough=%s)", async (supported) => {
		const { getUserMedia } = setup();
		const { cleanup } = renderPreview({
			webcamEnabled: false,
			hudOverlayMousePassthroughSupported: supported,
		});
		await Promise.resolve();
		expect(getUserMedia).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
		cleanup();
	});

	it("does not open a Linux preview just because Webcam is enabled with its menu closed", async () => {
		const { getUserMedia } = setup();
		const { cleanup } = renderPreview({ webcamPopoverOpen: false });
		await Promise.resolve();
		expect(getUserMedia).not.toHaveBeenCalled();
		cleanup();
	});

	it("shows actionable busy-camera guidance without retrying or preventing an OFF transition", async () => {
		const { getUserMedia } = setup();
		getUserMedia.mockRejectedValue(
			new DOMException("cannot start video capture", "NotReadableError"),
		);
		const preview = renderPreview();
		await Promise.resolve();
		expect(toast.error).toHaveBeenCalledWith(
			expect.stringMatching(
				/webcam.*Teams.*Zoom.*Webcam off.*NotReadableError: cannot start video capture/s,
			),
			{ id: "webcam-preview-error", duration: 10_000 },
		);
		expect(getUserMedia).toHaveBeenCalledOnce();
		preview.cleanup();
		const off = renderPreview({ webcamEnabled: false });
		await Promise.resolve();
		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(toast.dismiss).toHaveBeenCalledWith("webcam-preview-error");
		off.cleanup();
	});

	it("stops the stream and detaches both video nodes when disabled or unmounted", async () => {
		const { getUserMedia, stream, stop } = setup();
		const preview = renderPreview();
		const nodes = Array.from({ length: 2 }, () => ({
			srcObject: null,
			play: vi.fn().mockResolvedValue(undefined),
			pause: vi.fn(),
		}));
		preview.hook.setWebcamPreviewNode(nodes[0] as unknown as HTMLVideoElement);
		preview.hook.setRecordingWebcamPreviewNode(nodes[1] as unknown as HTMLVideoElement);
		await Promise.resolve();
		expect(getUserMedia).toHaveBeenCalledOnce();
		expect(getUserMedia.mock.calls[0][0]).toMatchObject({
			video: { deviceId: { exact: "camera" } },
			audio: false,
		});
		for (const node of nodes) expect(node.srcObject).toBe(stream);
		preview.cleanup();
		expect(stop).toHaveBeenCalledOnce();
		for (const node of nodes) {
			expect(node.srcObject).toBeNull();
			expect(node.pause).toHaveBeenCalledOnce();
		}
	});

	it("releases a stream acquired after Webcam was turned off instead of attaching it", async () => {
		const { getUserMedia, stream, stop } = setup();
		const pending = deferred<typeof stream>();
		getUserMedia.mockReturnValue(pending.promise);
		const preview = renderPreview();
		const node = { srcObject: null, play: vi.fn(), pause: vi.fn() };
		preview.hook.setWebcamPreviewNode(node as unknown as HTMLVideoElement);
		preview.cleanup();
		pending.resolve(stream);
		await Promise.resolve();
		expect(stop).toHaveBeenCalledOnce();
		expect(node.srcObject).toBeNull();
		expect(node.play).not.toHaveBeenCalled();
		expect(toast.error).not.toHaveBeenCalled();
	});

	it("ignores late failures from a canceled preview rather than reporting an OFF camera error", async () => {
		const { getUserMedia } = setup();
		const pending = deferred<MediaStream>();
		getUserMedia.mockReturnValue(pending.promise);
		const preview = renderPreview();
		preview.cleanup();
		pending.reject(new DOMException("busy", "NotReadableError"));
		await Promise.resolve();
		expect(toast.error).not.toHaveBeenCalled();
	});
});
