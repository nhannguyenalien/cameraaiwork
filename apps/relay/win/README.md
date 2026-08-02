# apps/relay/win

Windows has no launchd/systemd equivalent, so this uses
[`node-windows`](https://github.com/coreybutler/node-windows) to register
Node scripts as proper Windows Services (auto-restart on crash, start on
boot). `install-services.js` / `uninstall-services.js` are called by
`../install.ps1` — you normally don't run them directly.

- `go2rtc-wrapper.js` — node-windows only wraps Node.js scripts, not
  arbitrary binaries, so this tiny script spawns `go2rtc.exe` as a child
  process and restarts it on exit. It gets wrapped as a service the same
  way the relay itself does.
- `install-services.js` — installs `cameraaiwork-go2rtc` and
  `cameraaiwork-relay` as Windows Services. Run as Administrator.
- `uninstall-services.js` — removes them. Run as Administrator.

Manage them afterwards with the normal Windows tools (Services app,
`Get-Service cameraaiwork-*`, Event Viewer for logs).
