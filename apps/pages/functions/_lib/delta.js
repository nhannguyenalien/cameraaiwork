// Bounded map of visible row IDs to database-computed content hashes.
export function parseKnown(url) {
  const value = url.searchParams.get('known');
  if (!value) return {};
  if (value.length > 12000) throw new Error('known too large');
  const map = JSON.parse(value);
  if (!map || Array.isArray(map) || typeof map !== 'object' || Object.keys(map).length > 100
      || Object.entries(map).some(([id, hash]) => id.length > 100 || !/^[a-f0-9]{32}$/.test(hash))) throw new Error('Invalid known map');
  return map;
}
