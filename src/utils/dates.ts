/** A date as the clinic's readers write it, day first: 22.01.26 (card c-dates). Read in UTC so a date typed in the
 * files is the same day on every build. */
export function dayFirst(value: Date | string | undefined): string {
  if (!value) return "";
  const date = typeof value === "string" ? new Date(value) : value;
  if (isNaN(+date)) return "";
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(date.getUTCDate())}.${two(date.getUTCMonth() + 1)}.${two(date.getUTCFullYear() % 100)}`;
}
