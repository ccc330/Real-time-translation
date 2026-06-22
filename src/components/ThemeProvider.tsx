import type { ReactNode } from 'react';
import { ThemeProvider as NextThemeProvider, type ThemeProviderProps } from 'next-themes';

interface AppThemeProviderProps extends ThemeProviderProps {
  children: ReactNode;
}

export function ThemeProvider({ children, ...props }: AppThemeProviderProps) {
  return <NextThemeProvider {...props}>{children}</NextThemeProvider>;
}
