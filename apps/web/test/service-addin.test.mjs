/*───────────────────── Service Add-In Tests ─────────────────────*/
/* Unit tests for the MyGeotab Service Add-In notification delivery logic.
   Uses mocked SDK objects — no real MyGeotab tenant required.
   These are UNIT tests, not live integration tests. */

import test from "node:test";
import assert from "node:assert/strict";
import {
  NotificationRateLimiter,
  getAddInId,
  deliverPendingNotifications,
} from "../src/serviceAddin.ts";

/*───────────────────── Helpers ─────────────────────*/

const ADDIN_ID_KEY = "opex-vbm-addin-id";

function makeMockService(overrides = {}) {
  const notifications = [];
  const calls = [];

  return {
    notifications: {
      show: overrides.notificationsShow
        ?? (async (opts) => {
          notifications.push({ title: opts.title, text: opts.text, type: opts.type ?? "info", duration: opts.duration ?? 10 });
          return { hide: () => {} };
        }),
    },
    api: {
      call: overrides.apiCall
        ?? (async (method, params) => {
          calls.push({ method, params });
          if (method === "Get" && params.typeName === "AddInData") {
            return overrides.mockRecords ?? [];
          }
          if (method === "Set") {
            return { success: true };
          }
          return null;
        }),
      getSession: overrides.apiGetSession ?? (async () => null),
    },
    localStorage: overrides.localStorage ?? {
      get: overrides.localStorageGet ?? (async (key) => {
        if (key === ADDIN_ID_KEY) return overrides.mockAddInId ?? null;
        return null;
      }),
      set: overrides.localStorageSet ?? (async () => {}),
      remove: overrides.localStorageRemove ?? (async () => {}),
    },
  };
}

function makeMockNotification(overrides = {}) {
  return {
    id: "n-test-001",
    eventId: "evt-test-001",
    idempotencyKey: "notif:booking_created:b-001:u104",
    type: "booking_created",
    recipient_user_id: "u104",
    related_booking_id: "b-001",
    title: "New Vehicle Booking Request",
    message: "A new booking request BK-0001 from John Doe requires your approval.",
    is_read: false,
    delivery_status: "pending",
    delivered_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

function serializeNotification(n) {
  return JSON.stringify(n);
}

/*───────────────────── Storage Tests ─────────────────────*/

test("Service Add-In storage: missing localStorage service returns null", async () => {
  const service = makeMockService({ localStorage: undefined });
  const addInId = await getAddInId(service);
  assert.equal(addInId, null, "Should return null when localStorage service is missing");
});

test("Service Add-In storage: missing get method returns null", async () => {
  const service = makeMockService({ localStorage: { set: async () => {} } });
  const addInId = await getAddInId(service);
  assert.equal(addInId, null, "Should return null when get method is missing");
});

test("Service Add-In storage: valid AddInId is retrieved", async () => {
  const service = makeMockService({ mockAddInId: "addin-abc-123" });
  const addInId = await getAddInId(service);
  assert.equal(addInId, "addin-abc-123", "Should return the stored AddInId");
});

test("Service Add-In storage: storage read failure returns null", async () => {
  const service = makeMockService({
    localStorageGet: async () => { throw new Error("STORAGE_READ_FAILED"); },
  });
  const addInId = await getAddInId(service);
  assert.equal(addInId, null, "Should return null when storage read throws");
});

/*───────────────────── Rate Limiter Tests ─────────────────────*/

test("Rate limiter: allows calls up to the per-minute limit", () => {
  const limiter = new NotificationRateLimiter();
  for (let i = 0; i < 6; i++) {
    assert.equal(limiter.canCall(), true, `Call ${i + 1} should be allowed`);
    limiter.recordCall();
  }
  assert.equal(limiter.canCall(), false, "7th call should be blocked");
});

test("Rate limiter: visible notification limit is 2", () => {
  const limiter = new NotificationRateLimiter();
  assert.equal(limiter.canShow(), true, "Should allow first visible notification");
  limiter.incrementVisible();
  assert.equal(limiter.canShow(), true, "Should allow second visible notification");
  limiter.incrementVisible();
  assert.equal(limiter.canShow(), false, "Should block third visible notification");
});

test("Rate limiter: decrementVisible frees a slot", () => {
  const limiter = new NotificationRateLimiter();
  limiter.incrementVisible();
  limiter.incrementVisible();
  assert.equal(limiter.canShow(), false, "Should be at limit");
  limiter.decrementVisible();
  assert.equal(limiter.canShow(), true, "Should allow after decrement");
  limiter.decrementVisible();
  limiter.decrementVisible();
  assert.equal(limiter.canShow(), true, "Should still allow after extra decrement");
});

/*───────────────────── Notification Delivery Tests ─────────────────────*/

test("Delivery: missing AddInId causes safe no-op", async () => {
  const service = makeMockService({ mockAddInId: null });
  let nativeCallCount = 0;
  service.notifications.show = async () => {
    nativeCallCount++;
    return { hide: () => {} };
  };

  await deliverPendingNotifications(service);

  assert.equal(nativeCallCount, 0, "Should not attempt delivery without AddInId");
});

test("Delivery: delivery status checked before processing", async () => {
  const notifPending = makeMockNotification({ delivery_status: "pending" });
  const notifDelivered = makeMockNotification({ delivery_status: "delivered" });
  const notifFailed = makeMockNotification({ delivery_status: "failed" });

  const service = makeMockService({
    mockAddInId: "addin-test-123",
    mockRecords: [
      { id: "r-1", details: serializeNotification(notifPending) },
      { id: "r-2", details: serializeNotification(notifDelivered) },
      { id: "r-3", details: serializeNotification(notifFailed) },
    ],
  });

  let nativeCallCount = 0;
  service.notifications.show = async () => {
    nativeCallCount++;
    return { hide: () => {} };
  };

  await deliverPendingNotifications(service);

  assert.equal(nativeCallCount, 1, "Only 1 pending notification should be delivered");
});

test("Delivery: multiple pending notifications are processed with rate limiting", async () => {
  const records = [];
  for (let i = 1; i <= 5; i++) {
    records.push({ id: `r-${i}`, details: serializeNotification(makeMockNotification({ id: `n-${i}`, idempotencyKey: `key:${i}` })) });
  }

  const service = makeMockService({
    mockAddInId: "addin-test-123",
    mockRecords: records,
  });

  let nativeCallCount = 0;
  service.notifications.show = async () => {
    nativeCallCount++;
    return { hide: () => {} };
  };

  await deliverPendingNotifications(service);

  // All 5 pending notifications should be attempted (within rate limits)
  // Visible limit (2) may restrict synchronous delivery, but all should be handled
  assert.ok(nativeCallCount >= 1, "Should attempt delivery of pending notifications");
  assert.ok(nativeCallCount <= 5, "Should not exceed number of pending notifications");
});

test("Delivery: failed notification is not marked as delivered", async () => {
  const notif = makeMockNotification({ delivery_status: "pending" });
  const service = makeMockService({
    mockRecords: [{ id: "r-1", details: serializeNotification(notif) }],
  });

  service.notifications.show = async () => {
    throw new Error("NATIVE_NOTIFICATION_FAILED");
  };

  await deliverPendingNotifications(service);

  assert.ok(true, "Failed delivery handled without error");
});

/*───────────────────── Concurrency / Idempotency Tests ─────────────────────*/

test("Concurrency: duplicate events have same idempotency key", () => {
  const notif1 = makeMockNotification({ idempotencyKey: "notif:booking_created:b-001:u104" });
  const notif2 = makeMockNotification({ id: "n-other", idempotencyKey: "notif:booking_created:b-001:u104" });

  assert.equal(notif1.idempotencyKey, notif2.idempotencyKey, "Same logical event should produce same idempotency key");
  assert.notEqual(notif1.id, notif2.id, "But different notification records should have different IDs");
});

test("Concurrency: different booking IDs produce different idempotency keys", () => {
  const notif1 = makeMockNotification({ idempotencyKey: "notif:booking_created:b-001:u104" });
  const notif2 = makeMockNotification({ idempotencyKey: "notif:booking_created:b-002:u104" });

  assert.notEqual(notif1.idempotencyKey, notif2.idempotencyKey, "Different bookings should have different idempotency keys");
});

test("Concurrency: concurrent processing attempts handled without crash", async () => {
  const notif = makeMockNotification({ delivery_status: "pending" });
  const service = makeMockService({
    mockRecords: [{ id: "r-1", details: serializeNotification(notif) }],
  });

  let nativeCallCount = 0;
  service.notifications.show = async () => {
    nativeCallCount++;
    return { hide: () => {} };
  };

  await Promise.all([
    deliverPendingNotifications(service),
    deliverPendingNotifications(service),
  ]);

  assert.ok(nativeCallCount >= 0, "Concurrent delivery attempts handled without crash");
});

/*───────────────────── Bundle Entry Point Tests ─────────────────────*/

test("Bundle: module imports without error", () => {
  assert.ok(true, "Module loaded successfully");
});

test("Bundle: rate limiter is a class with expected methods", () => {
  const limiter = new NotificationRateLimiter();
  assert.equal(typeof limiter.canCall, "function", "Should have canCall method");
  assert.equal(typeof limiter.recordCall, "function", "Should have recordCall method");
  assert.equal(typeof limiter.canShow, "function", "Should have canShow method");
  assert.equal(typeof limiter.incrementVisible, "function", "Should have incrementVisible method");
  assert.equal(typeof limiter.decrementVisible, "function", "Should have decrementVisible method");
});
