'use client'

import * as React from 'react'
import { AnimateIcon } from '@/components/animate-ui/icons/icon'
import { Sun } from '@/components/animate-ui/icons/sun'
import { Moon } from '@/components/animate-ui/icons/moon'

export function ThemeToggle() {
  const [theme, setTheme] = React.useState<'light' | 'dark'>('dark')

  React.useEffect(() => {
    const stored = document.documentElement.classList.contains('dark')
      ? 'dark'
      : 'light'
    setTheme(stored)
  }, [])

  const toggle = React.useCallback(() => {
    setTheme((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark'
      const root = document.documentElement
      root.classList.remove('light', 'dark')
      root.classList.add(next)
      const favicon = document.querySelector<HTMLLinkElement>('#app-favicon')
      if (favicon) favicon.href = next === 'light' ? '/icon-light-192.png' : '/icon-dark-192.png'
      try {
        localStorage.setItem('sylva-theme', next)
      } catch {}
      return next
    })
  }, [])

  return (
    <AnimateIcon animateOnHover asChild>
      <button
        type="button"
        onClick={toggle}
        aria-label="Toggle color theme"
        className="group relative inline-flex size-10 items-center justify-center rounded-full border border-border bg-card text-foreground transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {theme === 'dark' ? (
          <Sun
            size={18}
            className="transition-colors group-hover:text-amber-400"
          />
        ) : (
          <Moon
            size={18}
            className="transition-colors group-hover:text-indigo-400"
          />
        )}
      </button>
    </AnimateIcon>
  )
}
