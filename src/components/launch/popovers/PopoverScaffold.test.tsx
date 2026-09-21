import { Children, type ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { HudPopover } from "./PopoverScaffold";

vi.mock("../contexts/HudInteractionContext", () => ({
	useHudInteraction: () => ({ onMouseEnter: vi.fn() }),
}));

describe("HUD menu placement", () => {
	it("portals menus outside animated toolbar transforms and enables viewport collision sizing", () => {
		const popover = HudPopover({
			open: true,
			onOpenChange: vi.fn(),
			trigger: <button type="button">Settings</button>,
			children: <div>Settings contents</div>,
		});
		const [, content] = Children.toArray(popover.props.children) as ReactElement[];
		expect(content.props).toMatchObject({
			usePortal: true,
			animated: false,
			side: "top",
			sideOffset: 24,
			avoidCollisions: true,
			collisionPadding: 10,
			"data-hud-interactive": true,
		});
	});
});
