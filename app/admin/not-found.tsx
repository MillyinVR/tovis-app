import NotFoundState from '@/app/_components/boundaries/NotFoundState'

export default function AdminNotFound() {
  return (
    <NotFoundState
      title="That admin page isn’t here."
      description="The tool may have moved or you may not have permission to view it."
      homeHref="/admin"
      homeLabel="Admin home"
    />
  )
}
