import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from './db.js';

const SECRET = process.env.JWT_SECRET || (console.warn('JWT_SECRET not set: using a temporary secret (logins reset on restart)'), crypto.randomBytes(32).toString('hex'));
const OFF = process.env.TZ_OFFSET || '+3 hours'; // Nairobi
const app = express();
app.use(helmet(), cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' }), express.json({ limit: '100kb' }));

const httpErr = (status, message) => Object.assign(new Error(message), { status });
const h = fn => (req, res, next) => { try { fn(req, res); } catch (e) { next(e); } };
const parse = (schema, data) => {
  const r = schema.safeParse(data);
  if (!r.success) throw httpErr(400, r.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
};
const auth = (...roles) => (req, res, next) => {
  try {
    req.user = jwt.verify((req.headers.authorization || '').slice(7), SECRET);
    if (roles.length && !roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission for this action' });
    next();
  } catch { res.status(401).json({ error: 'Please sign in' }); }
};
const admin = auth('admin'), any = auth();

/* ---- Auth ---- */
app.post('/api/login', rateLimit({ windowMs: 60_000, limit: 10, message: { error: 'Too many attempts, try again in a minute' } }), h((req, res) => {
  const { username, password } = parse(z.object({ username: z.string(), password: z.string() }), req.body);
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!u || !bcrypt.compareSync(password, u.password_hash)) throw httpErr(401, 'Wrong username or password');
  const user = { id: u.id, username: u.username, role: u.role };
  res.json({ token: jwt.sign(user, SECRET, { expiresIn: '8h' }), user });
}));
app.get('/api/me', any, h((req, res) => res.json({ id: req.user.id, username: req.user.username, role: req.user.role })));
app.get('/api/users', admin, h((req, res) => res.json(db.prepare('SELECT id,username,role FROM users').all())));
app.post('/api/users', admin, h((req, res) => {
  const d = parse(z.object({ username: z.string().trim().min(3), password: z.string().min(8), role: z.enum(['admin', 'cashier']) }), req.body);
  const r = db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)').run(d.username, bcrypt.hashSync(d.password, 10), d.role);
  res.status(201).json({ id: r.lastInsertRowid, username: d.username, role: d.role });
}));

/* ---- Products & stock ---- */
const productSchema = z.object({
  sku: z.string().trim().min(1), name: z.string().trim().min(1), category: z.string().trim().min(1),
  cost: z.number().min(0), price: z.number().min(0), qty: z.number().int().min(0).default(0),
  min_stock: z.number().int().min(0).default(5), supplier_id: z.number().int().nullable().optional(), allowBelowCost: z.boolean().optional()
});
const move = (productId, type, qty, userId) => {
  const p = db.prepare('SELECT qty FROM products WHERE id=?').get(productId);
  db.prepare('INSERT INTO moves(product_id,type,qty,balance,user_id) VALUES(?,?,?,?,?)').run(productId, type, qty, p.qty, userId);
};
app.get('/api/products', any, h((req, res) => {
  const q = `%${req.query.q || ''}%`;
  res.json(db.prepare(`SELECT p.*, s.name supplier FROM products p LEFT JOIN suppliers s ON s.id=p.supplier_id
    WHERE p.active=1 AND (p.name LIKE @q OR p.sku LIKE @q OR p.category LIKE @q) ORDER BY p.name`).all({ q }));
}));
app.post('/api/products', admin, h((req, res) => {
  const d = parse(productSchema, req.body);
  if (d.price < d.cost && !d.allowBelowCost) throw httpErr(400, 'Selling price is below cost price');
  const id = db.transaction(() => {
    const r = db.prepare('INSERT INTO products(sku,name,category,cost,price,qty,min_stock,supplier_id) VALUES(?,?,?,?,?,?,?,?)')
      .run(d.sku, d.name, d.category, d.cost, d.price, d.qty, d.min_stock, d.supplier_id ?? null);
    if (d.qty > 0) move(r.lastInsertRowid, 'opening', d.qty, req.user.id);
    return r.lastInsertRowid;
  })();
  res.status(201).json({ id });
}));
app.put('/api/products/:id', admin, h((req, res) => {
  const d = parse(productSchema.omit({ qty: true }), req.body);
  if (d.price < d.cost && !d.allowBelowCost) throw httpErr(400, 'Selling price is below cost price');
  const r = db.prepare('UPDATE products SET sku=?,name=?,category=?,cost=?,price=?,min_stock=?,supplier_id=? WHERE id=? AND active=1')
    .run(d.sku, d.name, d.category, d.cost, d.price, d.min_stock, d.supplier_id ?? null, req.params.id);
  if (!r.changes) throw httpErr(404, 'Product not found');
  res.json({ ok: true });
}));
app.delete('/api/products/:id', admin, h((req, res) => { // soft delete keeps sales history intact
  db.prepare('UPDATE products SET active=0 WHERE id=?').run(req.params.id); res.json({ ok: true });
}));
app.post('/api/products/:id/adjust', admin, h((req, res) => {
  const d = parse(z.object({ type: z.enum(['restock', 'return', 'damaged', 'adjustment']), qty: z.number().int().refine(n => n !== 0, 'must not be 0') }), req.body);
  const delta = d.type === 'damaged' ? -Math.abs(d.qty) : d.type === 'adjustment' ? d.qty : Math.abs(d.qty);
  db.transaction(() => {
    const p = db.prepare('SELECT qty FROM products WHERE id=? AND active=1').get(req.params.id);
    if (!p) throw httpErr(404, 'Product not found');
    if (p.qty + delta < 0) throw httpErr(400, 'Stock cannot go below zero');
    db.prepare('UPDATE products SET qty=qty+? WHERE id=?').run(delta, req.params.id);
    move(req.params.id, d.type, delta, req.user.id);
  })();
  res.json({ ok: true });
}));
app.get('/api/moves', admin, h((req, res) => res.json(db.prepare(
  'SELECT m.*, p.name FROM moves m JOIN products p ON p.id=m.product_id ORDER BY m.id DESC LIMIT 100').all())));

/* ---- Suppliers ---- */
app.get('/api/suppliers', any, h((req, res) => res.json(db.prepare(
  'SELECT s.*, (SELECT COUNT(*) FROM products WHERE supplier_id=s.id AND active=1) products FROM suppliers s ORDER BY name').all())));
app.post('/api/suppliers', admin, h((req, res) => {
  const d = parse(z.object({ name: z.string().trim().min(1), phone: z.string().optional(), email: z.string().email().or(z.literal('')).optional() }), req.body);
  res.status(201).json({ id: db.prepare('INSERT INTO suppliers(name,phone,email) VALUES(?,?,?)').run(d.name, d.phone ?? '', d.email ?? '').lastInsertRowid });
}));

/* ---- Sales ---- */
const SALE_SQL = `SELECT s.id,s.payment,s.total,s.cogs,s.created_at,u.username cashier,
  (SELECT json_group_array(json_object('name',name,'qty',qty,'unit_price',unit_price,'unit_cost',unit_cost)) FROM sale_items WHERE sale_id=s.id) items
  FROM sales s LEFT JOIN users u ON u.id=s.user_id`;
const fix = r => ({ ...r, items: JSON.parse(r.items) });
const getSale = id => fix(db.prepare(`${SALE_SQL} WHERE s.id=?`).get(id));
app.post('/api/sales', any, h((req, res) => {
  const d = parse(z.object({
    items: z.array(z.object({ productId: z.number().int(), qty: z.number().int().min(1) })).min(1),
    payment: z.enum(['Cash', 'M-Pesa', 'Card']), idem: z.string().min(8)
  }), req.body);
  const id = db.transaction(() => {
    const dup = db.prepare('SELECT id FROM sales WHERE idem=?').get(d.idem);
    if (dup) return dup.id; // double submission: return the original sale
    let total = 0, cogs = 0; const lines = [];
    for (const it of d.items) {
      const p = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(it.productId);
      if (!p) throw httpErr(400, 'A product in the cart no longer exists');
      if (it.qty > p.qty) throw httpErr(400, `Only ${p.qty} of ${p.name} in stock`);
      total += it.qty * p.price; cogs += it.qty * p.cost; lines.push([p, it.qty]);
    }
    const sid = db.prepare('INSERT INTO sales(idem,user_id,payment,total,cogs) VALUES(?,?,?,?,?)').run(d.idem, req.user.id, d.payment, total, cogs).lastInsertRowid;
    for (const [p, qty] of lines) {
      db.prepare('INSERT INTO sale_items(sale_id,product_id,name,qty,unit_price,unit_cost) VALUES(?,?,?,?,?,?)').run(sid, p.id, p.name, qty, p.price, p.cost);
      db.prepare('UPDATE products SET qty=qty-? WHERE id=?').run(qty, p.id);
      move(p.id, 'sale', -qty, req.user.id);
    }
    return sid;
  })();
  res.status(201).json(getSale(id));
}));
app.get('/api/sales', any, h((req, res) => res.json(db.prepare(`${SALE_SQL} ORDER BY s.id DESC LIMIT 200`).all().map(fix))));
app.get('/api/export/sales.csv', admin, h((req, res) => {
  const q = v => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [['Sale', 'Date (UTC)', 'Cashier', 'Payment', 'Product', 'Qty', 'Unit price', 'Unit cost']];
  db.prepare(`${SALE_SQL} ORDER BY s.id`).all().map(fix).forEach(s => s.items.forEach(i => rows.push([s.id, s.created_at, s.cashier, s.payment, i.name, i.qty, i.unit_price, i.unit_cost])));
  res.type('text/csv').send(rows.map(r => r.map(q).join(',')).join('\n'));
}));

/* ---- Reports ---- */
app.get('/api/reports/summary', admin, h((req, res) => {
  const per = cond => db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(total),0) revenue, COALESCE(SUM(total-cogs),0) profit FROM sales WHERE ${cond}`).get(OFF, OFF);
  res.json({
    today: per("date(created_at,?)=date('now',?)"),
    week: per("date(created_at,?)>=date('now',?,'-6 days')"),
    month: per("strftime('%Y-%m',created_at,?)=strftime('%Y-%m','now',?)"),
    series: db.prepare(`SELECT date(created_at,@o) day, SUM(total) revenue, SUM(total-cogs) profit FROM sales
      WHERE date(created_at,@o)>=date('now',@o,'-13 days') GROUP BY day ORDER BY day`).all({ o: OFF }),
    top: db.prepare('SELECT name, SUM(qty) sold, SUM(qty*unit_price) revenue FROM sale_items GROUP BY name ORDER BY sold DESC LIMIT 5').all(),
    payments: db.prepare('SELECT payment name, SUM(total) value FROM sales GROUP BY payment').all(),
    stock: db.prepare(`SELECT COUNT(*) products, COALESCE(SUM(qty*cost),0) value, COALESCE(SUM(qty=0),0) out,
      COALESCE(SUM(qty>0 AND qty<=min_stock),0) low, COALESCE(SUM(qty>min_stock),0) ok FROM products WHERE active=1`).get(),
    lowList: db.prepare('SELECT id,name,qty,min_stock FROM products WHERE active=1 AND qty<=min_stock ORDER BY qty LIMIT 8').all()
  });
}));

/* ---- Static client (production) + errors ---- */
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get(/^\/(?!api).*/, (req, res) => res.sendFile(path.join(dist, 'index.html'))); }
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((e, req, res, next) => {
  if (e.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error: 'That value already exists (SKU or username must be unique)' });
  if (!e.status) console.error(e);
  res.status(e.status || 500).json({ error: e.status ? e.message : 'Server error' });
});
app.listen(process.env.PORT || 4000, () => console.log('StockFlow API on :' + (process.env.PORT || 4000)));
