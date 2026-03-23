import { test, expect } from "@playwright/test";

// Helper: open the app, start camera, fill name, join the room.
async function joinAs(page, name, room = "test-room") {
  await page.goto("/");
  await expect(page.locator("#joinScreen")).toBeVisible();

  await page.click("#camBtn");
  await expect(page.locator("#joinBtn")).toBeEnabled({ timeout: 10_000 });

  await page.fill("#nameIn", name);
  await page.fill("#roomIn", room);
  await page.click("#joinBtn");

  await expect(page.locator("#meetingScreen")).toHaveClass(/active/, { timeout: 10_000 });
}

// ─────────────────────────────────────────────
//  BASIC FLOW
// ─────────────────────────────────────────────

test.describe("Join & Leave", () => {
  test("loads the join screen", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator(".join-card h1")).toHaveText("Video Conference");
    await expect(page.locator("#joinBtn")).toBeDisabled();
  });

  test("can start camera and enable join button", async ({ page }) => {
    await page.goto("/");
    await page.click("#camBtn");
    await expect(page.locator("#joinBtn")).toBeEnabled({ timeout: 10_000 });
  });

  test("joins a meeting and shows meeting screen", async ({ page }) => {
    await joinAs(page, "Alice");
    await expect(page.locator("#roomLabel")).toHaveText("test-room");
    await expect(page.locator("#peerCount")).toContainText("1 participant");
    await expect(page.locator("#localVid")).toBeVisible();
  });

  test("can leave the meeting", async ({ page }) => {
    await joinAs(page, "Alice");
    await page.click(".cb.leave");
    await expect(page.locator("#joinScreen")).toBeVisible();
  });
});

// ─────────────────────────────────────────────
//  TWO PEERS
// ─────────────────────────────────────────────

test.describe("Two Peers", () => {
  test("two users see each other", async ({ browser }) => {
    const ctx1 = await browser.newContext({
      permissions: ["camera", "microphone"],
      launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
    });
    const ctx2 = await browser.newContext({
      permissions: ["camera", "microphone"],
      launchOptions: { args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] },
    });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await joinAs(page1, "Alice", "e2e-room");
    await joinAs(page2, "Bob", "e2e-room");

    // Both should see 2 participants
    await expect(page1.locator("#peerCount")).toContainText("2", { timeout: 10_000 });
    await expect(page2.locator("#peerCount")).toContainText("2", { timeout: 10_000 });

    // Page1 should see Bob's video tile
    await expect(page1.locator(".tile:not(.local)")).toBeVisible({ timeout: 10_000 });
    // Page2 should see Alice's video tile
    await expect(page2.locator(".tile:not(.local)")).toBeVisible({ timeout: 10_000 });

    await ctx1.close();
    await ctx2.close();
  });

  test("peer leaving updates the count", async ({ browser }) => {
    const ctx1 = await browser.newContext({ permissions: ["camera", "microphone"] });
    const ctx2 = await browser.newContext({ permissions: ["camera", "microphone"] });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await joinAs(page1, "Alice", "leave-room");
    await joinAs(page2, "Bob", "leave-room");

    await expect(page1.locator("#peerCount")).toContainText("2", { timeout: 10_000 });

    // Bob leaves
    await page2.click(".cb.leave");

    // Alice should see 1 participant
    await expect(page1.locator("#peerCount")).toContainText("1", { timeout: 10_000 });

    await ctx1.close();
    await ctx2.close();
  });
});

// ─────────────────────────────────────────────
//  CHAT
// ─────────────────────────────────────────────

test.describe("Chat", () => {
  test("can send and receive chat messages", async ({ browser }) => {
    const ctx1 = await browser.newContext({ permissions: ["camera", "microphone"] });
    const ctx2 = await browser.newContext({ permissions: ["camera", "microphone"] });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await joinAs(page1, "Alice", "chat-room");
    await joinAs(page2, "Bob", "chat-room");

    // Wait for peers to connect
    await expect(page1.locator("#peerCount")).toContainText("2", { timeout: 10_000 });

    // Alice opens chat and sends a message
    await page1.click("#chatBtn");
    await page1.fill("#chatIn", "Hello Bob!");
    await page1.click(".csend");

    // Bob should see the chat badge (unread dot)
    await expect(page2.locator("#chatBtn.has-dot")).toBeVisible({ timeout: 5_000 });

    // Bob opens chat and sees the message
    await page2.click("#chatBtn");
    await expect(page2.locator(".msgs")).toContainText("Hello Bob!", { timeout: 5_000 });

    await ctx1.close();
    await ctx2.close();
  });
});

// ─────────────────────────────────────────────
//  MIC & CAMERA TOGGLE
// ─────────────────────────────────────────────

test.describe("Media Controls", () => {
  test("toggling mic changes button state", async ({ page }) => {
    await joinAs(page, "Alice");

    await expect(page.locator("#micBtn")).toHaveClass(/on/);
    await page.click("#micBtn");
    await expect(page.locator("#micBtn")).toHaveClass(/off/);
    await page.click("#micBtn");
    await expect(page.locator("#micBtn")).toHaveClass(/on/);
  });

  test("toggling camera shows avatar overlay", async ({ page }) => {
    await joinAs(page, "Alice");

    await page.click("#camCtrl");
    await expect(page.locator("#localTile .cam-off")).toBeVisible();
    await expect(page.locator("#localTile .avatar")).toHaveText("A");

    await page.click("#camCtrl");
    await expect(page.locator("#localTile .cam-off")).not.toBeVisible();
  });

  test("remote peer sees mute indicator", async ({ browser }) => {
    const ctx1 = await browser.newContext({ permissions: ["camera", "microphone"] });
    const ctx2 = await browser.newContext({ permissions: ["camera", "microphone"] });

    const page1 = await ctx1.newPage();
    const page2 = await ctx2.newPage();

    await joinAs(page1, "Alice", "mute-room");
    await joinAs(page2, "Bob", "mute-room");

    await expect(page1.locator("#peerCount")).toContainText("2", { timeout: 10_000 });

    // Bob mutes mic
    await page2.click("#micBtn");

    // Alice should see mute indicator on Bob's tile
    await expect(page1.locator(".tile:not(.local) .mic-x")).toBeVisible({ timeout: 5_000 });

    await ctx1.close();
    await ctx2.close();
  });
});

// ─────────────────────────────────────────────
//  HEALTH CHECK
// ─────────────────────────────────────────────

test("health endpoint returns ok", async ({ request }) => {
  const res = await request.get("/healthz");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.ok).toBe(true);
});
