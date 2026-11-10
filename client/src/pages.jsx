import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, kes } from './api';

const useLoad = (path, deps = []) => {
  const [data, setData] = useState(null), [tick, setTick] = useState(0);
  useEffect(() => { api(path).then(setData).catch(() => setData([])); }, [path, tick, ...deps]);
  return [data, () => setTick(t => t + 1)];
};
const Modal = ({ title, onClose, children }) => (
  <div className="modal" onMouseDown={onClose}>
    <div className="panel" role="dialog" aria-label={title} onMouseDown={e => e.stopPropagation()}>
      <h3>{title}</h3>{children}
    </div>
  </div>
);
const Status = ({ p }) => {
  const s = p.qty <= 0 ? ['out', 'Out of stock'] : p.qty <= p.min_stock ? ['low', 'Low stock'] : ['ok', 'In stock'];
  return <span className={'tag ' + s[0]}>{s[1]}</span>;
};
const Receipt = ({ sale, onClose }) => (
  <Modal title={`Receipt #${sale.id}`} onClose={onClose}>
    <div className="receipt">
      <p className="mute">{new Date(sale.created_at.replace(' ', 'T') + 'Z').toLocaleString()} · {sale.cashier}</p>
      <table><tbody>{sale.items.map((i, k) => <tr key={k}><td>{i.name}</td><td>{i.qty} × {i.unit_price}</td><td className="r">{kes(i.qty * i.unit_price)}</td></tr>)}</tbody></table>
      <p className="total">Total {kes(sale.total)} <span className="mute">({sale.payment})</span></p>
    </div>
    <div className="row noprint"><button className="btn" onClick={() => window.print()}>Print</button><button className="btn ghost" onClick={onClose}>Close</button></div>
  </Modal>
);

export function Dashboard() {
  const [d] = useLoad('/reports/summary');
  if (!d || !d.stock) return <p className="mute">Loading…</p>;
  const S = d.stock;
  return (<>
    <h2>Dashboard</h2>
    <div className="stats">
      <div className="stat"><span>Today's revenue</span><b>{kes(d.today.revenue)}</b><small>{d.today.n} sales</small></div>
      <div className="stat"><span>This month</span><b>{kes(d.month.revenue)}</b><small>{d.month.n} sales</small></div>
      <div className="stat"><span>Gross profit (month)</span><b className="ok">{kes(d.month.profit)}</b><small>before expenses</small></div>
      <div className="stat"><span>Stock value (cost)</span><b>{kes(S.value)}</b><small>{S.products} products</small></div>
    </div>
    <div className="cols">
      <section className="panel"><h3>Revenue and profit, 14 days</h3>
        <div style={{ height: 240 }}><ResponsiveContainer>
          <AreaChart data={d.series}><CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
            <XAxis dataKey="day" tickFormatter={x => x.slice(5)} stroke="var(--mute)" /><YAxis stroke="var(--mute)" width={50} />
            <Tooltip formatter={v => kes(v)} contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)' }} />
            <Area dataKey="revenue" name="Revenue" stroke="var(--acc)" fill="var(--acc)" fillOpacity={.18} />
            <Area dataKey="profit" name="Gross profit" stroke="var(--ok)" fill="var(--ok)" fillOpacity={.18} />
          </AreaChart></ResponsiveContainer></div>
      </section>
      <section className="panel"><h3>Stock health</h3>
        <p><span className="tag ok">In stock</span> {S.ok} <span className="tag low">Low</span> {S.low} <span className="tag out">Out</span> {S.out}</p>
        {d.lowList.length ? <table><tbody>{d.lowList.map(p => <tr key={p.id}><td>{p.name}</td><td className="r">{p.qty} left</td></tr>)}</tbody></table> : <p className="mute">Nothing needs restocking.</p>}
      </section>
      <section className="panel"><h3>Best sellers</h3>{d.top.length ? <table><tbody>{d.top.map(t => <tr key={t.name}><td>{t.name}</td><td>{t.sold} sold</td><td className="r">{kes(t.revenue)}</td></tr>)}</tbody></table> : <p className="mute">No sales yet.</p>}</section>
      <section className="panel"><h3>Payment methods</h3>{d.payments.length ? <table><tbody>{d.payments.map(t => <tr key={t.name}><td>{t.name}</td><td className="r">{kes(t.value)}</td></tr>)}</tbody></table> : <p className="mute">No sales yet.</p>}</section>
    </div>
  </>);
}

export function Products({ user, toast }) {
  const isAdmin = user.role === 'admin', [q, setQ] = useState('');
  const [rows, reload] = useLoad('/products?q=' + encodeURIComponent(q), [q]);
  const [sup] = useLoad('/suppliers'), [edit, setEdit] = useState(null), [adj, setAdj] = useState(null);
  const [moves, reloadMoves] = useLoad(isAdmin ? '/moves' : '/products?q=zzzzzz');
  const blank = { sku: '', name: '', category: '', cost: '', price: '', qty: 0, min_stock: 5, supplier_id: '' };
  const save = async e => {
    e.preventDefault();
    const body = { ...edit, cost: +edit.cost, price: +edit.price, qty: +edit.qty, min_stock: +edit.min_stock, supplier_id: edit.supplier_id ? +edit.supplier_id : null };
    ['id', 'supplier', 'active'].forEach(k => delete body[k]); if (edit.id) delete body.qty;
    const send = b => api(edit.id ? '/products/' + edit.id : '/products', { method: edit.id ? 'PUT' : 'POST', body: b });
    try { await send(body); } catch (x) {
      if (!x.message.includes('below cost') || !confirm('Selling price is below cost price. Save anyway?')) return toast(x.message);
      try { await send({ ...body, allowBelowCost: true }); } catch (y) { return toast(y.message); }
    }
    setEdit(null); reload(); reloadMoves(); toast('Product saved');
  };
  const adjust = async e => {
    e.preventDefault();
    try { await api(`/products/${adj.p.id}/adjust`, { body: { type: adj.type, qty: +adj.qty } }); setAdj(null); reload(); reloadMoves(); toast('Stock updated'); } catch (x) { toast(x.message); }
  };
  const del = async p => { if (confirm(`Delete ${p.name}? Past sales are kept.`)) { await api('/products/' + p.id, { method: 'DELETE' }); reload(); } };
  const F = (k, label, props = {}) => <label>{label}<input value={edit[k] ?? ''} onChange={e => setEdit({ ...edit, [k]: e.target.value })} required {...props} /></label>;
  return (<>
    <div className="head"><h2>Products</h2><input className="search" placeholder="Search name, SKU, category" value={q} onChange={e => setQ(e.target.value)} />
      {isAdmin && <button className="btn" onClick={() => setEdit(blank)}>Add product</button>}</div>
    <div className="panel wrap">{!rows ? 'Loading…' : rows.length ? <table><thead><tr><th>Name</th><th>SKU</th><th>Category</th><th>Cost</th><th>Price</th><th>Qty</th><th>Status</th>{isAdmin && <th />}</tr></thead>
      <tbody>{rows.map(p => <tr key={p.id}><td>{p.name}</td><td>{p.sku}</td><td>{p.category}</td><td>{kes(p.cost)}</td><td>{kes(p.price)}</td><td>{p.qty}</td><td><Status p={p} /></td>
        {isAdmin && <td className="acts"><button className="btn sm ghost" onClick={() => setAdj({ p, type: 'restock', qty: '' })}>Stock</button><button className="btn sm ghost" onClick={() => setEdit(p)}>Edit</button><button className="btn sm danger" onClick={() => del(p)}>Delete</button></td>}</tr>)}</tbody></table>
      : <p className="mute">No products found. Add your first product to get started.</p>}</div>
    {isAdmin && <section className="panel wrap"><h3>Stock movements</h3>{Array.isArray(moves) && moves.length ? <table><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Change</th><th>Balance</th></tr></thead>
      <tbody>{moves.slice(0, 15).map(m => <tr key={m.id}><td>{new Date(m.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</td><td>{m.name}</td><td>{m.type}</td><td className={m.qty < 0 ? 'bad' : 'ok'}>{m.qty > 0 ? '+' : ''}{m.qty}</td><td>{m.balance}</td></tr>)}</tbody></table> : <p className="mute">No movements yet.</p>}</section>}
    {edit && <Modal title={edit.id ? 'Edit product' : 'Add product'} onClose={() => setEdit(null)}><form onSubmit={save}>
      {F('name', 'Name')}{F('sku', 'SKU')}{F('category', 'Category')}
      <div className="row">{F('cost', 'Cost (KSh)', { type: 'number', min: 0, step: 'any' })}{F('price', 'Price (KSh)', { type: 'number', min: 0, step: 'any' })}</div>
      <div className="row">{!edit.id && F('qty', 'Opening stock', { type: 'number', min: 0, step: 1 })}{F('min_stock', 'Minimum stock', { type: 'number', min: 0, step: 1 })}</div>
      <label>Supplier<select value={edit.supplier_id ?? ''} onChange={e => setEdit({ ...edit, supplier_id: e.target.value })}><option value="">None</option>{(sup || []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <div className="row"><button className="btn">Save product</button><button type="button" className="btn ghost" onClick={() => setEdit(null)}>Cancel</button></div></form></Modal>}
    {adj && <Modal title={`Adjust stock: ${adj.p.name}`} onClose={() => setAdj(null)}><p className="mute">Current stock: {adj.p.qty}</p><form onSubmit={adjust}>
      <label>Reason<select value={adj.type} onChange={e => setAdj({ ...adj, type: e.target.value })}><option value="restock">Purchase/restock</option><option value="return">Customer return</option><option value="damaged">Damaged goods</option><option value="adjustment">Manual adjustment (± allowed)</option></select></label>
      <label>Quantity<input type="number" step="1" autoFocus required value={adj.qty} onChange={e => setAdj({ ...adj, qty: e.target.value })} /></label>
      <div className="row"><button className="btn">Save adjustment</button><button type="button" className="btn ghost" onClick={() => setAdj(null)}>Cancel</button></div></form></Modal>}
  </>);
}

export function Pos({ toast }) {
  const [q, setQ] = useState(''), [rows, reload] = useLoad('/products?q=' + encodeURIComponent(q), [q]);
  const [cart, setCart] = useState([]), [pay, setPay] = useState('Cash'), [busy, setBusy] = useState(false), [done, setDone] = useState(null);
  const idem = useRef(crypto.randomUUID()), search = useRef();
  useEffect(() => { const k = e => { if (e.key === '/' && document.activeElement.tagName !== 'INPUT') { e.preventDefault(); search.current?.focus(); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const add = p => setCart(c => { const x = c.find(i => i.p.id === p.id); if (x && x.qty >= p.qty) { toast(`Only ${p.qty} in stock`); return c; } return x ? c.map(i => i.p.id === p.id ? { ...i, qty: i.qty + 1 } : i) : [...c, { p, qty: 1 }]; });
  const setQty = (id, d) => setCart(c => c.map(i => i.p.id === id ? { ...i, qty: Math.max(1, Math.min(i.p.qty, i.qty + d)) } : i));
  const total = useMemo(() => cart.reduce((a, i) => a + i.qty * i.p.price, 0), [cart]);
  const checkout = async () => {
    if (busy || !cart.length) return; setBusy(true);
    try {
      const s = await api('/sales', { body: { items: cart.map(i => ({ productId: i.p.id, qty: i.qty })), payment: pay, idem: idem.current } });
      setDone(s); setCart([]); idem.current = crypto.randomUUID(); reload(); toast('Sale completed');
    } catch (x) { toast(x.message); } finally { setBusy(false); }
  };
  return (<>
    <h2>Point of sale</h2>
    <div className="pos">
      <section className="panel">
        <input ref={search} className="search wide" placeholder="Search products (press / to focus, Enter adds the first match)" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && rows?.[0] && rows[0].qty > 0) { add(rows[0]); setQ(''); } }} />
        <div className="pgrid">{(rows || []).map(p => <button key={p.id} className="pitem" disabled={p.qty <= 0} onClick={() => add(p)}><b>{p.name}</b><span>{kes(p.price)}</span><small className="mute">{p.qty} in stock</small></button>)}</div>
      </section>
      <section className="panel"><h3>Cart</h3>
        {cart.length ? <>
          {cart.map(i => <div className="line" key={i.p.id}><span>{i.p.name}<small className="mute"> {kes(i.p.price)}</small></span>
            <span className="step"><button onClick={() => setQty(i.p.id, -1)} aria-label="Less">−</button>{i.qty}<button onClick={() => setQty(i.p.id, 1)} aria-label="More">+</button></span>
            <b>{kes(i.qty * i.p.price)}</b><button className="x" onClick={() => setCart(c => c.filter(x => x.p.id !== i.p.id))} aria-label="Remove">✕</button></div>)}
          <p className="total">Total {kes(total)}</p>
          <div className="seg">{['Cash', 'M-Pesa', 'Card'].map(m => <button key={m} className={pay === m ? 'on' : ''} onClick={() => setPay(m)}>{m}</button>)}</div>
          <button className="btn block" disabled={busy} onClick={checkout}>{busy ? 'Processing…' : 'Complete sale'}</button>
        </> : <p className="mute">Pick a product to start a sale.</p>}
      </section>
    </div>
    {done && <Receipt sale={done} onClose={() => setDone(null)} />}
  </>);
}

export function Sales({ user, toast }) {
  const [rows] = useLoad('/sales'), [q, setQ] = useState(''), [view, setView] = useState(null);
  const list = (rows || []).filter(s => (`#${s.id} ${s.payment} ${s.cashier} ${s.created_at}`).toLowerCase().includes(q.toLowerCase()));
  const exp = async () => { try { const b = await api('/export/sales.csv'); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'stockflow-sales.csv'; a.click(); } catch (x) { toast(x.message); } };
  return (<>
    <div className="head"><h2>Sales history</h2><input className="search" placeholder="Search ID, payment, cashier, date" value={q} onChange={e => setQ(e.target.value)} />
      {user.role === 'admin' && <button className="btn ghost" onClick={exp}>Export CSV</button>}</div>
    <div className="panel wrap">{list.length ? <table><thead><tr><th>ID</th><th>Date</th><th>Cashier</th><th>Items</th><th>Payment</th><th>Total</th><th /></tr></thead>
      <tbody>{list.map(s => <tr key={s.id}><td>#{s.id}</td><td>{new Date(s.created_at.replace(' ', 'T') + 'Z').toLocaleString()}</td><td>{s.cashier}</td><td>{s.items.reduce((a, i) => a + i.qty, 0)}</td><td>{s.payment}</td><td>{kes(s.total)}</td><td><button className="btn sm ghost" onClick={() => setView(s)}>Receipt</button></td></tr>)}</tbody></table>
      : <p className="mute">No sales recorded yet. Complete a sale in the point of sale.</p>}</div>
    {view && <Receipt sale={view} onClose={() => setView(null)} />}
  </>);
}

export function Suppliers({ user, toast }) {
  const [rows, reload] = useLoad('/suppliers'), [f, setF] = useState(null);
  const save = async e => { e.preventDefault(); try { await api('/suppliers', { body: f }); setF(null); reload(); } catch (x) { toast(x.message); } };
  return (<>
    <div className="head"><h2>Suppliers</h2>{user.role === 'admin' && <button className="btn" onClick={() => setF({ name: '', phone: '', email: '' })}>Add supplier</button>}</div>
    <div className="panel wrap">{rows?.length ? <table><thead><tr><th>Name</th><th>Phone</th><th>Email</th><th>Products</th></tr></thead>
      <tbody>{rows.map(s => <tr key={s.id}><td>{s.name}</td><td>{s.phone}</td><td>{s.email}</td><td>{s.products}</td></tr>)}</tbody></table> : <p className="mute">No suppliers yet.</p>}</div>
    {f && <Modal title="Add supplier" onClose={() => setF(null)}><form onSubmit={save}>
      {['name', 'phone', 'email'].map(k => <label key={k}>{k[0].toUpperCase() + k.slice(1)}<input value={f[k]} required={k === 'name'} type={k === 'email' ? 'email' : 'text'} onChange={e => setF({ ...f, [k]: e.target.value })} /></label>)}
      <div className="row"><button className="btn">Save supplier</button><button type="button" className="btn ghost" onClick={() => setF(null)}>Cancel</button></div></form></Modal>}
  </>);
}
