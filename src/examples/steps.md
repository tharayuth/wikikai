# Step Cards Examples

Use ` ```steps ` with a JSON array. Each item has:
- `title` (string, optional) — bold heading
- `body` (string, optional) — markdown supported (code spans, **bold**, *italic*, links, lists)
- `n` (string or number, optional) — badge text; defaults to 1-based index

## Basic 3 steps

```steps
[
  {
    "title": "ดึง Raw + bump rev",
    "body": "PROD API → SSE stream → เทียบ `submittedDt` / `updatedDt` กับ rev ล่าสุดของ FID นั้น → INSERT new rev (ถ้าต่าง) หรือ skip (เหมือนเดิม). เก็บ JSONB ทุก rev"
  },
  {
    "title": "แปลง (mirror)",
    "body": "SELECT raw rows + revision → INSERT factories + datasets ด้วย rev เดียวกัน. **ไม่มี logic compare** — แค่ skip ถ้า (fid, rev) มีอยู่แล้ว"
  },
  {
    "title": "Diff Revision",
    "body": "เทียบ payload JSONB ระหว่าง rev N-1 vs N (ที่ raw layer). Flatten nested keys → ตาราง diff per field path"
  }
]
```

## Custom badge labels

```steps
[
  { "n": "A", "title": "Plan", "body": "Define scope and success criteria." },
  { "n": "B", "title": "Build", "body": "Implement core flow with `tests`." },
  { "n": "C", "title": "Ship", "body": "Deploy + monitor for first 24h." }
]
```

## With bullets inside body

```steps
[
  {
    "title": "Pre-flight",
    "body": "Before starting:\n\n- Lock the schema\n- Snapshot the DB\n- Notify oncall"
  },
  {
    "title": "Migration",
    "body": "Run `npm run migrate:up`. Expected duration **~3 min**."
  }
]
```
