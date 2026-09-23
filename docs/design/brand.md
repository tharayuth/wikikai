# WikiKai — Open Pages identity

The selected identity is an open book with an indigo left page and a teal
right page, paired with the rounded **WikiKai** wordmark. The two pages
represent people and AI contributing to shared knowledge.

Optional accompanying copy: **Knowledge, built together.**
Thai: **ความรู้ที่คนและ AI ต่อยอดร่วมกัน**.
Keep the tagline separate from the logo so it stays readable and can be
omitted in compact navigation.

## Assets and usage

- `client/public/wikikai-logo.png`: transparent horizontal lockup for reuse.
- `client/public/assets/wikikai-mark.png`: two-color book, used by the portal
  and README.
- `client/public/assets/wikikai-wordmark.png`: custom lettering; the
  `BrandLogo` component uses its alpha as a CSS mask with the theme's text
  color. This keeps the lettering legible without changing the book colors.
- `client/public/wikikai-logo-mini.png`: square icon at the existing URL.
- `client/public/favicon.ico`: 16, 32 and 48 px PNG entries.
- `client/public/favicon-{32,192,512}.png` and
  `client/public/apple-touch-icon.png`: book-only browser and home-screen
  icons. Small icons omit the wordmark and reserve a little clear space.

The login, portal header, empty document view, public share header and share
login use `BrandLogo`. The SPA and standalone chart/diagram viewers link to
the same icon with an identity version query to refresh browser caches.
Legacy logo and icon URLs remain available.

## Image generation

Created with the built-in **imagegen** tool from the selected Open Pages
concept. The tool cleaned the identity into one transparent horizontal
master. Asset preparation only crops the mark/lettering and resizes PNGs;
the original generated shapes and colors are retained.

Final production prompt:

```text
Use case: background-extraction / logo-brand
Asset type: final production horizontal logo master, transparent PNG.
Edit target: the supplied WikiKai Open Pages concept board. The user selected the LARGE TOP two-color book icon and its WikiKai wordmark. Preserve that exact design and lettering.
Primary request: isolate ONLY the main horizontal book + WikiKai lockup. Remove the tagline and both smaller bottom icon samples. Remove all surrounding glow, haze, shadows, tint, texture and artifacts. Return one clean large horizontal logo, centered with a modest transparent margin.
Book: preserve the original two broad gently rounded page silhouettes and narrow central seam. Left page rich indigo blue, right page teal. Both solid opaque fills with crisp antialiased edges. Preserve proportions and curvature.
Wordmark exact text: "WikiKai" (W i k i K a i). Preserve the reference's friendly chunky rounded custom sans lettering, capitals W and K, and spacing. Solid opaque dark navy, flat. Wordmark beside the book, vertically centered, no tagline.
Background: genuinely transparent alpha, entirely clear between and outside the shapes. No background color, no checkerboard drawn into image, no drop shadow, no colored aura, no glow, no gradient, no mockup, no board, no other text or icons.
This is a cleanup and extraction of the selected identity, not a new design. Do not reinterpret the book or the lettering. Render at high resolution in a wide horizontal composition.
```
