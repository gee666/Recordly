import {
	isLikelyLinuxWaylandSession,
	LINUX_PORTAL_SCREEN_SOURCE_ID,
} from "./ipc/register/sourceMapping";

type CaptureSource = { id: string; name: string };

/** Resolve desktop capture without ever substituting an unrelated window. */
export async function resolveDisplayCaptureSource({
	sourceId,
	platform,
	env,
	getSources,
}: {
	sourceId: string | null | undefined;
	platform: string;
	env: NodeJS.ProcessEnv;
	getSources: (types: ("screen" | "window")[]) => Promise<CaptureSource[]>;
}): Promise<CaptureSource | undefined> {
	const defaultScreen = !sourceId || sourceId === LINUX_PORTAL_SCREEN_SOURCE_ID;
	if (platform === "linux" && isLikelyLinuxWaylandSession(env) && defaultScreen) {
		// Enumerating here opens an extra portal picker and yields stale IDs.
		return { id: "screen:0:0", name: "Entire screen" };
	}

	// X11 needs an actual Electron source ID, not Wayland's synthetic ID.
	const sources = await getSources(defaultScreen ? ["screen"] : ["screen", "window"]);
	const source = defaultScreen
		? sources.find((candidate) => candidate.id.startsWith("screen:"))
		: sources.find((candidate) => candidate.id === sourceId);
	return source ? { id: source.id, name: source.name } : undefined;
}
