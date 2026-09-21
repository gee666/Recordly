export interface GpuSwitches {
	useAngle?: string;
	useGl?: string;
	disableFeatures?: string[];
}

export function getGpuSwitches(platform: NodeJS.Platform): GpuSwitches {
	if (platform === "darwin") {
		return {
			useAngle: "metal",
			disableFeatures: ["MacCatapLoopbackAudioForScreenShare"],
		};
	}

	if (platform === "win32") {
		return { useAngle: "d3d11" };
	}

	if (platform === "linux") {
		return {
			// Let Electron select its supported ANGLE backend on both X11 and
			// Wayland. Forcing --use-gl=egl selects the removed egl-gles2
			// implementation in Electron 43, crashing the GPU/capture service.
			disableFeatures: ["VaapiVideoDecoder", "VaapiVideoEncoder"],
		};
	}

	return {};
}
