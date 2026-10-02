import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { useScopedT } from "@/contexts/I18nContext";
import { cn } from "@/lib/utils";
import { SliderControl } from "./SliderControl";
import { SPEED_SECTION_PRESETS } from "./speedSection";
import { getPreviewPlaybackRateRange } from "./videoPlayback/playbackRate";

interface ClipSpeedControlsProps {
	speed: number | null;
	onChange: (speed: number) => void;
}

/** Speed slider plus one-click presets, shared by the clip and speed-section panels. */
export function ClipSpeedControls({ speed, onChange }: ClipSpeedControlsProps) {
	const tSettings = useScopedT("settings");
	const range = useMemo(getPreviewPlaybackRateRange, []);
	// Presets the preview cannot play are hidden rather than shown disabled.
	const presets = SPEED_SECTION_PRESETS.filter(
		(preset) => preset >= range.min && preset <= range.max,
	);
	const isUnsupported = speed !== null && (speed < range.min || speed > range.max);

	return (
		<>
			<SliderControl
				label={tSettings("speed.label", "Speed")}
				value={Math.min(range.max, Math.max(range.min, speed ?? 1))}
				defaultValue={1}
				min={range.min}
				max={range.max}
				step={0.25}
				onChange={onChange}
				formatValue={(value) => `${value}×`}
				parseInput={(text) => Number.parseFloat(text)}
			/>
			<div className="grid grid-cols-6 gap-1.5">
				{presets.map((preset) => (
					<Button
						key={preset}
						type="button"
						onClick={() => onChange(preset)}
						className={cn(
							"h-auto w-full rounded-lg border px-1 py-2 text-center shadow-sm transition-all duration-200 ease-out cursor-pointer",
							speed === preset
								? "border-[#f59e0b] bg-[#f59e0b] text-black"
								: "border-foreground/5 bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:border-foreground/10 hover:text-foreground",
						)}
					>
						<span className="text-xs font-semibold">{preset}×</span>
					</Button>
				))}
			</div>
			{isUnsupported && (
				<p className="text-[11px] text-muted-foreground" role="status">
					{speed}× —{" "}
					{tSettings("speed.unsupported", "Not supported for preview on this device")}
				</p>
			)}
		</>
	);
}
