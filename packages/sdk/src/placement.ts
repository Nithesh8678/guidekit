export interface PlacementBox { left: number; top: number; width: number; height: number; }
export interface PlacementArea { left: number; top: number; width: number; height: number; }
export interface GuidancePlacement { left: number; top: number; anchor: number; }
const clamp = (value: number, minimum: number, maximum: number) => Math.max(minimum, Math.min(Math.max(minimum, maximum), value));
function valid(box: PlacementBox): boolean { return Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0; }
function overlap(left: number, top: number, width: number, height: number, obstacle: PlacementBox, padding = 5): number {
  return Math.max(0, Math.min(left + width, obstacle.left + obstacle.width + padding) - Math.max(left, obstacle.left - padding)) * Math.max(0, Math.min(top + height, obstacle.top + obstacle.height + padding) - Math.max(top, obstacle.top - padding));
}

/** Sixteen geometric candidates, bounded public rectangles, no page text or pixels. */
export function placeGuidanceLabel(target: PlacementBox, size: { width: number; height: number }, area: PlacementArea, obstacles: readonly PlacementBox[] = [], preferred = -1): GuidancePlacement {
  if (!valid(target) || !valid(area) || !Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) throw new RangeError('Invalid guidance placement bounds');
  const width = Math.min(size.width, Math.max(1, area.width - 24)), height = Math.min(size.height, Math.max(1, area.height - 24)), gap = 14;
  const x = target.left, y = target.top, right = x + target.width, bottom = y + target.height, middleX = x + target.width / 2 - width / 2, middleY = y + target.height / 2 - height / 2;
  const candidates = [
    [x, y - height - gap], [middleX, y - height - gap], [right - width, y - height - gap],
    [x, bottom + gap], [middleX, bottom + gap], [right - width, bottom + gap],
    [right + gap, y], [right + gap, middleY], [right + gap, bottom - height],
    [x - width - gap, y], [x - width - gap, middleY], [x - width - gap, bottom - height],
    [middleX, y - height - gap * 3], [middleX, bottom + gap * 3], [x - width - gap * 3, middleY], [right + gap * 3, middleY]
  ];
  const nearby = obstacles.slice(0, 24).filter(valid);
  let best = Infinity, result: GuidancePlacement = { left: area.left + 12, top: area.top + 12, anchor: 0 };
  for (const [anchor, candidate] of candidates.entries()) {
    const left = clamp(candidate[0]!, area.left + 12, area.left + area.width - width - 12), top = clamp(candidate[1]!, area.top + 12, area.top + area.height - height - 12);
    const targetCover = overlap(left, top, width, height, target, 9), controlCover = nearby.reduce((sum, obstacle) => sum + overlap(left, top, width, height, obstacle), 0);
    const score = targetCover * 10000 + controlCover * 3000 + Math.hypot(left - candidate[0]!, top - candidate[1]!) + anchor * .25 + (preferred >= 0 && anchor !== preferred ? 70 : 0);
    if (score < best) { best = score; result = { left, top, anchor }; }
  }
  return result;
}
