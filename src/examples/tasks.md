# Checkboxes

Every checkbox renders as a clickable box and is flipped with `toggle_task`. Boxes are
numbered 0, 1, 2 … in source order across all three kinds below. Boxes inside other code
fences are plain text and don't count.

## Task list

- [ ] Write the migration
- [x] Review the schema

1. [ ] Numbered items work too

## In a table cell

| Task | Dev | QA |
|---|---|---|
| Login | [x] | [ ] |
| Export | [ ] | [ ] |

A cell can hold several: `| Tests [x] Lint [ ] |`. A box needs a space or `|` right after it;
put a literal `[x]` in backticks to keep it as text. `get_table_rows_with_checkbox` returns
each row's boxes with the index `toggle_task` takes.

## In custom HTML — only when a layout needs it

```html-embed
<label><input type="checkbox"> Custom styled item</label>
```
