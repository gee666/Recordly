import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { SourceSelectorContent } from "./SourceSelector";
import type { DesktopSource } from "./popovers/launchPopoverTypes";

vi.mock("@/contexts/I18nContext", () => ({
	useScopedT: () => (key: string, fallback?: string) => fallback || key,
}));

function buttons(node: ReactNode): ReactElement[] {
	return Children.toArray(node).flatMap((child) => {
		if (!isValidElement<{ children?: ReactNode }>(child)) return [];
		return [...(child.type === "button" ? [child] : []), ...buttons(child.props.children)];
	});
}
const screens: DesktopSource[] = [
	{
		id: "screen:407:0",
		display_id: "right",
		name: "Screen 2 (Primary)",
		thumbnail: null,
		appIcon: null,
		sourceType: "screen",
	},
	{
		id: "screen:408:0",
		display_id: "left",
		name: "Screen 1",
		thumbnail: null,
		appIcon: null,
		sourceType: "screen",
	},
];

describe("source picker area actions", () => {
	it("offers one display-independent area action above the monitor choices", () => {
		const onSourceSelect = vi.fn(),
			onSelectRegion = vi.fn();
		const tree = SourceSelectorContent({
			screenSources: screens,
			onSourceSelect,
			onSelectRegion,
		});
		const actions = buttons(tree);
		expect(actions).toHaveLength(3);
		actions[0].props.onClick();
		actions[1].props.onClick();
		actions[2].props.onClick();
		expect(onSourceSelect.mock.calls).toEqual([[screens[0]], [screens[1]]]);
		expect(onSelectRegion.mock.calls).toEqual([[]]);
	});
	it("keeps area selection independent of the source list, even while loading", () => {
		expect(buttons(SourceSelectorContent({ screenSources: screens }))).toHaveLength(2);
		const onSelectRegion = vi.fn();
		const tree = SourceSelectorContent({
			windowSources: [{ ...screens[0], id: "window:1:0", sourceType: "window" }],
			onSelectRegion,
		});
		expect(buttons(tree)).toHaveLength(2);
		const loading = SourceSelectorContent({ loading: true, onSelectRegion });
		expect(buttons(loading)).toHaveLength(1);
		buttons(loading)[0].props.onClick();
		expect(onSelectRegion).toHaveBeenCalledWith();
	});
});
