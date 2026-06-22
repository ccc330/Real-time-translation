import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** True when text contains common CJK ideographs (for `lang` tagging / CJK-aware layout). */
export const hasCjk = (text: string): boolean => /[一-鿿]/.test(text);
