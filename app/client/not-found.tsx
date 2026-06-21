import NotFoundState from '@/app/_components/boundaries/NotFoundState'

export default function ClientNotFound() {
  return (
    <NotFoundState
      title="That page isn’t here."
      description="The link may be broken or the page may have moved."
      homeHref="/client"
      homeLabel="Home"
    />
  )
}
