import { describe, expect, it } from "vitest";

import {
	getScreenSourceIdForDisplay,
	LINUX_PORTAL_SCREEN_SOURCE_ID,
	matchLinuxScreenSource,
} from "./sourceMapping";

describe("matchLinuxScreenSource", () => {
	const sources = [
		{ id: "screen:407:0", display_id: "66" },
		{ id: "screen:408:0", display_id: "4155486533" },
	];
	it("matches the actual Ubuntu 64-bit/32-bit display IDs even with reversed spatial order", () => {
		expect(matchLinuxScreenSource(3850489720471618, [...sources].reverse())).toBe(sources[0]);
		// This 64-bit ID has already lost its low bit when represented as a JS number.
		expect(matchLinuxScreenSource(20982680333037892, sources)).toBe(sources[1]);
	});
	it("preserves exact matches and refuses ambiguous or unrelated source IDs", () => {
		expect(matchLinuxScreenSource(66, sources)).toBe(sources[0]);
		expect(matchLinuxScreenSource(999, sources)).toBeUndefined();
		expect(
			matchLinuxScreenSource(20982680333037892, [
				...sources,
				{ id: "other", display_id: "4155486532" },
			]),
		).toBeUndefined();
	});
});

describe("getScreenSourceIdForDisplay", () => {
	it("keeps the live Electron screen source when one is available", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				matchedSourceId: "screen:42:0",
				platform: "linux",
			}),
		).toBe("screen:42:0");
	});

	it("routes unmatched Linux Wayland screens through the portal sentinel", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				env: { XDG_SESSION_TYPE: "wayland", WAYLAND_DISPLAY: "wayland-0" },
				matchedSourceId: null,
				platform: "linux",
			}),
		).toBe(LINUX_PORTAL_SCREEN_SOURCE_ID);
	});

	it("keeps unmatched Linux X11 screens on the explicit fallback id", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				env: { XDG_SESSION_TYPE: "x11", DISPLAY: ":0" },
				matchedSourceId: null,
				platform: "linux",
			}),
		).toBe("screen:fallback:42");
	});

	it("keeps non-Linux unmatched screens on the explicit fallback id", () => {
		expect(
			getScreenSourceIdForDisplay({
				displayId: "42",
				matchedSourceId: undefined,
				platform: "win32",
			}),
		).toBe("screen:fallback:42");
	});
});
