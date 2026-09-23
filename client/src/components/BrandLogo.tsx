/** The same two-color mark and custom wordmark on every portal surface. */
export function BrandLogo({ className = "" }: { className?: string }): JSX.Element {
  return (
    <span className={`brand-logo ${className}`.trim()} role="img" aria-label="WikiKai">
      <img className="brand-mark" src="/assets/wikikai-mark.png" alt="" width="280" height="221" />
      <span className="brand-wordmark" aria-hidden="true" />
    </span>
  );
}
