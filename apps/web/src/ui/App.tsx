import { useState, useCallback, useEffect, useMemo } from "react";
import { bookingDataProvider } from "../data/dataProvider";
import type { ResolvedVehicle, ResolvedBooking, ResolvedEmployee, BookingDataProvider } from "../data/types";
import { createMyGeotabProvider, MyGeotabBookingDataProvider } from "../data/mygeotabProvider";

const TENANT = import.meta.env.VITE_GEOTAB_DATABASE || "opex_trial";

type GeotabApi = {
  call?: (method: string, params: Record<string, unknown>, success: (result: unknown) => void, error?: (error: unknown) => void) => void;
  getSession?: (callback: (session: { userName?: string; database?: string; server?: string } | null) => void) => void;
};


/*───────────────────── Types ─────────────────────*/

type Vehicle = {
  id: string;
  vehicle_code: string;
  make_model: string;
  vehicle_class: string;
  registration_no: string | null;
  status: string;
  geotab_device_id: string | null;
};
type Booking = {
  id: string;
  requester_id: string;
  requester_name: string;
  requested_class: string;
  vehicle_id: string | null;
  vehicle_code: string | null;
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
type DemoEmployee = { id: string; name: string; roles: string[] };

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

/*───────────────────── Navigation Groups ─────────────────────*/

const NAV_GROUPS: Array<{ section: string; items: Array<{ key: string; label: string }> }> = [
  {
    section: "WORKSPACE",
    items: [
      { key: "Dashboard", label: "Dashboard" },
      { key: "Vehicle Booking", label: "Vehicle Booking" },
      { key: "My Bookings", label: "My Bookings" },
      { key: "Approval Inbox", label: "Approval Inbox" },
    ],
  },
  {
    section: "FLEET MANAGEMENT",
    items: [
      { key: "GA Fleet Board", label: "GA Fleet Board" },
      { key: "Reports", label: "Reports" },
    ],
  },
  {
    section: "ADMINISTRATION",
    items: [
      { key: "Administration", label: "Administration" },
    ],
  },
];

/*───────────────────── Data Provider (MyGeotab-aligned mock data + localStorage) ─────────────────────*/
/* Master data (devices, users, groups, telemetry) comes from ./data/mockMyGeotab.ts.
   OPEX booking transactions are persisted in localStorage via the data provider.
   Live MyGeotab integration would only require swapping the data provider implementation. */

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

function StatCard({ label, value, sub, icon, trend }: {
  label: string; value: string | number; sub: string; icon: string; trend?: { dir: "up" | "down" | "neutral"; label: string };
}) {
  return (
    <article className="stat-card">
      <div className="stat-icon">{icon}</div>
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

function VehicleStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    AVAILABLE: "badge-vehicle-available",
    MAINTENANCE: "badge-vehicle-maintenance",
    OUT_OF_SERVICE: "badge-vehicle-unavailable",
  };
  const cls = "badge " + (map[status] || "badge-vehicle-unavailable");
  const label = status === "AVAILABLE" ? "Available" : status === "MAINTENANCE" ? "Maintenance" : "Unavailable";
  return <span className={cls}>{label}</span>;
}

function LoadingState({ message = "Loading…" }: { message?: string }) {
  return (
    <div className="loading-state">
      <div className="loading-spinner"></div>
      <b>{message}</b>
    </div>
  );
}

function EmptyState({ icon = "▣", title, message, action }: { icon?: string; title: string; message: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
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
      <div className="error-icon">⚠</div>
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
  const iconMap = { success: "✅", error: "❌", warn: "⚠️" };
  return (
    <div className={`toast toast-${toast.type}`}>
      <span className="toast-icon">{iconMap[toast.type]}</span>
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

/*───────────────────── Pages ─────────────────────*/

function Dashboard({
  bookings,
  vehicles,
  filters,
  setFilters,
  loading,
  onLoadData,
  onExport,
  onView,
  onApprove,
  onReject,
  onAssign,
  onComplete,
  rejectingId,
  onConfirmReject,
  onCancelReject,
  addToast,
  setToasts,
}: {
  bookings: Booking[];
  vehicles: Vehicle[];
  filters: { from: string; to: string; vehicle: string; employee: string; status: string };
  setFilters: (f: { from: string; to: string; vehicle: string; employee: string; status: string }) => void;
  loading: boolean;
  onLoadData: () => void;
  onExport: () => void;
  onView: (id: string) => void;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onAssign: (id: string) => void;
  onComplete: (id: string) => void;
  rejectingId: string | null;
  onConfirmReject: (id: string) => void;
  onCancelReject: () => void;
  addToast: (type: Toast["type"], text: string) => void;
  setToasts: (t: Toast[]) => void;
}) {
  const totalVehicles = vehicles.length;
  const availableVehicles = vehicles.filter(v => v.status === "AVAILABLE").length;
  const pendingApproval = bookings.filter(b => b.status === "PENDING_APPROVAL").length;
  const activeBookings = bookings.filter(b => b.status === "APPROVED" || b.status === "ASSIGNED").length;

  const handleLoad = () => {
    onLoadData();
    addToast("success", "Data refreshed.");
  };

  const handleResetFilters = () => {
    setFilters({ from: "", to: "", vehicle: "", employee: "", status: "" });
  };

  const filtered = bookings.filter(b => {
    if (filters.from && b.start_at < filters.from) return false;
    if (filters.to && b.start_at > filters.to) return false;
    if (filters.status && b.status !== filters.status) return false;
    if (filters.vehicle && b.vehicle_code?.toLowerCase().includes(filters.vehicle.toLowerCase()) === false) return false;
    if (filters.employee && b.requester_name.toLowerCase().includes(filters.employee.toLowerCase()) === false) return false;
    return true;
  });

  return (
    <div className="page">
      <PageHeader
        eyebrow="OPEX Vehicle Booking Management"
        title="Fleet Reservation Dashboard"
        subtitle="MyGeotab database: opex_trial — fleet coordination and booking workspace"
      />

      <section className="stats">
        <StatCard
          label="Total Vehicles"
          value={totalVehicles}
          sub="Registered fleet"
          icon="🚗"
          trend={totalVehicles > 0 ? { dir: "neutral" as const, label: "fleet" } : undefined}
        />
        <StatCard
          label="Available Vehicles"
          value={availableVehicles}
          sub="Ready for booking"
          icon="✅"
        />
        <StatCard
          label="Pending Approval"
          value={pendingApproval}
          sub="Awaiting decision"
          icon="⏳"
        />
        <StatCard
          label="Active Bookings"
          value={activeBookings}
          sub="Approved or assigned"
          icon="📋"
        />
      </section>

      <div className="filters">
        <div className="filter-group">
          <label>Date Range</label>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="form-control" type="date" value={filters.from} onChange={e => setFilters({ ...filters, from: e.target.value })} />
            <input className="form-control" type="date" value={filters.to} onChange={e => setFilters({ ...filters, to: e.target.value })} />
          </div>
        </div>
        <div className="filter-group">
          <label>Vehicle</label>
          <input className="form-control" placeholder="Vehicle code or plate" value={filters.vehicle} onChange={e => setFilters({ ...filters, vehicle: e.target.value })} />
        </div>
        <div className="filter-group">
          <label>Employee</label>
          <input className="form-control" placeholder="Employee name" value={filters.employee} onChange={e => setFilters({ ...filters, employee: e.target.value })} />
        </div>
        <div className="filter-group">
          <label>Booking Status</label>
          <select className="form-control" value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All</option>
            <option value="PENDING_APPROVAL">Pending Approval</option>
            <option value="APPROVED">Approved</option>
            <option value="ASSIGNED">Assigned</option>
            <option value="COMPLETED">Completed</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </div>
        <div className="filter-actions">
          <button className="btn btn-outline btn-sm" onClick={handleResetFilters}>Reset Filters</button>
          <button className="btn btn-primary" onClick={handleLoad} disabled={loading}>
            {loading ? "Loading…" : "Load Data"}
          </button>
          <button className="btn btn-secondary" onClick={onExport}>Export CSV</button>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>Booking Register</h2>
            <p>All bookings across the fleet. Filter and load data.</p>
          </div>
          <div className="panel-head-actions">
            <span className="badge badge-approved">{bookings.length} records</span>
          </div>
        </div>
        <div className="panel-body">
          {loading ? (
            <LoadingState message="Loading data…" />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="No bookings found"
              message="Adjust your filters or load data."
              action={{ label: "Create Booking", onClick: () => {} }}
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Booking ID</th><th>Vehicle</th><th>License Plate</th><th>Employee</th><th>Date</th><th>Time</th><th>Destination</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(b => (
                    <tr key={b.id}>
                      <td>#{b.id.slice(-4)}</td>
                      <td><b>{b.vehicle_code || "Unassigned"}</b></td>
                      <td>{b.registration_no || "—"}</td>
                      <td>{b.requester_name}</td>
                      <td>{formatDate(b.start_at)}</td>
                      <td>{formatTime(b.start_at)} – {formatTime(b.end_at)}</td>
                      <td>{b.destination || "—"}</td>
                      <td><StatusBadge status={b.status} /></td>
                      <td className="actions">
                        <button className="btn btn-sm btn-view" onClick={() => onView(b.id)}>View</button>
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

function VehicleBooking({
  vehicles,
  bookings,
  demoEmployee,
  onCreateBooking,
  submitting,
  addToast,
}: {
  vehicles: Vehicle[];
  bookings: Booking[];
  demoEmployee: DemoEmployee | null;
  onCreateBooking: (input: {
    vehicleId: string; startAt: string; endAt: string; destination: string;
    purpose: string; notes: string;
  }) => void;
  submitting: boolean;
  addToast: (type: Toast["type"], text: string) => void;
}) {
  const [form, setForm] = useState({
    vehicle: "", date: "", startTime: "", endTime: "", destination: "", purpose: "", notes: "",
  });
  const [conflictError, setConflictError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const availableVehicles = vehicles.filter(v => v.status === "AVAILABLE");

  const handleChange = (key: string, value: string) => {
    setForm(prev => ({ ...prev, [key]: value }));
    setConflictError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setConflictError(null);

    if (!demoEmployee) {
      addToast("error", "Please select a demo employee first.");
      return;
    }
    if (!form.vehicle || !form.date || !form.startTime || !form.endTime || !form.destination || !form.purpose) {
      addToast("error", "Please fill in all required fields.");
      return;
    }

    const start = new Date(`${form.date}T${form.startTime}`);
    const end = new Date(`${form.date}T${form.endTime}`);
    if (end <= start) {
      addToast("error", "End time must be after start time.");
      return;
    }

    const selectedVehicle = vehicles.find(v => v.id === form.vehicle);
    if (!selectedVehicle || selectedVehicle.status !== "AVAILABLE") {
      addToast("error", "Selected vehicle is not available.");
      return;
    }

    // Conflict prevention: check overlapping bookings for the same vehicle
    const conflictStatuses = ["PENDING_APPROVAL", "APPROVED", "ASSIGNED"];
    const conflictBooking = bookings.find(b => {
      if (b.vehicle_id !== form.vehicle) return false;
      if (!conflictStatuses.includes(b.status)) return false;
      const bStart = parseISO(b.start_at);
      const bEnd = parseISO(b.end_at);
      return overlaps(start, end, bStart, bEnd);
    });

    if (conflictBooking) {
      setConflictError(`Vehicle ${selectedVehicle.vehicle_code} already has a ${conflictBooking.status.replace(/_/g, " ").toLowerCase()} booking from ${formatDateTime(conflictBooking.start_at)} to ${formatDateTime(conflictBooking.end_at)}. Please choose another time or vehicle.`);
      return;
    }

    setConfirmOpen(true);
  };

  const handleConfirmSubmit = () => {
    setConfirmOpen(false);
    onCreateBooking({
      vehicleId: form.vehicle,
      startAt: startISO(),
      endAt: endISO(),
      destination: form.destination,
      purpose: form.purpose,
      notes: form.notes,
    });
    addToast("success", "Booking created successfully as PENDING_APPROVAL.");
  };

  function startISO() { return new Date(`${form.date}T${form.startTime}`).toISOString(); }
  function endISO() { return new Date(`${form.date}T${form.endTime}`).toISOString(); }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Vehicle Booking"
        title="Create New Booking"
        subtitle="Reserve a vehicle for your trip. Conflicting bookings are blocked automatically."
      />

      {demoEmployee && (
        <div className="notice demo">
          <span style={{ fontWeight: 600 }}>Booking as:</span> <b>{demoEmployee.name}</b> ({demoEmployee.id}) — demo identity, not authenticated MyGeotab
        </div>
      )}
      {!demoEmployee && (
        <div className="notice error">
          No demo employee selected. Choose one from the sidebar to create bookings.
        </div>
      )}

      {conflictError && (
        <div className="notice error">{conflictError}</div>
      )}

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>Booking Form</h2>
            <p>Select vehicle and trip details.</p>
          </div>
        </div>
        <div className="panel-body">
          <form onSubmit={handleSubmit}>
            <div className="form-section">
              <div className="form-section-label">Request Details</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Employee</label>
                  <select className="form-control" value={demoEmployee?.id || ""} disabled onChange={() => {}}>
                    <option value={demoEmployee?.id || ""}>{demoEmployee ? demoEmployee.name : "Select employee"}</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Department</label>
                  <input className="form-control" value="North Sumatra" disabled placeholder="Fleet Management" />
                </div>
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

            <div className="form-section">
              <div className="form-section-label">Vehicle Selection</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Vehicle Type</label>
                  <select className="form-control" value={form.vehicle ? vehicles.find(v => v.id === form.vehicle)?.vehicle_class : ""} disabled onChange={() => {}}>
                    <option value="">Select vehicle type</option>
                    <option value="OPERATIONAL_4X4">Operational 4X4</option>
                    <option value="PASSENGER">Passenger</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Available Vehicle</label>
                  <select className="form-control" value={form.vehicle} onChange={e => handleChange("vehicle", e.target.value)} required>
                    <option value="">Select a vehicle</option>
                    {availableVehicles.map(v => (
                      <option key={v.id} value={v.id}>{v.vehicle_code} · {v.make_model} ({v.registration_no || "No plate"})</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Registration</label>
                  <input className="form-control" value={vehicles.find(v => v.id === form.vehicle)?.registration_no || ""} disabled />
                </div>
                <div className="form-group">
                  <label>Vehicle Group</label>
                  <input className="form-control" value="North Sumatra" disabled />
                </div>
              </div>
            </div>

            <div className="form-section">
              <div className="form-section-label">Schedule</div>
              <div className="form-row">
                <div className="form-group">
                  <label>Booking Date</label>
                  <input className="form-control" type="date" value={form.date} onChange={e => handleChange("date", e.target.value)} required />
                </div>
              </div>
              <div className="form-row">
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
              <button type="button" className="btn btn-secondary" onClick={() => setForm({ vehicle: "", date: "", startTime: "", endTime: "", destination: "", purpose: "", notes: "" })}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting || !demoEmployee}>{submitting ? "Submitting…" : "Create Booking"}</button>
            </div>
          </form>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>Vehicle Availability</h2>
            <p>Vehicles that can be booked.</p>
          </div>
        </div>
        <div className="panel-body">
          {availableVehicles.length === 0 ? (
            <EmptyState title="No vehicles available" message="All vehicles are currently booked or under maintenance." />
          ) : (
            <div className="vehicle-grid">
              {availableVehicles.map(v => (
                <div key={v.id} className="vehicle-card">
                  <div className="vehicle-card-header">
                    <div className="vehicle-card-info">
                      <b>{v.vehicle_code}</b>
                      <span>{v.make_model}</span>
                      <div className="vehicle-card-meta">{v.registration_no || "Plate pending"} · {v.vehicle_class.replace(/_/g, " ")}</div>
                    </div>
                    <VehicleStatusBadge status={v.status} />
                  </div>
                  <div className="vehicle-card-footer">
                    <span style={{ fontSize: 11, color: "#16A34A", fontWeight: 600 }}>Available for booking</span>
                  </div>
                </div>
              ))}
            </div>
          )}
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
}) {
  const pending = bookings.filter(b => b.status === "PENDING_APPROVAL");

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
                    <th>Request ID</th><th>Employee</th><th>Vehicle</th><th>Booking Date</th><th>Destination</th><th>Request Date</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.map(b => (
                    <tr key={b.id}>
                      <td>#{b.id.slice(-4)}</td>
                      <td>{b.requester_name}</td>
                      <td>{b.vehicle_code || "Unassigned"}</td>
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

function FleetBoard({
  vehicles,
  bookings,
  onExport,
}: {
  vehicles: Vehicle[];
  bookings: Booking[];
  onExport: () => void;
}) {
  // Map bookings to vehicles for "Current Booking" column
  const bookingByVehicle = new Map<string, Booking>();
  bookings.forEach(b => {
    if (b.vehicle_id && (b.status === "PENDING_APPROVAL" || b.status === "APPROVED" || b.status === "ASSIGNED")) {
      const existing = bookingByVehicle.get(b.vehicle_id);
      if (!existing || b.created_at > existing.created_at) {
        bookingByVehicle.set(b.vehicle_id, b);
      }
    }
  });

  return (
    <div className="page">
      <PageHeader
        eyebrow="GA Fleet Board"
        title="Fleet Overview"
        subtitle="Vehicle master data and current availability."
      />

      <section className="stats">
        <StatCard
          label="Total Fleet"
          value={vehicles.length}
          sub="All registered vehicles"
          icon="🚙"
        />
        <StatCard
          label="Available"
          value={vehicles.filter(v => v.status === "AVAILABLE").length}
          sub="Ready for booking"
          icon="✅"
        />
        <StatCard
          label="Maintenance"
          value={vehicles.filter(v => v.status === "MAINTENANCE").length}
          sub="Out of service"
          icon="🔧"
        />
        <StatCard
          label="Out of Service"
          value={vehicles.filter(v => v.status === "OUT_OF_SERVICE").length}
          sub="Not available"
          icon="❌"
        />
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>Vehicle Register</h2>
            <p>Fleet inventory with current availability and booking status.</p>
          </div>
          <div className="panel-head-actions">
            <span className="badge badge-approved">{vehicles.length} vehicles</span>
            <button className="btn btn-secondary btn-sm" onClick={onExport}>Export CSV</button>
          </div>
        </div>
        <div className="panel-body">
          {vehicles.length === 0 ? (
            <EmptyState title="No vehicles registered" message="No vehicle data available." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Vehicle</th><th>License Plate</th><th>Vehicle Type</th><th>MyGeotab Device ID</th><th>Vehicle Group</th><th>Availability</th><th>Current Booking</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map(v => {
                    const currentBooking = bookingByVehicle.get(v.id);
                    return (
                      <tr key={v.id}>
                        <td><b>{v.vehicle_code}</b></td>
                        <td>{v.registration_no || "—"}</td>
                        <td>{v.vehicle_class.replace(/_/g, " ")}</td>
                        <td>{v.geotab_device_id || "Not mapped"}</td>
                        <td>North Sumatra</td>
                        <td><VehicleStatusBadge status={v.status} /></td>
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

function MyBookings({
  bookings,
  demoEmployee,
  employees,
  setDemoEmployee,
  onExport,
  onView,
  onCancel,
  addToast,
}: {
  bookings: Booking[];
  demoEmployee: DemoEmployee | null;
  employees: DemoEmployee[];
  setDemoEmployee: (e: DemoEmployee | null) => void;
  onExport: () => void;
  onView: (id: string) => void;
  onCancel: (id: string) => void;
  addToast: (type: Toast["type"], text: string) => void;
}) {
  const rows = demoEmployee ? bookings.filter(b => b.requester_id === demoEmployee.id) : [];
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");

  const now = new Date().toISOString();
  const upcoming = rows.filter(b => b.end_at >= now && b.status !== "CANCELLED" && b.status !== "REJECTED" && b.status !== "COMPLETED");
  const past = rows.filter(b => b.end_at < now || b.status === "CANCELLED" || b.status === "REJECTED" || b.status === "COMPLETED");
  const activeTab = tab === "upcoming" ? upcoming : past;

  const handleCancel = (id: string) => {
    if (!window.confirm("Cancel this booking?")) return;
    onCancel(id);
    addToast("success", "Booking cancelled.");
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="My Bookings"
        title="Booking History"
        subtitle={demoEmployee ? `Bookings for ${demoEmployee.name}` : "Select a demo employee from the sidebar."}
      />

      {!demoEmployee && (
        <div className="notice error">
          Select a demo employee from the sidebar to view their bookings.
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>My Bookings</h2>
            <p>Booking history filtered by the selected demo employee.</p>
          </div>
          <div className="panel-head-actions">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className={`btn btn-sm ${tab === "upcoming" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("upcoming")}>Upcoming</button>
              <button className={`btn btn-sm ${tab === "past" ? "btn-primary" : "btn-outline"}`} onClick={() => setTab("past")}>Past</button>
              <select
                className="form-control"
                style={{ width: "220px", maxWidth: "300px" }}
                value={demoEmployee ? demoEmployee.id : ""}
                onChange={e => {
                  const emp = employees.find(x => x.id === e.target.value) || null;
                  setDemoEmployee(emp);
                }}
              >
                <option value="">Select demo employee</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.id})</option>
                ))}
              </select>
              <button className="btn btn-secondary btn-sm" onClick={onExport}>Export CSV</button>
            </div>
          </div>
        </div>
        <div className="panel-body">
          {!demoEmployee ? (
            <EmptyState title="No employee selected" message="Choose a demo employee from the sidebar selector." />
          ) : activeTab.length === 0 ? (
            <EmptyState title="No bookings" message={`No ${tab} bookings found for ${demoEmployee?.name}.`} />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Booking ID</th><th>Vehicle</th><th>Booking Date</th><th>Time</th><th>Destination</th><th>Booking Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {activeTab.map(b => (
                    <tr key={b.id}>
                      <td>#{b.id.slice(-4)}</td>
                      <td><b>{b.vehicle_code || "Unassigned"}</b></td>
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

function Reports({
  bookings,
  vehicles,
  onExport,
}: {
  bookings: Booking[];
  vehicles: Vehicle[];
  onExport: () => void;
}) {
  const total = bookings.length;
  const byStatus = bookings.reduce<Record<string, number>>((acc, b) => { acc[b.status] = (acc[b.status] || 0) + 1; return acc; }, {});
  const byVehicle = bookings.reduce<Record<string, number>>((acc, b) => { if (b.vehicle_code) acc[b.vehicle_code] = (acc[b.vehicle_code] || 0) + 1; return acc; }, {});
  const mostBooked = Object.entries(byVehicle).sort((a, b) => b[1] - a[1]).slice(0, 5);

  // Real utilization: percentage of vehicles that have at least one booking
  const vehiclesWithBookings = new Set(bookings.filter(b => b.vehicle_id).map(b => b.vehicle_id)).size;
  const utilization = vehicles.length > 0 ? Math.round((vehiclesWithBookings / vehicles.length) * 100) : 0;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Reports"
        title="Booking Reports"
        subtitle="Fleet utilization and booking analytics based on actual data."
      />

      <section className="stats">
        <StatCard label="Total Bookings" value={total} sub="All time" icon="📊" />
        <StatCard label="Vehicle Utilization" value={`${utilization}%`} sub={`${vehiclesWithBookings} of ${vehicles.length} vehicles used`} icon="📈" />
        <StatCard label="Most Booked Vehicle" value={mostBooked[0]?.[0] || "—"} sub={mostBooked[0]?.[1] ? `${mostBooked[0][1]} bookings` : "No data"} icon="🏆" />
        <StatCard label="Status Summary" value={Object.keys(byStatus).length} sub="Different statuses" icon="📋" />
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
                  <div className="stat-icon">📋</div>
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
            <h2>Most Booked Vehicles</h2>
            <p>Top vehicles by number of bookings.</p>
          </div>
        </div>
        <div className="panel-body">
          {mostBooked.length === 0 ? (
            <EmptyState title="No vehicle data" message="Bookings will populate this report." />
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

function Administration({
  geotabApi,
  dataSource,
  onResetDemoData,
  addToast,
}: {
  geotabApi: GeotabApi | null;
  dataSource: "LOCAL_DEMO" | "MYGEOTAB_LIVE";
  onResetDemoData: () => void;
  addToast: (type: Toast["type"], text: string) => void;
}) {
  return (
    <div className="page">
      <PageHeader
        eyebrow="Administration"
        title="System Administration"
        subtitle="Configure users, roles, vehicles, and demo data."
      />

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>Data Source Settings</h2>
            <p>Current data source and connection status.</p>
          </div>
        </div>
        <div className="panel-body">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 16 }}>
            <div className="stat-card">
              <div className="stat-label">Data Source</div>
              <div className="stat-value" style={{ fontSize: 14, textTransform: "uppercase" }}>{dataSource}</div>
              <div className="stat-sub">{dataSource === "MYGEOTAB_LIVE" ? "MyGeotab live API" : "Local mock data"}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">MyGeotab Connection</div>
              <div className="stat-value" style={{ fontSize: 14 }}>{geotabApi ? "Connected" : "Not available"}</div>
              <div className="stat-sub">{geotabApi ? "Running inside MyGeotab Add-In" : "Standalone preview"}</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Booking Storage</div>
              <div className="stat-value">localStorage</div>
              <div className="stat-sub">Transactions are local/simulated</div>
            </div>
            <div className="stat-card">
              <div className="stat-label">Identity</div>
              <div className="stat-value">Demo mode</div>
              <div className="stat-sub">Not authenticated MyGeotab user</div>
            </div>
          </div>
          <div style={{ marginTop: 20 }}>
            <p style={{ fontSize: 12, color: "#6B7280", marginBottom: 8 }}><b>Security:</b> No credentials or session information are stored in the frontend. Demo employee selection is simulation only, not authenticated identity.</p>
            <button className="btn btn-secondary btn-sm" onClick={onResetDemoData}>Reset Demo Data</button>
            {dataSource === "MYGEOTAB_LIVE" && !geotabApi && (
              <p style={{ fontSize: 11, color: "#FCA5A5", marginTop: 8 }}>Not running inside MyGeotab Add-In — live master data unavailable.</p>
            )}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <div className="panel-head-content">
            <h2>Demo Data Management</h2>
            <p>Reset all local booking transactions to initial state.</p>
          </div>
        </div>
        <div className="panel-body">
          <p style={{ fontSize: 13, color: "#6B7280", marginBottom: 16 }}>This will restore all 30 demo booking transactions. Vehicle, user, and group master data are unchanged.</p>
          <button className="btn btn-secondary" onClick={() => {
            if (window.confirm("Reset all demo booking transactions to initial state?")) {
              onResetDemoData();
              addToast("success", "Demo data reset to initial state.");
            }
          }}>Reset Demo Data</button>
        </div>
      </section>
    </div>
  );
}

/*───────────────────── View Details Modal ─────────────────────*/

function ViewDetailsModal({
  booking,
  vehicles,
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
  vehicles: Vehicle[];
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
  const vehicle = vehicles.find(v => v.id === booking.vehicle_id);
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
            <div className="detail-row"><label>Employee</label><span className="value">{booking.requester_name}</span></div>
            <div className="detail-row"><label>Vehicle</label><span className="value">{booking.vehicle_code || "Unassigned"} {vehicle ? `(${vehicle.registration_no || "No plate"})` : ""}</span></div>
            <div className="detail-row"><label>Vehicle Class</label><span className="value">{booking.requested_class.replace(/_/g, " ")}</span></div>
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
              <button className="btn btn-sm btn-primary" onClick={handleModalAssign}>Assign Vehicle</button>
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
  const [vehicles, setVehicles] = useState<ResolvedVehicle[]>([]);
  const [users, setUsers] = useState<ResolvedEmployee[]>([]);
  const [demoEmployee, setDemoEmployee] = useState<ResolvedEmployee | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [active, setActive] = useState("Dashboard");
  const [filters, setFilters] = useState({ from: "", to: "", vehicle: "", employee: "", status: "" });
  const [selectedBooking, setSelectedBooking] = useState<ResolvedBooking | null>(null);
  const [geotabApi, setGeotabApi] = useState<GeotabApi | null>(null);
  const [dataSource, setDataSource] = useState<"LOCAL_DEMO" | "MYGEOTAB_LIVE">("LOCAL_DEMO");
  const [myGeotabError, setMyGeotabError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [rejectReason, setRejectReasonState] = useState<{ [id: string]: string }>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    let mounted = true;

    const onInitialize = (event: Event) => {
      const ce = event as CustomEvent<{ api: GeotabApi | null; state: unknown }>;
      if (ce.detail?.api) {
        setGeotabApi(ce.detail.api);
        document.documentElement.dataset.opexVbm = "initialized";
      }
    };

    window.addEventListener("opex-vbm:initialize", onInitialize as EventListener);
    window.addEventListener("opex-vbm:focus", onInitialize as EventListener);

    const provider: BookingDataProvider = dataSource === "MYGEOTAB_LIVE"
      ? createMyGeotabProvider(geotabApi)
      : bookingDataProvider;

    provider.getDevices().then((v: ResolvedVehicle[]) => { if (mounted) setVehicles(v); }).catch((e: unknown) => { if (mounted) setMyGeotabError(e instanceof Error ? e.message : "Failed to load devices from MyGeotab."); });
    provider.getUsers().then((u: ResolvedEmployee[]) => { if (mounted) { setUsers(u); if (u.length > 0 && !demoEmployee) setDemoEmployee(u[0]); } }).catch((e: unknown) => { if (mounted) setMyGeotabError(e instanceof Error ? e.message : "Failed to load users from MyGeotab."); });
    provider.getBookings().then((b: ResolvedBooking[]) => { if (mounted) setBookings(b); }).catch((e: unknown) => { if (mounted) setMyGeotabError(e instanceof Error ? e.message : "Failed to load bookings."); });

    return () => {
      mounted = false;
      window.removeEventListener("opex-vbm:initialize", onInitialize as EventListener);
      window.removeEventListener("opex-vbm:focus", onInitialize as EventListener);
    };
  }, [dataSource, geotabApi, demoEmployee]);

  const provider = useMemo(() => {
    if (dataSource === "MYGEOTAB_LIVE") {
      return createMyGeotabProvider(geotabApi);
    }
    return bookingDataProvider;
  }, [dataSource, geotabApi]);

  const pushToastCb = useCallback((type: Toast["type"], text: string) => {
    pushToast(setToasts, type, text);
  }, []);

  /*───────────────────── State mutations ─────────────────────*/
  const updateBookingStatus = useCallback(async (id: string, newStatus: string) => {
    await provider.updateBookingStatus(id, newStatus);
    const updated = await provider.getBookings();
    setBookings(updated);
  }, [provider]);

  const onLoadData = useCallback(async () => {
    setLoading(true);
    setMessage(null);
    try {
      const refreshed = await provider.getBookings();
      setBookings(refreshed);
      setLoading(false);
      setMessage({ type: "success", text: dataSource === "MYGEOTAB_LIVE" ? "Master data reloaded from MyGeotab live API." : "Demo data reloaded from local storage." });
    } catch (e) {
      setLoading(false);
      setMessage({ type: "error", text: e instanceof Error ? e.message : "Failed to reload data." });
    }
  }, [provider, dataSource]);

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

  const onCreateBooking = useCallback(async (input: {
    vehicleId: string; startAt: string; endAt: string; destination: string;
    purpose: string; notes: string;
  }) => {
    if (!demoEmployee) return;
    try {
      const created = await provider.createBooking({
        deviceId: input.vehicleId,
        requesterUserId: demoEmployee.id,
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
  }, [demoEmployee, provider]);

  const onApprove = useCallback(async (id: string) => {
    await updateBookingStatus(id, "APPROVED");
  }, [updateBookingStatus]);

  const onReject = useCallback((id: string) => {
    setRejectingId(id);
  }, []);

  const onConfirmReject = useCallback(async (id: string) => {
    await updateBookingStatus(id, "REJECTED");
    setRejectingId(null);
  }, [updateBookingStatus]);

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

  /*───────────────────── CSV exports ─────────────────────*/
  const onExportDashboard = useCallback(() => {
    const data = bookings.map(b => ({
      "Booking ID": b.id,
      Vehicle: b.vehicle_code || "Unassigned",
      "License Plate": b.registration_no || "",
      Employee: b.requester_name,
      "Booking Date": b.start_at,
      "Start Time": b.start_at,
      "End Time": b.end_at,
      Destination: b.destination || "",
      "Booking Status": b.status,
    }));
    exportCSV(data, `opex-vbm-dashboard-bookings-${new Date().toISOString().slice(0,10)}.csv`);
  }, [bookings]);

  const onExportMyBookings = useCallback(() => {
    const rows = demoEmployee ? bookings.filter(b => b.requester_id === demoEmployee.id) : [];
    const data = rows.map(b => ({
      "Booking ID": b.id,
      Vehicle: b.vehicle_code || "Unassigned",
      "Booking Date": b.start_at,
      "Start Time": b.start_at,
      "End Time": b.end_at,
      Destination: b.destination || "",
      "Booking Status": b.status,
    }));
    exportCSV(data, `opex-vbm-mybookings-${demoEmployee?.name || "all"}-${new Date().toISOString().slice(0,10)}.csv`);
  }, [bookings, demoEmployee]);

  const onExportApprovals = useCallback(() => {
    const data = bookings
      .filter(b => b.status === "PENDING_APPROVAL")
      .map(b => ({
        "Request ID": b.id,
        Employee: b.requester_name,
        Vehicle: b.vehicle_code || "Unassigned",
        "Booking Date": b.start_at,
        Destination: b.destination || "",
        "Request Date": b.created_at,
      }));
    exportCSV(data, `opex-vbm-approvals-${new Date().toISOString().slice(0,10)}.csv`);
  }, [bookings]);

  const onExportFleet = useCallback(() => {
    const data = vehicles.map(v => ({
      "Vehicle Name": v.vehicle_code,
      "License Plate": v.registration_no || "",
      "Vehicle Type": v.vehicle_class,
      "MyGeotab Device ID": v.geotab_device_id || "",
      "Vehicle Group": "North Sumatra",
      Availability: v.status,
      "Current Booking": "",
    }));
    exportCSV(data, `opex-vbm-fleet-${new Date().toISOString().slice(0,10)}.csv`);
  }, [vehicles]);

  const setRejectReason = useCallback((id: string, reason: string) => {
    setRejectReasonState(prev => ({ ...prev, [id]: reason }));
  }, []);

  /*───────────────────── Render ─────────────────────*/
  const Page = (() => {
    switch (active) {
      case "Dashboard": return (
        <Dashboard
          bookings={bookings}
          vehicles={vehicles}
          filters={filters}
          setFilters={setFilters}
          loading={loading}
          onLoadData={onLoadData}
          onExport={onExportDashboard}
          onView={id => setSelectedBooking(bookings.find(b => b.id === id) || null)}
          onApprove={onApprove}
          onReject={onReject}
          onAssign={onAssign}
          onComplete={onComplete}
          rejectingId={rejectingId}
          onConfirmReject={onConfirmReject}
          onCancelReject={onCancelReject}
          addToast={pushToastCb}
          setToasts={setToasts}
        />
      );
      case "Vehicle Booking": return (
        <VehicleBooking
          vehicles={vehicles}
          bookings={bookings}
          demoEmployee={demoEmployee}
          onCreateBooking={onCreateBooking}
          submitting={loading}
          addToast={pushToastCb}
        />
      );
      case "My Bookings": return (
        <MyBookings
          bookings={bookings}
          demoEmployee={demoEmployee}
          employees={users}
          setDemoEmployee={setDemoEmployee}
          onExport={onExportMyBookings}
          onView={id => setSelectedBooking(bookings.find(b => b.id === id) || null)}
          onCancel={onCancel}
          addToast={pushToastCb}
        />
      );
      case "Approval Inbox": return (
        <ApprovalInbox
          bookings={bookings}
          onApprove={onApprove}
          onReject={onReject}
          onView={id => setSelectedBooking(bookings.find(b => b.id === id) || null)}
          rejectingId={rejectingId}
          onConfirmReject={onConfirmReject}
          onCancelReject={onCancelReject}
          onExport={onExportApprovals}
          addToast={pushToastCb}
          rejectReason={rejectReason}
          setRejectReason={setRejectReason}
        />
      );
      case "GA Fleet Board": return (
        <FleetBoard vehicles={vehicles} bookings={bookings} onExport={onExportFleet} />
      );
      case "Reports": return (
        <Reports bookings={bookings} vehicles={vehicles} onExport={onExportDashboard} />
      );
      case "Administration": return (
        <Administration
          geotabApi={geotabApi}
          dataSource={dataSource}
          onResetDemoData={onResetDemoData}
          addToast={pushToastCb}
        />
      );
      default: return <Dashboard bookings={bookings} vehicles={vehicles} filters={filters} setFilters={setFilters} loading={loading} onLoadData={onLoadData} onExport={onExportDashboard} onView={id => setSelectedBooking(bookings.find(b => b.id === id) || null)} onApprove={onApprove} onReject={onReject} onAssign={onAssign} onComplete={onComplete} rejectingId={rejectingId} onConfirmReject={onConfirmReject} onCancelReject={onCancelReject} addToast={pushToastCb} setToasts={setToasts} />;
    }
  })();

  return (
    <div className="shell">
      <aside className={`sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="brand">
          <span className="brand-mark">O</span>
          <div><b>OPEX VBM</b><small>VEHICLE BOOKING</small></div>
        </div>
        <div className="tenant">MYGEOTAB · {TENANT} · {dataSource === "MYGEOTAB_LIVE" ? "LIVE MASTER DATA" : "LOCAL DEMO"}</div>
        <nav>
          {NAV_GROUPS.map(group => (
            <div key={group.section} className="nav-group">
              <div className="nav-group-label">{group.section}</div>
              {group.items.map(item => (
                <button
                  key={item.key}
                  className={`nav ${active === item.key ? "active" : ""}`}
                  onClick={() => { setActive(item.key); if (window.innerWidth <= 768) setSidebarOpen(false); }}
                >
                  <span className="nav-label">{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="data-source-switch">
          <label>Data source</label>
          <select
            className="form-control"
            value={dataSource}
            onChange={e => setDataSource(e.target.value === "MYGEOTAB_LIVE" ? "MYGEOTAB_LIVE" : "LOCAL_DEMO")}
          >
            <option value="LOCAL_DEMO">LOCAL DEMO (mock data)</option>
            <option value="MYGEOTAB_LIVE">MYGEOTAB LIVE (opex_trial)</option>
          </select>
          <div className="source-status">
            {dataSource === "MYGEOTAB_LIVE" && !geotabApi ? (
              <span className="live-unavailable">Not running inside MyGeotab Add-In — live data unavailable.</span>
            ) : dataSource === "MYGEOTAB_LIVE" && geotabApi ? (
              <span className="live-connected">Connected to MyGeotab Add-In API.</span>
            ) : (
              <span className="demo">Bookings always local/simulated.</span>
            )}
          </div>
        </div>
        <div className="side-foot">OPEX Vehicle Booking<br/>North Sumatra · Fleet Management</div>
      </aside>

      {window.innerWidth <= 768 && sidebarOpen && (
        <div className="sidebar-backdrop open" onClick={() => setSidebarOpen(false)} />
      )}

      <main className="main">
        <div className="topbar">
          <div className="topbar-left">
            <div className="topbar-brand">
              <div className="topbar-brand-mark">O</div>
              <div className="topbar-brand-text"><b>OPEX VBM</b><small>Vehicle Booking</small></div>
            </div>
            <div className="topbar-divider"></div>
            <div className="topbar-info">
              <div className="topbar-tenant">{TENANT}</div>
              <div className="topbar-source">{dataSource === "MYGEOTAB_LIVE" ? "MYGEOTAB LIVE" : "LOCAL DEMO"}</div>
            </div>
          </div>
          <div className="topbar-right">
            {window.innerWidth <= 768 && (
              <button className="btn btn-icon" onClick={() => setSidebarOpen(true)} style={{ padding: 6 }}>
                ☰
              </button>
            )}
            <div className="user-badge">
              {demoEmployee ? (
                <>
                  <div className="user-avatar">{demoEmployee.name.charAt(0)}</div>
                  <div>
                    <div style={{ fontSize: 12 }}>{demoEmployee.name}</div>
                    <div style={{ fontSize: 10, color: "#6B7280" }}>{demoEmployee.roles.join(", ")}</div>
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 11, color: "#9CA3AF" }}>No employee</div>
              )}
            </div>
          </div>
        </div>

        {message && (
          <div className={`notice ${message.type === "success" ? "success" : "error"}`} style={{ marginBottom: 0 }}>
            {message.text}
          </div>
        )}

        <div className="page-container">
          {Page}
          <ViewDetailsModal
            booking={selectedBooking}
            vehicles={vehicles}
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
          OPEX Vehicle Booking Management · v0.1.0 · {dataSource} · Bookings: local only
        </footer>
      </main>
    </div>
  );
}
