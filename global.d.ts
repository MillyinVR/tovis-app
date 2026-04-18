// global.d.ts
// Allows TypeScript to accept side-effect CSS imports (import './foo.css')
// without errors. Next.js handles the actual bundling at build time.
declare module '*.css'
