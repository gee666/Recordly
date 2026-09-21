import { beforeEach, describe, expect, it, vi } from "vitest";
import { SourcePopover } from "./SourcePopover";

const mocks = vi.hoisted(() => ({
	lock: { current: false },
	isOpen: vi.fn(() => true),
	requestOpen: vi.fn(),
	requestClose: vi.fn(),
	selectRegion: vi.fn(),
}));
vi.mock("react", async (importOriginal) => ({
	...(await importOriginal<typeof import("react")>()),
	useRef: () => mocks.lock,
	useState: (value: unknown) => [value, vi.fn()],
	useMemo: (fn: () => unknown) => fn(),
	useCallback: (fn: unknown) => fn,
	useEffect: (fn: () => void) => fn(),
}));
vi.mock("./LaunchPopoverCoordinator", () => ({ useLaunchPopoverCoordinator: () => mocks }));
vi.mock("../SourceSelector", () => ({ SourceSelector: () => null }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.lock.current = false;
	vi.stubGlobal("window", { electronAPI: { selectRecordingRegion: mocks.selectRegion } });
});

function render(disabled: boolean, onSourceSelect = vi.fn()) {
	return SourcePopover({
		trigger: null,
		selectedSource: "Screen",
		disabled,
		allowRegionSelection: true,
		onSourceSelect,
	});
}

describe("source selection startup lock", () => {
	it("closes and blocks source selection during startup/recording", async () => {
		const select = vi.fn();
		const { props } = render(true, select);
		expect(props.open).toBe(false);
		expect(mocks.requestClose).toHaveBeenCalledWith("sources");
		props.onOpenChange(true);
		await props.onSourceSelect({ id: "screen:1:0" });
		await props.onSelectRegion();
		expect(mocks.requestOpen).not.toHaveBeenCalled();
		expect(select).not.toHaveBeenCalled();
		expect(mocks.selectRegion).not.toHaveBeenCalled();
	});

	it("ignores a region dialog completing after startup locks selection", async () => {
		const select = vi.fn();
		let resolve!: (result: unknown) => void;
		mocks.selectRegion.mockReturnValue(
			new Promise((done) => {
				resolve = done;
			}),
		);
		const { props } = render(false, select);
		const selection = props.onSelectRegion();
		expect(mocks.selectRegion).toHaveBeenCalledWith();
		render(true, select);
		resolve({ success: true, source: { id: "screen:1:0" } });
		await selection;
		expect(select).not.toHaveBeenCalled();
	});
});
