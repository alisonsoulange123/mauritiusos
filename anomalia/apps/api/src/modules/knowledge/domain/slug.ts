/**
 * Title → URL slug.
 *
 * Diacritics are folded rather than stripped, because this platform publishes
 * in French as well as English: dropping them outright turns "Résidence
 * fiscale" into "rsidence-fiscale", and folding gives "residence-fiscale",
 * which is what a reader would type and what a French editor expects to see.
 */
const MAX_LENGTH = 80;

export function slugify(title: string): string {
  const folded = title
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

  return folded
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_LENGTH)
    // A trailing hyphen can reappear after the slice.
    .replace(/-+$/, '');
}
