import NotFoundState from '@/app/_components/boundaries/NotFoundState'

export default function MessagesNotFound() {
  return (
    <NotFoundState
      title="This conversation isn’t here."
      description="The thread may have been removed, or you may not have access to it."
      homeHref="/messages"
      homeLabel="Back to messages"
    />
  )
}
