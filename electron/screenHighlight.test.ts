import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
	windows: [] as any[],
	load: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("electron", () => ({
	BrowserWindow: vi.fn(function (options) {
		const win = {
			options,
			destroyed: false,
			setMenu: vi.fn(),
			setIgnoreMouseEvents: vi.fn(),
			setAlwaysOnTop: vi.fn(),
			loadURL: mocks.load,
			showInactive: vi.fn(),
			on: vi.fn(),
			isDestroyed() {
				return this.destroyed;
			},
			close: vi.fn(function () {
				win.destroyed = true;
			}),
		};
		mocks.windows.push(win);
		return win;
	}),
}));
import {
	clearScreenHighlight,
	getScreenHighlightStrips,
	showScreenHighlight,
} from "./screenHighlight";

afterEach(() => {
	clearScreenHighlight();
	vi.useRealTimers();
	mocks.windows.length = 0;
	mocks.load.mockReset().mockResolvedValue(undefined);
});

describe("screen highlight placement", () => {
	it("cancels borders before capture even if their renderer loads late", async () => {
		vi.useFakeTimers();
		let resolve!: () => void;
		mocks.load.mockReturnValue(
			new Promise<void>((done) => {
				resolve = done;
			}),
		);
		const pending = showScreenHighlight({ x: 1920, y: 0, width: 1920, height: 1080 });
		clearScreenHighlight();
		resolve();
		await pending;
		for (const win of mocks.windows) {
			expect(win.close).toHaveBeenCalledOnce();
			expect(win.showInactive).not.toHaveBeenCalled();
		}
		expect(vi.getTimerCount()).toBe(0);
	});
	it.each([
		{ x: 0, y: 0, width: 1920, height: 1080 },
		{ x: 1920, y: 0, width: 1920, height: 1080 },
		{ x: -2560, y: -200, width: 2560, height: 1440 },
	])("never creates an oversized/off-monitor window for %s", (display) => {
		const strips = getScreenHighlightStrips(display);
		expect(strips).toHaveLength(4);
		for (const strip of strips) {
			expect(strip.x).toBeGreaterThanOrEqual(display.x);
			expect(strip.y).toBeGreaterThanOrEqual(display.y);
			expect(strip.x + strip.width).toBeLessThanOrEqual(display.x + display.width);
			expect(strip.y + strip.height).toBeLessThanOrEqual(display.y + display.height);
		}
	});

	it("shows click-through strips on the right-hand monitor and closes every strip", async () => {
		vi.useFakeTimers();
		await showScreenHighlight({ x: 1920, y: 0, width: 1920, height: 1080 });
		expect(mocks.windows).toHaveLength(4);
		for (const win of mocks.windows) {
			expect(win.options.x).toBeGreaterThanOrEqual(1920);
			expect(win.setIgnoreMouseEvents).toHaveBeenCalledWith(true);
			expect(win.showInactive).toHaveBeenCalledOnce();
		}
		vi.advanceTimersByTime(1800);
		for (const win of mocks.windows) expect(win.close).toHaveBeenCalledOnce();
	});
});
