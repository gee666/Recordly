import {
	CaretUpIcon,
	Eye,
	EyeSlash as EyeOff,
	VideoCamera as Video,
	VideoCameraSlash as VideoOff,
} from "@phosphor-icons/react";
import { useScopedT } from "@/contexts/I18nContext";
import { Button } from "@/components/ui/button";
import { DropdownItem, HudPopover } from "./PopoverScaffold";
import { useLaunchPopoverCoordinator } from "./LaunchPopoverCoordinator";
import type { DeviceOption } from "./launchPopoverTypes";
import { cloneElement, type ReactElement } from "react";

const POPOVER_ID = "webcam";

export function WebcamPopover({
	trigger,
	disabled,
	webcamEnabled,
	onToggleWebcam,
	onDisableWebcam,
	canToggleFloatingPreview,
	showFloatingWebcamPreview,
	onToggleFloatingPreview,
	showWebcamControls,
	setWebcamPreviewNode,
	videoDevices,
	webcamDeviceId,
	selectedVideoDeviceId,
	onSelectVideoDevice,
}: {
	trigger: ReactElement;
	disabled?: boolean;
	webcamEnabled: boolean;
	onToggleWebcam: () => void;
	onDisableWebcam: () => void;
	canToggleFloatingPreview: boolean;
	showFloatingWebcamPreview: boolean;
	onToggleFloatingPreview: () => void;
	showWebcamControls: boolean;
	setWebcamPreviewNode: (node: HTMLVideoElement | null) => void;
	videoDevices: DeviceOption[];
	webcamDeviceId?: string;
	selectedVideoDeviceId?: string;
	onSelectVideoDevice: (deviceId: string) => void;
}) {
	const t = useScopedT("launch");
	const { isOpen, requestOpen, requestClose } = useLaunchPopoverCoordinator();
	const open = isOpen(POPOVER_ID);

	return (
		<>
			{cloneElement(trigger, {
				onClick: onToggleWebcam,
				disabled,
				"aria-pressed": webcamEnabled,
			})}
			<HudPopover
				open={open}
				onOpenChange={(nextOpen) => {
					if (!nextOpen) {
						requestClose(POPOVER_ID);
						return;
					}
					if (disabled) {
						return;
					}
					requestOpen(POPOVER_ID);
				}}
				trigger={
					<Button
						variant="ghost"
						size="icon"
						className="w-5 -ml-2"
						disabled={disabled}
						title={t("recording.webcam")}
						aria-label={t("recording.webcam")}
					>
						<CaretUpIcon size={10} className={open ? "" : "rotate-180"} />
					</Button>
				}
				align="center"
			>
				<div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--launch-label)]">
					{t("recording.webcam")}
				</div>
				{webcamEnabled && (
					<>
						<DropdownItem
							icon={<VideoOff size={16} />}
							onClick={() => {
								onDisableWebcam();
								requestClose(POPOVER_ID);
							}}
						>
							{t("recording.turnOffWebcam")}
						</DropdownItem>
						{canToggleFloatingPreview ? (
							<DropdownItem
								icon={
									showFloatingWebcamPreview ? (
										<EyeOff size={16} />
									) : (
										<Eye size={16} />
									)
								}
								selected={showFloatingWebcamPreview}
								onClick={onToggleFloatingPreview}
							>
								{showFloatingWebcamPreview
									? t("recording.hideFloatingWebcamPreview")
									: t("recording.showFloatingWebcamPreview")}
							</DropdownItem>
						) : null}
					</>
				)}
				{!webcamEnabled && (
					<div className="px-3 py-2 text-xs text-[var(--launch-text-muted)]">
						{t("recording.selectWebcamToEnable")}
					</div>
				)}
				{showWebcamControls && (
					<div className="flex justify-center px-3 py-2">
						<div className="h-24 w-24 overflow-hidden rounded-2xl bg-[var(--launch-hover)] ring-1 ring-[var(--launch-border-strong)]">
							<video
								ref={setWebcamPreviewNode}
								className="h-full w-full object-cover"
								muted
								playsInline
								style={{ transform: "scaleX(-1)" }}
							/>
						</div>
					</div>
				)}
				{videoDevices.map((device) => (
					<DropdownItem
						key={device.deviceId}
						icon={
							webcamEnabled &&
							(webcamDeviceId === device.deviceId ||
								selectedVideoDeviceId === device.deviceId) ? (
								<Video size={16} />
							) : (
								<VideoOff size={16} />
							)
						}
						selected={
							webcamEnabled &&
							(webcamDeviceId === device.deviceId ||
								selectedVideoDeviceId === device.deviceId)
						}
						onClick={() => onSelectVideoDevice(device.deviceId)}
					>
						{device.label}
					</DropdownItem>
				))}
				{videoDevices.length === 0 && (
					<div className="text-center text-xs text-[var(--launch-text-muted)] py-4">
						{t("recording.noWebcamsFound")}
					</div>
				)}
			</HudPopover>
		</>
	);
}
