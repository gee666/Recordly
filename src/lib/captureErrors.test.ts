import { describe, expect, it } from "vitest";
import { getCaptureErrorMessage } from "./captureErrors";

describe("capture error messages", () => {
	it.each([
		"NotReadableError",
		"TrackStartError",
		"AbortError",
	])("gives camera-busy advice for webcam %s", (name) => {
		const message = getCaptureErrorMessage(
			{ name, message: "cannot start video capture" },
			"webcam",
		);
		expect(message).toContain("Teams");
		expect(message).toContain("turn Webcam off");
		expect(message).toContain(`${name}: cannot start video capture`);
	});

	it("does not misidentify screen NotReadableError as camera contention", () => {
		const message = getCaptureErrorMessage(
			new DOMException("cannot start video capture", "NotReadableError"),
			"screen",
			"linux",
		);
		expect(message).toContain("not webcam capture");
		expect(message).toContain("X11");
		expect(message).toContain("PipeWire");
		expect(message).not.toContain("Teams");
	});

	it("distinguishes missing cameras and permission denial from camera contention", () => {
		expect(getCaptureErrorMessage({ name: "NotFoundError" }, "webcam")).toContain("Reconnect");
		expect(getCaptureErrorMessage({ name: "NotAllowedError" }, "webcam")).toContain(
			"Allow camera access",
		);
	});

	it("keeps string errors useful", () => {
		expect(getCaptureErrorMessage("backend disconnected", "screen")).toContain(
			"backend disconnected",
		);
	});
});
