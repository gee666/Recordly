# Running and testing on Ubuntu

Build just the application (without packaging an AppImage):

```sh
npm ci
npx tsc --noEmit
npx vite build
npm start
```

If Ubuntu prevents an unpackaged Electron binary from starting because its sandbox
helper is not installed, use `npm start -- --no-sandbox` for local development only.
This disables Chromium's sandbox; do not use it to load untrusted content. Prefer a
properly installed/sandboxed package for distribution. No system sandbox policy
changes are needed. Rebuild with `npx vite build` after changing repo files.

## Recording on X11

- Open **Screen** to choose a monitor or window.
- Choose **Select area** at the top of the source menu. Drag directly on either
  monitor, then click **Use area** or press Enter. The monitor is detected from
  where the drag starts; no screen selection is required first. Press Escape to
  cancel. Each rectangle stays within its starting monitor; spanning monitors is
  not supported.
- The blue, click-through outline remains visible during recording and pause. Its
  strips sit outside the recorded pixels (an edge at the desktop boundary can be
  off-screen).
- The recording controls are hidden while recording when they sit inside the
  captured screen or area (window capture and other monitors are unaffected).
  A hint appears outside the recorded pixels (during the countdown when there is
  no such place). Stop with **Ctrl+Alt+Shift+S** (global, only registered while
  the controls are hidden) or with the Recordly tray icon: **Stop Recording**, or
  **Show Controls** to bring the controls back for the rest of the recording.
- Source changes are locked while recording starts. Changing the display layout
  invalidates the selection; select the area again.
- The camera icon toggles recording on/off. The adjacent arrow opens camera
  settings. Webcam off never requests camera access, including device enumeration.
- On Linux, desktop loopback/system audio is unavailable in this capture path;
  microphone capture is independent. The app warns rather than failing screen
  recording or reopening a portal.

Wayland retains portal-based screen selection. The X11 rectangle selector and
programmatic window dragging are not advertised as working on native Wayland.

## Graphics and export

Do not force `--use-gl=egl`: Electron 43 rejects that legacy backend. Let Electron
select a supported graphics implementation. Lightning export defaults to WebGL;
WebGPU is excluded for GPU-filter combinations without reliable bindings. This is
separate from the video encoder choice.

Tests: `npm test` and `npx tsc --noEmit`.

A real, automatic export smoke test (writes its result beside the MP4):

```sh
RECORDLY_SMOKE_EXPORT=1 \
RECORDLY_SMOKE_EXPORT_INPUT=/absolute/path/to/recording.webm \
RECORDLY_SMOKE_EXPORT_OUTPUT=/tmp/recordly-smoke.mp4 \
npm start -- --user-data-dir=/tmp/recordly-smoke-profile
```

Use an isolated profile for tests so recordings/preferences in
`~/.config/Recordly` remain untouched. `ffprobe` should recognize the output as
H.264 MP4; decoding the entire file with FFmpeg verifies more than file creation.
