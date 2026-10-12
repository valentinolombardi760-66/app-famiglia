export function InArrivo({ title, text }: { title: string; text: string }) {
  return (
    <section>
      <h1>{title}</h1>
      <p className="muted">{text}</p>
    </section>
  )
}
