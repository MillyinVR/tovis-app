// lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * cn = className merge helper
 * - clsx: conditional class logic
 * - twMerge: resolves Tailwind conflicts correctly
 *
 * This is the same pattern used by shadcn/ui
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
