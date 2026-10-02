import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	protectionEnabled: false,
	shortcutFree: true,
	registered: new Map<string, () => void>(),
	source: null as unknown,
	hud: null as unknown,
	countdown: null as unknown,
	displays: [] as unknown[],
	hint: vi.fn(),
	closeHint: vi.fn(),
}));

vi.mock("electron", () => ({
	globalShortcut: {
		register: vi.fn((accelerator: string, callback: () => void) => {
			if (!mocks.shortcutFree) return false;
			mocks.registered.set(accelerator, callback);
			return true;
		}),
		unregister: vi.fn((accelerator: string) => mocks.registered.delete(accelerator)),
	},
	screen: {
		getAllDisplays: () => mocks.displays,
		getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
	},
}));
vi.mock("./ipc/state", () => ({
	get selectedSource() {
		return mocks.source;
	},
}));
vi.mock("./windows", () => ({
	getHudOverlayWindow: () => mocks.hud,
	getCountdownWindow: () => mocks.countdown,
	getHudOverlayCaptureProtectionEnabled: () => mocks.protectionEnabled,
}));
vi.mock("./recordingHintWindow", () => ({
	RECORDING_HINT_SIZE: { width: 480, height: 72 },
	showRecordingHint: mocks.hint,
	closeRecordingHint: mocks.closeHint,
}));

import {
	configureHudAutoHide,
	getActiveStopShortcut,
	setHudAutoHideRecording,
	showHudAutoHideCountdownHint,
	STOP_RECORDING_SHORTCUT,
} from "./hudAutoHide";

const firstDisplay = {
	id: 1,
	bounds: { x: 0, y: 0, width: 1920, height: 1080 },
	workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};
const secondDisplay = {
	id: 2,
	bounds: { x: 1920, y: 0, width: 1280, height: 1024 },
	workArea: { x: 1920, y: 0, width: 1280, height: 1024 },
};
const hudBounds = { x: 530, y: 880, width: 860, height: 160 };
const stopRecording = vi.fn();
const showHud = vi.fn(() => true);

function createHud() {
	return { isVisible: () => true, getBounds: () => hudBounds, hide: vi.fn() };
}

function configure(trayAvailable = true) {
	configureHudAutoHide({ stopRecording, showHud, trayAvailable });
}

describe("hud auto hide", () => {
	const realPlatform = process.platform;
	const setPlatform = (platform: string) =>
		Object.defineProperty(process, "platform", { value: platform });

	afterEach(() => setPlatform(realPlatform));

	beforeEach(() => {
		setHudAutoHideRecording(false);
		vi.clearAllMocks();
		setPlatform("linux");
		mocks.protectionEnabled = false;
		mocks.shortcutFree = true;
		mocks.registered.clear();
		mocks.source = { id: "screen:1:0", display_id: "1", sourceType: "screen" };
		mocks.displays = [firstDisplay, secondDisplay];
		mocks.hud = createHud();
		mocks.countdown = null;
		configure();
	});

	it("hides the HUD inside the recording, registers the stop shortcut and hints elsewhere", () => {
		setHudAutoHideRecording(true);

		expect((mocks.hud as ReturnType<typeof createHud>).hide).toHaveBeenCalled();
		expect(getActiveStopShortcut()).toBe(STOP_RECORDING_SHORTCUT);
		mocks.registered.get(STOP_RECORDING_SHORTCUT)?.();
		expect(stopRecording).toHaveBeenCalled();
		// The only display holding the HUD is fully recorded, so the hint goes to the other one.
		expect(mocks.hint).toHaveBeenCalledWith(expect.stringContaining(STOP_RECORDING_SHORTCUT), {
			x: 2320,
			y: 24,
		});
	});

	it("restores the HUD and releases the shortcut when recording ends", () => {
		setHudAutoHideRecording(true);
		setHudAutoHideRecording(false);

		expect(mocks.registered.size).toBe(0);
		expect(getActiveStopShortcut()).toBeNull();
		expect(mocks.closeHint).toHaveBeenCalled();
		expect(showHud).toHaveBeenCalledTimes(1);
	});

	it("leaves the HUD alone when it is outside the recorded area", () => {
		mocks.source = { id: "screen:2:0", display_id: "2", sourceType: "screen" };
		setHudAutoHideRecording(true);

		expect((mocks.hud as ReturnType<typeof createHud>).hide).not.toHaveBeenCalled();
		expect(mocks.registered.size).toBe(0);
		setHudAutoHideRecording(false);
		expect(showHud).not.toHaveBeenCalled();
	});

	it("leaves the HUD alone for window capture", () => {
		mocks.source = { id: "window:42:0", sourceType: "window" };
		setHudAutoHideRecording(true);

		expect((mocks.hud as ReturnType<typeof createHud>).hide).not.toHaveBeenCalled();
	});

	it("leaves the HUD alone when capture protection already hides it", () => {
		setPlatform("win32");
		mocks.protectionEnabled = true;
		setHudAutoHideRecording(true);

		expect((mocks.hud as ReturnType<typeof createHud>).hide).not.toHaveBeenCalled();
	});

	it("does not advertise the shortcut when it cannot be registered", () => {
		mocks.shortcutFree = false;
		setHudAutoHideRecording(true);

		expect(getActiveStopShortcut()).toBeNull();
		const [text] = mocks.hint.mock.calls[0];
		expect(text).not.toContain(STOP_RECORDING_SHORTCUT);
		expect(text).toContain("Recordly icon");
	});

	it("keeps the HUD when neither the shortcut nor the tray can bring it back", () => {
		mocks.shortcutFree = false;
		configure(false);
		setHudAutoHideRecording(true);

		expect((mocks.hud as ReturnType<typeof createHud>).hide).not.toHaveBeenCalled();
		expect(mocks.hint).not.toHaveBeenCalled();
	});

	it("shows no hint during recording when it would land inside the recording", () => {
		mocks.displays = [firstDisplay];
		setHudAutoHideRecording(true);

		expect((mocks.hud as ReturnType<typeof createHud>).hide).toHaveBeenCalled();
		expect(mocks.hint).not.toHaveBeenCalled();
		expect(getActiveStopShortcut()).toBe(STOP_RECORDING_SHORTCUT);
	});

	it("does not hide again when the state is repeated, so a revealed HUD stays visible", () => {
		setHudAutoHideRecording(true);
		setHudAutoHideRecording(true);

		expect((mocks.hud as ReturnType<typeof createHud>).hide).toHaveBeenCalledTimes(1);
		expect(showHud).not.toHaveBeenCalled();
	});

	describe("countdown hint", () => {
		it("shows the hint while counting down and closes it with the countdown window", () => {
			const countdown = new EventEmitter();
			mocks.countdown = countdown;
			showHudAutoHideCountdownHint();

			expect(mocks.hint).toHaveBeenCalledTimes(1);
			expect(mocks.registered.size).toBe(0);
			countdown.emit("closed");
			expect(mocks.closeHint).toHaveBeenCalled();
		});

		it("falls back to the recorded display, which is safe before frames exist", () => {
			mocks.displays = [firstDisplay];
			mocks.countdown = new EventEmitter();
			showHudAutoHideCountdownHint();

			expect(mocks.hint).toHaveBeenCalledWith(expect.any(String), { x: 720, y: 24 });
		});

		it("stays silent when the HUD will not be hidden", () => {
			mocks.countdown = new EventEmitter();
			mocks.source = { id: "window:42:0", sourceType: "window" };
			showHudAutoHideCountdownHint();

			expect(mocks.hint).not.toHaveBeenCalled();
		});
	});
});
