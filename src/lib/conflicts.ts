// Overlap detection: the same person in two places at once.
// Pure functions (no database), so they are unit tested.

export interface Busy {
  /** Unique per occurrence. */
  key: string
  title: string
  start: Date
  end: Date
  allDay: boolean
  /** Member ids involved: participants, everyone for family events, and the driver. */
  people: string[]
  /** Member id of the driver, if any: shown as "accompagna" in the warning. */
  driverId?: string | null
}

export interface Conflict {
  /** The member who is double-booked. */
  memberId: string
  /** True when that member is the driver of this item or of the other one. */
  asDriver: boolean
  other: Busy
}

// A zero-length event ("partenza alle 7:00") still occupies its minute.
const MIN_LENGTH_MS = 60_000

function overlaps(a: Busy, b: Busy): boolean {
  const aEnd = Math.max(a.end.getTime(), a.start.getTime() + MIN_LENGTH_MS)
  const bEnd = Math.max(b.end.getTime(), b.start.getTime() + MIN_LENGTH_MS)
  return a.start.getTime() < bEnd && b.start.getTime() < aEnd
}

/**
 * For every item, the other items it overlaps for the same person.
 * All-day items are ignored: "Gita" or "Natale" would clash with everything.
 */
export function findConflicts(items: Busy[]): Map<string, Conflict[]> {
  const timed = items.filter((i) => !i.allDay).sort((a, b) => a.start.getTime() - b.start.getTime())
  const result = new Map<string, Conflict[]>()
  const add = (item: Busy, c: Conflict) => {
    const list = result.get(item.key) ?? []
    if (!list.some((x) => x.other.key === c.other.key && x.memberId === c.memberId)) list.push(c)
    result.set(item.key, list)
  }
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i]
    for (let j = i + 1; j < timed.length; j++) {
      const b = timed[j]
      // Sorted by start: once b starts after a ends, no later item can overlap a.
      if (b.start.getTime() >= Math.max(a.end.getTime(), a.start.getTime() + MIN_LENGTH_MS)) break
      if (!overlaps(a, b)) continue
      for (const memberId of a.people) {
        if (!b.people.includes(memberId)) continue
        const asDriver = a.driverId === memberId || b.driverId === memberId
        add(a, { memberId, asDriver, other: b })
        add(b, { memberId, asDriver, other: a })
      }
    }
  }
  return result
}

/** Conflicts of a not-yet-saved item against existing ones. */
export function conflictsFor(item: Busy, others: Busy[]): Conflict[] {
  const map = findConflicts([item, ...others.filter((o) => o.key !== item.key)])
  return map.get(item.key) ?? []
}
