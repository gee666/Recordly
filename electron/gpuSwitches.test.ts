import { describe, expect, it } from "vitest";
import { getGpuSwitches } from "./gpuSwitches";

describe("getGpuSwitches", () => {
	it("lets Electron choose a supported Linux GL implementation", () => {
		expect(getGpuSwitches("linux")).toEqual({
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		});
		expect(getGpuSwitches("linux").useGl).toBeUndefined();
		expect(getGpuSwitches("linux").useAngle).toBeUndefined();
	});

	it("retains Metal and the audio workaround on macOS", () => {
		expect(getGpuSwitches("darwin")).toEqual({
			useAngle: "metal",
			disableFeatures: ["MacCatapLoopbackAudioForScreenShare"],
		});
	});

	it("retains Direct3D on Windows", () => {
		expect(getGpuSwitches("win32")).toEqual({ useAngle: "d3d11" });
	});
});
