export const LINUX_PORTAL_SCREEN_SOURCE_ID = "screen:linux-portal";

/** Electron's X11 screen IDs can be 64-bit while Chromium exposes their low 32 bits.
 * Large Electron IDs lose a few low bits when marshalled into a JS number. Match
 * only a unique candidate within that number's rounding precision, never list order.
 */
export function matchLinuxScreenSource<T extends { display_id: string }>(
	displayId: number,
	sources: T[],
): T | undefined {
	const exact = sources.filter((source) => source.display_id === String(displayId));
	if (exact.length === 1) return exact[0];
	if (!Number.isFinite(displayId) || !Number.isInteger(displayId)) return undefined;
	const lowBits = Number(BigInt(displayId) & 0xffffffffn);
	const tolerance = Math.max(0.5, 2 ** (Math.floor(Math.log2(Math.abs(displayId) || 1)) - 53));
	const matches = sources.filter((source) => {
		if (!/^\d+$/.test(source.display_id)) return false;
		const id = Number(source.display_id);
		if (id < 0 || id > 0xffffffff) return false;
		const distance = Math.abs(lowBits - id);
		return Math.min(distance, 0x100000000 - distance) <= tolerance;
	});
	return matches.length === 1 ? matches[0] : undefined;
}

export function isLikelyLinuxWaylandSession(env: NodeJS.ProcessEnv) {
	const sessionType = env.XDG_SESSION_TYPE?.trim().toLowerCase();
	if (sessionType === "wayland") {
		return true;
	}
	if (sessionType === "x11") {
		return false;
	}

	return Boolean(env.WAYLAND_DISPLAY);
}

export function getScreenSourceIdForDisplay({
	displayId,
	env = process.env,
	matchedSourceId,
	platform,
}: {
	displayId: string;
	env?: NodeJS.ProcessEnv;
	matchedSourceId?: string | null;
	platform: NodeJS.Platform | string;
}) {
	if (matchedSourceId) {
		return matchedSourceId;
	}

	if (platform === "linux" && isLikelyLinuxWaylandSession(env)) {
		return LINUX_PORTAL_SCREEN_SOURCE_ID;
	}

	return `screen:fallback:${displayId}`;
}
