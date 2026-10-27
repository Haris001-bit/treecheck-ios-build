/** A key for something the owner names: "Bucket truck" becomes bucket_truck. */
export function keyFor(name: string, taken: string[] = []): string {
  const base = (name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'item').replace(/^([^a-z])/, 'x_$1').slice(0, 36);
  let k = base;
  for (let i = 2; taken.includes(k); i++) k = `${base.slice(0, 33)}_${i}`;
  return k;
}
