import { useState, useCallback, useEffect, useMemo } from "react";
import { bookingDataProvider } from "../data/dataProvider";
import type { ResolvedAsset, ResolvedBooking, ResolvedUser, BookingDataProvider } from "../data/types";
import { createAddInDataProvider, AddInDataBookingDataProvider } from "../data/addinDataProvider";

const TENANT = import.meta.env.VITE_GEOTAB_DATABASE || "opex_trial";

type GeotabApi = {
  call?: (method: string, params: Record<string, unknown>, success: (result: unknown) => void, error?: (error: unknown) => void) => void;
  getSession?: (callback: (session: { userName?: string; database?: string; server?: string } | null) => void) => void;
};

/*───────────────────── Types ─────────────────────*/

type Asset = {
  id: string;
  asset_code: string;
  make_model: string;
  asset_class: string;
  registration_no: string | null;
  status: string;
  geotab_device_id: string | null;
};
type Booking = {
  id: string;
  requester_id: string;
  requester_name: string;
  requested_class: string;
  asset_id: string | null;
  asset_code: string | null;
  registration_no: string | null;
  start_at: string;
  end_at: string;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  purpose: string;
  destination: string | null;
  passenger_count: number | null;
  status: string;
  version: number;
  created_at: string;
};
type DemoUser = { id: string; name: string; roles: string[] };

type Toast = {
  id: string;
  type: "success" | "error" | "warn";
  text: string;
};

type ConfirmDialog = {
  id: string;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/*───────────────────── Navigation ─────────────────────*/

const NAV_ITEMS: Array<{ key: string; label: string }> = [
  { key: "Dashboard", label: "Dashboard" },
  { key: "New Booking", label: "New Booking" },
  { key: "My Bookings", label: "My Bookings" },
  { key: "Approval Inbox", label: "Approval Inbox" },
  { key: "Asset Availability", label: "Asset Availability" },
  { key: "Booking Reports", label: "Booking Reports" },
];

/*───────────────────── Helpers ─────────────────────*/

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function parseISO(s: string): Date { return new Date(s); }

function formatDate(s: string): string {
  return new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatTime(s: string): string {
  return new Date(s).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(s: string): string {
  return new Date(s).toLocaleString();
}

function computeTimeRange(range: string, customFrom?: string, customTo?: string): { from: string; to: string } | null {
  const now = new Date();
  if (range === "today") {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  if (range === "thisWeek") {
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { from: monday.toISOString(), to: sunday.toISOString() };
  }
  if (range === "thisMonth") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { from: start.toISOString(), to: end.toISOString() };
  }
  if (range === "last30Days") {
    const start = new Date(now);
    start.setDate(now.getDate() - 30);
    start.setHours(0, 0, 0, 0);
    return { from: start.toISOString(), to: now.toISOString() };
  }
  if (range === "custom" && customFrom && customTo) {
    const start = new Date(`${customFrom}T00:00:00`);
    const end = new Date(`${customTo}T23:59:59.999`);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return null;
    return { from: start.toISOString(), to: end.toISOString() };
  }
  return null;
}

function filterBookings(bookings: ResolvedBooking[], f: {
  timeRange: string; customFrom: string; customTo: string;
  statusFilter: string; asset: string; user: string;
}): ResolvedBooking[] {
  const range = computeTimeRange(f.timeRange, f.customFrom, f.customTo);
  return bookings.filter(b => {
    if (range) {
      const bStart = new Date(b.start_at).getTime();
      const bEnd = new Date(b.end_at).getTime();
      const fFrom = new Date(range.from).getTime();
      const fTo = new Date(range.to).getTime();
      if (bEnd < fFrom || bStart > fTo) return false;
    }
    if (f.statusFilter && b.status !== f.statusFilter) return false;
    if (f.asset && b.asset_id !== f.asset) return false;
    if (f.user && b.requester_id !== f.user) return false;
    return true;
  });
}

function exportCSV(data: Array<Record<string, unknown>>, filename: string) {
  if (!data.length) return;
  const headers = Object.keys(data[0]);
  const escape = (val: unknown) => {
    const s = String(val ?? "");
    if (/[",\n]/.test(s)) return `"${String(s).replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [headers.join(","), ...data.map(row => headers.map(h => escape(row[h])).join(","))];
  const csv = lines.join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/*───────────────────── Toast System ─────────────────────*/

function pushToast(setToasts: React.Dispatch<React.SetStateAction<Toast[]>>, type: Toast["type"], text: string) {
  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  setToasts(prev => [...prev, { id, type, text }]);
  setTimeout(() => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, 5000);
}

/*───────────────────── Reusable UI Components ─────────────────────*/

function StatCard({ label, value, sub, trend }: {
  label: string; value: string | number; sub: string; trend?: { dir: "up" | "down" | "neutral"; label: string };
}) {
  return (
    <article className="stat-card">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
      {trend && (
        <div className={`stat-trend ${trend.dir}`}>{trend.dir === "up" ? "▲" : trend.dir === "down" ? "▼" : "—"} {trend.label}</div>
      )}
    </article>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    PENDING_APPROVAL: "badge-pending",
    APPROVED: "badge-approved",
    ASSIGNED: "badge-assigned",
    COMPLETED: "badge-completed",
    REJECTED: "badge-rejected",
    CANCELLED: "badge-cancelled",
  };
  const cls = "badge " + (map[status] || "badge-completed");
  const label = status.replace(/_/g, " ");
  return <span className={cls}>{label}</span>;
}

function AssetStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    AVAILABLE: "badge-asset-available",
    MAINTENANCE: "badge-asset-maintenance",
    OUT_OF_SERVICE: "badge-asset-unavailable",
  };
  const cls = "badge " + (map[status] || "badge-asset-unavailable");
  const label = status === "AVAILABLE" ? "Available" : status === "MAINTENANCE" ? "Maintenance" : "Unavailable";
  return <span className={cls}>{label}</span>;
}

function LoadingState({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="loading-state">
      <b>{message}</b>
    </div>
  );
}

function EmptyState({ title, message, action }: { title: string; message: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="empty-state">
      <b>{title}</b>
      <p>{message}</p>
      {action && (
        <button className="btn btn-primary" onClick={action.onClick} style={{ marginTop: 16 }}>
          {action.label}
        </button>
      )}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="error-state">
      <b>Error</b>
      <p>{message}</p>
      {onRetry && <button className="btn btn-primary" onClick={onRetry} style={{ marginTop: 16 }}>Retry</button>}
    </div>
  );
}

function PageHeader({ eyebrow, title, subtitle }: { eyebrow: string; title: string; subtitle?: string }) {
  return (
    <div className="page-header">
      <span className="eyebrow">{eyebrow}</span>
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  return (
    <div className={`toast toast-${toast.type}`}>
      <span className="toast-message">{toast.text}</span>
      <button className="toast-dismiss" onClick={() => onDismiss(toast.id)}>×</button>
    </div>
  );
}

function ConfirmDialog({
  dialog,
  onConfirm,
  onCancel,
}: {
  dialog: ConfirmDialog;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>{dialog.title}</h2>
          <button className="btn btn-sm btn-secondary" onClick={onCancel}>Close</button>
        </div>
        <div className="modal-body confirm-dialog">
          <p>{dialog.message}</p>
          <div className="confirm-actions">
            <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
            <button className="btn btn-primary" onClick={onConfirm}>Confirm</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/*───────────────────── Booking Filter Bar ─────────────────────*/

function BookingFilterBar({
  filters,
  onFilterChange,
  onApplyFilters,
  onResetFilters,
  assets,
  users,
  isApprovalInbox = false,
}: {
  filters: { timeRange: string; customFrom: string; customTo: string; statusFilter: string; asset: string; user: string };
  onFilterChange: (key: string, value: string) => void;
  onApplyFilters: () => void;
  onResetFilters: () => void;
  assets: Asset[];
  users: ResolvedUser[];
  isApprovalInbox?: boolean;
}) {
  const timeRangeOptions = [
    { value: "", label: "All Time" },
    { value: "today", label: "Today" },
    { value: "thisWeek", label: "This Week" },
    { value: "thisMonth", label: "This Month" },
    { value: "last30Days", label: "Last 30 Days" },
    { value: "custom", label: "Custom Date Range" },
  ];
  const statusOptions = [
    { value: "", label: "All Status" },
    { value: "PENDING_APPROVAL", label: "Pending Approval" },
    { value: "APPROVED", label: "Approved" },
    { value: "REJECTED", label: "Rejected" },
    { value: "CANCELLED", label: "Cancelled" },
    { value: "COMPLETED", label: "Completed" },
  ];
  const hasActiveFilters = filters.timeRange || filters.customFrom || filters.customTo || filters.statusFilter || filters.asset || filters.user;
  const customInvalid = filters.timeRange === "custom" && filters.customFrom && filters.customTo && filters.customFrom > filters.customTo;

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="panel-head-content">
          <h2>Filters</h2>
          <p>Filter bookings by time range, status, asset, and user.</p>
        </div>
      </div>
      <div className="panel-body">
        <div className="filters">
          <div className="form-group">
            <label>Time Range</label>
            <select className="form-control" value={filters.timeRange} onChange={e => onFilterChange("timeRange", e.target.value)}>
              {timeRangeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          {!isApprovalInbox && (
            <div className="form-group">
              <label>Status</label>
              <select className="form-control" value={filters.statusFilter} onChange={e => onFilterChange("statusFilter", e.target.value)}>
                {statusOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
          )}
          <div className="form-group">
            <label>Asset</label>
            <select className="form-control" value={filters.asset} onChange={e => onFilterChange("asset", e.target.value)}>
              <option value="">All Assets</option>
              {assets.map(a => <option key={a.id} value={a.id}>{a.asset_code}</option>)}
            </select>
          </div>
          {!isApprovalInbox && (
            <div className="form-group">
              <label>User</label>
              <select className="form-control" value={filters.user} onChange={e => onFilterChange("user", e.target.value)}>
                <option value="">All Users</option>
                {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
          )}
          {filters.timeRange === "custom" && (
            <div className="form-group">
              <label>Start Date</label>
              <input className="form-control" type="date" value={filters.customFrom} onChange={e => onFilterChange("customFrom", e.target.value)} />
            </div>
          )}
          {filters.timeRange === "custom" && (
            <div className="form-group">
              <label>End Date</label>
              <input className="form-control" type="date" value={filters.customTo} onChange={e => onFilterChange("customTo", e.target.value)} />
            </div>
          )}
          <div className="form-group filter-actions">
            <button className="btn btn-primary" onClick={onApplyFilters} disabled={customInvalid || (filters.timeRange === "custom" && !filters.customFrom && !filters.customTo)}>
              Apply Filters
            </button>
            <button className="btn btn-secondary" onClick={onResetFilters}>Reset Filters</button>
          </div>
        </div>
        {hasActiveFilters && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--text-muted)", marginTop: 8 }}>
            Active filters applied — click Reset Filters to clear
          </div>
        )}
        {customInvalid && (
          <div style={{ fontSize: "var(--text-xs)", color: "var(--status-rejected)", marginTop: 8 }}>
            Start date must be on or before end date.
          </div>
        )}
      </div>
    </section>
  );
}

/*───────────────────── Pages ─────────────────────*/

function Dashboard({
  bookings,
  assets,
  loading,
  onLoadData,
  onExport,
  onNewBooking,
  addToast,
  filters,
  onFilterChange,
  onApplyFilters,
  onResetFilters,
  users,
}: {
  bookings: Booking[];
  assets: Asset[];
  loading: boolean;
  onLoadData: () => void;
  onExport: () => void;
  onNewBooking: () => void;
  addToast: (type: Toast["type"], text: string) => void;
  filters: { timeRange: string; customFrom: string; customTo: string; statusFilter: string; asset: string; user: string };
  onFilterChange: (key: string, value: string) => void;
  onApplyFilters: () => void;
  onResetFilters: () => void;
  users: ResolvedUser[];
}) {
  const totalAssets = assets.length;
  const availableAssets = assets.filter(a => a.status === "AVAILABLE").length;
  const pendingApproval = bookings.filter(b => b.status === "PENDING_APPROVAL").length;
  const activeBookings = bookings.filter(b => b.status === "APPROVED" || b.status === "ASSIGNED").length;

  const handleLoad = () => {
    onLoadData();
    addToast("success", "Data refreshed.");
  };

  const recent = [...bookings].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 5);

  return (
    <div className="page">
      <PageHeader
        eyebrow="OPEX Asset Booking Management"
        title="Dashboard"
        subtitle={`MyGeotab database: ${TENANT} — fleet coordination and booking workspace`}
      />

      <BookingFilterBar
        filters={filters}
        onFilterChange={onFilterChange}
        onApplyFilters={onApplyFilters}
        onResetFilters={onResetFilters}
        assets={assets}
        users={users}
      />

      <section className="stats">
        <StatCard
          label="Total Assets"
          value={totalAssets}
          sub="Registered fleet"
        />
        <StatCard
          label="Available Assets"
          value={availableAssets}
          sub="Ready for booking"
        />
        <StatCard
          label="Pending Approval"
          value={pendingApproval}
          sub="Awaiting decision"
        />
        <StatCard
          label="Active Bookings"
          value={activeBookings}
          sub="Approved or assigned"
        />
      </section>

      <div className="dashboard-actions" style={{ display: "flex", gap: 12, marginBottom: 24, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={handleLoad} disabled={loading}>
          {loading ? "Loading…" : "Load Data"}
        </button>
        <button className="btn btn-secondary" onClick={onExport}>Export CSV</button>
        <button className="btn btn-primary" onClick={onNewBooking}>Create New Booking</button>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>Recent Bookings</h2>
            <p>Latest booking activity across the fleet.</p>
          </div>
          <div className="panel-head-actions">
            <span className="badge badge-approved">{recent.length} records</span>
          </div>
        </div>
        <div className="panel-body">
          {loading ? (
            <LoadingState message="Loading data…" />
          ) : recent.length === 0 ? (
            <EmptyState
              title="No bookings found"
              message="Create your first booking to see activity here."
              action={{ label: "Create Booking", onClick: onNewBooking }}
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                    <tr>
                    <th>Booking ID</th><th>Asset</th><th>User</th><th>Date</th><th>Time</th><th>Destination</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map(b => (
                    <tr key={b.id}>
                      <td>#{b.id.slice(-4)}</td>
                      <td><b>{b.asset_code || "Unassigned"}</b></td>
                      <td>{b.requester_name}</td>
                      <td>{formatDate(b.start_at)}</td>
                      <td>{formatTime(b.start_at)} – {formatTime(b.end_at)}</td>
                      <td>{b.destination || "—"}</td>
                      <td><StatusBadge status={b.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function NewBooking({
  assets,
  bookings,
  demoUser,
  onCreateBooking,
  submitting,
  addToast,
  navigateToMyBookings,
}: {
  assets: Asset[];
  bookings: Booking[];
  demoUser: DemoUser | null;
  onCreateBooking: (input: {
    assetId: string; startAt: string; endAt: string; destination: string;
    purpose: string; notes: string;
  }) => void;
  submitting: boolean;
  addToast: (type: Toast["type"], text: string) => void;
  navigateToMyBookings: () => void;
}) {
  const [form, setForm] = useState({
    asset: "", date: "", startTime: "", endTime: "", destination: "", purpose: "", notes: "",
  });
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const availableAssets = assets.filter(a => a.status === "AVAILABLE");

  const handleChange = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setConflictError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setConflictError(null);

    if (!demoUser) {
      addToast("error", "Please select a demo user first.");
      return;
    }
    if (!form.asset || !form.date || !form.startTime || !form.endTime || !form.destination || !form.purpose) {
      addToast("error", "Please fill in all required fields.");
      return;
    }

    const start = new Date(`${form.date}T${form.startTime}`);
    const end = new Date(`${form.date}T${form.endTime}`);
    if (end <= start) {
      addToast("error", "End time must be after start time.");
      return;
    }

    const selectedAsset = assets.find(a => a.id === form.asset);
    if (!selectedAsset || selectedAsset.status !== "AVAILABLE") {
      addToast("error", "Selected asset is not available.");
      return;
    }

    const conflictStatuses = ["PENDING_APPROVAL", "APPROVED", "ASSIGNED"];
    const conflictBooking = bookings.find(b => {
      if (b.asset_id !== form.asset) return false;
      if (!conflictStatuses.includes(b.status)) return false;
      const bStart = parseISO(b.start_at);
      const bEnd = parseISO(b.end_at);
      return overlaps(start, end, bStart, bEnd);
    });

    if (conflictBooking) {
      setConflictError(`Asset ${selectedAsset.asset_code} already has a ${conflictBooking.status.replace(/_/g, " ").toLowerCase()} booking from ${formatDateTime(conflictBooking.start_at)} to ${formatDateTime(conflictBooking.end_at)}. Please choose another time or asset.`);
      return;
    }

    setConfirmOpen(true);
  };

  const handleConfirmSubmit = () => {
    setConfirmOpen(false);
    onCreateBooking({
      assetId: form.asset,
      startAt: new Date(`${form.date}T${form.startTime}`).toISOString(),
      endAt: new Date(`${form.date}T${form.endTime}`).toISOString(),
      destination: form.destination,
      purpose: form.purpose,
      notes: form.notes,
    });
    addToast("success", "Booking created successfully as PENDING_APPROVAL.");
    navigateToMyBookings();
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Asset Booking"
        title="Create New Booking"
        subtitle="Reserve an asset for your trip. Conflicting bookings are blocked automatically."
      />

      {demoUser && (
        <div className="notice demo">
          <span style={{ fontWeight: 600 }}>Booking as:</span> <b>{demoUser.name}</b> ({demoUser.id}) — demo identity, not authenticated MyGeotab
        </div>
      )}
      {!demoUser && (
        <div className="notice error">
          No demo user selected. Choose one from the topbar to create bookings.
        </div>
      )}

      {conflictError && (
        <div className="notice error">{conflictError}</div>
      )}

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>Booking Form</h2>
            <p>Select asset and trip details.</p>
          </div>
        </div>
        <div className="panel-body">
          <form onSubmit={handleSubmit}>
            <div className="form-section">
              <div className="form-section-label">Request Details</div>
              <div className="form-row">
                <div className="form-group">
                  <label>User</label>
                  <select className="form-control" value={demoUser?.id || ""} disabled onChange={() => {}}>
                    <option value={demoUser?.id || ""}>{demoUser ? demoUser.name : "Select user"}</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Booking Purpose</label>
                  <input className="form-control" value={form.purpose} onChange={e => handleChange("purpose", e.target.value)} placeholder="Purpose of trip" required />
                </div>
                <div className="form-group">
                  <label>Destination</label>
                  <input className="form-control" value={form.destination} onChange={e => handleChange("destination", e.target.value)} placeholder="Destination" required />
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section-label">Asset Selection</div>
              <div className="form-group">
                <label>Available Asset</label>
                <select className="form-control" value={form.asset} onChange={e => handleChange("asset", e.target.value)} required>
                  <option value="">Select an asset</option>
                  {availableAssets.map(a => (
                    <option key={a.id} value={a.id}>{a.asset_code} · {a.make_model} ({a.registration_no || "No plate"})</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section-label">Schedule</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Booking Date</label>
                  <input className="form-control" type="date" value={form.date} onChange={e => handleChange("date", e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>Start Time</label>
                  <input className="form-control" type="time" value={form.startTime} onChange={e => handleChange("startTime", e.target.value)} required />
                </div>
                <div className="form-group">
                  <label>End Time</label>
                  <input className="form-control" type="time" value={form.endTime} onChange={e => handleChange("endTime", e.target.value)} required />
                </div>
              </div>
              <div className="form-group">
                <label>Buffer Time</label>
                <span style={{ fontSize: 12, color: "#6B7280" }}>Standard buffers applied: 0 min before, 30 min after.</span>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section-label">Additional Information</div>
              <div className="form-group">
                <label>Notes</label>
                <textarea className="form-control" value={form.notes} onChange={e => handleChange("notes", e.target.value)} rows={3} placeholder="Any special instructions..." />
              </div>
            </div>

            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setForm({ asset: "", date: "", startTime: "", endTime: "", destination: "", purpose: "", notes: "" })}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting || !demoUser}>{submitting ? "Submitting…" : "Create Booking"}</button>
            </div>
          </form>
        </div>
      </section>

      {confirmOpen && (
        <ConfirmDialog
          dialog={{
            id: "confirm-booking",
            title: "Confirm Booking Submission",
            message: "Submit this booking request? It will be created as PENDING_APPROVAL and require approval before assignment.",
            onConfirm: handleConfirmSubmit,
            onCancel: () => setConfirmOpen(false),
          }}
          onConfirm={handleConfirmSubmit}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

function MyBookings({
  bookings,
  demoUser,
  users,
  setDemoUser,
  onExport,
  onView,
  onCancel,
  addToast,
  filters,
  onFilterChange,
  onApplyFilters,
  onResetFilters,
}: {
  bookings: Booking[];
  demoUser: DemoUser | null;
  users: DemoUser[];
  setDemoUser: (e: DemoUser | null) => void;
  onExport: () => void;
  onView: (id: string) => void;
  onCancel: (id: string) => void;
  addToast: (type: Toast["type"], text: string) => void;
  filters: { timeRange: string; customFrom: string; customTo: string; statusFilter: string; asset: string; user: string };
  onFilterChange: (key: string, value: string) => void;
  onApplyFilters: () => void;
  onResetFilters: () => void;
}) {
  const rows = bookings;
  const [tab, setTab] = useState<"upcoming" | "past" | "all">("upcoming");

  const now = new Date().toISOString();
  const upcoming = rows.filter(b => b.end_at >= now && b.status !== "CANCELLED" && b.status !== "REJECTED" && b.status !== "COMPLETED");
  const past = rows.filter(b => b.end_at < now || b.status === "CANCELLED" || b.status === "REJECTED" || b.status === "COMPLETED");
  const activeTab = tab === "upcoming" ? upcoming : tab === "past" ? past : rows;

  const handleCancel = (id: string) => {
    if (!window.confirm("Cancel this booking?")) return;
    onCancel(id);
    addToast("success", "Booking cancelled.");
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="My Bookings"
        title="My Bookings"
        subtitle={demoUser ? `Bookings for ${demoUser.name}` : "Select a demo user from the topbar."}
      />

      {!demoUser && (
        <div className="notice error">
          Select a demo user from the topbar to view their bookings.
        </div>
      )}

      <BookingFilterBar
        filters={filters}
        onFilterChange={onFilterChange}
        onApplyFilters={onApplyFilters}
        onResetFilters={onResetFilters}
        assets={[]}
        users={users}
      />

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>My Bookings</h2>
            <p>Booking history filtered by the selected demo user.</p>
          </div>
          <div className="panel-head-actions">
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <button className={`btn btn-sm ${tab === "upcoming" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("upcoming")}>Upcoming</button>
              <button className={`btn btn-sm ${tab === "past" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("past")}>Past</button>
              <button className={`btn btn-sm ${tab === "all" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("all")}>All</button>
              <select
                className="form-control"
                style={{ width: "220px", maxWidth: "300px" }}
                value={demoUser ? demoUser.id : ""}
                onChange={e => {
                  const emp = users.find(x => x.id === e.target.value) || null;
                  setDemoUser(emp);
                }}
              >
                <option value="">Select demo user</option>
                {users.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.id})</option>
                ))}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={onExport}>Export CSV</button>
            </div>
          </div>
        </div>
        <div className="panel-body">
          {!demoUser ? (
            <EmptyState title="No user selected" message="Choose a demo user from the topbar selector." />
          ) : activeTab.length === 0 ? (
            <EmptyState title="No bookings" message={`No ${tab} bookings found for ${demoUser?.name}.`} />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                    <tr>
                    <th>Booking ID</th><th>Asset</th><th>Booking Date</th><th>Time</th><th>Destination</th><th>Booking Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTab.map(b => (
                    <tr key={b.id}>
                      <td>#{b.id.slice(-4)}</td>
                      <td><b>{b.asset_code || "Unassigned"}</b></td>
                      <td>{formatDate(b.start_at)}</td>
                      <td>{formatTime(b.start_at)} – {formatTime(b.end_at)}</td>
                      <td>{b.destination || "—"}</td>
                      <td><StatusBadge status={b.status} /></td>
                      <td className="actions">
                        <button className="btn btn-sm btn-view" onClick={() => onView(b.id)}>View</button>
                        {(b.status === "PENDING_APPROVAL" || b.status === "APPROVED" || b.status === "ASSIGNED") && (
                          <button className="btn btn-sm btn-outline" onClick={() => handleCancel(b.id)}>Cancel</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ApprovalInbox({
  bookings,
  onApprove,
  onReject,
  onView,
  rejectingId,
  onConfirmReject,
  onCancelReject,
  onExport,
  addToast,
  rejectReason,
  setRejectReason,
  filters,
  onFilterChange,
  onApplyFilters,
  onResetFilters,
  assets,
}: {
  bookings: Booking[];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onView: (id: string) => void;
  rejectingId: string | null;
  onConfirmReject: (id: string) => void;
  onCancelReject: () => void;
  onExport: () => void;
  addToast: (type: Toast["type"], text: string) => void;
  rejectReason: { [id: string]: string };
  setRejectReason: (id: string, reason: string) => void;
  filters: { timeRange: string; customFrom: string; customTo: string; statusFilter: string; asset: string; user: string };
  onFilterChange: (key: string, value: string) => void;
  onApplyFilters: () => void;
  onResetFilters: () => void;
  assets: Asset[];
}) {
  const pending = bookings;

  const handleAction = (id: string, action: "approve" | "reject" | "view") => {
    if (action === "approve") { onApprove(id); }
    else if (action === "reject") { onReject(id); }
    else { onView(id); }
  };

  const handleConfirmRejectWithReason = (id: string) => {
    const reason = rejectReason[id] || "";
    if (!reason.trim()) {
      addToast("error", "Please provide a rejection reason.");
      return;
    }
    onConfirmReject(id);
    addToast("success", `Booking #${id.slice(-4)} rejected.`);
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="Approval Inbox"
        title="Pending Approvals"
        subtitle="Review and act on booking requests awaiting your decision."
      />

      <BookingFilterBar
        filters={filters}
        onFilterChange={onFilterChange}
        onApplyFilters={onApplyFilters}
        onResetFilters={onResetFilters}
        assets={assets}
        users={[]}
        isApprovalInbox
      />

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>Approval Requests</h2>
            <p>Bookings pending approval from authorized approvers.</p>
          </div>
          <div className="panel-head-actions">
            <span className="badge badge-pending">{pending.length} pending</span>
            <button className="btn btn-secondary btn-sm" onClick={onExport}>Export CSV</button>
          </div>
        </div>
        <div className="panel-body">
          {pending.length === 0 ? (
            <EmptyState title="No pending approvals" message="All booking requests have been reviewed." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Request ID</th><th>User</th><th>Asset</th><th>Booking Date</th><th>Destination</th><th>Request Date</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(b => (
                    <tr key={b.id}>
                      <td>#{b.id.slice(-4)}</td>
                      <td>{b.requester_name}</td>
                      <td>{b.asset_code || "Unassigned"}</td>
                      <td>{formatDate(b.start_at)}</td>
                      <td>{b.destination || "—"}</td>
                      <td>{formatDate(b.created_at)}</td>
                      <td className="actions">
                        {rejectingId === b.id ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <textarea
                              className="form-control"
                              value={rejectReason[b.id] || ""}
                              onChange={e => setRejectReason(b.id, e.target.value)}
                              rows={2}
                              placeholder="Rejection reason"
                            />
                            <div className="action-group">
                              <button className="btn btn-sm btn-secondary" onClick={() => handleConfirmRejectWithReason(b.id)}>Confirm Reject</button>
                              <button className="btn btn-sm btn-secondary" onClick={onCancelReject}>Cancel</button>
                            </div>
                          </div>
                        ) : (
                          <div className="action-group">
                            <button className="btn btn-sm btn-view" onClick={() => handleAction(b.id, "view")}>View Details</button>
                            <button className="btn btn-sm btn-primary" onClick={() => handleAction(b.id, "approve")}>Approve</button>
                            <button className="btn btn-sm btn-outline" onClick={() => handleAction(b.id, "reject")}>Reject</button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function AssetAvailability({
  assets,
  bookings,
  onExport,
  filters,
  onFilterChange,
  onApplyFilters,
  onResetFilters,
  users,
}: {
  assets: Asset[];
  bookings: Booking[];
  onExport: () => void;
  filters: { timeRange: string; customFrom: string; customTo: string; statusFilter: string; asset: string; user: string };
  onFilterChange: (key: string, value: string) => void;
  onApplyFilters: () => void;
  onResetFilters: () => void;
  users: ResolvedUser[];
}) {
  const bookingByAsset = new Map<string, Booking>();
  bookings.forEach(b => {
    if (b.asset_id && (b.status === "PENDING_APPROVAL" || b.status === "APPROVED" || b.status === "ASSIGNED")) {
      const existing = bookingByAsset.get(b.asset_id);
      if (!existing || b.created_at > existing.created_at) {
        bookingByAsset.set(b.asset_id, b);
      }
    }
  });

  return (
    <div className="page">
      <PageHeader
        eyebrow="Asset Availability"
        title="Asset Availability"
        subtitle="Real-time view of fleet availability and current bookings."
      />

      <BookingFilterBar
        filters={filters}
        onFilterChange={onFilterChange}
        onApplyFilters={onApplyFilters}
        onResetFilters={onResetFilters}
        assets={assets}
        users={users}
      />

      <section className="stats">
        <StatCard
          label="Total Fleet"
          value={assets.length}
          sub="All registered assets"
        />
        <StatCard
          label="Available"
          value={assets.filter(a => a.status === "AVAILABLE").length}
          sub="Ready for booking"
        />
        <StatCard
          label="Maintenance"
          value={assets.filter(a => a.status === "MAINTENANCE").length}
          sub="Out of service"
        />
        <StatCard
          label="Out of Service"
          value={assets.filter(a => a.status === "OUT_OF_SERVICE").length}
          sub="Not available"
        />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>Asset Register</h2>
            <p>Fleet inventory with current availability and booking status.</p>
          </div>
          <div className="panel-head-actions">
            <span className="badge badge-approved">{assets.length} assets</span>
            <button className="btn btn-secondary btn-sm" onClick={onExport}>Export CSV</button>
          </div>
        </div>
        <div className="panel-body">
          {assets.length === 0 ? (
            <EmptyState title="No assets registered" message="No asset data available." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Asset</th><th>License Plate</th><th>Asset Type</th><th>MyGeotab Device ID</th><th>Availability</th><th>Current Booking</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map(a => {
                    const currentBooking = bookingByAsset.get(a.id);
                    return (
                      <tr key={a.id}>
                        <td><b>{a.asset_code}</b></td>
                        <td>{a.registration_no || "—"}</td>
                        <td>{a.asset_class.replace(/_/g, " ")}</td>
                        <td>{a.geotab_device_id || "Not mapped"}</td>
                        <td><AssetStatusBadge status={a.status} /></td>
                        <td>
                          {currentBooking ? (
                            <span style={{ fontSize: 11, color: "#1E3A5F", fontWeight: 600 }}>{`#${currentBooking.id.slice(-4)} · ${currentBooking.status.replace(/_/g, " ")}`}</span>
                          ) : (
                            <span style={{ color: "#9CA3AF" }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function BookingReports({
  bookings,
  assets,
  onExport,
  filters,
  onFilterChange,
  onApplyFilters,
  onResetFilters,
  users,
}: {
  bookings: Booking[];
  assets: Asset[];
  onExport: () => void;
  filters: { timeRange: string; customFrom: string; customTo: string; statusFilter: string; asset: string; user: string };
  onFilterChange: (key: string, value: string) => void;
  onApplyFilters: () => void;
  onResetFilters: () => void;
  users: ResolvedUser[];
}) {
  const total = bookings.length;
  const byStatus = bookings.reduce<Record<string, number>>((acc, b) => { acc[b.status] = (acc[b.status] || 0) + 1; return acc; }, {});
  const byAsset = bookings.reduce<Record<string, number>>((acc, b) => { if (b.asset_code) acc[b.asset_code] = (acc[b.asset_code] || 0) + 1; return acc; }, {});
  const mostBooked = Object.entries(byAsset).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const assetsWithBookings = new Set(bookings.filter(b => b.asset_id).map(b => b.asset_id)).size;
  const utilization = assets.length > 0 ? Math.round((assetsWithBookings / assets.length) * 100) : 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Booking Reports"
        title="Booking Reports"
        subtitle="Fleet utilization and booking analytics based on actual data."
      />

      <BookingFilterBar
        filters={filters}
        onFilterChange={onFilterChange}
        onApplyFilters={onApplyFilters}
        onResetFilters={onResetFilters}
        assets={assets}
        users={users}
      />

      <section className="stats">
        <StatCard label="Total Bookings" value={total} sub="All time" />
        <StatCard label="Asset Utilization" value={`${utilization}%`} sub={`${assetsWithBookings} of ${assets.length} assets used`} />
        <StatCard label="Most Booked Asset" value={mostBooked[0]?.[0] || "—"} sub={mostBooked[0]?.[1] ? `${mostBooked[0][1]} bookings` : "No data"} />
        <StatCard label="Status Summary" value={Object.keys(byStatus).length} sub="Different statuses" />
      </section>

      <div className="filters" style={{ marginBottom: 0 }}>
        <div className="filter-actions">
          <button className="btn btn-secondary" onClick={onExport}>Export CSV</button>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>Booking Status Summary</h2>
            <p>Breakdown of bookings by status.</p>
          </div>
        </div>
        <div className="panel-body">
          {total === 0 ? (
            <EmptyState title="No data available" message="Create some bookings to see reports." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
              {Object.entries(byStatus).map(([status, count]) => (
                <div key={status} className="stat-card">
                  <div className="stat-label">{status.replace(/_/g, " ")}</div>
                  <div className="stat-value">{count}</div>
                  <div className="stat-sub">bookings</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>Most Booked Assets</h2>
            <p>Top assets by number of bookings.</p>
          </div>
        </div>
        <div className="panel-body">
          {mostBooked.length === 0 ? (
            <EmptyState title="No asset data" message="Bookings will populate this report." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {mostBooked.map(([code, count]) => (
                <div key={code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", background: "#fff", border: "1px solid var(--border)", borderRadius: "var(--radius)" }}>
                  <div><b>{code}</b></div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: "140px", height: "8px", background: "#E5E7EB", borderRadius: "4px" }}>
                      <div style={{ width: `${Math.min((count / Math.max(...mostBooked.map(([, c]) => c)) * 100, 100))}%`, height: "8px", background: "#2563EB", borderRadius: "4px" }}></div>
                    </div>
                    <span className="text-blue" style={{ fontWeight: 600 }}>{count} bookings</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/*───────────────────── View Details Modal ─────────────────────*/

function ViewDetailsModal({
  booking,
  assets,
  onClose,
  onApprove,
  onReject,
  onAssign,
  onComplete,
  onCancel,
  rejectingId,
  onConfirmReject,
  onCancelReject,
  addToast,
  rejectReason,
  setRejectReason,
}: {
  booking: Booking | null;
  assets: Asset[];
  onClose: () => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAssign: (id: string) => void;
  onComplete: (id: string) => void;
  onCancel: (id: string) => void;
  rejectingId: string | null;
  onConfirmReject: (id: string) => void;
  onCancelReject: () => void;
  addToast: (type: Toast["type"], text: string) => void;
  rejectReason: { [id: string]: string };
  setRejectReason: (id: string, reason: string) => void;
}) {
  if (!booking) return null;
  const asset = assets.find(a => a.id === booking.asset_id);
  const handleModalApprove = () => { onApprove(booking.id); onClose(); addToast("success", `Booking #${booking.id.slice(-4)} approved.`); };
  const handleModalReject = () => { onReject(booking.id); };
  const handleModalAssign = () => { onAssign(booking.id); onClose(); addToast("success", `Booking #${booking.id.slice(-4)} assigned.`); };
  const handleModalComplete = () => { onComplete(booking.id); onClose(); addToast("success", `Booking #${booking.id.slice(-4)} completed.`); };
  const handleModalCancel = () => { onCancel(booking.id); onClose(); addToast("success", `Booking #${booking.id.slice(-4)} cancelled.`); };
  const handleModalConfirmReject = () => {
    const reason = rejectReason[booking.id] || "";
    if (!reason.trim()) {
      addToast("error", "Please provide a rejection reason.");
      return;
    }
    onConfirmReject(booking.id);
    onClose();
    addToast("success", `Booking #${booking.id.slice(-4)} rejected.`);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Booking Details</h2>
          <button className="btn btn-sm btn-secondary" onClick={onClose}>Close</button>
        </div>
        <div className="modal-body">
          <div className="detail-grid">
            <div className="detail-row"><label>Booking ID</label><span className="value">#{booking.id.slice(-4)}</span></div>
            <div className="detail-row"><label>User</label><span className="value">{booking.requester_name}</span></div>
            <div className="detail-row"><label>Asset</label><span className="value">{booking.asset_code || "Unassigned"} {asset ? `(${asset.registration_no || "No plate"})` : ""}</span></div>
            <div className="detail-row"><label>Asset Class</label><span className="value">{booking.requested_class.replace(/_/g, " ")}</span></div>
            <div className="detail-row"><label>Start</label><span className="value">{formatDateTime(booking.start_at)}</span></div>
            <div className="detail-row"><label>End</label><span className="value">{formatDateTime(booking.end_at)}</span></div>
            <div className="detail-row"><label>Destination</label><span className="value">{booking.destination || "—"}</span></div>
            <div className="detail-row"><label>Purpose</label><span className="value">{booking.purpose}</span></div>
            <div className="detail-row"><label>Status</label><span className="value"><StatusBadge status={booking.status} /></span></div>
            <div className="detail-row"><label>Created</label><span className="value">{formatDateTime(booking.created_at)}</span></div>
            <div className="detail-row"><label>Version</label><span className="value">{booking.version}</span></div>
            {rejectingId === booking.id && (
              <div className="detail-row" style={{ gridColumn: "1 / -1" }}>
                <label>Rejection Reason</label>
                <textarea
                  className="form-control"
                  value={rejectReason[booking.id] || ""}
                  onChange={e => setRejectReason(booking.id, e.target.value)}
                  rows={2}
                  placeholder="Enter rejection reason"
                />
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {booking.status === "PENDING_APPROVAL" ? (
              <>
                <button className="btn btn-sm btn-primary" onClick={handleModalApprove}>Approve</button>
                <button className="btn btn-sm btn-outline" onClick={handleModalReject}>Reject</button>
              </>
            ) : null}
            {booking.status === "APPROVED" ? (
              <button className="btn btn-sm btn-primary" onClick={handleModalAssign}>Assign Asset</button>
            ) : null}
            {booking.status === "ASSIGNED" ? (
              <button className="btn btn-sm btn-primary" onClick={handleModalComplete}>Complete Booking</button>
            ) : null}
            {["PENDING_APPROVAL", "APPROVED", "ASSIGNED"].includes(booking.status) ? (
              <button className="btn btn-sm btn-outline" onClick={handleModalCancel}>Cancel Booking</button>
            ) : null}
            {rejectingId === booking.id ? (
              <>
                <button className="btn btn-sm btn-primary" onClick={handleModalConfirmReject}>Confirm Reject</button>
                <button className="btn btn-sm btn-secondary" onClick={onCancelReject}>Cancel</button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/*───────────────────── Main App ─────────────────────*/

export default function App() {
  const [bookings, setBookings] = useState<ResolvedBooking[]>([]);
  const [assets, setAssets] = useState<ResolvedAsset[]>([]);
  const [users, setUsers] = useState<ResolvedUser[]>([]);
  const [demoUser, setDemoUser] = useState<ResolvedUser | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [active, setActive] = useState("Dashboard");
  const [filters, setFilters] = useState({
    timeRange: "",
    customFrom: "",
    customTo: "",
    statusFilter: "",
    asset: "",
    user: "",
  });
  const [selectedBooking, setSelectedBooking] = useState<ResolvedBooking | null>(null);
  const [geotabApi, setGeotabApi] = useState<GeotabApi | null>(null);
  const [mode, setMode] = useState<"DEMO" | "ADDIN_DATA">("DEMO");
  const [myGeotabError, setMyGeotabError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [rejectReason, setRejectReasonState] = useState<{ [id: string]: string }>({});
  const [addInId, setAddInId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("opex-vbm-addin-id") || null;
    } catch {
      return null;
    }
  });
  const [addInIdInput, setAddInIdInput] = useState<string>("");
  const [currentMyGeotabUser, setCurrentMyGeotabUser] = useState<{ userName?: string; database?: string; server?: string } | null>(null);
  const [providerError, setProviderError] = useState<string | null>(null);

  const onFilterChange = useCallback((key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  }, []);

  const onResetFilters = useCallback(() => {
    setFilters({ timeRange: "", customFrom: "", customTo: "", statusFilter: "", asset: "", user: "" });
  }, []);

  const dashboardBookings = useMemo(() => filterBookings(bookings, filters), [bookings, filters]);
  const myBookingsData = useMemo(() => {
    let result = filterBookings(bookings, filters);
    if (demoUser) result = result.filter(b => b.requester_id === demoUser.id);
    return result;
  }, [bookings, filters, demoUser]);
  const approvalBookings = useMemo(() => filterBookings(bookings, { ...filters, statusFilter: "PENDING_APPROVAL" }), [bookings, filters]);
  const availabilityBookings = useMemo(() => filterBookings(bookings, filters), [bookings, filters]);
  const reportsBookings = useMemo(() => filterBookings(bookings, filters), [bookings, filters]);

  useEffect(() => {
    let mounted = true;

    const onInitialize = (event: Event) => {
      const ce = event as CustomEvent<{ api: GeotabApi | null; state: unknown }>;
      if (ce.detail?.api) {
        setGeotabApi(ce.detail.api);
        document.documentElement.dataset.opexVbm = "initialized";
        // Retrieve current MyGeotab user identity from Add-In context
        ce.detail.api.getSession?.((session) => {
          if (mounted && session) {
            setCurrentMyGeotabUser(session);
            // Auto-activate ADDIN_DATA when running inside MyGeotab with addInId configured
            if (addInId && mode === "DEMO") {
              setMode("ADDIN_DATA");
              setProviderError(null);
            }
          }
        });
      }
    };

    const onFocus = (event: Event) => {
      const ce = event as CustomEvent<{ api: GeotabApi | null; state: unknown }>;
      if (ce.detail?.api) {
        setGeotabApi(ce.detail.api);
        // Re-check auto-activation on focus (addInId may have been configured meanwhile)
        if (addInId && mode === "DEMO") {
          setMode("ADDIN_DATA");
          setProviderError(null);
        }
      }
    };

    window.addEventListener("opex-vbm:initialize", onInitialize as EventListener);
    window.addEventListener("opex-vbm:focus", onFocus as EventListener);

    // Determine effective provider: no silent fallback to DEMO when LIVE is intended
    const effectiveMode = mode === "ADDIN_DATA" && !geotabApi ? "DEMO" : mode;
    const provider: BookingDataProvider = effectiveMode === "ADDIN_DATA"
      ? createAddInDataProvider(geotabApi, addInId)
      : bookingDataProvider;

    const loadMasterData = async () => {
      try {
        const [assets, users, bookings] = await Promise.all([
          provider.getAssets(),
          provider.getUsers(),
          provider.getBookings(),
        ]);
        if (mounted) {
          setAssets(assets);
          setUsers(users);
          setBookings(bookings);
          // In ADDIN_DATA mode, use authenticated MyGeotab user as current user
          if (effectiveMode === "ADDIN_DATA" && currentMyGeotabUser) {
            const matched = users.find(u => u.name === currentMyGeotabUser?.userName || u.id === currentMyGeotabUser?.userName);
            if (matched && !demoUser) {
              setDemoUser(matched);
            }
          }
          setProviderError(null);
        }
      } catch (e) {
        if (mounted) {
          const msg = e instanceof Error ? e.message : "Failed to load data from MyGeotab.";
          setMyGeotabError(msg);
          // No silent fallback: if ADDIN_DATA was intended but failed, surface the error
          if (mode === "ADDIN_DATA" && !geotabApi) {
            setProviderError("MyGeotab Add-In API is not available. ADDIN_DATA mode requires running inside a registered MyGeotab Add-In.");
          } else if (mode === "ADDIN_DATA" && !addInId) {
            setProviderError("Add-In Id is not configured. Enter your AddInId to use ADDIN_DATA storage.");
          } else {
            setProviderError(msg);
          }
          // Fall back to DEMO only as a last resort for standalone preview
          if (mode === "DEMO") {
            const fb = bookingDataProvider;
            Promise.all([
              fb.getAssets(),
              fb.getUsers(),
              fb.getBookings(),
            ]).then(([a, u, b]) => {
              if (mounted) {
                setAssets(a);
                setUsers(u);
                setBookings(b);
              }
            });
          }
        }
      }
    };

    loadMasterData();

    return () => {
      mounted = false;
      window.removeEventListener("opex-vbm:initialize", onInitialize as EventListener);
      window.removeEventListener("opex-vbm:focus", onFocus as EventListener);
    };
  }, [mode, geotabApi, addInId, demoUser, currentMyGeotabUser]);

  // Keep the AddInId text input in sync with the persisted value
  useEffect(() => {
    setAddInIdInput(addInId ?? "");
  }, [addInId]);

  const provider = useMemo(() => {
    const effectiveMode = mode === "ADDIN_DATA" && !geotabApi ? "DEMO" : mode;
    if (effectiveMode === "ADDIN_DATA") {
      return createAddInDataProvider(geotabApi, addInId);
    }
    return bookingDataProvider;
  }, [mode, geotabApi, addInId]);
  const pushToastCb = useCallback((type: Toast["type"], text: string) => {
    pushToast(setToasts, type, text);
  }, []);

  const updateBookingStatus = useCallback(async (id: string, newStatus: string, approverId?: string, approvalRemarks?: string) => {
    await provider.updateBookingStatus(id, newStatus, approverId, approvalRemarks);
    const updated = await provider.getBookings();
    setBookings(updated);
  }, [provider]);

  const onLoadData = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    setProviderError(null);
    try {
      const refreshed = await provider.getBookings();
      setBookings(refreshed);
      setLoading(false);
      setMessage({ type: "success", text: mode === "ADDIN_DATA" ? "Bookings reloaded from MyGeotab AddInData." : "Demo data reloaded from local storage." });
    } catch (e) {
      setLoading(false);
      const msg = e instanceof Error ? e.message : "Failed to reload data.";
      setMessage({ type: "error", text: msg });
      setProviderError(msg);
      // No silent fallback: if ADDIN_DATA was intended but failed, surface the error
      if (mode === "ADDIN_DATA" && !geotabApi) {
        setProviderError("MyGeotab Add-In API is not available. ADDIN_DATA mode requires running inside a registered MyGeotab Add-In.");
      } else if (mode === "ADDIN_DATA" && !addInId) {
        setProviderError("Add-In Id is not configured. Enter your AddInId to use ADDIN_DATA storage.");
      }
    }
  }, [provider, mode, geotabApi, addInId]);

  const onResetDemoData = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      await provider.resetDemoData();
      const refreshed = await provider.getBookings();
      setBookings(refreshed);
      setLoading(false);
      setMessage({ type: "success", text: "Demo data reset to initial state." });
    } catch (e) {
      setLoading(false);
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to reset demo data." });
    }
  }, [provider]);

  const onSaveAddInId = useCallback(async () => {
    const trimmed = addInIdInput.trim();
    if (!trimmed) {
      setAddInId(null);
      try { localStorage.removeItem("opex-vbm-addin-id"); } catch { }
      setProviderError(null);
      setMode("DEMO");
      setMessage({ type: "success", text: "Add-In Id cleared. Running in DEMO mode." });
      return;
    }
    try {
      localStorage.setItem("opex-vbm-addin-id", trimmed);
      setAddInId(trimmed);
      setProviderError(null);
      // When inside MyGeotab, switch to LIVE (ADDIN_DATA); otherwise stay DEMO until API is available
      if (geotabApi) {
        setMode("ADDIN_DATA");
        setMessage({ type: "success", text: "Add-In Id saved. LIVE mode active inside MyGeotab." });
      } else {
        setMessage({ type: "success", text: "Add-In Id saved. Switch to LIVE mode when running inside MyGeotab." });
      }
    } catch (e) {
      setProviderError(e instanceof Error ? e.message : "Failed to save Add-In Id.");
    }
  }, [addInIdInput, geotabApi]);

  const onCreateBooking = useCallback(async (input: {
    assetId: string; startAt: string; endAt: string; destination: string;
    purpose: string; notes: string;
  }) => {
    if (!demoUser) return;
    try {
      const created = await provider.createBooking({
        deviceId: input.assetId,
        requesterUserId: demoUser.id,
        requestedClass: "PASSENGER",
        startAt: input.startAt,
        endAt: input.endAt,
        purpose: input.purpose,
        destination: input.destination,
        passengerCount: null,
      });
      const refreshed = await provider.getBookings();
      setBookings(refreshed);
      setMessage({ type: "success", text: `Booking #${created.id.slice(-4)} created successfully as PENDING_APPROVAL.` });
    } catch (e) {
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to create booking." });
    }
  }, [demoUser, provider]);

  const onApprove = useCallback(async (id: string) => {
    await updateBookingStatus(id, "APPROVED", demoUser?.id ?? undefined);
  }, [updateBookingStatus, demoUser]);

  const onReject = useCallback((id: string) => {
    setRejectingId(id);
  }, []);

  const onConfirmReject = useCallback(async (id: string) => {
    await updateBookingStatus(id, "REJECTED", demoUser?.id ?? undefined, rejectReason[id] ?? undefined);
    setRejectingId(null);
  }, [updateBookingStatus, demoUser, rejectReason]);

  const onCancelReject = useCallback(() => {
    setRejectingId(null);
  }, []);

  const onAssign = useCallback(async (id: string) => {
    const b = bookings.find(x => x.id === id);
    if (!b || b.status !== "APPROVED") return;
    await updateBookingStatus(id, "ASSIGNED");
  }, [bookings, updateBookingStatus]);

  const onComplete = useCallback(async (id: string) => {
    const b = bookings.find(x => x.id === id);
    if (!b || b.status !== "ASSIGNED") return;
    await updateBookingStatus(id, "COMPLETED");
  }, [bookings, updateBookingStatus]);

  const onCancel = useCallback(async (id: string) => {
    const b = bookings.find(x => x.id === id);
    if (!b || !["PENDING_APPROVAL", "APPROVED", "ASSIGNED"].includes(b.status)) return;
    await updateBookingStatus(id, "CANCELLED");
  }, [bookings, updateBookingStatus]);

  const setRejectReason = useCallback((id: string, reason: string) => {
    setRejectReasonState(prev => ({ ...prev, [id]: reason }));
  }, []);

  const onExportDashboard = useCallback(() => {
    const data = dashboardBookings.map(b => ({
      "Booking ID": b.id,
      Asset: b.asset_code || "Unassigned",
      "License Plate": b.registration_no || "",
      User: b.requester_name,
      "Booking Date": b.start_at,
      "Start Time": b.start_at,
      "End Time": b.end_at,
      Destination: b.destination || "",
      "Booking Status": b.status,
    }));
    exportCSV(data, `opex-vbm-dashboard-bookings-${new Date().toISOString().slice(0,10)}.csv`);
  }, [dashboardBookings]);

  const onExportMyBookings = useCallback(() => {
    const data = myBookingsData.map(b => ({
      "Booking ID": b.id,
      Asset: b.asset_code || "Unassigned",
      "Booking Date": b.start_at,
      "Start Time": b.start_at,
      "End Time": b.end_at,
      Destination: b.destination || "",
      "Booking Status": b.status,
    }));
    exportCSV(data, `opex-vbm-mybookings-${demoUser?.name || "all"}-${new Date().toISOString().slice(0,10)}.csv`);
  }, [myBookingsData, demoUser]);

  const onExportApprovals = useCallback(() => {
    const data = approvalBookings.map(b => ({
      "Request ID": b.id,
      User: b.requester_name,
      Asset: b.asset_code || "Unassigned",
      "Booking Date": b.start_at,
      Destination: b.destination || "",
      "Request Date": b.created_at,
    }));
    exportCSV(data, `opex-vbm-approvals-${new Date().toISOString().slice(0,10)}.csv`);
  }, [approvalBookings]);

  const onExportFleet = useCallback(() => {
    const data = assets.map(a => ({
      "Asset Name": a.asset_code,
      "License Plate": a.registration_no || "",
      "Asset Type": a.asset_class,
      "MyGeotab Device ID": a.geotab_device_id || "",
      "Asset Group": "North Sumatra",
      Availability: a.status,
      "Current Booking": "",
    }));
    exportCSV(data, `opex-vbm-fleet-${new Date().toISOString().slice(0,10)}.csv`);
  }, [assets]);

  const navigateTo = (key: string) => {
    setActive(key);
  };

  const Page = (() => {
    switch (active) {
      case "Dashboard": return (
        <Dashboard
          bookings={dashboardBookings}
          assets={assets}
          loading={loading}
          onLoadData={onLoadData}
          onExport={onExportDashboard}
          onNewBooking={() => navigateTo("New Booking")}
          addToast={pushToastCb}
          filters={filters}
          onFilterChange={onFilterChange}
          onApplyFilters={onLoadData}
          onResetFilters={onResetFilters}
          users={users}
        />
      );
      case "New Booking": return (
        <NewBooking
          assets={assets}
          bookings={bookings}
          demoUser={demoUser}
          onCreateBooking={onCreateBooking}
          submitting={loading}
          addToast={pushToastCb}
          navigateToMyBookings={() => navigateTo("My Bookings")}
        />
      );
      case "My Bookings": return (
        <MyBookings
          bookings={myBookingsData}
          demoUser={demoUser}
          users={users}
          setDemoUser={setDemoUser}
          onExport={onExportMyBookings}
          onView={id => setSelectedBooking(myBookingsData.find(b => b.id === id) || null)}
          onCancel={onCancel}
          addToast={pushToastCb}
          filters={filters}
          onFilterChange={onFilterChange}
          onApplyFilters={onLoadData}
          onResetFilters={onResetFilters}
        />
      );
      case "Approval Inbox": return (
        <ApprovalInbox
          bookings={approvalBookings}
          onApprove={onApprove}
          onReject={onReject}
          onView={id => setSelectedBooking(approvalBookings.find(b => b.id === id) || null)}
          rejectingId={rejectingId}
          onConfirmReject={onConfirmReject}
          onCancelReject={onCancelReject}
          onExport={onExportApprovals}
          addToast={pushToastCb}
          rejectReason={rejectReason}
          setRejectReason={setRejectReason}
          filters={filters}
          onFilterChange={onFilterChange}
          onApplyFilters={onLoadData}
          onResetFilters={onResetFilters}
          assets={assets}
        />
      );
      case "Asset Availability": return (
        <AssetAvailability assets={assets} bookings={availabilityBookings} onExport={onExportFleet}
          filters={filters}
          onFilterChange={onFilterChange}
          onApplyFilters={onLoadData}
          onResetFilters={onResetFilters}
          users={users} />
      );
      case "Booking Reports": return (
        <BookingReports bookings={reportsBookings} assets={assets} onExport={onExportDashboard}
          filters={filters}
          onFilterChange={onFilterChange}
          onApplyFilters={onLoadData}
          onResetFilters={onResetFilters}
          users={users} />
      );
      default: return (
        <Dashboard
          bookings={dashboardBookings}
          assets={assets}
          loading={loading}
          onLoadData={onLoadData}
          onExport={onExportDashboard}
          onNewBooking={() => navigateTo("New Booking")}
          addToast={pushToastCb}
          filters={filters}
          onFilterChange={onFilterChange}
          onApplyFilters={onLoadData}
          onResetFilters={onResetFilters}
          users={users}
        />
      );
    }
  })();

  const pendingCount = bookings.filter(b => b.status === "PENDING_APPROVAL").length;

  return (
    <div className="shell">
      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <div className="topbar-brand">
              <div className="topbar-brand-text"><b>OPEX VBM</b><small>Asset Booking</small></div>
            </div>
            <div className="topbar-divider"></div>
            <div className="topbar-info">
              <div className="topbar-tenant">{TENANT}</div>
              <div className="topbar-source">{mode === "ADDIN_DATA" ? "ADDIN DATA" : "DEMO MODE"}</div>
            </div>
          </div>
          <div className="topbar-right">
            {/* Mode toggle: DEMO (standalone) vs LIVE / ADDIN_DATA (inside MyGeotab) */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Mode</label>
              <select
                className="form-control"
                style={{ width: "130px", fontSize: "var(--text-sm)" }}
                value={mode}
                onChange={e => setMode(e.target.value as "DEMO" | "ADDIN_DATA")}
                disabled={mode === "ADDIN_DATA" && !geotabApi}
              >
                <option value="DEMO">DEMO (standalone)</option>
                <option value="ADDIN_DATA">LIVE (MyGeotab AddInData)</option>
              </select>
              {mode === "ADDIN_DATA" && !geotabApi && (
                <span style={{ fontSize: "var(--text-xs)", color: "#EF4444" }}>API not available</span>
              )}
            </div>

            {/* AddInId input: required for ADDIN_DATA write operations */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <label style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>AddInId</label>
              <input
                className="form-control"
                style={{ width: "180px", fontSize: "var(--text-sm)" }}
                value={addInIdInput}
                onChange={e => setAddInIdInput(e.target.value)}
                placeholder="e.g. opex-vbm-addin"
                disabled={mode === "DEMO" && !geotabApi}
              />
              <button
                className="btn btn-primary"
                onClick={onSaveAddInId}
                disabled={mode === "DEMO" && !geotabApi}
                style={{ fontSize: "var(--text-sm)", padding: "4px 10px" }}
              >
                Save
              </button>
              {addInId && (
                <span style={{ fontSize: "var(--text-xs)", color: "#10B981" }}>● configured</span>
              )}
            </div>

            {/* Current MyGeotab user from authenticated session */}
            {currentMyGeotabUser && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 12, borderLeft: "1px solid var(--border)" }}>
                <div>
                  <div style={{ fontSize: "var(--text-xs)", color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>MyGeotab User</div>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>{currentMyGeotabUser.userName || "Unknown"}</div>
                  <div style={{ fontSize: 10, color: "#6B7280" }}>{currentMyGeotabUser.database || ""}{currentMyGeotabUser.server ? ` · ${currentMyGeotabUser.server}` : ""}</div>
                </div>
              </div>
            )}

            {/* Demo User select (DEMO mode only) */}
            {mode === "DEMO" && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 12, borderLeft: "1px solid var(--border)" }}>
                <label style={{ fontSize: "var(--text-xs)", fontWeight: 600, color: "#6B7280", textTransform: "uppercase", letterSpacing: "0.05em" }}>Demo User</label>
                <select
                  className="form-control"
                  style={{ width: "180px", fontSize: "var(--text-sm)" }}
                  value={demoUser ? demoUser.id : ""}
                  onChange={e => {
                    const emp = users.find(x => x.id === e.target.value) || null;
                    setDemoUser(emp);
                  }}
                >
                  <option value="">Select user</option>
                  {users.map(u => (
                    <option key={u.id} value={u.id}>{u.name} ({u.id})</option>
                  ))}
                </select>
              </div>
            )}

            <div className="user-badge">
              {demoUser ? (
                <>
                  <div>
                    <div style={{ fontSize: 12 }}>{demoUser.name}</div>
                    <div style={{ fontSize: 10, color: "#6B7280" }}>{demoUser.roles.join(", ")}</div>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: "#9CA3AF" }}>No user</div>
              )}
            </div>
          </div>

          {/* Provider error banner (never silently swallowed) */}
          {providerError && (
            <div style={{ marginLeft: 16, padding: 8, background: "#FEF2F2", border: "1px solid #FECACA", color: "#991B1B", fontSize: "var(--text-xs)", borderRadius: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "400px" }}>
              {providerError}
            </div>
          )}
        </div>

        <nav className="tab-nav">
          {NAV_ITEMS.map(item => {
            const isActive = active === item.key;
            const badge = item.key === "Approval Inbox" && pendingCount > 0 ? (
              <span className="tab-badge">{pendingCount}</span>
            ) : null;
            return (
              <button
                key={item.key}
                className={`tab ${isActive ? "tab-active" : ""}`}
                onClick={() => navigateTo(item.key)}
              >
                {item.label}{badge}
              </button>
            );
          })}
        </nav>

        {message && (
          <div className={`notice ${message.type === "success" ? "success" : "error"}`} style={{ marginBottom: 0 }}>
            {message.text}
          </div>
        )}

        <div className="page-container">
          {Page}
          <ViewDetailsModal
            booking={selectedBooking}
            assets={assets}
            onClose={() => setSelectedBooking(null)}
            onApprove={onApprove}
            onReject={onReject}
            onAssign={onAssign}
            onComplete={onComplete}
            onCancel={onCancel}
            rejectingId={rejectingId}
            onConfirmReject={onConfirmReject}
            onCancelReject={onCancelReject}
            addToast={pushToastCb}
            rejectReason={rejectReason}
            setRejectReason={setRejectReason}
          />
        </div>

        <div className="toast-container">
          {toasts.map(t => (
            <ToastItem key={t.id} toast={t} onDismiss={id => setToasts(prev => prev.filter(x => x.id !== id))} />
          ))}
        </div>

        <footer style={{ marginTop: 40, paddingTop: 20, borderTop: "1px solid var(--border)", fontSize: 11, color: "#6B7280" }}>
          OPEX Asset Booking Management · v0.1.0 · {mode} · Bookings: {mode === "ADDIN_DATA" ? "MyGeotab AddInData" : "local mock"}
        </footer>
      </main>
    </div>
  );
}
