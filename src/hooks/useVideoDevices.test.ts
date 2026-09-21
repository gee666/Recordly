import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({
	effects: [] as Array<() => (() => void) | undefined>,
	setters: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useState: (initial: unknown) => {
		const setter = vi.fn();
		lifecycle.setters.push(setter);
		return [initial, setter];
	},
	useEffect: (effect: () => (() => void) | undefined) => lifecycle.effects.push(effect),
}));

import { useVideoDevices } from "./useVideoDevices";

function setup(devices: Array<{ kind: string; deviceId: string; label: string; groupId: string }>) {
	const mediaDevices = {
		enumerateDevices: vi.fn().mockResolvedValue(devices),
		getUserMedia: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
	};
	vi.stubGlobal("navigator", { mediaDevices });
	return mediaDevices;
}

beforeEach(() => {
	lifecycle.effects = [];
	lifecycle.setters = [];
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe("useVideoDevices permission-free enumeration", () => {
	it("does not enumerate or open a camera when the hook is disabled", () => {
		const media = setup([]);
		useVideoDevices(false);
		lifecycle.effects[0]();
		expect(media.enumerateDevices).not.toHaveBeenCalled();
		expect(media.getUserMedia).not.toHaveBeenCalled();
		expect(media.addEventListener).not.toHaveBeenCalled();
	});

	it("lists unlabeled cameras without requesting a stream when the OFF device menu opens", async () => {
		const media = setup([
			{ kind: "videoinput", deviceId: "", label: "", groupId: "" },
			{ kind: "videoinput", deviceId: "camera2", label: "   ", groupId: "group" },
			{ kind: "audioinput", deviceId: "mic", label: "Mic", groupId: "group" },
		]);
		useVideoDevices(true);
		const cleanup = lifecycle.effects[0]();
		await Promise.resolve();
		expect(lifecycle.setters[0]).toHaveBeenCalledWith([
			{ deviceId: "", label: "Camera 1", groupId: "" },
			{ deviceId: "camera2", label: "Camera 2", groupId: "group" },
		]);
		expect(media.enumerateDevices).toHaveBeenCalledOnce();
		expect(media.getUserMedia).not.toHaveBeenCalled();
		cleanup?.();
		expect(media.removeEventListener).toHaveBeenCalledWith(
			"devicechange",
			media.addEventListener.mock.calls[0][1],
		);
	});

	it("refreshes labels from devicechange after preview permission, without probing again", async () => {
		const media = setup([{ kind: "videoinput", deviceId: "camera", label: "", groupId: "g" }]);
		useVideoDevices(true);
		const cleanup = lifecycle.effects[0]();
		await Promise.resolve();
		media.enumerateDevices.mockResolvedValue([
			{ kind: "videoinput", deviceId: "camera", label: "USB camera", groupId: "g" },
		]);
		media.addEventListener.mock.calls[0][1]();
		await Promise.resolve();
		expect(lifecycle.setters[0]).toHaveBeenLastCalledWith([
			{ deviceId: "camera", label: "USB camera", groupId: "g" },
		]);
		expect(media.getUserMedia).not.toHaveBeenCalled();
		cleanup?.();
	});

	it("ignores an enumeration that finishes after closing the device menu", async () => {
		const media = setup([]);
		let resolve!: (devices: unknown[]) => void;
		media.enumerateDevices.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		useVideoDevices(true);
		const cleanup = lifecycle.effects[0]();
		cleanup?.();
		resolve([{ kind: "videoinput", deviceId: "camera", label: "Camera", groupId: "g" }]);
		await Promise.resolve();
		expect(lifecycle.setters[0]).not.toHaveBeenCalled();
		expect(media.getUserMedia).not.toHaveBeenCalled();
	});
});
