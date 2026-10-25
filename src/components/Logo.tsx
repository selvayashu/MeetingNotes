interface Props {
  /** "full" is the SYJO Labs lockup; "mark" is the hexagon on its own. */
  variant: 'full' | 'mark'
  className?: string
}

// Natural sizes of the generated PNGs (see scripts/make-logo-assets.ps1); lets the browser reserve space.
const SIZE = { full: { w: 340, h: 131 }, mark: { w: 118, h: 131 } } as const

/**
 * Brand image that follows the light/dark theme. Two transparent PNGs are rendered and CSS shows the right one,
 * so there is no flash when the theme is applied before first paint. The mark is decorative (it always sits next
 * to the product name), the full lockup carries the company name as its alt text.
 */
export default function Logo({ variant, className = '' }: Props) {
  const { w, h } = SIZE[variant]
  const alt = variant === 'full' ? 'SYJO Labs' : ''
  const common = { width: w, height: h, alt, draggable: false } as const
  return (
    <>
      <img src={`/${variant === 'full' ? 'logo' : 'mark'}-light.png`} className={`${className} dark:hidden`} {...common} />
      <img
        src={`/${variant === 'full' ? 'logo' : 'mark'}-dark.png`}
        className={`${className} hidden dark:block`}
        {...common}
      />
    </>
  )
}
