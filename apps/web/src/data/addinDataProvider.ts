/*───────────────────── MyGeotab AddInData Booking Provider ─────────────────────*/
/* Booking transactions stored in MyGeotab AddInData.
   One AddInData record per booking. details = JSON string (max 10,000 chars).
   Master data (devices/users/groups) loaded live from MyGeotab Get calls.
   No localStorage, no external database, no PostgreSQL/Neon/Cloudflare. */

import type {
  MyGeotabGroup,
  MyGeotabStatusData,
  MyGeotabLogRecord,
  OpexBooking,
  ResolvedAsset,
  ResolvedBooking,
  ResolvedUser,
  BookingDataProvider,
} from "./types";

/*───────────────────── Geotab API type (Add-In context) ─────────────────────*/

type GeotabApi = {
  call?: (method: string, params: Record<string, unknown>, success: (result: unknown) => void, error?: (error: unknown) => void) => void;
  getSession?: (callback: (session: { userName?: string; database?: string; server?: string } | null) => void) => void;
};

const MAX_DETAILS_CHARS = 10000;
const DEFAULT_GROUP_ID = "GroupCompanyId";

/*───────────────────── Raw MyGeotab record shapes ─────────────────────*/

type RawMyGeotabDevice = {
  id: string;
  name?: string;
  serialNumber?: string;
  licensePlate?: string;
  make?: string;
  model?: string;
  vehicleClass?: string;
  groupIds?: string[];
  status?: string;
};

type RawMyGeotabUser = {
  id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  companyGroups?: string[];
  role?: string;
  siteCode?: string;
};

type RawMyGeotabGroup = {
  id: string;
  name: string;
  parentId?: string;
};

type AddInDataRecord = {
  id: string;
  addInId: string;
  details: string;
  groups?: Array<{ id: string }>;
  dateTime?: string;
};

/*───────────────────── Mapping helpers ─────────────────────*/

function mapLiveAsset(raw: RawMyGeotabDevice): ResolvedAsset {
  return {
    id: raw.id,
    asset_code: `VEH-${raw.id.slice(-3).toUpperCase()}`,
    make_model: `${raw.make ?? "Unknown"} ${raw.model ?? "Asset"}`,
    asset_class: raw.vehicleClass ?? "OPERATIONAL_4X4",
    registration_no: raw.licensePlate ?? null,
    status: raw.status ?? "AVAILABLE",
    geotab_device_id: raw.id,
  };
}

function mapLiveUser(raw: RawMyGeotabUser): ResolvedUser {
  return {
    id: raw.id,
    name: raw.name || "Unknown",
    roles: raw.role ? [raw.role] : ["EMPLOYEE"],
  };
}

function mapLiveGroup(raw: RawMyGeotabGroup): MyGeotabGroup {
  return {
    id: raw.id,
    name: raw.name,
    parentId: raw.parentId,
  };
}

/*───────────────────── Booking serialization (10,000-char limit) ─────────────────────*/

function serializeBooking(booking: OpexBooking): string {
  const json = JSON.stringify(booking);
  if (json.length > MAX_DETAILS_CHARS) {
    throw new Error(`ADDIN_DATA_DETAILS_EXCEEDED: ${json.length} characters (max ${MAX_DETAILS_CHARS})`);
  }
  return json;
}

function deserializeBooking(details: string): OpexBooking {
  return JSON.parse(details) as OpexBooking;
}

/*───────────────────── Conflict check helper ─────────────────────*/

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/*───────────────────── AddInData Booking Data Provider ─────────────────────*/

export class AddInDataBookingDataProvider implements BookingDataProvider {
  private readonly api: GeotabApi | null;
  private readonly addInId: string | null;
  private readonly groupId: string;

  constructor(api: GeotabApi | null, addInId: string | null, groupId: string = DEFAULT_GROUP_ID) {
    this.api = api;
    this.addInId = addInId;
    this.groupId = groupId;
  }

  /*───────────────────── JSON-RPC wrapper over geotab.addin API ─────────────────────*/

  private async apiCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.api?.call) {
        reject(new Error("GEOTAB_API_NOT_AVAILABLE: running outside MyGeotab Add-In context"));
        return;
      }
      if ((method === "Add" || method === "Set" || method === "Remove") && !this.addInId) {
        reject(new Error("ADDIN_ID_NOT_CONFIGURED: set addInId before using AddInData storage"));
        return;
      }
      this.api.call(method, params, (result: unknown) => resolve(result as T), (error: unknown) => reject(error ?? new Error("GEOTAB_API_ERROR")));
    });
  }

  /*───────────────────── Read-only master data (live from MyGeotab) ─────────────────────*/

  async getAssets(): Promise<ResolvedAsset[]> {
    const devices = await this.apiCall<RawMyGeotabDevice[]>("Get", {
      typeName: "Device",
      resultsLimit: 1000,
    });
    return devices.map(mapLiveAsset);
  }

  async getUsers(): Promise<ResolvedUser[]> {
    const users = await this.apiCall<RawMyGeotabUser[]>("Get", {
      typeName: "User",
      resultsLimit: 1000,
    });
    return users.map(mapLiveUser);
  }

  async getGroups(): Promise<MyGeotabGroup[]> {
    const groups = await this.apiCall<RawMyGeotabGroup[]>("Get", {
      typeName: "Group",
      resultsLimit: 1000,
    });
    return groups.map(mapLiveGroup);
  }

  async getStatusData(): Promise<MyGeotabStatusData[]> {
    return [];
  }

  async getLogRecords(): Promise<MyGeotabLogRecord[]> {
    return [];
  }

  /*───────────────────── Booking transactions (AddInData storage) ─────────────────────*/

  private async getDevicesRaw(): Promise<RawMyGeotabDevice[]> {
    return this.apiCall<RawMyGeotabDevice[]>("Get", { typeName: "Device", resultsLimit: 1000 });
  }

  private async getUsersRaw(): Promise<RawMyGeotabUser[]> {
    return this.apiCall<RawMyGeotabUser[]>("Get", { typeName: "User", resultsLimit: 1000 });
  }

  async getBookings(): Promise<ResolvedBooking[]> {
    const records = await this.apiCall<AddInDataRecord[]>("Get", {
      typeName: "AddInData",
      search: { addInId: this.addInId },
    });
    const devices = await this.getDevicesRaw();
    const users = await this.getUsersRaw();
    const deviceMap = new Map(devices.map(d => [d.id, d]));
    const userMap = new Map(users.map(u => [u.id, u]));
    return (records || []).map(r => resolveAddInDataBooking(r, deviceMap, userMap));
  }

  async createBooking(input: {
    deviceId: string;
    requesterUserId: string;
    requestedClass: "OPERATIONAL_4X4" | "PASSENGER";
    startAt: string;
    endAt: string;
    purpose: string;
    destination: string | null;
    passengerCount: number | null;
  }): Promise<ResolvedBooking> {
    // Best-effort conflict check: load all bookings, filter overlaps for same asset
    const existing = await this.getBookings();
    const conflictStatuses = ["PENDING_APPROVAL", "APPROVED", "ASSIGNED"];
    const newStart = new Date(input.startAt);
    const newEnd = new Date(input.endAt);
    const conflict = existing.find(b => {
      if (b.asset_id !== input.deviceId) return false;
      if (!conflictStatuses.includes(b.status)) return false;
      return overlaps(newStart, newEnd, new Date(b.start_at), new Date(b.end_at));
    });
    if (conflict) {
      throw new Error(`ASSET_CONFLICT: Asset ${input.deviceId} already has a ${conflict.status.replace(/_/g, " ").toLowerCase()} booking overlapping the requested time.`);
    }

    const now = new Date().toISOString();
    const booking: OpexBooking = {
      id: `addin-${Date.now()}`,
      deviceId: input.deviceId,
      requesterUserId: input.requesterUserId,
      requestedClass: input.requestedClass,
      startAt: input.startAt,
      endAt: input.endAt,
      bufferBeforeMinutes: 0,
      bufferAfterMinutes: 30,
      purpose: input.purpose,
      destination: input.destination,
      passengerCount: input.passengerCount,
      status: "PENDING_APPROVAL",
      assignedDriverUserId: null,
      approverId: null,
      approvalRemarks: null,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    const details = serializeBooking(booking);
    const response = await this.apiCall<{ id?: string }>("Add", {
      typeName: "AddInData",
      entity: {
        addInId: this.addInId,
        details,
        groups: [{ id: this.groupId }],
      },
    });
    if (response?.id) {
      booking.id = response.id;
    }

    const resolved = await this.getBookings();
    return resolved.find(b => b.id === booking.id) ?? resolveBookingToResolved(booking);
  }

  async updateBookingStatus(id: string, status: string, approverId?: string, approvalRemarks?: string): Promise<void> {
    const records = await this.apiCall<AddInDataRecord[]>("Get", {
      typeName: "AddInData",
      search: { addInId: this.addInId },
    });
    const record = (records || []).find(r => r.id === id);
    if (!record) throw new Error(`BOOKING_NOT_FOUND: ${id}`);
    const booking = deserializeBooking(record.details);
    booking.status = status as OpexBooking["status"];
    if (approverId !== undefined) booking.approverId = approverId;
    if (approvalRemarks !== undefined) booking.approvalRemarks = approvalRemarks;
    booking.updatedAt = new Date().toISOString();
    booking.version = (booking.version || 0) + 1;
    await this.apiCall<unknown>("Set", {
      typeName: "AddInData",
      entity: {
        addInId: this.addInId,
        id,
        details: serializeBooking(booking),
        groups: [{ id: this.groupId }],
      },
    });
  }

  async deleteBooking(id: string): Promise<void> {
    await this.apiCall<unknown>("Remove", {
      typeName: "AddInData",
      entity: { id },
    });
  }

  async resetDemoData(): Promise<void> {
    // AddInData mode does not use local demo data. No-op here.
    // DEMO mode uses LocalBookingDataProvider.resetDemoData().
  }

  isLive(): boolean {
    return true;
  }
}

/*───────────────────── Helper: build provider from Add-In API context ─────────────────────*/

export function createAddInDataProvider(api: GeotabApi | null, addInId: string | null): AddInDataBookingDataProvider {
  return new AddInDataBookingDataProvider(api, addInId);
}

/*───────────────────── Resolve helpers ─────────────────────*/

function resolveAddInDataBooking(
  record: AddInDataRecord,
  devices: Map<string, RawMyGeotabDevice>,
  users: Map<string, RawMyGeotabUser>,
): ResolvedBooking {
  const booking = deserializeBooking(record.details);
  const device = devices.get(booking.deviceId);
  const requester = users.get(booking.requesterUserId);
  return {
    id: booking.id,
    requester_id: booking.requesterUserId,
    requester_name: requester?.name ?? "Unknown User",
    requested_class: booking.requestedClass,
    asset_id: booking.deviceId ?? null,
    asset_code: device ? `VEH-${device.id.slice(-3).toUpperCase()}` : null,
    registration_no: device?.licensePlate ?? null,
    start_at: booking.startAt,
    end_at: booking.endAt,
    buffer_before_minutes: booking.bufferBeforeMinutes,
    buffer_after_minutes: booking.bufferAfterMinutes,
    purpose: booking.purpose,
    destination: booking.destination,
    passenger_count: booking.passengerCount,
    status: booking.status,
    approver_id: booking.approverId ?? null,
    approval_remarks: booking.approvalRemarks ?? null,
    version: booking.version,
    created_at: booking.createdAt,
    updated_at: booking.updatedAt,
  };
}

function resolveBookingToResolved(booking: OpexBooking): ResolvedBooking {
  return {
    id: booking.id,
    requester_id: booking.requesterUserId,
    requester_name: "Unknown User",
    requested_class: booking.requestedClass,
    asset_id: booking.deviceId ?? null,
    asset_code: null,
    registration_no: null,
    start_at: booking.startAt,
    end_at: booking.endAt,
    buffer_before_minutes: booking.bufferBeforeMinutes,
    buffer_after_minutes: booking.bufferAfterMinutes,
    purpose: booking.purpose,
    destination: booking.destination,
    passenger_count: booking.passengerCount,
    status: booking.status,
    approver_id: booking.approverId ?? null,
    approval_remarks: booking.approvalRemarks ?? null,
    version: booking.version,
    created_at: booking.createdAt,
    updated_at: booking.updatedAt,
  };
}
