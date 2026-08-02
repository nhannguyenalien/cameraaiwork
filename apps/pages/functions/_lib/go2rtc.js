// go2rtc's real snapshot endpoint is /api/frame.jpeg (not .jpg — caught via
// live testing, see docs/PLAN.md). It shells out to ffmpeg internally, so
// this fails if ffmpeg isn't installed/working on the on-site machine.
export async function getFrame(env, site, camera) {
  const res = await fetch(`${site.go2rtc_url}/api/frame.jpeg?src=${camera}`);
  if (!res.ok) throw new Error(`go2rtc frame lỗi: ${res.status}`);
  return res.arrayBuffer();
}

// NOTE: go2rtc has no "export N seconds as a file" endpoint — /api/stream.mp4
// is a live progressive stream, not a bounded clip (also caught via live
// testing; the original design here assumed an endpoint that doesn't
// exist). Alerts use a snapshot instead for now — see getFrame above and
// docs/PLAN.md's backlog for the real clip-capture approach.
