import NotFoundState from '@/app/_components/boundaries/NotFoundState'

export default function ProfessionalsNotFound() {
  return (
    <NotFoundState
      title="We couldn’t find that pro."
      description="This professional may have moved or is no longer listed."
      homeHref="/professionals"
      homeLabel="Browse pros"
    />
  )
}
