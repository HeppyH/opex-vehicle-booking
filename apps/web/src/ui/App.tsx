import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_BASE_URL || "";
const TENANT = import.meta.env.VITE_GEOTAB_DATABASE || "opex_trial";

type Health = { ok: boolean; service?: string; environment?: string };
type Vehicle = { id: string; vehicle_code: string; make_model: string; vehicle_class: string; registration_no: string | null; status: string };

export default function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [notice, setNotice] = useState("Checking backend connection...");
  const [active, setActive] = useState("Overview");

  async function refresh() {
    if (!API) {
      setHealth(null);
      setVehicles([]);
      setNotice("Backend not connected. Configure VITE_API_BASE_URL for a future Cloudflare Workers deployment.");
      return;
    }
    try {
      const h = await fetch(`${API}/api/health`).then(r => r.json());
      setHealth(h);
      // Protected list endpoint deliberately fails closed until auth is implemented.
      const v = await fetch(`${API}/api/vehicles`);
      if (v.ok) {
        setVehicles(await v.json());
        setNotice("Backend connected. Protected booking functions remain locked until verified identity is configured.");
      } else {
        setVehicles([]);
        setNotice("Backend reachable, but protected vehicle data is unavailable until verified identity is configured.");
      }
    } catch {
      setHealth(null);
      setVehicles([]);
      setNotice("Backend not connected. API is unavailable; GitHub Pages is serving the static frontend only.");
    }
  }

  useEffect(() => {
    refresh();
    const onFocus = () => refresh();
    window.addEventListener("opex-vbm:focus", onFocus);
    return () => window.removeEventListener("opex-vbm:focus", onFocus);
  }, []);

  const nav = ["Overview", "Vehicle Booking", "My Bookings", "Approval Inbox", "GA Fleet Board", "Reports", "Administration"];

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">O</span><div><b>OPEX AIO</b><small>VEHICLE BOOKING</small></div></div>
      <div className="tenant">MYGEOTAB · {TENANT} target</div>
      <nav>{nav.map(n => <button key={n} className={active === n ? "nav active" : "nav"} onClick={() => setActive(n)}>{n}</button>)}</nav>
      <div className="side-foot">PT Timbang Deli Indonesia<br/>North Sumatra · Initial fleet 8</div>
    </aside>
    <main className="main">
      <header><div><span className="eyebrow">FLEET OPERATIONS</span><h1>{active}</h1><p>Vehicle coordination and booking workspace</p></div><button className="refresh" onClick={refresh}>Refresh</button></header>
      <div className="notice">{notice}</div>
      <section className="stats">
        <article><label>Fleet size</label><strong>8</strong><small>Initial registered fleet target</small></article>
        <article><label>Operational vehicles</label><strong>5</strong><small>Fortuner / Hilux · plantation</small></article>
        <article><label>Passenger vehicles</label><strong>3</strong><small>Zenix / Innova variants</small></article>
        <article><label>Backend status</label><strong className={health?.ok ? "ok" : "warn"}>{health?.ok ? "Connected" : "Not connected"}</strong><small>{health?.ok ? (health.service || "API reachable") : "Static hosting - backend unavailable"}</small></article>
      </section>
      <section className="panel">
        <div className="panel-head"><div><h2>Vehicle register</h2><p>Business records will be mapped to MyGeotab Device IDs after tenant validation.</p></div><span className="tag">8 vehicle target</span></div>
        {vehicles.length ? <div className="vehicle-list">{vehicles.map(v => <div className="vehicle" key={v.id}><b>{v.vehicle_code}</b><span>{v.make_model}</span><span>{v.vehicle_class}</span><span>{v.registration_no || "Plate pending"}</span><i>{v.status}</i></div>)}</div> :
          <div className="empty"><div className="empty-icon">▣</div><b>Vehicle data not connected yet</b><p>Register and map the eight actual vehicles after the PostgreSQL database and verified identity are configured.</p></div>}
      </section>
      <section className="panel lower">
        <div><h2>Next implementation gates</h2><ul><li>Configure Cloudflare Worker and PostgreSQL connection.</li><li>Implement verified MyGeotab identity mapping; do not accept browser-supplied roles.</li><li>Validate Device, User, Trip and GPS data access in the selected tenant.</li><li>Complete booking, approval, assignment and transactional conflict controls.</li></ul></div>
        <div className="api-box"><b>Integration status</b><p>MyGeotab API adapter: scaffold only</p><p>Authentication: fail-closed</p><p>Booking workflow: next build phase</p></div>
      </section>
      <footer>OPEX Vehicle Booking Management · v0.1.0 · Technical scaffold</footer>
    </main>
  </div>;
}
