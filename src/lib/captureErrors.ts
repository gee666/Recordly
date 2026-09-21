export type CaptureKind = "webcam" | "screen";

function errorDetails(error: unknown): { name: string; message: string } {
	if (typeof error === "object" && error !== null) {
		const value = error as { name?: unknown; message?: unknown };
		return {
			name: typeof value.name === "string" ? value.name : "Error",
			message: typeof value.message === "string" ? value.message : "Unknown capture error",
		};
	}
	return { name: "Error", message: String(error) };
}

/** A media error's name alone cannot distinguish a busy camera from a broken screen backend. */
export function getCaptureErrorMessage(
	error: unknown,
	kind: CaptureKind,
	platform?: string,
): string {
	const { name, message } = errorDetails(error);
	let guidance: string;
	if (kind === "webcam") {
		if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError") {
			guidance =
				"The webcam could not start. It may be in use by Teams, Zoom, or another app. Close other camera apps and try again, or turn Webcam off to record only the screen.";
		} else if (
			name === "NotAllowedError" ||
			name === "PermissionDeniedError" ||
			name === "SecurityError"
		) {
			guidance =
				"Webcam access was denied. Allow camera access, or turn Webcam off to record only the screen.";
		} else if (
			name === "NotFoundError" ||
			name === "DevicesNotFoundError" ||
			name === "OverconstrainedError"
		) {
			guidance =
				"The selected webcam is unavailable. Reconnect it or select another camera, or turn Webcam off to record only the screen.";
		} else {
			guidance =
				"Webcam capture failed. Try another camera, or turn Webcam off to record only the screen.";
		}
	} else if (
		name === "NotAllowedError" ||
		name === "PermissionDeniedError" ||
		name === "SecurityError"
	) {
		guidance =
			"Screen sharing was cancelled or denied. Select a screen or window and allow screen sharing to record.";
	} else if (platform === "linux") {
		guidance =
			"Screen capture failed (not webcam capture). On X11, reselect a screen or window and restart Recordly if needed. On Wayland, check that PipeWire and your desktop's xdg-desktop-portal service are running, then try sharing again.";
	} else {
		guidance =
			"Screen capture failed (not webcam capture). Reselect a screen or window and check screen-recording permissions, then try again.";
	}
	return `${guidance}\nTechnical details: ${name}: ${message}`;
}

export class CaptureError extends Error {
	readonly cause: unknown;

	constructor(error: unknown, kind: CaptureKind, platform?: string) {
		super(getCaptureErrorMessage(error, kind, platform));
		this.name = "CaptureError";
		this.cause = error;
	}
}
