import type { Member } from '../lib/types'

/**
 * A person's name with their color as a dot, not as the text color: any
 * color stays readable in light and dark mode.
 */
export function MemberChip({ member, label }: { member: Member; label?: string }) {
  return (
    <span className="chip">
      <span className="dot" style={{ background: member.color }} aria-hidden />
      {label ?? member.name}
    </span>
  )
}
