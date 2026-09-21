import { EventEmitter } from "node:events";
import { rmSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalShortcut, ipcMain, screen, type Display } from "electron";

const keys = new Map<string, () => void>();
const loadFile = vi.fn();
let clipDisplaySizedWindows = false;
class TestWindow extends EventEmitter {
	webContents = Object.assign(new EventEmitter(), {
		send: vi.fn(),
		setZoomFactor: vi.fn(),
		setWindowOpenHandler: vi.fn(),
		mainFrame: {},
	});
	destroyed = false;
	bounds: Electron.Rectangle;
	setMenu = vi.fn();
	setIgnoreMouseEvents = vi.fn();
	setAlwaysOnTop = vi.fn();
	showInactive = vi.fn();
	loadURL = vi.fn().mockResolvedValue(undefined);
	loadFile = loadFile;
	constructor(public options: Electron.BrowserWindowConstructorOptions) {
		super();
		this.bounds = {
			x: options.x ?? 0,
			y: options.y ?? 0,
			width: options.width ?? 800,
			height: options.height ?? 600,
		};
		if (clipDisplaySizedWindows && this.bounds.width === 1280 && this.bounds.height === 800) {
			this.bounds.width--;
			this.bounds.height--;
		}
	}
	getBounds() {
		return this.bounds;
	}
	setBounds(bounds: Electron.Rectangle) {
		this.bounds = bounds;
	}
	isDestroyed() {
		return this.destroyed;
	}
	close() {
		this.destroy();
	}
	destroy() {
		this.destroyed = true;
		this.emit("closed");
	}
}
const windows: TestWindow[] = [];
vi.mock("node:fs", () => ({
	mkdtempSync: vi.fn(() => "/tmp/recordly-area-test"),
	writeFileSync: vi.fn(),
	rmSync: vi.fn(),
}));
vi.mock("electron", () => ({
	ipcMain: new EventEmitter(),
	screen: new EventEmitter(),
	globalShortcut: {
		isRegistered: vi.fn((key: string) => keys.has(key)),
		register: vi.fn((key: string, callback: () => void) => {
			keys.set(key, callback);
			return true;
		}),
		unregister: vi.fn((key: string) => {
			keys.delete(key);
		}),
	},
	BrowserWindow: vi.fn(function (options: Electron.BrowserWindowConstructorOptions) {
		const win = new TestWindow(options);
		windows.push(win);
		return win;
	}),
}));
const left = {
	id: 1,
	bounds: { x: -1280, y: -100, width: 1280, height: 800 },
	scaleFactor: 2,
} as Display;
const right = {
	id: 2,
	bounds: { x: 0, y: 0, width: 1920, height: 1080 },
	scaleFactor: 1,
} as Display;
const channel = "recording-region-picker-event";
function send(
	win: TestWindow,
	message: Record<string, unknown>,
	senderFrame = win.webContents.mainFrame,
) {
	ipcMain.emit(channel, { sender: win.webContents, senderFrame }, message);
}
function drag(win: TestWindow, start = { x: 100, y: 100 }, end = { x: 700, y: 500 }) {
	send(win, { type: "start", ...start });
	send(win, { type: "move", ...end });
	send(win, { type: "end", ...end });
}
function expectCleaned() {
	expect(windows.every((win) => win.destroyed)).toBe(true);
	expect(ipcMain.listenerCount(channel)).toBe(0);
	for (const name of ["display-added", "display-removed", "display-metrics-changed"])
		expect(screen.listenerCount(name)).toBe(0);
	expect(keys.size).toBe(0);
	expect(rmSync).toHaveBeenCalledWith("/tmp/recordly-area-test", {
		recursive: true,
		force: true,
	});
}

beforeEach(() => {
	vi.resetModules();
	vi.clearAllMocks();
	vi.useFakeTimers();
	loadFile.mockReset().mockResolvedValue(undefined);
	windows.length = 0;
	keys.clear();
	clipDisplaySizedWindows = false;
	ipcMain.removeAllListeners();
	screen.removeAllListeners();
});
afterEach(() => vi.useRealTimers());

describe("native multi-monitor area picker", () => {
	it("covers every display with interactive, isolated, unzoomed overlay content", async () => {
		const { selectRecordingRegion } = await import("./recordingRegionWindow");
		const pending = selectRecordingRegion([left, right]);
		await vi.waitFor(() => expect(windows[0].showInactive).toHaveBeenCalled());
		expect(windows).toHaveLength(2);
		for (const [i, win] of windows.entries()) {
			expect(win.options).toMatchObject({
				...[left, right][i].bounds,
				frame: false,
				transparent: true,
				focusable: false,
				hasShadow: false,
				webPreferences: {
					sandbox: true,
					contextIsolation: true,
					nodeIntegration: false,
					backgroundThrottling: false,
					preload: "/tmp/recordly-area-test/preload.cjs",
				},
			});
			expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
			expect(win.webContents.setZoomFactor).toHaveBeenCalledWith(1);
		}
		expect(writeFileSync).toHaveBeenCalledTimes(2);
		keys.get("Escape")!();
		expect(await pending).toBeNull();
		expectCleaned();
	});

	it.each([
		0, 1,
	])("uses the drag-start display (%i), not the primary monitor or its DPI", async (index) => {
		const { selectRecordingRegion } = await import("./recordingRegionWindow");
		const pending = selectRecordingRegion([left, right]);
		drag(windows[index]);
		send(windows[index], { type: "confirm" });
		const display = [left, right][index];
		expect(await pending).toEqual({
			x: 100,
			y: 100,
			width: 600,
			height: 400,
			displayId: String(display.id),
			displayBounds: display.bounds,
		});
		expectCleaned();
	});

	it("clamps a captured drag that leaves the starting display and ignores other windows' updates", async () => {
		const { selectRecordingRegion } = await import("./recordingRegionWindow");
		const pending = selectRecordingRegion([left, right]);
		send(windows[0], { type: "start", x: 1000, y: 200 });
		send(windows[1], { type: "start", x: 10, y: 10 });
		send(windows[1], { type: "end", x: 100, y: 100 });
		send(windows[0], { type: "end", x: 1500, y: 500 });
		send(windows[1], { type: "confirm" });
		expect(windows[0].destroyed).toBe(false);
		keys.get("Enter")!();
		expect(await pending).toMatchObject({
			displayId: "1",
			x: 1000,
			y: 200,
			width: 280,
			height: 300,
		});
		expectCleaned();
	});

	it("allows redrawing on a different monitor after releasing the first drag", async () => {
		const { selectRecordingRegion } = await import("./recordingRegionWindow");
		const pending = selectRecordingRegion([left, right]);
		drag(windows[0]);
		drag(windows[1]);
		keys.get("Enter")!();
		expect(await pending).toMatchObject({ displayId: "2" });
		expectCleaned();
	});

	it("rejects unrelated senders, subframes and malformed geometry", async () => {
		const { selectRecordingRegion } = await import("./recordingRegionWindow");
		const pending = selectRecordingRegion([left, right]);
		ipcMain.emit(channel, { sender: {} }, { type: "cancel" });
		send(windows[0], { type: "cancel" }, {});
		send(windows[0], { type: "start", x: NaN, y: 100 });
		send(windows[0], { type: "end", x: 700, y: 500 });
		keys.get("Enter")!();
		expect(windows.every((win) => !win.destroyed)).toBe(true);
		keys.get("Escape")!();
		expect(await pending).toBeNull();
		expectCleaned();
	});

	it("does not confirm tiny or canceled pointer gestures", async () => {
		const { selectRecordingRegion } = await import("./recordingRegionWindow");
		const pending = selectRecordingRegion([left]);
		drag(windows[0], { x: 100, y: 100 }, { x: 105, y: 106 });
		keys.get("Enter")!();
		expect(windows[0].destroyed).toBe(false);
		drag(windows[0]);
		send(windows[0], { type: "abort" });
		keys.get("Enter")!();
		expect(windows[0].destroyed).toBe(false);
		send(windows[0], { type: "cancel" });
		expect(await pending).toBeNull();
		expectCleaned();
	});

	it.each([
		"display-added",
		"display-removed",
		"display-metrics-changed",
	])("cleans up every overlay and key binding on %s", async (event) => {
		const { selectRecordingRegion } = await import("./recordingRegionWindow");
		const pending = selectRecordingRegion([left, right]);
		screen.emit(event, {}, right, ["scaleFactor"]);
		expect(await pending).toBeNull();
		expectCleaned();
	});

	it("cleans up when one overlay is externally closed and permits another session", async () => {
		const { selectRecordingRegion } = await import("./recordingRegionWindow");
		const first = selectRecordingRegion([left, right]);
		expect(() => selectRecordingRegion([left])).toThrow(/already open/);
		windows[1].close();
		expect(await first).toBeNull();
		expectCleaned();
		const next = selectRecordingRegion([right]);
		keys.get("Escape")!();
		expect(await next).toBeNull();
	});

	it("fails closed on a load failure, without subsequently showing any overlays", async () => {
		const { selectRecordingRegion } = await import("./recordingRegionWindow");
		loadFile.mockRejectedValueOnce(new Error("load failed"));
		await expect(selectRecordingRegion([left, right])).rejects.toThrow("load failed");
		expect(windows.every((win) => win.showInactive.mock.calls.length === 0)).toBe(true);
		expectCleaned();
	});

	it("does not steal an existing Escape shortcut or leave a non-cancelable overlay", async () => {
		const { selectRecordingRegion } = await import("./recordingRegionWindow");
		const existing = vi.fn();
		keys.set("Escape", existing);
		await expect(selectRecordingRegion([left])).rejects.toThrow(/Escape is unavailable/);
		expect(windows).toHaveLength(0);
		expect(keys.get("Escape")).toBe(existing);
		expect(globalShortcut.unregister).not.toHaveBeenCalled();
	});

	it("covers Chromium's one-pixel X11 popup gaps and accepts gestures starting on an edge", async () => {
		clipDisplaySizedWindows = true;
		const { selectRecordingRegion } = await import("./recordingRegionWindow");
		const pending = selectRecordingRegion([left]);
		expect(windows).toHaveLength(4);
		const edge = windows.find((win) => win.bounds.x === -1 && win.bounds.height > 1)!;
		drag(edge, { x: 0, y: 100 }, { x: -279, y: 400 });
		// Confirmation controls live on the primary overlay, not on the edge strip.
		send(windows[0], { type: "confirm" });
		expect(await pending).toMatchObject({
			displayId: "1",
			x: 1000,
			y: 100,
			width: 279,
			height: 300,
		});
		expectCleaned();
	});
});

describe("recording outline lifecycle", () => {
	it("keeps four click-through strips visible until recording stops", async () => {
		const {
			setSelectedRecordingRegion,
			previewRecordingRegionOutline,
			setRecordingRegionOutlineActive,
		} = await import("./recordingRegionWindow");
		setSelectedRecordingRegion({
			x: 100,
			y: 100,
			width: 600,
			height: 400,
			displayId: "1",
			displayBounds: left.bounds,
		});
		previewRecordingRegionOutline();
		setRecordingRegionOutlineActive(true);
		await Promise.resolve();
		vi.advanceTimersByTime(10_000);
		const borders = windows.filter((win) => !win.destroyed);
		expect(borders).toHaveLength(4);
		for (const border of borders) {
			expect(border.options).toMatchObject({
				focusable: false,
				hasShadow: false,
				alwaysOnTop: true,
			});
			expect(border.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
			expect(border.showInactive).toHaveBeenCalled();
		}
		setRecordingRegionOutlineActive(false);
		expect(windows.every((win) => win.destroyed)).toBe(true);
	});
});
