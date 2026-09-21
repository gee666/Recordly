export interface HudOverlayTaskbarOptions {
	skipTaskbar: boolean;
	focusable: boolean;
}

// Wayland prohibits client-positioned windows; X11 supports setBounds dragging.
export function supportsHudOverlayWindowPositioning(
	platform: NodeJS.Platform,
	sessionType: string | undefined,
	ozonePlatform = "",
): boolean {
	if (platform !== "linux") return true;
	if (ozonePlatform === "x11") return true;
	if (ozonePlatform === "wayland") return false;
	return sessionType !== "wayland";
}

export function getHudOverlayTaskbarOptions(platform: NodeJS.Platform): HudOverlayTaskbarOptions {
	const showInWindowsTaskbar = platform === "win32";
	return {
		skipTaskbar: !showInWindowsTaskbar,
		// On Linux, focusable:false makes Electron bypass the window manager.
		// That breaks native dragging and keyboard interaction with HUD menus.
		focusable: showInWindowsTaskbar || platform === "linux",
	};
}
