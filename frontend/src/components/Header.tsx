'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

import { MORE_NAV, NAV, REPO_URL } from '@/lib/site'

import { Logo } from './Logo'
import { ThemeToggle } from './ThemeToggle'

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href)
}

const linkClass =
  'rounded-lg px-2.5 py-2 text-sm font-medium text-muted hover:text-text aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent'

function GitHubIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

function MoreMenu({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = MORE_NAV.some((item) => isActive(pathname, item.href))

  useEffect(() => {
    if (!open) return
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === 'Escape' : !ref.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen(!open)}
        className={`${linkClass} inline-flex items-center gap-1 ${active ? 'text-accent' : ''}`}
      >
        Learn
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul className="card absolute right-0 top-11 z-50 w-48 p-1.5">
          {MORE_NAV.map((item) => (
            <li key={item.href}>
              <a
                href={item.href}
                aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                className={`${linkClass} block`}
              >
                {item.label}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Header() {
  const pathname = usePathname() ?? '/'
  const [open, setOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur-sm">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:rounded-md focus:bg-paper focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6">
        <a href="/" aria-label="OpenTelemetry Incident Lab home" className="shrink-0">
          <Logo />
        </a>

        <nav aria-label="Main" className="ml-auto hidden xl:block">
          <ul className="flex items-center gap-0.5">
            {NAV.map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                  className={linkClass}
                >
                  {item.label}
                </a>
              </li>
            ))}
            <li>
              <MoreMenu pathname={pathname} />
            </li>
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2 xl:ml-2">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="otel-demo on GitHub"
            title="GitHub"
            className="hidden size-9 place-items-center rounded-lg text-text hover:bg-paper-2 sm:grid"
          >
            <GitHubIcon />
          </a>
          <ThemeToggle />
          <a
            href="/workshop/"
            className="hidden h-9 items-center gap-1.5 rounded-lg bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-hover md:flex"
          >
            Start the Lab <span aria-hidden="true">→</span>
          </a>
          <button
            type="button"
            className="grid size-9 place-items-center rounded-lg border border-line bg-paper text-muted xl:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen(!open)}
          >
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              {open ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Main" className="border-t border-line bg-paper xl:hidden">
          <ul className="mx-auto grid max-w-7xl gap-1 px-4 py-3 sm:grid-cols-2">
            {[...NAV, ...MORE_NAV].map((item) => (
              <li key={item.href}>
                <a
                  href={item.href}
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                  className="block rounded-lg px-3 py-2 font-medium text-muted aria-[current=page]:bg-accent-soft aria-[current=page]:text-accent"
                >
                  {item.label}
                </a>
              </li>
            ))}
            <li>
              <a
                href={REPO_URL}
                target="_blank"
                rel="noreferrer"
                className="block rounded-lg px-3 py-2 font-medium text-muted"
              >
                GitHub
              </a>
            </li>
          </ul>
        </nav>
      )}
    </header>
  )
}
