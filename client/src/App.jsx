import { useEffect, useState } from 'react';
import { api, token } from './api';
import { Dashboard, Products, Pos, Sales, Suppliers } from './pages.jsx';

function Login({ onLogin }) {
  const [f, setF] = useState({ username: '', password: '' }), [err, setErr] = useState('');
  const submit = async e => {
    e.preventDefault(); setErr('');
    try { const d = await api('/login', { body: f }); token.set(d.token); onLogin(d.user); } catch (x) { setErr(x.message); }
  };
  return (
    <div className="login">
      <form onSubmit={submit} className="panel">
        <h1>StockFlow</h1>
        <p className="mute">Sign in to manage stock and sales.</p>
        <label>Username<input autoFocus value={f.username} onChange={e => setF({ ...f, username: e.target.value })} required /></label>
        <label>Password<input type="password" value={f.password} onChange={e => setF({ ...f, password: e.target.value })} required /></label>
        {err && <p className="err" role="alert">{err}</p>}
        <button className="btn">Sign in</button>
        <p className="mute small">Demo: admin / admin123 or cashier / cashier123</p>
      </form>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null), [ready, setReady] = useState(false), [page, setPage] = useState(null);
  const [msg, setMsg] = useState(''), [dark, setDark] = useState(localStorage.getItem('sf_dark') === '1');
  useEffect(() => { document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('sf_dark', dark ? '1' : '0'); }, [dark]);
  useEffect(() => { (token.get() ? api('/me').then(setUser).catch(() => token.set(null)) : Promise.resolve()).finally(() => setReady(true)); }, []);
  const toast = m => { setMsg(m); setTimeout(() => setMsg(''), 3000); };
  if (!ready) return null;
  if (!user) return <Login onLogin={setUser} />;
  const isAdmin = user.role === 'admin';
  const nav = [['dashboard', 'Dashboard', Dashboard, true], ['pos', 'Point of sale', Pos], ['products', 'Products', Products], ['sales', 'Sales', Sales], ['suppliers', 'Suppliers', Suppliers]]
    .filter(n => !n[3] || isAdmin);
  const cur = nav.find(n => n[0] === page) || nav[0], Page = cur[2];
  return (
    <div className="shell">
      <aside>
        <h1>StockFlow</h1>
        <nav>{nav.map(n => <button key={n[0]} className={n[0] === cur[0] ? 'on' : ''} onClick={() => setPage(n[0])}>{n[1]}</button>)}</nav>
        <div className="foot">
          <span>{user.username} · {user.role}</span>
          <button onClick={() => setDark(!dark)}>{dark ? 'Light mode' : 'Dark mode'}</button>
          <button onClick={() => { token.set(null); location.reload(); }}>Sign out</button>
        </div>
      </aside>
      <main><Page user={user} toast={toast} /></main>
      {msg && <div className="toast" role="status">{msg}</div>}
    </div>
  );
}
