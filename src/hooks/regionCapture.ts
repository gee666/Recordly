import type { RecordingBounds, RecordingRegion } from "@/lib/recordingRegion";

type CaptureRectangle = RecordingBounds;

function readRectangle(value: unknown): CaptureRectangle {
	if (!value || typeof value !== "object")
		throw new Error("Missing recording region bounds. Select the area again.");
	const rectangle = value as CaptureRectangle;
	if (
		![rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite) ||
		rectangle.width <= 0 ||
		rectangle.height <= 0
	) {
		throw new Error("Invalid recording region bounds. Select the area again.");
	}
	return { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height };
}

/** Validate before any capture starts; never silently record the whole monitor. */
export function getRecordingRegion(source: unknown): RecordingRegion | null {
	if (!source || typeof source !== "object") return null;
	const value = source as { id?: string; display_id?: string; captureRegion?: unknown };
	if (value.captureRegion == null) return null;
	if (
		!value.id?.startsWith("screen:") ||
		value.id === "screen:linux-portal" ||
		value.id.startsWith("screen:fallback:")
	) {
		throw new Error(
			"Area recording needs a specific monitor. Select an area on a screen again (portal capture cannot guarantee the selected monitor).",
		);
	}
	const area = readRectangle(value.captureRegion);
	const metadata = value.captureRegion as Partial<RecordingRegion>;
	const display = readRectangle(metadata.displayBounds);
	if (
		typeof metadata.displayId !== "string" ||
		!metadata.displayId ||
		(value.display_id && value.display_id !== metadata.displayId)
	) {
		throw new Error(
			"The recording area belongs to a different monitor. Select the area again.",
		);
	}
	const region: RecordingRegion = {
		...area,
		displayId: metadata.displayId,
		displayBounds: display,
	};
	if (
		area.x < 0 ||
		area.y < 0 ||
		area.x + area.width > display.width ||
		area.y + area.height > display.height
	) {
		throw new Error("The recording area must be inside one monitor. Select the area again.");
	}
	return region;
}

export function getRegionCropPixels(
	region: RecordingRegion,
	videoWidth: number,
	videoHeight: number,
): CaptureRectangle {
	if (
		!Number.isFinite(videoWidth) ||
		!Number.isFinite(videoHeight) ||
		videoWidth <= 0 ||
		videoHeight <= 0
	) {
		throw new Error("The selected monitor returned no usable video dimensions.");
	}
	const area = region;
	const display = region.displayBounds;
	const scaleX = videoWidth / display.width;
	const scaleY = videoHeight / display.height;
	// Round inward so neither scaling nor codec alignment exposes pixels outside the area.
	const x = Math.ceil(area.x * scaleX);
	const y = Math.ceil(area.y * scaleY);
	const right = Math.floor((area.x + area.width) * scaleX);
	const bottom = Math.floor((area.y + area.height) * scaleY);
	const width = Math.floor((right - x) / 2) * 2;
	const height = Math.floor((bottom - y) / 2) * 2;
	if (width < 2 || height < 2)
		throw new Error("The recording area is too small. Select a larger area.");
	return { x, y, width, height };
}

/** Owns only the crop renderer/output video track; the caller still owns input tracks. */
export async function cropRecordingStream(
	input: MediaStream,
	region: RecordingRegion,
	frameRate = 60,
): Promise<{ stream: MediaStream; dispose: () => void }> {
	const video = document.createElement("video");
	const canvas = document.createElement("canvas");
	let output: MediaStream | undefined;
	let frameCallback: number | undefined;
	let timer: ReturnType<typeof setInterval> | undefined;
	let startupTimer: ReturnType<typeof setTimeout> | undefined;
	let disposed = false;
	const sourceTracks = input.getVideoTracks();
	let rejectSourceEnded: (error: Error) => void = () => undefined;
	const sourceEnded = new Promise<never>((_, reject) => {
		rejectSourceEnded = reject;
	});
	const onSourceEnded = () => {
		if (disposed) return;
		dispose();
		rejectSourceEnded(new Error("Screen sharing ended before area recording was ready."));
	};
	const dispose = () => {
		if (disposed) return;
		disposed = true;
		sourceTracks.forEach((track) => track.removeEventListener("ended", onSourceEnded));
		if (frameCallback !== undefined) video.cancelVideoFrameCallback(frameCallback);
		if (timer !== undefined) clearInterval(timer);
		if (startupTimer !== undefined) clearTimeout(startupTimer);
		video.pause();
		video.srcObject = null;
		output?.getVideoTracks().forEach((track) => track.stop());
	};
	try {
		sourceTracks.forEach((track) => track.addEventListener("ended", onSourceEnded));
		if (
			sourceTracks.length === 0 ||
			sourceTracks.some((track) => track.readyState === "ended")
		) {
			throw new Error("Screen sharing has ended. Select a screen and start recording again.");
		}
		video.muted = true;
		video.playsInline = true;
		video.srcObject = input;
		await Promise.race([
			video.play(),
			sourceEnded,
			new Promise<never>((_, reject) => {
				startupTimer = setTimeout(
					() =>
						reject(
							new Error(
								"Timed out waiting for the selected monitor's video. Try selecting the area again.",
							),
						),
					10000,
				);
			}),
		]);
		clearTimeout(startupTimer);
		if (disposed) throw new Error("Screen sharing ended before area recording was ready.");
		const initial = getRegionCropPixels(region, video.videoWidth, video.videoHeight);
		canvas.width = initial.width;
		canvas.height = initial.height;
		const context = canvas.getContext("2d", { alpha: false });
		if (!context)
			throw new Error("Area recording requires canvas video capture, which is unavailable.");
		const draw = () => {
			const crop = getRegionCropPixels(region, video.videoWidth, video.videoHeight);
			context.drawImage(
				video,
				crop.x,
				crop.y,
				crop.width,
				crop.height,
				0,
				0,
				canvas.width,
				canvas.height,
			);
		};
		draw();
		output = canvas.captureStream(frameRate);
		if (output.getVideoTracks().length === 0)
			throw new Error("Area recording did not produce a video track.");
		const drawNextFrame = () => {
			if (disposed) return;
			// Retain the last cropped frame during transient source reconfiguration;
			// never replace it with an uncropped monitor frame.
			if (video.videoWidth > 0 && video.videoHeight > 0) draw();
			frameCallback = video.requestVideoFrameCallback(drawNextFrame);
		};
		if (typeof video.requestVideoFrameCallback === "function") {
			frameCallback = video.requestVideoFrameCallback(drawNextFrame);
		} else {
			timer = setInterval(() => {
				if (!disposed && video.videoWidth > 0 && video.videoHeight > 0) draw();
			}, 1000 / frameRate);
		}
		return {
			stream: new MediaStream([...output.getVideoTracks(), ...input.getAudioTracks()]),
			dispose,
		};
	} catch (error) {
		dispose();
		throw error;
	}
}
