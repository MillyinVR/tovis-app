import NotFoundState from '@/app/_components/boundaries/NotFoundState'

export default function PublicProfileNotFound() {
  return (
    <NotFoundState
      title="That profile isn’t here."
      description="This handle may be unclaimed, private, or have changed."
      homeHref="/"
      homeLabel="Back to home"
    />
  )
}
