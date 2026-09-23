# WikiKai — Shared Spark identity

The selected A1 identity pairs an indigo/teal open book with a four-point
spark at the meeting of its pages. The spark represents AI contributing
to shared knowledge. The rounded **WikiKai** wordmark highlights its final
lowercase **ai** in teal.

Optional accompanying copy: **Knowledge, built together.**
Thai: **ความรู้ที่คนและ AI ต่อยอดร่วมกัน**.
Keep the tagline separate from the logo so it stays readable and can be
omitted in compact navigation.

## Assets and themes

- `client/public/wikikai-logo.png`: transparent horizontal lockup for light
  backgrounds, including the teal ai.
- `client/public/assets/wikikai-mark.png`: two-color book and transparent
  spark, used by the portal and README.
- `client/public/assets/wikikai-wordmark.png`: custom lettering. The
  `BrandLogo` component uses its alpha as a CSS mask, preserving the
  accepted letterforms and spacing.
- `client/public/wikikai-logo-mini.png`: square icon at the existing URL.
- `client/public/favicon.ico`: 16, 32 and 48 px PNG entries.
- `client/public/favicon-{32,192,512}.png` and
  `client/public/apple-touch-icon.png`: book-and-spark browser and
  home-screen icons, with a little clear space around the symbol.

The wordmark mask uses two theme tokens: `--brand-ink` is navy on light
surfaces and off-white on dark surfaces; `--brand-ai` stays teal. The hard
color stop at 77.7% follows the boundary between K and ai in this asset.
The book colors stay unchanged, and the spark reveals the background.

The login, portal header, empty document view, public share header and share
login use `BrandLogo`. The SPA and standalone chart/diagram viewers link to
the same icon. Logo, mask and icon references use `v=spark-ai-1` to refresh
cached assets from the previous identity. Legacy asset URLs remain available.

## Image generation

Created with the built-in **imagegen** tool from the approved A1 concept.
The tool extracted the main lockup and cleaned its edges. Asset preparation
crops and resizes that master into the mark, wordmark and browser icons.
Theme colors are applied in CSS.

Production prompt:

```text
Use case: background-extraction / logo-brand
Asset type: final production transparent logo master.
Edit target: the approved A1 WikiKai proof attached. It has an open two-color book, a white four-point sparkle carved into the center seam, and the word WikiKai with teal final "ai".
Primary request: extract and clean ONLY the large top horizontal logo. Remove the bottom sample completely. Remove all glow, soft colored halos, shadows, haze, texture and background. Return a crisp single flat horizontal identity on truly transparent background, with a small clear margin.
Preserve the approved shape and proportions exactly: rounded indigo-blue left page, rounded teal right page, the bold four-point negative-space sparkle where the pages meet, and the narrow lower center seam. The sparkle MUST be transparent negative space, not an opaque white shape. The colored page fills must be fully opaque.
Preserve the exact custom rounded wordmark, including all letterforms, kerning, baseline and capitalization: "WikiKai" (W i k i K a i), one continuous word. The first five letters "WikiK" are opaque dark navy. ONLY the final lowercase "a" and final lowercase "i", including its dot, are opaque teal matching the right book page. No other letters change color.
Solid flat opaque fills and crisp antialiased edges only. No gradients, no glow, no shadow, no 3D, no border, no background, no white matte, no checkerboard baked into the image. No extra text, no tagline, no other icons or samples. Keep the accepted A1 identity; this is production cleanup, not a redesign. Wide horizontal composition.
```

Edge cleanup prompt:

```text
Use case: precise-object-edit
Edit target: attached WikiKai production logo.
Perform a surgical edge-and-transparency cleanup. The design, placement, sizes, text and colors must stay identical.
There are stray cyan/teal pixels and rough fringes at the center book seam, around the teal "a" counter, around the teal "i" dot, and along some outer edges. Remove ALL those specks, fringes and leftover mask artifacts. Restore perfectly clean smooth vector-like contours, solid uninterrupted opaque color inside each legitimate shape, and fully clear transparent negative spaces outside them.
The four-point star between book pages and the lower center gap must be completely transparent; no cyan line or dots there. Both openings inside the lowercase "a" must be fully transparent and smoothly rounded; no cyan fill, fragments or islands. The gap below the final i dot must be completely transparent.
Retain exact two-color book silhouette: blue left, teal right; retain exact rounded WikiKai wordmark with dark-navy "WikiK" and teal final "ai". ONE horizontal lockup only.
Output a flat, sharp, production-ready transparent PNG. No glow, no shadows, no blur, no colored halo, no texture, no gradients, no background. Do not redesign or decorate anything.
```
