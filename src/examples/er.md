# ER Diagram Pattern

## Basic ER

```mermaid
erDiagram
  CUSTOMER ||--o{ ORDER : places
  ORDER ||--|{ LINE_ITEM : contains
  PRODUCT ||--o{ LINE_ITEM : "appears in"

  CUSTOMER {
    int id PK
    string name
    string email UK
    datetime created_at
  }
  ORDER {
    int id PK
    int customer_id FK
    decimal total
    datetime placed_at
  }
  LINE_ITEM {
    int id PK
    int order_id FK
    int product_id FK
    int qty
    decimal price
  }
  PRODUCT {
    int id PK
    string sku UK
    string name
    decimal price
  }
```

## Tips

- ใช้ `||--o{` = one-to-many, `||--||` = one-to-one, `}o--o{` = many-to-many
- ใส่ `PK` / `FK` / `UK` หลัง column name สำหรับ primary / foreign / unique key
- คั่นความสัมพันธ์ด้วย label เช่น `: places`, `: contains` เพื่อให้อ่านง่าย
