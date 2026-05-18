# Chart.js Examples

## Bar Chart

```chart
{
  "type": "bar",
  "data": {
    "labels": ["Mon","Tue","Wed","Thu","Fri"],
    "datasets": [
      { "label": "Visits", "data": [120, 190, 70, 150, 200], "backgroundColor": "#6366f1" }
    ]
  }
}
```

## Line Chart

```chart
{
  "type": "line",
  "data": {
    "labels": ["Jan","Feb","Mar","Apr","May","Jun"],
    "datasets": [
      { "label": "Revenue", "data": [12, 19, 17, 25, 30, 28], "borderColor": "#10b981", "tension": 0.3 },
      { "label": "Cost",    "data": [10, 12, 13, 15, 18, 20], "borderColor": "#ef4444", "tension": 0.3 }
    ]
  }
}
```

## Doughnut

```chart
{
  "type": "doughnut",
  "data": {
    "labels": ["Done","In Progress","Pending"],
    "datasets": [
      { "data": [42, 18, 15], "backgroundColor": ["#10b981", "#f59e0b", "#94a3b8"] }
    ]
  }
}
```

## Chart Grid (side-by-side)

Use ` ```chart-grid ` with a JSON **array** of chart configs. Each item may include an optional
`"title"` field. Cards auto-flow into a responsive grid (≥ 360px per card).

```chart-grid
[
  {
    "title": "Storage mix (MB)",
    "type": "doughnut",
    "data": {
      "labels": ["Dataset","Validation","Other"],
      "datasets": [{ "data": [136, 135, 70], "backgroundColor": ["#4299e1","#f56565","#a0aec0"] }]
    }
  },
  {
    "title": "Growth (GB)",
    "type": "line",
    "data": {
      "labels": ["Y1","Y5","Y10","Y20"],
      "datasets": [{ "label": "DB size", "data": [3.5, 17, 34, 68], "borderColor": "#5b52cc", "tension": 0.3 }]
    }
  }
]
```
