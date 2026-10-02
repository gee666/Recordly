import { globalShortcut, screen } from "electron";
import { supportsHudCaptureProtection } from "../src/lib/hudCaptureProtection";
import type { RecordingBounds } from "../src/lib/recordingRegion";
import {
	findPositionOutside,
	getCapturedRect,
	getTopCenter,
	type Point,
	rectsIntersect,
} from "./captureArea";
import { selectedSource } from "./ipc/state";
import { closeRecordingHint, RECORDING_HINT_SIZE, showRecordingHint } from "./recordingHintWindow";
import {
	getCountdownWindow,
	getHudOverlayCaptureProtectionEnabled,
	getHudOverlayWindow,
} from "./windows";

/** Not a GNOME/Ubuntu default and unlike Ctrl+Shift+<key>, not used by common editors or browsers. */
export const STOP_RECORDING_SHORTCUT = "Ctrl+Alt+Shift+S";

const HINT_DURATION_MS = 8000;
const HINT_SCREEN_MARGIN = 24;

interface HudAutoHideDeps {
	stopRecording: () => void;
	showHud: () => boolean;
	/** Whether the app keeps a tray icon whose menu can show the controls and stop. */
	trayAvailable: boolean;
}

let deps: HudAutoHideDeps | null = null;
let shortcutRegistered = false;
let hudHidden = false;
let hintTimer: ReturnType<typeof setTimeout> | null = null;

export function configureHudAutoHide(options: HudAutoHideDeps) {
	deps = options;
}

/** Label for menus; null when the shortcut is not active. */
export function getActiveStopShortcut(): string | null {
	return shortcutRegistered ? STOP_RECORDING_SHORTCUT : null;
}

/** Capture rectangle the visible HUD would be recorded in, or null when it is safe. */
function getCaptureCoveringHud(): RecordingBounds | null {
	if (supportsHudCaptureProtection(process.platform) && getHudOverlayCaptureProtectionEnabled()) {
		return null;
	}
	const hud = getHudOverlayWindow();
	if (!hud || !hud.isVisible()) return null;
	const captured = getCapturedRect(selectedSource, screen.getAllDisplays());
	return captured && rectsIntersect(captured, hud.getBounds()) ? captured : null;
}

function getHintText(shortcut: boolean, tray: boolean): string {
	const ways = [
		shortcut && `press ${STOP_RECORDING_SHORTCUT}`,
		tray && "use the Recordly icon in the top bar",
	].filter(Boolean);
	return `Controls hide while recording. To stop, ${ways.join(" or ")}.`;
}

function findHintPositionOutside(captured: RecordingBounds): Point | null {
	return findPositionOutside(
		captured,
		screen.getAllDisplays().map((display) => display.workArea),
		RECORDING_HINT_SIZE,
		HINT_SCREEN_MARGIN,
	);
}

/** Probe without keeping the key, so the countdown hint is honest about the shortcut. */
function isStopShortcutFree(): boolean {
	if (!globalShortcut.register(STOP_RECORDING_SHORTCUT, () => undefined)) return false;
	globalShortcut.unregister(STOP_RECORDING_SHORTCUT);
	return true;
}

/**
 * Frames are not produced during the countdown, so the hint may sit on the
 * recorded area then; it closes together with the countdown window.
 */
export function showHudAutoHideCountdownHint() {
	const captured = getCaptureCoveringHud();
	const countdown = getCountdownWindow();
	if (!deps || !captured || !countdown) return;
	const shortcut = isStopShortcutFree();
	if (!shortcut && !deps.trayAvailable) return;
	const position =
		findHintPositionOutside(captured) ??
		getTopCenter(
			screen.getDisplayMatching(captured).workArea,
			RECORDING_HINT_SIZE,
			HINT_SCREEN_MARGIN,
		);
	showRecordingHint(getHintText(shortcut, deps.trayAvailable), position);
	countdown.once("closed", closeRecordingHint);
}

function release() {
	if (shortcutRegistered) {
		globalShortcut.unregister(STOP_RECORDING_SHORTCUT);
		shortcutRegistered = false;
	}
	if (hintTimer) clearTimeout(hintTimer);
	hintTimer = null;
	closeRecordingHint();
	if (hudHidden) {
		hudHidden = false;
		deps?.showHud();
	}
}

/**
 * Hides the HUD while it would be recorded, and brings it back when the
 * recording ends. The controls can still be reached through the global stop
 * shortcut and the tray menu; without either, the HUD stays visible.
 */
export function setHudAutoHideRecording(recording: boolean) {
	if (recording && hudHidden) return;
	release();
	const captured = recording ? getCaptureCoveringHud() : null;
	const hud = getHudOverlayWindow();
	if (!deps || !captured || !hud) return;
	const { stopRecording, trayAvailable } = deps;
	shortcutRegistered = globalShortcut.register(STOP_RECORDING_SHORTCUT, stopRecording);
	if (!shortcutRegistered && !trayAvailable) return;

	hud.hide();
	hudHidden = true;
	// Frames are already being captured, so only a spot outside the recording is safe.
	const position = findHintPositionOutside(captured);
	if (!position) return;
	showRecordingHint(getHintText(shortcutRegistered, trayAvailable), position);
	hintTimer = setTimeout(closeRecordingHint, HINT_DURATION_MS);
}
