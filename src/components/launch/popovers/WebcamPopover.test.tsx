import { Children, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WebcamPopover } from "./WebcamPopover";

const coordinator = vi.hoisted(() => ({
	isOpen: vi.fn(() => false),
	requestOpen: vi.fn(),
	requestClose: vi.fn(),
}));
vi.mock("./LaunchPopoverCoordinator", () => ({
	useLaunchPopoverCoordinator: () => coordinator,
}));
vi.mock("@/contexts/I18nContext", () => ({ useScopedT: () => (key: string) => key }));
vi.mock("./PopoverScaffold", () => ({ HudPopover: () => null, DropdownItem: () => null }));

function renderControl(webcamEnabled: boolean, onToggleWebcam: () => void, disabled = false) {
	const element = WebcamPopover({
		trigger: <button type="button">Camera</button>,
		disabled,
		webcamEnabled,
		onToggleWebcam,
		onDisableWebcam: vi.fn(),
		canToggleFloatingPreview: false,
		showFloatingWebcamPreview: false,
		onToggleFloatingPreview: vi.fn(),
		showWebcamControls: webcamEnabled,
		setWebcamPreviewNode: vi.fn(),
		videoDevices: [],
		onSelectVideoDevice: vi.fn(),
	});
	return Children.toArray(element.props.children) as ReactElement[];
}

beforeEach(() => vi.clearAllMocks());

describe("webcam toolbar control", () => {
	it("uses the camera button to toggle both on and off, not just open a menu", () => {
		let enabled = false;
		const toggle = vi.fn(() => {
			enabled = !enabled;
		});
		const [offButton] = renderControl(enabled, toggle);
		expect(offButton.props["aria-pressed"]).toBe(false);
		offButton.props.onClick();
		const [onButton] = renderControl(enabled, toggle);
		expect(onButton.props["aria-pressed"]).toBe(true);
		onButton.props.onClick();
		expect(enabled).toBe(false);
		expect(toggle).toHaveBeenCalledTimes(2);
		expect(coordinator.requestOpen).not.toHaveBeenCalled();
	});

	it("keeps the device menu accessible without toggling the webcam", () => {
		const toggle = vi.fn();
		const [, menu] = renderControl(true, toggle);
		expect(menu.props.trigger.props["aria-label"]).toBe("recording.webcam");
		menu.props.onOpenChange(true);
		expect(coordinator.requestOpen).toHaveBeenCalledWith("webcam");
		expect(toggle).not.toHaveBeenCalled();
	});

	it("disables both controls while configuration is locked", () => {
		const [button, menu] = renderControl(true, vi.fn(), true);
		expect(button.props.disabled).toBe(true);
		expect(menu.props.trigger.props.disabled).toBe(true);
		menu.props.onOpenChange(true);
		expect(coordinator.requestOpen).not.toHaveBeenCalled();
	});
});
