# Images

Upload with `get_upload_url` (curl), then paste the `markdown` line it returns.
`/img/<hash>.png` below stands for that returned `src`.

## Inline image — the default

![Login screen](/img/<hash>.png "720x")

- Size goes in the title slot: `"300x200"` fits both, `"300x"` width only, `"x200"` height only,
  or `"tooltip text w=300 h=200"`. The aspect ratio is always kept.
- The article column is about 860px wide; `"720x"` is a safe full-width cap.
- On a line of its own the image is centred and its alt text shows as the caption, so write the
  alt as a short figure name. Inside a sentence it gets no caption.
- Readers can drag the edges to resize (saved back into the title slot) and click to open full size.

## In a table cell

| Screen | Notes |
|---|---|
| ![Home](/img/<hash>.png "240x") | Landing page |

## Gallery — four or more side by side

```images
[
  { "src": "/img/<hash>.png", "alt": "Step 1", "caption": "Sign in" },
  { "src": "/img/<hash>.png", "alt": "Step 2", "caption": "Pick a project" },
  { "src": "/img/<hash>.png", "alt": "Step 3", "caption": "Upload" },
  { "src": "/img/<hash>.png", "alt": "Step 4", "caption": "Done" }
]
```

## Inside custom HTML — only when a layout needs it

```html-embed
<div style="display:flex;gap:12px">
  <img src="/img/<hash>.png" alt="Before" style="max-width:320px">
  <img src="/img/<hash>.png" alt="After" style="max-width:320px">
</div>
```
