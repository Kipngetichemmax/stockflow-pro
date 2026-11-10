# StockFlow Pro

Full-stack inventory and point-of-sale system for small retailers.

**Stack:** React 19 + Vite + Recharts (client) · Node.js + Express + SQLite (better-sqlite3) · JWT auth · bcrypt · Zod validation · Helmet + rate limiting.

## Run it (two terminals)

```bash
# 1) API  -> http://localhost:4000
cd server && npm install && npm run dev

# 2) Web  -> http://localhost:5173
cd client && npm install && npm run dev
```

Demo logins: `admin / admin123` and `cashier / cashier123`. Change these before real use.
Copy `server/.env.example` to `server/.env` and set `JWT_SECRET` (export the variables or use `node --env-file=.env`).

Production: `cd client && npm run build`, then `cd server && npm start`. Express serves `client/dist` on port 4000.

## What it does
- Roles: admin (everything) and cashier (POS, products view, sales).
- Products with unique SKU, below-cost confirmation, soft delete (sales history is preserved).
- Stock adjustments (restock, return, damaged, manual) with a movement log; stock can never go negative.
- POS: search with `/` shortcut, Enter to add, quantity steppers, Cash/M-Pesa/Card, printable receipt.
- Sales are one database transaction, and an idempotency key makes double submission safe.
- Dashboard: revenue and gross profit (14-day chart), stock health, best sellers, payment mix.
- Sales history search and CSV export, suppliers, light/dark theme, responsive layout.

## API (all under `/api`, JWT bearer token)
| Method | Path | Role |
|---|---|---|
| POST | /login | public |
| GET | /me | any |
| GET/POST | /users | admin |
| GET | /products?q= | any |
| POST/PUT/DELETE | /products, /products/:id | admin |
| POST | /products/:id/adjust | admin |
| GET | /moves | admin |
| GET/POST | /suppliers | any / admin |
| GET/POST | /sales | any |
| GET | /export/sales.csv | admin |
| GET | /reports/summary | admin |

## Known limitations / next steps
Token is stored in localStorage (use httpOnly cookies for production), no user-management screen yet (API exists), no automated tests, no refunds or multi-branch. Add Docker, tests (Vitest/Supertest) and PostgreSQL when you outgrow SQLite.
