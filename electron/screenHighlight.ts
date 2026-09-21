import { BrowserWindow, type Rectangle } from "electron";

/** Keep screen highlights within the selected display. A single padded fullscreen
 * window exceeds X11's work area and can be moved onto a different monitor by the WM.
 */
export function getScreenHighlightStrips(bounds: Rectangle, thickness = 3): Rectangle[] {
	const { x, y, width, height } = bounds;
	if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return [];
	const t = Math.max(1, Math.min(thickness, width, height));
	return [
		{ x, y, width, height: t },
		{ x, y: y + height - t, width, height: t },
		{ x, y, width: t, height },
		{ x: x + width - t, y, width: t, height },
	];
}

let dismissHighlight = () => {};

export function clearScreenHighlight(): void {
	dismissHighlight();
}

export async function showScreenHighlight(bounds: Rectangle): Promise<void> {
	clearScreenHighlight();
	const windows: BrowserWindow[] = [];
	let cancelled = false;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const close = () => {
		cancelled = true;
		if (timer) clearTimeout(timer);
		for (const win of windows) if (!win.isDestroyed()) win.close();
		if (dismissHighlight === close) dismissHighlight = () => {};
	};
	dismissHighlight = close;
	try {
		await Promise.all(
			getScreenHighlightStrips(bounds).map(async (strip) => {
				const win = new BrowserWindow({
					...strip,
					frame: false,
					transparent: true,
					backgroundColor: "#3d8bff",
					resizable: false,
					movable: false,
					focusable: false,
					skipTaskbar: true,
					alwaysOnTop: true,
					hasShadow: false,
					show: false,
					webPreferences: {
						nodeIntegration: false,
						contextIsolation: true,
						sandbox: true,
					},
				});
				windows.push(win);
				win.setMenu(null);
				win.setIgnoreMouseEvents(true);
				win.setAlwaysOnTop(true, "screen-saver");
				await win.loadURL("data:text/html,<html style='background:%233d8bff'></html>");
				if (!cancelled && !win.isDestroyed()) win.showInactive();
			}),
		);
		if (cancelled) return;
		timer = setTimeout(close, 1700);
		for (const win of windows)
			win.on("closed", () => {
				if (windows.every((candidate) => candidate.isDestroyed())) clearTimeout(timer);
			});
	} catch (error) {
		if (cancelled) return;
		close();
		throw error;
	}
}
