import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BrowserWindow, globalShortcut, ipcMain, screen, type Display } from "electron";
import {
	getRecordingRegionFromDesktopDrag,
	getRecordingOverlayGaps,
	type RecordingBounds,
	getRecordingRegionOutlineBounds,
	type RecordingPoint,
	type RecordingRegion,
} from "../src/lib/recordingRegion";

let pickerActive = false;
let selectedRegion: RecordingRegion | null = null;
let recording = false;
let outlineWindows: BrowserWindow[] = [];
let previewTimer: ReturnType<typeof setTimeout> | null = null;
const PICKER_EVENT = "recording-region-picker-event";
const PICKER_STATE = "recording-region-picker-state";

function closeOutline() {
	for (const win of outlineWindows) if (!win.isDestroyed()) win.close();
	outlineWindows = [];
}

function showOutline() {
	closeOutline();
	if (!selectedRegion) return;
	for (const bounds of getRecordingRegionOutlineBounds(selectedRegion)) {
		const win = new BrowserWindow({
			...bounds,
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
			webPreferences: { nodeIntegration: false, contextIsolation: true },
		});
		win.setMenu(null);
		win.setIgnoreMouseEvents(true);
		win.setAlwaysOnTop(true, "screen-saver");
		outlineWindows.push(win);
		void win
			.loadURL("data:text/html,<html style='background:%233d8bff'></html>")
			.then(() => {
				if (!win.isDestroyed()) win.showInactive();
			})
			.catch(() => {
				if (!win.isDestroyed()) win.close();
			});
	}
}

export function setSelectedRecordingRegion(region: RecordingRegion | null) {
	selectedRegion = region;
	if (previewTimer) clearTimeout(previewTimer);
	previewTimer = null;
	if (recording) showOutline();
	else closeOutline();
}

/** Called by the existing HUD recording-state lifecycle; remains visible when paused. */
export function setRecordingRegionOutlineActive(active: boolean) {
	recording = active;
	if (previewTimer) clearTimeout(previewTimer);
	previewTimer = null;
	if (active) showOutline();
	else closeOutline();
}

export function previewRecordingRegionOutline() {
	if (previewTimer) clearTimeout(previewTimer);
	showOutline();
	previewTimer = setTimeout(() => {
		previewTimer = null;
		if (!recording) closeOutline();
	}, 1700);
}

interface PickerOverlay {
	win: BrowserWindow;
	viewportBounds: RecordingBounds;
	controls: boolean;
	display: Pick<Display, "id" | "bounds">;
}

/** X11 desktop overlays. The drag-start window, not the cursor at confirmation,
 * determines the display. Coordinates returned to the recorder are display-local DIPs.
 * No thumbnail, app renderer, or application preload is involved.
 */
export function selectRecordingRegion(displays: Display[]): Promise<RecordingRegion | null> {
	if (pickerActive) throw new Error("An area selection is already open");
	if (
		!displays.length ||
		displays.some(
			({ bounds }) =>
				![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite) ||
				bounds.width < 16 ||
				bounds.height < 16,
		)
	)
		throw new Error("No usable displays for area selection");
	pickerActive = true;
	if (previewTimer) clearTimeout(previewTimer);
	previewTimer = null;
	closeOutline();

	return new Promise((resolve, reject) => {
		const overlays: PickerOverlay[] = [];
		let directory: string | undefined;
		let settled = false;
		let ownsEscape = false;
		let ownsEnter = false;
		let active: PickerOverlay | undefined;
		let start: RecordingPoint | undefined;
		let region: RecordingRegion | null = null;
		let dragging = false;

		const finish = (result: RecordingRegion | null, error?: unknown) => {
			if (settled) return;
			settled = true;
			ipcMain.removeListener(PICKER_EVENT, onEvent);
			screen.removeListener("display-added", cancel);
			screen.removeListener("display-removed", cancel);
			screen.removeListener("display-metrics-changed", displayChanged);
			if (ownsEscape) globalShortcut.unregister("Escape");
			if (ownsEnter) globalShortcut.unregister("Enter");
			for (const { win } of overlays) {
				if (!win.isDestroyed()) win.destroy();
			}
			if (directory) {
				try {
					rmSync(directory, { recursive: true, force: true });
				} catch (cleanupError) {
					console.warn("Could not remove area picker temporary files:", cleanupError);
				}
			}
			pickerActive = false;
			if (error) reject(error);
			else resolve(result);
		};
		const cancel = () => finish(null);
		const confirm = () => {
			if (!dragging && region) finish(region);
		};
		const displayChanged = (_event: Electron.Event, _display: Display, metrics: string[]) => {
			if (metrics.some((metric) => ["bounds", "scaleFactor", "rotation"].includes(metric)))
				cancel();
		};
		const publish = () => {
			for (const overlay of overlays) {
				if (overlay.win.isDestroyed()) continue;
				const bounds = overlay.win.getBounds();
				overlay.win.webContents.send(PICKER_STATE, {
					active: overlay.display.id === active?.display.id,
					controls: overlay.controls,
					locked: dragging && overlay !== active,
					dragging,
					// Main-process coordinates account for any native placement adjustment.
					rectangle:
						overlay.display.id === active?.display.id && region
							? {
									x: region.displayBounds.x + region.x - bounds.x,
									y: region.displayBounds.y + region.y - bounds.y,
									width: region.width,
									height: region.height,
								}
							: null,
				});
			}
		};
		const onEvent = (event: Electron.IpcMainEvent, message: unknown) => {
			if (settled || !message || typeof message !== "object") return;
			const overlay = overlays.find(
				({ win }) => !win.isDestroyed() && event.sender === win.webContents,
			);
			if (!overlay || (event.senderFrame && event.senderFrame !== event.sender.mainFrame))
				return;
			const input = message as { type?: string; x?: number; y?: number };
			if (input.type === "cancel") {
				cancel();
				return;
			}
			if (input.type === "confirm") {
				if (overlay.display.id === active?.display.id) confirm();
				return;
			}
			if (input.type === "abort") {
				if (overlay === active) {
					dragging = false;
					region = null;
					start = undefined;
					publish();
				}
				return;
			}
			if (
				typeof input.x !== "number" ||
				typeof input.y !== "number" ||
				!Number.isFinite(input.x) ||
				!Number.isFinite(input.y)
			)
				return;
			const bounds = overlay.win.getBounds();
			const point = { x: bounds.x + input.x, y: bounds.y + input.y };
			if (input.type === "start") {
				if (dragging) return;
				const display = overlay.display.bounds;
				if (
					point.x < display.x ||
					point.y < display.y ||
					point.x >= display.x + display.width ||
					point.y >= display.y + display.height
				)
					return;
				active = overlay;
				start = point;
				region = null;
				dragging = true;
			} else if (
				(input.type === "move" || input.type === "end") &&
				dragging &&
				active === overlay &&
				start
			) {
				region = getRecordingRegionFromDesktopDrag(
					start,
					point,
					String(overlay.display.id),
					overlay.display.bounds,
				);
				if (input.type === "end") dragging = false;
			} else return;
			publish();
		};

		try {
			// These X11 override-redirect windows intentionally cannot steal focus.
			// Reserve Escape before showing any overlay so cancellation is always available.
			ownsEscape =
				!globalShortcut.isRegistered("Escape") && globalShortcut.register("Escape", cancel);
			if (!ownsEscape)
				throw new Error(
					"Escape is unavailable for area selection. Close the other selection dialog and try again.",
				);
			ownsEnter =
				!globalShortcut.isRegistered("Enter") && globalShortcut.register("Enter", confirm);
			// An isolated, tiny preload avoids depending on the app's privileged API or
			// data-URL navigation. Only this session's window senders are accepted above.
			directory = mkdtempSync(path.join(os.tmpdir(), "recordly-area-"));
			const preload = path.join(directory, "preload.cjs");
			const page = path.join(directory, "picker.html");
			writeFileSync(preload, PICKER_PRELOAD, { mode: 0o600 });
			writeFileSync(page, PICKER_HTML, { mode: 0o600 });
			ipcMain.on(PICKER_EVENT, onEvent);
			screen.on("display-added", cancel);
			screen.on("display-removed", cancel);
			screen.on("display-metrics-changed", displayChanged);
			const createOverlay = (
				display: Display,
				viewportBounds: RecordingBounds,
				controls: boolean,
			) => {
				const win = new BrowserWindow({
					...viewportBounds,
					frame: false,
					transparent: true,
					backgroundColor: "#00000000",
					resizable: false,
					movable: false,
					maximizable: false,
					fullscreenable: false,
					focusable: false,
					skipTaskbar: true,
					alwaysOnTop: true,
					hasShadow: false,
					show: false,
					enableLargerThanScreen: true,
					webPreferences: {
						preload,
						contextIsolation: true,
						nodeIntegration: false,
						sandbox: true,
						backgroundThrottling: false,
						partition: "recordly-region-picker",
					},
				});
				overlays.push({
					win,
					viewportBounds,
					controls,
					display: { id: display.id, bounds: { ...display.bounds } },
				});
				win.setMenu(null);
				win.setAlwaysOnTop(true, "screen-saver");
				win.setIgnoreMouseEvents(false);
				win.webContents.setZoomFactor(1);
				win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
				win.webContents.on("will-navigate", (event) => event.preventDefault());
				win.webContents.once("render-process-gone", () =>
					finish(
						null,
						new Error("The area picker closed unexpectedly. Please try again."),
					),
				);
				win.once("closed", cancel);
				return win;
			};
			for (const display of displays) {
				const main = createOverlay(display, display.bounds, true);
				// Chromium/X11 clips screen-sized popups by one pixel on this platform.
				// Input-catching edge strips make even the last row/column selectable.
				for (const gap of getRecordingOverlayGaps(display.bounds, main.getBounds())) {
					createOverlay(display, gap, false);
				}
			}
			void Promise.all(overlays.map(({ win }) => win.loadFile(page)))
				.then(() => {
					if (settled) return;
					for (const { win, viewportBounds } of overlays) {
						win.showInactive();
						win.setBounds(viewportBounds, false);
						// Reassert after mapping, not just before: selection must never pass clicks through.
						win.setIgnoreMouseEvents(false);
					}
					publish();
				})
				.catch((error) => finish(null, error));
		} catch (error) {
			finish(null, error);
		}
	});
}

const PICKER_PRELOAD = `const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('regionPicker',{
 send:message=>ipcRenderer.send('${PICKER_EVENT}',message),
 onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('${PICKER_STATE}',listener);return ()=>ipcRenderer.removeListener('${PICKER_STATE}',listener)}
});`;

const PICKER_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Select recording area</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;font:14px system-ui;color:#fff;cursor:crosshair;user-select:none;touch-action:none}body{background:rgba(0,0,0,.3)}
#selection{position:fixed;display:none;border:2px solid #3d8bff;box-shadow:0 0 0 99999px rgba(0,0,0,.3);pointer-events:none}
header,aside{position:fixed;left:50%;transform:translateX(-50%);padding:12px 18px;border-radius:12px;background:#121218;z-index:2;cursor:default}header{top:24px;pointer-events:none;white-space:nowrap}aside{bottom:24px;display:flex;gap:12px;align-items:center;white-space:nowrap}
button{border:0;border-radius:8px;padding:10px 16px;background:#3d8bff;color:white;font:inherit;cursor:pointer}button:disabled{opacity:.4;cursor:default}#cancel{background:#34343c}
</style></head><body><div id="selection"></div><header id="hint">Drag an area on any monitor · Escape cancels</header><aside><span id="size">Select an area</span><button id="confirm" disabled>Use area</button><button id="cancel">Cancel</button></aside><script>
const box=document.getElementById('selection'),hint=document.getElementById('hint'),confirm=document.getElementById('confirm'),size=document.getElementById('size');let pointer=null,locked=false;
const send=(type,e)=>window.regionPicker.send({type,...(e?{x:e.clientX,y:e.clientY}:{})});
window.regionPicker.onState(state=>{locked=state.locked;hint.style.display=state.controls?'block':'none';document.querySelector('aside').style.display=state.controls?'flex':'none';const r=state.rectangle;box.style.display=r?'block':'none';document.body.style.background=r?'transparent':'rgba(0,0,0,.3)';if(r)Object.assign(box.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});confirm.disabled=!r||state.dragging;size.textContent=r?r.width+' × '+r.height+' DIP':'Select an area';hint.textContent=state.locked?'Selection stays on the monitor where you started':r?'Use area to confirm, or drag again · Escape cancels':'Drag an area on any monitor · Escape cancels'});
window.addEventListener('pointerdown',e=>{if(e.button!==0||pointer!==null||locked||e.target.closest('aside'))return;e.preventDefault();pointer=e.pointerId;document.body.setPointerCapture(pointer);send('start',e)});
window.addEventListener('pointermove',e=>{if(pointer===e.pointerId)send('move',e)});
window.addEventListener('pointerup',e=>{if(pointer!==e.pointerId)return;pointer=null;send('end',e);if(document.body.hasPointerCapture(e.pointerId))document.body.releasePointerCapture(e.pointerId)});
const abort=e=>{if(pointer!==e.pointerId)return;pointer=null;send('abort')};window.addEventListener('pointercancel',abort);document.body.addEventListener('lostpointercapture',abort);
confirm.onclick=()=>send('confirm');document.getElementById('cancel').onclick=()=>send('cancel');
window.addEventListener('keydown',e=>{if(e.key==='Escape')send('cancel');if(e.key==='Enter')send('confirm')});
</script></body></html>`;
