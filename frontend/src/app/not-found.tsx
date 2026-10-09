export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-24 text-center sm:px-6">
      <p className="font-mono text-sm text-accent">404 · span not found</p>
      <h1 className="mt-2 text-3xl font-bold tracking-tight">This page is not here</h1>
      <p className="mt-3 text-muted">It may have moved. The workshop starts at chapter 00.</p>
      <a
        href="/workshop/"
        className="mt-8 inline-block rounded-lg bg-brand px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-hover"
      >
        Go to the workshop
      </a>
    </div>
  )
}
