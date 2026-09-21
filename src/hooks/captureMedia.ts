import { CaptureError } from "@/lib/captureErrors";
import type { RecordingRegion } from "@/lib/recordingRegion";

/** Names/thumbnails may refresh; only changes to what is captured invalidate startup. */
export function recordingSourceKey(
	source: {
		id?: string;
		display_id?: string;
		captureRegion?: RecordingRegion;
	} | null,
): string {
	const region = source?.captureRegion;
	return JSON.stringify([
		source?.id,
		source?.display_id,
		region && [
			region.x,
			region.y,
			region.width,
			region.height,
			region.displayId,
			region.displayBounds?.x,
			region.displayBounds?.y,
			region.displayBounds?.width,
			region.displayBounds?.height,
		],
	]);
}

export type DesktopCaptureMediaDevices = Pick<MediaDevices, "getUserMedia" | "getDisplayMedia">;

/** Disabled webcam recording must not even probe camera permissions or devices. */
export async function acquireRecordingWebcam(
	mediaDevices: Pick<MediaDevices, "getUserMedia">,
	{ enabled, deviceId }: { enabled: boolean; deviceId?: string },
): Promise<MediaStream | null> {
	if (!enabled) return null;
	try {
		return await mediaDevices.getUserMedia({
			audio: false,
			video: {
				...(deviceId ? { deviceId: { exact: deviceId } } : {}),
				width: { ideal: 1280 },
				height: { ideal: 720 },
				frameRate: { ideal: 30, max: 30 },
			},
		});
	} catch (error) {
		throw new CaptureError(error, "webcam");
	}
}

export async function acquireDesktopCapture({
	mediaDevices,
	sourceId,
	platform,
	systemAudio,
	cursor,
}: {
	mediaDevices: DesktopCaptureMediaDevices;
	sourceId: string;
	platform: string;
	systemAudio: boolean;
	cursor: "always" | "never";
}): Promise<MediaStream> {
	const useDisplayMedia = sourceId === "screen:linux-portal";
	// Electron's desktop loopback audio is not supported on Linux. Asking for it
	// can fail the entire video request, and retrying opens a second portal picker.
	const requestAudio = systemAudio && platform !== "linux";
	const acquire = (audio: boolean) =>
		useDisplayMedia
			? mediaDevices.getDisplayMedia({
					audio,
					video: {
						displaySurface: "monitor",
						width: { ideal: 3840, max: 3840 },
						height: { ideal: 2160, max: 2160 },
						frameRate: { ideal: 60, max: 60 },
						cursor,
					},
					selfBrowserSurface: "exclude",
					surfaceSwitching: "exclude",
				} as DisplayMediaStreamOptions)
			: mediaDevices.getUserMedia({
					audio: audio
						? {
								mandatory: {
									chromeMediaSource: "desktop",
									chromeMediaSourceId: sourceId,
								},
							}
						: false,
					video: {
						mandatory: {
							chromeMediaSource: "desktop",
							chromeMediaSourceId: sourceId,
							maxWidth: 3840,
							maxHeight: 2160,
							maxFrameRate: 60,
							googCaptureCursor: cursor === "always",
						},
						cursor,
					},
				} as MediaStreamConstraints);

	try {
		// Never let an invalid desktop ID fall through to a default camera request.
		if (!/^(screen|window):/.test(sourceId) || /^(screen|window):fallback:/.test(sourceId)) {
			throw new Error("The selected screen or window is unavailable. Select it again.");
		}
		let stream: MediaStream;
		try {
			stream = await acquire(requestAudio);
		} catch (error) {
			if (!requestAudio) throw error;
			const name = (error as { name?: string } | null)?.name;
			if (name === "NotAllowedError" || name === "SecurityError") throw error;
			console.warn("System audio capture failed, trying video-only:", error);
			stream = await acquire(false);
		}
		if (stream.getVideoTracks().length === 0) {
			stream.getTracks().forEach((track) => track.stop());
			throw new Error("The screen capture backend returned no video track.");
		}
		return stream;
	} catch (error) {
		throw new CaptureError(error, "screen", platform);
	}
}
