import { getDb } from "./db.js";
import { deleteDriveFiles, driveInventory } from "./objectStorage.js";

const kindOf = (file) => /\.mp4$|^video\//i.test(file.name || "") || /^video\//.test(file.mimeType || "") ? "video"
  : /\.jpe?g$|^image\//i.test(file.name || "") || /^image\//.test(file.mimeType || "") ? "image" : "other";
const bucket = () => ({ count: 0, bytes: 0 });
const add = (target, file) => { target.count += 1; target.bytes += file.size; };

// Compare what the account's DB says is on a Drive with what is really in the
// folder. Report only; `apply` additionally deletes orphan files this app wrote
// and clears DB references to files that no longer exist.
export async function reconcileDrive(env, accountId, backend, { apply = false } = {}) {
  const [files, rows] = await Promise.all([
    driveInventory(env, accountId, backend),
    getDb(env, "_lib.storageReconcile").execute({
      sql: "SELECT id, image_key, video_key FROM events WHERE account_id = ? AND storage_backend = ?",
      args: [accountId, backend],
    }),
  ]);
  const referenced = new Set();
  for (const row of rows.rows) for (const key of [row.image_key, row.video_key]) if (key) referenced.add(String(key));
  const mine = files.filter((file) => file.key?.startsWith(`${accountId}/`));
  const onDrive = new Set(mine.filter((file) => !file.trashed).map((file) => file.key));
  const report = {
    backend, filesInFolder: files.length, untagged: files.filter((file) => !file.key).length,
    live: { video: bucket(), image: bucket(), other: bucket() },
    trashed: bucket(), linked: bucket(),
    orphan: { video: bucket(), image: bucket(), other: bucket(), trashed: bucket() },
    dbReferencesMissing: { video: 0, image: 0 },
  };
  const orphanIds = [];
  for (const file of mine) {
    const kind = kindOf(file);
    if (file.trashed) { add(report.trashed, file); add(report.orphan.trashed, file); orphanIds.push(file.id); continue; }
    add(report.live[kind], file);
    if (referenced.has(file.key)) add(report.linked, file);
    else { add(report.orphan[kind], file); orphanIds.push(file.id); }
  }
  const missing = [];
  for (const row of rows.rows) {
    if (row.video_key && !onDrive.has(String(row.video_key))) { report.dbReferencesMissing.video += 1; missing.push({ id: row.id, kind: "video" }); }
    if (row.image_key && !onDrive.has(String(row.image_key))) { report.dbReferencesMissing.image += 1; missing.push({ id: row.id, kind: "image" }); }
  }
  report.applied = false;
  if (apply) {
    await deleteDriveFiles(env, accountId, backend, orphanIds);
    const db = getDb(env, "_lib.storageReconcile");
    for (let offset = 0; offset < missing.length; offset += 200) {
      await db.batch(missing.slice(offset, offset + 200).map((item) => item.kind === "video"
        ? { sql: "UPDATE events SET video_key = NULL, video_status = 'expired', video_error = NULL WHERE id = ? AND account_id = ?", args: [item.id, accountId] }
        : { sql: "UPDATE events SET image_key = NULL WHERE id = ? AND account_id = ?", args: [item.id, accountId] }));
    }
    report.applied = true;
    report.deletedFiles = orphanIds.length;
    report.clearedReferences = missing.length;
  }
  return report;
}
