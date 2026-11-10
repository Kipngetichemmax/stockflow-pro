import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';

export const db = new Database(process.env.DB_FILE || 'stockflow.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','cashier')));
CREATE TABLE IF NOT EXISTS suppliers(id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT, email TEXT);
CREATE TABLE IF NOT EXISTS products(id INTEGER PRIMARY KEY, sku TEXT UNIQUE NOT NULL, name TEXT NOT NULL, category TEXT NOT NULL,
  cost REAL NOT NULL CHECK(cost>=0), price REAL NOT NULL CHECK(price>=0), qty INTEGER NOT NULL DEFAULT 0 CHECK(qty>=0),
  min_stock INTEGER NOT NULL DEFAULT 5, supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS sales(id INTEGER PRIMARY KEY, idem TEXT UNIQUE, user_id INTEGER REFERENCES users(id), payment TEXT NOT NULL,
  total REAL NOT NULL, cogs REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sale_items(id INTEGER PRIMARY KEY, sale_id INTEGER NOT NULL REFERENCES sales(id), product_id INTEGER,
  name TEXT NOT NULL, qty INTEGER NOT NULL, unit_price REAL NOT NULL, unit_cost REAL NOT NULL);
CREATE TABLE IF NOT EXISTS moves(id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id), type TEXT NOT NULL,
  qty INTEGER NOT NULL, balance INTEGER NOT NULL, user_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
`);

if (!db.prepare('SELECT 1 FROM users').get()) {
  const u = db.prepare('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)');
  u.run('admin', bcrypt.hashSync('admin123', 10), 'admin');
  u.run('cashier', bcrypt.hashSync('cashier123', 10), 'cashier');
  const s = db.prepare('INSERT INTO suppliers(name,phone,email) VALUES(?,?,?)').run('ABC Electronics', '0712345678', 'abc@example.com').lastInsertRowid;
  const p = db.prepare('INSERT INTO products(sku,name,category,cost,price,qty,min_stock,supplier_id) VALUES(?,?,?,?,?,?,?,?)');
  const m = db.prepare("INSERT INTO moves(product_id,type,qty,balance) VALUES(?,'opening',?,?)");
  [['SAM-CH-001','Samsung Charger','Electronics',500,800,25],['EAR-001','Earphones','Electronics',700,1200,12],
   ['USB-001','USB Cable','Electronics',150,300,40],['CAS-001','Phone Case','Accessories',200,450,3]]
    .forEach(r => { const id = p.run(...r, 5, s).lastInsertRowid; m.run(id, r[5], r[5]); });
}
