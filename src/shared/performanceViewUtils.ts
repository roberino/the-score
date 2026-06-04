/** Maps a click x-offset within a track canvas cell to a 0-based measure index. */
export function measureIndexFromClickX(
  offsetX: number,
  measureWidth: number,
  totalMeasures: number,
): number {
  return Math.max(0, Math.min(totalMeasures - 1, Math.floor(offsetX / measureWidth)))
}
