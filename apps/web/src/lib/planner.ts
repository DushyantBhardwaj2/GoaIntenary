export function tripDays(start: string, end: string): string[] {
  const result: string[] = []; const cursor = new Date(`${start}T00:00:00Z`); const finish = new Date(`${end}T00:00:00Z`).getTime();
  while (Number.isFinite(cursor.getTime()) && cursor.getTime() <= finish && result.length <= 366) { result.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1); }
  return result;
}
export function dayLabel(day: string): string { return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T00:00:00Z`)); }
export function overlappingIds(activities: { id: string; day: string | null; startTime: string | null; endTime: string | null }[]): Set<string> {
  const result = new Set<string>();
  for (let i = 0; i < activities.length; i++) for (let j = i + 1; j < activities.length; j++) {
    const a = activities[i], b = activities[j];
    if (a.day && a.day === b.day && a.startTime && a.endTime && b.startTime && b.endTime && a.startTime < b.endTime && b.startTime < a.endTime) { result.add(a.id); result.add(b.id); }
  }
  return result;
}
