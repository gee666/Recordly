import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	listeners: new Map<string, (...args: unknown[]) => void>(),
	workArea: { x: 0, y: 0, width: 1920, height: 1080 },
	ozonePlatform: "x11",
}));

vi.mock("electron", () => ({
	app: {
		isReady: () => true,
		commandLine: { getSwitchValue: () => mocks.ozonePlatform },
	},
	ipcMain: {
		on: (channel: string, handler: (...args: unknown[]) => void) =>
			mocks.listeners.set(channel, handler),
		handle: vi.fn(),
		removeListener: vi.fn(),
	},
	BrowserWindow: class extends EventEmitter {
		bounds: { x: number; y: number; width: number; height: number };
		webContents = Object.assign(new EventEmitter(), { send: vi.fn() });
		setMenu = vi.fn();
		setIgnoreMouseEvents = vi.fn();
		setAlwaysOnTop = vi.fn();
		moveTop = vi.fn();
		loadFile = vi.fn();
		loadURL = vi.fn();
		constructor(public options: Electron.BrowserWindowConstructorOptions) {
			super();
			const { x = 0, y = 0, width = 800, height = 600 } = options;
			this.bounds = { x, y, width, height };
		}
		getBounds() {
			return this.bounds;
		}
		setBounds(bounds: typeof this.bounds) {
			this.bounds = bounds;
			this.emit("move");
		}
		isDestroyed() {
			return false;
		}
		isVisible() {
			return false;
		}
	},
}));
vi.mock("node:module", () => ({
	createRequire: () => () => ({
		screen: {
			getPrimaryDisplay: () => ({ workArea: mocks.workArea }),
			getDisplayMatching: () => ({ workArea: mocks.workArea }),
			on: vi.fn(),
			removeListener: vi.fn(),
		},
	}),
}));
vi.mock("./appPaths", () => ({ USER_DATA_PATH: "/nonexistent-recordly-test" }));
vi.mock("./rendererServer", () => ({ getPackagedRendererBaseUrl: vi.fn() }));

const originalPlatform = process.platform;

beforeEach(() => {
	vi.resetModules();
	mocks.listeners.clear();
	mocks.ozonePlatform = "x11";
	Object.defineProperty(process, "platform", { value: "linux" });
});
afterEach(() => {
	Object.defineProperty(process, "platform", { value: originalPlatform });
});

function send(channel: string, ...args: unknown[]) {
	const handler = mocks.listeners.get(channel);
	expect(handler).toBeDefined();
	handler!({}, ...args);
}

describe("Linux HUD window", () => {
	it("is window-manager controlled and removes the native application menu", async () => {
		const { createHudOverlayWindow } = await import("./windows");
		const win = createHudOverlayWindow();
		expect(win).toMatchObject({
			options: {
				focusable: true,
				skipTaskbar: true,
				autoHideMenuBar: true,
				maximizable: false,
			},
		});
		expect(win.setMenu).toHaveBeenCalledWith(null);
	});

	it("expands for menus on Linux and compacts after leaving, without ignoring mouse events", async () => {
		const { createHudOverlayWindow } = await import("./windows");
		const win = createHudOverlayWindow();
		const compact = win.getBounds();
		send("hud-overlay-set-ignore-mouse", false);
		expect(win.getBounds().height).toBe(540);
		expect(win.getBounds().y + win.getBounds().height).toBe(compact.y + compact.height);
		send("hud-overlay-set-ignore-mouse", true);
		expect(win.getBounds()).toEqual(compact);
		expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
	});

	it("compensates toolbar layout when expanding a window dragged to the top edge", async () => {
		const { createHudOverlayWindow } = await import("./windows");
		const win = createHudOverlayWindow();
		const compact = { x: 300, y: 0, width: 860, height: 160 };
		win.setBounds(compact);
		send("hud-overlay-set-ignore-mouse", false);
		expect(win.webContents.send).toHaveBeenLastCalledWith("hud-overlay-toolbar-offset", -380);
		send("hud-overlay-set-ignore-mouse", true);
		expect(win.getBounds()).toEqual(compact);
		expect(win.webContents.send).toHaveBeenLastCalledWith("hud-overlay-toolbar-offset", 0);
	});

	it("moves the X11 window with pointer IPC, not just its renderer contents", async () => {
		const { createHudOverlayWindow } = await import("./windows");
		const win = createHudOverlayWindow();
		const bounds = win.getBounds();
		send("hud-overlay-drag", "start", bounds.x + 30, bounds.y + 40);
		send("hud-overlay-drag", "move", bounds.x + 130, bounds.y - 60);
		send("hud-overlay-drag", "end", bounds.x + 130, bounds.y - 60);
		expect(win.getBounds()).toEqual({ ...bounds, x: bounds.x + 100, y: bounds.y - 100 });
		// A stale pointer move after release cannot keep moving the toolbar.
		send("hud-overlay-drag", "move", 0, 0);
		expect(win.getBounds().x).toBe(bounds.x + 100);
	});

	it("leaves native Wayland movement to the compositor", async () => {
		mocks.ozonePlatform = "wayland";
		const { createHudOverlayWindow } = await import("./windows");
		const win = createHudOverlayWindow();
		const bounds = win.getBounds();
		send("hud-overlay-drag", "start", bounds.x, bounds.y);
		send("hud-overlay-drag", "move", 0, 0);
		expect(win.getBounds()).toEqual(bounds);
	});

	it("preserves a native X11 drag when recording state and hover change", async () => {
		const { createHudOverlayWindow, setHudOverlayRecordingActive } = await import("./windows");
		const win = createHudOverlayWindow();
		const dragged = { x: 300, y: 700, width: 860, height: 160 };
		win.setBounds(dragged);
		send("hud-overlay-set-ignore-mouse", false);
		setHudOverlayRecordingActive(true);
		expect(win.getBounds()).toEqual(dragged);
		send("hud-overlay-set-ignore-mouse", false);
		expect(win.getBounds()).toEqual(dragged);
	});
});
