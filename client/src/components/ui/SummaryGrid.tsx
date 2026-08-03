interface Card {
  label: string;
  value: string | number;
  sub: string;
}

export function SummaryGrid({ cards }: { cards: Card[] }) {
  return (
    <section className="summary-grid">
      {cards.map((c) => (
        <article key={c.label} className="summary-card">
          <div className="summary-label">{c.label}</div>
          <div className="summary-value">{c.value}</div>
          <div className="summary-sub">{c.sub}</div>
        </article>
      ))}
    </section>
  );
}
