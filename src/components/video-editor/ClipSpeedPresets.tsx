import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SPEED_SECTION_PRESETS } from "./speedSection";

interface ClipSpeedPresetsProps {
	speed: number | null;
	/** Speeds the preview can play; presets outside it are hidden. */
	range: { min: number; max: number };
	onSelect: (speed: number) => void;
}

export function ClipSpeedPresets({ speed, range, onSelect }: ClipSpeedPresetsProps) {
	const presets = SPEED_SECTION_PRESETS.filter(
		(preset) => preset >= range.min && preset <= range.max,
	);

	return (
		<div className="grid grid-cols-6 gap-1.5">
			{presets.map((preset) => (
				<Button
					key={preset}
					type="button"
					onClick={() => onSelect(preset)}
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
	);
}
