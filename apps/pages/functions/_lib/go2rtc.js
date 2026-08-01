export async function getFrame(env, site, camera) {
  const res = await fetch(`${site.go2rtc_url}/api/frame.jpg?src=${camera}`);
  if (!res.ok) throw new Error(`go2rtc frame lỗi: ${res.status}`);
  return res.arrayBuffer();
}

export async function getClip(env, site, camera, durationSeconds = 10) {
  const res = await fetch(
    `${site.go2rtc_url}/api/stack.mp4?src=${camera}&duration=${durationSeconds}`
  );
  if (!res.ok) throw new Error(`go2rtc clip lỗi: ${res.status}`);
  return res.arrayBuffer();
}
