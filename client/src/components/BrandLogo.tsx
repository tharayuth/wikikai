/** Shared-spark book and teal ai wordmark, with theme-aware lettering. */
export function BrandLogo({ className = "" }: { className?: string }): JSX.Element {
  return (
    <span className={`brand-logo ${className}`.trim()} role="img" aria-label="WikiKai">
      <img className="brand-mark" src="/assets/wikikai-mark.png?v=spark-ai-1" alt="" width="280" height="230" />
      <span className="brand-wordmark" aria-hidden="true" />
    </span>
  );
}
