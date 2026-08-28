import NotFoundState from '@/app/_components/boundaries/NotFoundState'

// "Browse pros" points at /search, not /professionals: there is no
// app/professionals/page.tsx — only [id]/ and dashboard/ — so the old href was a
// 404 whose only escape hatch was another 404. /search is the app's established
// browse-pros destination (client openings empty state, guest footer, nav).
export default function ProfessionalsNotFound() {
  return (
    <NotFoundState
      title="We couldn’t find that pro."
      description="This professional may have moved or is no longer listed."
      homeHref="/search"
      homeLabel="Browse pros"
    />
  )
}
