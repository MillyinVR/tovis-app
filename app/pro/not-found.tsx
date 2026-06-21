import NotFoundState from '@/app/_components/boundaries/NotFoundState'

export default function ProNotFound() {
  return (
    <NotFoundState
      title="That page isn’t here."
      description="This pro tool may have moved. Head back to your dashboard to pick up where you left off."
      homeHref="/pro/dashboard"
      homeLabel="Pro dashboard"
    />
  )
}
