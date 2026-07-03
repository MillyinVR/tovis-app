// app/_components/seo/JsonLdScript.tsx
//
// Renders a schema.org JSON-LD node. `<` is escaped so payload strings can
// never terminate the script element (the standard JSON-LD XSS guard).
export default function JsonLdScript({
  data,
}: {
  data: Record<string, unknown>
}) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(data).replace(/</g, '\\u003c'),
      }}
    />
  )
}
