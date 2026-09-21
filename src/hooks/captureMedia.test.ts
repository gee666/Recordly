import { describe, expect, it, vi } from "vitest";
import { acquireDesktopCapture, acquireRecordingWebcam } from "./captureMedia";

function createStream(video = true) {
	const track = { stop: vi.fn() };
	return {
		stream: {
			getTracks: () => [track],
			getVideoTracks: () => (video ? [track] : []),
			getAudioTracks: () => [],
		} as unknown as MediaStream,
		track,
	};
}

function setupDesktop(sourceId = "screen:123:0", platform = "linux", systemAudio = false) {
	const { stream } = createStream();
	const mediaDevices = {
		getUserMedia: vi.fn().mockResolvedValue(stream),
		getDisplayMedia: vi.fn().mockResolvedValue(stream),
	};
	return { mediaDevices, sourceId, platform, systemAudio, cursor: "never" as const };
}

// These exercise the acquisition helpers used by useScreenRecorder, not copies of hook logic.
describe("recording webcam acquisition", () => {
	it("never touches the camera when webcam is off, even with a saved device and a busy camera", async () => {
		const getUserMedia = vi
			.fn()
			.mockRejectedValue(new DOMException("Device in use", "NotReadableError"));
		await expect(
			acquireRecordingWebcam({ getUserMedia }, { enabled: false, deviceId: "saved-camera" }),
		).resolves.toBeNull();
		expect(getUserMedia).not.toHaveBeenCalled();
	});

	it("requests only the selected camera when enabled", async () => {
		const { stream } = createStream();
		const getUserMedia = vi.fn().mockResolvedValue(stream);
		await expect(
			acquireRecordingWebcam({ getUserMedia }, { enabled: true, deviceId: "camera" }),
		).resolves.toBe(stream);
		expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({
			audio: false,
			video: {
				deviceId: { exact: "camera" },
				width: { ideal: 1280 },
				height: { ideal: 720 },
				frameRate: { ideal: 30, max: 30 },
			},
		});
	});

	it("reports a busy camera with specific recovery steps and the original error", async () => {
		const cause = new DOMException("Could not start video source", "NotReadableError");
		const getUserMedia = vi.fn().mockRejectedValue(cause);
		const request = acquireRecordingWebcam({ getUserMedia }, { enabled: true });
		await expect(request).rejects.toMatchObject({
			cause,
			message: expect.stringMatching(/webcam.*Teams.*Webcam off/s),
		});
		await expect(request).rejects.toThrow("NotReadableError: Could not start video source");
	});
});

describe("desktop acquisition", () => {
	it.each([
		"screen:123:0",
		"window:456:0",
	])("uses desktop-only constraints for X11 source %s", async (sourceId) => {
		const options = setupDesktop(sourceId);
		await acquireDesktopCapture(options);
		expect(options.mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
		expect(options.mediaDevices.getUserMedia).toHaveBeenCalledExactlyOnceWith({
			audio: false,
			video: {
				mandatory: {
					chromeMediaSource: "desktop",
					chromeMediaSourceId: sourceId,
					maxWidth: 3840,
					maxHeight: 2160,
					maxFrameRate: 60,
					googCaptureCursor: false,
				},
				cursor: "never",
			},
		});
	});

	it.each([
		"screen:123:0",
		"screen:linux-portal",
	])("does not request unsupported Linux loopback audio for %s", async (sourceId) => {
		const options = setupDesktop(sourceId, "linux", true);
		await acquireDesktopCapture(options);
		const calls = [
			...options.mediaDevices.getUserMedia.mock.calls,
			...options.mediaDevices.getDisplayMedia.mock.calls,
		];
		expect(calls).toHaveLength(1);
		expect(calls[0][0].audio).toBe(false);
	});

	it("routes the portal sentinel only to display media, never to camera acquisition", async () => {
		const options = setupDesktop("screen:linux-portal");
		await acquireDesktopCapture(options);
		expect(options.mediaDevices.getUserMedia).not.toHaveBeenCalled();
		expect(options.mediaDevices.getDisplayMedia).toHaveBeenCalledOnce();
	});

	it("reports Linux screen backend failure without blaming a busy webcam or retrying a portal", async () => {
		const options = setupDesktop("screen:linux-portal", "linux", true);
		options.mediaDevices.getDisplayMedia.mockRejectedValue(
			new DOMException("Could not start video source", "NotReadableError"),
		);
		await expect(acquireDesktopCapture(options)).rejects.toThrow(
			/Screen capture failed \(not webcam capture\).*X11.*PipeWire.*xdg-desktop-portal/s,
		);
		expect(options.mediaDevices.getDisplayMedia).toHaveBeenCalledOnce();
		expect(options.mediaDevices.getUserMedia).not.toHaveBeenCalled();
	});

	it.each([
		"",
		"camera-device",
		"screen:fallback:7",
		"window:fallback:8",
	])("rejects invalid desktop source %s without attempting camera access", async (sourceId) => {
		const options = setupDesktop(sourceId);
		await expect(acquireDesktopCapture(options)).rejects.toThrow(
			/selected screen or window is unavailable/i,
		);
		expect(options.mediaDevices.getUserMedia).not.toHaveBeenCalled();
		expect(options.mediaDevices.getDisplayMedia).not.toHaveBeenCalled();
	});

	it("releases an unusable stream when the backend returns no video", async () => {
		const options = setupDesktop();
		const { stream, track } = createStream(false);
		options.mediaDevices.getUserMedia.mockResolvedValue(stream);
		await expect(acquireDesktopCapture(options)).rejects.toThrow("no video track");
		expect(track.stop).toHaveBeenCalledOnce();
	});

	it("preserves video-only fallback for unsupported system audio on Windows", async () => {
		const options = setupDesktop("screen:1:0", "win32", true);
		options.mediaDevices.getUserMedia.mockRejectedValueOnce(
			new DOMException("No audio", "NotReadableError"),
		);
		await acquireDesktopCapture(options);
		expect(options.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
		expect(options.mediaDevices.getUserMedia.mock.calls[0][0].audio).toMatchObject({
			mandatory: { chromeMediaSource: "desktop" },
		});
		expect(options.mediaDevices.getUserMedia.mock.calls[1][0].audio).toBe(false);
	});

	it("does not retry permission denial as an audio failure", async () => {
		const options = setupDesktop("screen:1:0", "win32", true);
		options.mediaDevices.getUserMedia.mockRejectedValue(
			new DOMException("Permission denied", "NotAllowedError"),
		);
		await expect(acquireDesktopCapture(options)).rejects.toThrow(
			"Screen sharing was cancelled or denied",
		);
		expect(options.mediaDevices.getUserMedia).toHaveBeenCalledOnce();
	});
});
