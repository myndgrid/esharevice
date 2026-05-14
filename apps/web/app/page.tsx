export default function HomePage() {
  return (
    <main style={{ display: "grid", placeItems: "center", padding: "4rem 1rem" }}>
      <section style={{ maxWidth: "32rem", display: "grid", gap: "1rem" }}>
        <h1
          style={{
            fontSize: "clamp(1.75rem, 4vw, 2.5rem)",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          e-Sharevice
        </h1>
        <p style={{ color: "var(--fg-muted)", fontSize: "1rem" }}>
          Monorepo foundation is live. Real pages land in week 5+.
        </p>
        <p style={{ color: "var(--fg-subtle)", fontSize: "0.875rem" }}>
          Toggle <code>data-theme=&quot;dark&quot;</code> on{" "}
          <code>&lt;html&gt;</code> via DevTools to preview dark mode.
        </p>
      </section>
    </main>
  );
}
