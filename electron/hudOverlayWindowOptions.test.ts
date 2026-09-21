import { describe, expect, it } from "vitest";
import {
	getHudOverlayTaskbarOptions,
	supportsHudOverlayWindowPositioning,
} from "./hudOverlayWindowOptions";

describe("supportsHudOverlayWindowPositioning", () => {
	it("uses pointer-driven window movement on X11, not native Wayland", () => {
		expect(supportsHudOverlayWindowPositioning("linux", "x11")).toBe(true);
		expect(supportsHudOverlayWindowPositioning("linux", "wayland")).toBe(false);
	});

	it("honors explicit Ozone selection over the desktop session type", () => {
		expect(supportsHudOverlayWindowPositioning("linux", "wayland", "x11")).toBe(true);
		expect(supportsHudOverlayWindowPositioning("linux", "x11", "wayland")).toBe(false);
	});

	it("keeps other desktop platforms on the existing positioning path", () => {
		expect(supportsHudOverlayWindowPositioning("darwin", undefined)).toBe(true);
		expect(supportsHudOverlayWindowPositioning("win32", undefined)).toBe(true);
	});
});

describe("getHudOverlayTaskbarOptions", () => {
	it("keeps a focusable HUD in the Windows taskbar", () => {
		expect(getHudOverlayTaskbarOptions("win32")).toEqual({
			skipTaskbar: false,
			focusable: true,
		});
	});

	it("keeps the Linux HUD window-manager controlled for native dragging and menus", () => {
		expect(getHudOverlayTaskbarOptions("linux")).toEqual({
			skipTaskbar: true,
			focusable: true,
		});
	});

	it("keeps the macOS HUD non-focusable and out of the taskbar", () => {
		expect(getHudOverlayTaskbarOptions("darwin")).toEqual({
			skipTaskbar: true,
			focusable: false,
		});
	});
});
