import type { PointerEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHudBarDrag } from "./useHudBarDrag";

function renderWindowDrag() {
	let result!: ReturnType<typeof useHudBarDrag>;
	function Harness() {
		result = useHudBarDrag({
			dragWindow: true,
			hudBarRef: { current: null },
			hudContentRef: { current: null },
			recordingWebcamPreviewContainerRef: { current: null },
		});
		return null;
	}
	renderToStaticMarkup(<Harness />);
	return result;
}

function pointerEvent(screenX: number, screenY: number, pointerId = 1) {
	return {
		button: 0,
		pointerId,
		screenX,
		screenY,
		// Deliberately different: X11 window movement needs screen coordinates.
		clientX: 10,
		clientY: 20,
		preventDefault: vi.fn(),
		currentTarget: {
			setPointerCapture: vi.fn(),
			hasPointerCapture: () => true,
			releasePointerCapture: vi.fn(),
		},
	} as unknown as PointerEvent<HTMLDivElement>;
}

afterEach(() => vi.unstubAllGlobals());

describe("X11 HUD pointer dragging", () => {
	it("sends native window movement in screen coordinates without translating the toolbar", () => {
		const hudOverlayDrag = vi.fn();
		const hudOverlaySetIgnoreMouse = vi.fn();
		vi.stubGlobal("window", { electronAPI: { hudOverlayDrag, hudOverlaySetIgnoreMouse } });
		const drag = renderWindowDrag();
		const start = pointerEvent(500, 800);
		drag.handleHudBarPointerDown(start);
		expect(start.currentTarget.setPointerCapture).toHaveBeenCalledWith(1);
		expect(drag.isHudDraggingRef.current).toBe(true);
		drag.handleHudBarPointerMove(pointerEvent(600, 700));
		const end = pointerEvent(600, 700);
		drag.handleHudBarPointerUp(end);
		expect(hudOverlayDrag.mock.calls).toEqual([
			["start", 500, 800],
			["move", 600, 700],
			["end", 600, 700],
		]);
		expect(hudOverlaySetIgnoreMouse).toHaveBeenCalledWith(false);
		expect(drag.recordingHudOffset).toEqual({ x: 0, y: 0 });
		expect(drag.isHudDraggingRef.current).toBe(false);
		expect(end.currentTarget.releasePointerCapture).toHaveBeenCalledWith(1);
	});

	it("ignores other pointers and does not keep dragging after release", () => {
		const hudOverlayDrag = vi.fn();
		vi.stubGlobal("window", { electronAPI: { hudOverlayDrag } });
		const drag = renderWindowDrag();
		drag.handleHudBarPointerDown(pointerEvent(500, 800));
		drag.handleHudBarPointerMove(pointerEvent(0, 0, 2));
		drag.handleHudBarPointerUp(pointerEvent(0, 0, 2));
		expect(drag.isHudDraggingRef.current).toBe(true);
		drag.handleHudBarPointerUp(pointerEvent(500, 800));
		drag.handleHudBarPointerMove(pointerEvent(0, 0));
		expect(hudOverlayDrag).toHaveBeenCalledTimes(2);
	});
});
