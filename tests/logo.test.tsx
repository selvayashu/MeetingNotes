// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import fs from 'node:fs'
import path from 'node:path'
import Logo from '../src/components/Logo'

// vitest runs from the project root (import.meta.url is not a file: URL under jsdom)
const root = process.cwd()
const pub = (p: string) => path.join(root, 'public', p.replace(/^\//, ''))
const exists = (p: string) => fs.existsSync(pub(p))

afterEach(cleanup)

describe('Logo component', () => {
  it('renders a light and a dark image so CSS can follow the theme', () => {
    const { container } = render(<Logo variant="full" className="h-12" />)
    const imgs = [...container.querySelectorAll('img')]
    expect(imgs.map((i) => i.getAttribute('src'))).toEqual(['/logo-light.png', '/logo-dark.png'])
    expect(imgs[0].className).toContain('dark:hidden')
    expect(imgs[1].className).toMatch(/\bhidden\b.*dark:block/)
  })

  it('labels the full lockup but treats the mark as decorative', () => {
    const full = render(<Logo variant="full" />).container
    expect(full.querySelector('img')!.getAttribute('alt')).toBe('SYJO Labs')
    cleanup()
    const mark = render(<Logo variant="mark" />).container
    expect(mark.querySelector('img')!.getAttribute('alt')).toBe('')
    expect([...mark.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['/mark-light.png', '/mark-dark.png'])
  })

  it('reserves space with width/height to avoid layout shift', () => {
    const img = render(<Logo variant="mark" />).container.querySelector('img')!
    expect(img.getAttribute('width')).toBe('118')
    expect(img.getAttribute('height')).toBe('131')
  })
})

describe('brand assets referenced by the app exist', () => {
  it('every image path used by Logo, index.html and the PWA config is in public/', () => {
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
    const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8')
    const fromHtml = [...html.matchAll(/href="(\/[^"]+\.(?:png|svg|ico))"/g)].map((m) => m[1])
    const fromVite = [...vite.matchAll(/'([\w-]+\.png)'/g)].map((m) => '/' + m[1])
    const fromLogo = ['logo-light', 'logo-dark', 'mark-light', 'mark-dark'].map((n) => `/${n}.png`)
    const all = [...new Set([...fromHtml, ...fromVite, ...fromLogo])]
    expect(all.length).toBeGreaterThanOrEqual(8)
    expect(all.filter((p) => !exists(p))).toEqual([])
  })

  it('the PWA icons are real PNGs of the declared sizes', () => {
    const dims = (p: string) => {
      const b = fs.readFileSync(pub(p))
      expect(b.subarray(1, 4).toString()).toBe('PNG')
      return [b.readUInt32BE(16), b.readUInt32BE(20)]
    }
    expect(dims('icon-192.png')).toEqual([192, 192])
    expect(dims('icon-512.png')).toEqual([512, 512])
    expect(dims('apple-touch-icon.png')).toEqual([180, 180])
    expect(dims('favicon-32.png')).toEqual([32, 32])
  })
})
