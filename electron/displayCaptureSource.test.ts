import { describe, expect, it, vi } from "vitest";
import { resolveDisplayCaptureSource } from "./displayCaptureSource";

const screen = { id: "screen:123:0", name: "Display 1" };
const window = { id: "window:456:0", name: "Private window" };

describe("resolveDisplayCaptureSource", () => {
	it.each([
		undefined,
		"screen:linux-portal",
	])("resolves %s to a real X11 screen", async (sourceId) => {
		const getSources = vi.fn().mockResolvedValue([window, screen]);
		expect(
			await resolveDisplayCaptureSource({
				sourceId,
				platform: "linux",
				env: { XDG_SESSION_TYPE: "x11" },
				getSources,
			}),
		).toEqual(screen);
		expect(getSources).toHaveBeenCalledWith(["screen"]);
	});

	it.each([
		undefined,
		"screen:linux-portal",
	])("does not enumerate before a Wayland portal request (%s)", async (sourceId) => {
		const getSources = vi.fn();
		expect(
			await resolveDisplayCaptureSource({
				sourceId,
				platform: "linux",
				env: { XDG_SESSION_TYPE: "wayland" },
				getSources,
			}),
		).toEqual({ id: "screen:0:0", name: "Entire screen" });
		expect(getSources).not.toHaveBeenCalled();
	});

	it("denies a vanished selected source instead of recording something else", async () => {
		expect(
			await resolveDisplayCaptureSource({
				sourceId: "window:missing:0",
				platform: "linux",
				env: { XDG_SESSION_TYPE: "x11" },
				getSources: async () => [screen, window],
			}),
		).toBeUndefined();
	});

	it("keeps an explicitly selected source", async () => {
		expect(
			await resolveDisplayCaptureSource({
				sourceId: window.id,
				platform: "linux",
				env: { XDG_SESSION_TYPE: "x11" },
				getSources: async () => [screen, window],
			}),
		).toEqual(window);
	});

	it("does not substitute a window when there are no screens", async () => {
		expect(
			await resolveDisplayCaptureSource({
				sourceId: null,
				platform: "linux",
				env: { XDG_SESSION_TYPE: "x11" },
				getSources: async () => [window],
			}),
		).toBeUndefined();
	});
});
