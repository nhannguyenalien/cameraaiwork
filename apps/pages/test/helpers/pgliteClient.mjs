// Adapts a PGlite instance to the subset of the `postgres` client used by
// functions/_lib/db.js (unsafe, begin, end), injected through env.DB_CLIENT.
export function pgliteClient(pg) {
  const run = async (query, args = []) => (await pg.query(query, args)).rows;
  return {
    unsafe: run,
    async begin(fn) {
      await pg.exec('BEGIN');
      try {
        const results = await Promise.all(fn({ unsafe: run }));
        await pg.exec('COMMIT');
        return results;
      } catch (error) { await pg.exec('ROLLBACK'); throw error; }
    },
    end: async () => {},
  };
}
