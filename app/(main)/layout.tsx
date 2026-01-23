// app/(main)/layout.tsx
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return <div className="min-h-dvh bg-bgPrimary">{children}</div>
}
