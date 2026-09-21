import { useCallback, useEffect, useMemo, useRef, type ReactNode, useState } from "react";
import { toast } from "sonner";
import { SourceSelector } from "../SourceSelector";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import {
	mapRawSource,
	isScreenSource,
	isWindowSource,
	type DesktopSource,
} from "./launchPopoverTypes";

const POPOVER_ID = "sources";

export function SourcePopover({
	trigger,
	selectedSource,
	onSourceSelect,
	onOpen,
	allowRegionSelection = false,
	disabled = false,
}: {
	trigger: ReactNode;
	selectedSource: string;
	onSourceSelect: (source: DesktopSource) => Promise<void> | void;
	onOpen?: () => void;
	allowRegionSelection?: boolean;
	disabled?: boolean;
}) {
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const [sources, setSources] = useState<DesktopSource[]>([]);
	const [loading, setLoading] = useState(false);
	const open = isOpen(POPOVER_ID) && !disabled;
	const disabledRef = useRef(disabled);
	disabledRef.current = disabled;
	useEffect(() => {
		if (disabled) requestClose(POPOVER_ID);
	}, [disabled, requestClose]);

	const fetchSources = useCallback(async () => {
		if (!window.electronAPI) return;
		setLoading(true);
		try {
			const rawSources = await window.electronAPI.getSources({
				types: ["screen", "window"],
				thumbnailSize: { width: 160, height: 90 },
				fetchWindowIcons: true,
			});
			setSources(rawSources.map((s) => mapRawSource(s as DesktopSource)));
		} catch (error) {
			console.error("Failed to fetch sources:", error);
		} finally {
			setLoading(false);
		}
	}, []);

	const screenSources = useMemo(() => sources.filter(isScreenSource), [sources]);
	const windowSources = useMemo(() => sources.filter(isWindowSource), [sources]);

	return (
		<SourceSelector
			screenSources={screenSources}
			windowSources={windowSources}
			selectedSource={selectedSource}
			loading={loading}
			onSourceSelect={async (source) => {
				if (disabledRef.current) return;
				try {
					await onSourceSelect(source);
					requestClose(POPOVER_ID);
				} catch (error) {
					console.error("Failed to select source:", error);
				}
			}}
			onSelectRegion={
				allowRegionSelection
					? async () => {
							if (disabledRef.current) return;
							requestClose(POPOVER_ID);
							try {
								const result = await window.electronAPI.selectRecordingRegion();
								if (result.canceled || disabledRef.current) return;
								if (!result.success || !result.source)
									throw new Error(
										result.error || "Unable to select recording area",
									);
								await onSourceSelect(result.source);
							} catch (error) {
								toast.error(error instanceof Error ? error.message : String(error));
							}
						}
					: undefined
			}
			onFetchSources={fetchSources}
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					requestClose(POPOVER_ID);
					return;
				}
				if (disabledRef.current) return;
				onOpen?.();
				requestOpen(POPOVER_ID);
			}}
		>
			{trigger}
		</SourceSelector>
	);
}
