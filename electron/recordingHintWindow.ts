import { BrowserWindow } from "electron";
import type { Point, Size } from "./captureArea";

export const RECORDING_HINT_SIZE: Size = { width: 480, height: 72 };

const HINT_STYLE = [
	"margin:0",
	"height:100vh",
	"box-sizing:border-box",
	"padding:0 20px",
	"display:flex",
	"align-items:center",
	"justify-content:center",
	"text-align:center",
	"border-radius:14px",
	"background:rgba(18,18,22,0.92)",
	"color:#fff",
	"font:500 14px/1.4 system-ui,sans-serif",
].join(";");

let hintWindow: BrowserWindow | null = null;

export function closeRecordingHint() {
	if (hintWindow && !hintWindow.isDestroyed()) hintWindow.close();
	hintWindow = null;
}

/** A click-through, non-focusable toast so it never steals input from the recorded app. */
export function showRecordingHint(text: string, position: Point) {
	closeRecordingHint();
	const win = new BrowserWindow({
		...position,
		...RECORDING_HINT_SIZE,
		frame: false,
		transparent: true,
		backgroundColor: "#00000000",
		resizable: false,
		movable: false,
		focusable: false,
		skipTaskbar: true,
		alwaysOnTop: true,
		hasShadow: false,
		show: false,
		webPreferences: { nodeIntegration: false, contextIsolation: true },
	});
	hintWindow = win;
	win.setMenu(null);
	win.setIgnoreMouseEvents(true);
	win.setAlwaysOnTop(true, "screen-saver");
	const html = `<body style="${HINT_STYLE}">${text}</body>`;
	void win
		.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
		.then(() => {
			if (!win.isDestroyed()) win.showInactive();
		})
		.catch(() => {
			if (!win.isDestroyed()) win.close();
		});
}
