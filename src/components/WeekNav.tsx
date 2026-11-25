/** "‹ 23–29 novembre 2026 ›": the label goes back to the current week. */
export function WeekNav(props: {
  label: string
  onPrev: () => void
  onNext: () => void
  onToday: () => void
  nextDisabled?: boolean
}) {
  return (
    <div className="week-nav">
      <button className="icon" aria-label="Settimana precedente" onClick={props.onPrev}>
        ‹
      </button>
      <button className="link" onClick={props.onToday}>
        {props.label}
      </button>
      <button className="icon" aria-label="Settimana successiva" disabled={props.nextDisabled} onClick={props.onNext}>
        ›
      </button>
    </div>
  )
}
