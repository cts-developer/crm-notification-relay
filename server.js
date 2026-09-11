/**
 * FREE FCM Push Relay — replacement for Firebase Cloud Functions
 * ─────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 * Firebase Cloud Functions (the old cloud_functions/functions/index.js in
 * this repo) can ONLY be deployed on the Blaze (pay-as-you-go) plan, which
 * forces you to add a credit card — even if you never get charged.
 *
 * Sending a push notification via FCM itself is 100% FREE, forever, on
 * every Firebase plan (Spark included). The only thing that costs money is
 * *deploying code to Firebase's own servers* (Cloud Functions). So instead
 * of deploying to Firebase, we run this exact same logic on a free host
 * (Render.com free Web Service — no card required) that talks to Firestore
 * and FCM directly using the Admin SDK.
 *
 * HOW IT WORKS
 * The Flutter app writes a doc to `fcmQueue/{autoId}` whenever a
 * notification-worthy event happens (see notification_service.dart).
 * This server keeps a realtime Firestore listener open on that collection,
 * looks up the target user's fcmToken, sends the push, then deletes the
 * queue doc — identical behaviour to the old Cloud Function.
 *
 * DEPLOY (see README.md for the full step-by-step guide)
 * 1. Push this folder to a GitHub repo.
 * 2. Create a free Web Service on render.com pointing at that repo.
 * 3. Set the FIREBASE_SERVICE_ACCOUNT env var (see README).
 * 4. Ping the /health URL every 5-10 min with cron-job.org (free) so the
 *    free instance doesn't go to sleep.
 */

const express = require("express");
const admin = require("firebase-admin");

// ── Load the service account from an env var (never commit the JSON file) ───
let serviceAccount;
try {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT env var is not set");
  serviceAccount = JSON.parse(raw);
} catch (e) {
  console.error("❌ Could not parse FIREBASE_SERVICE_ACCOUNT:", e.message);
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const app = express();

// ── Health check endpoint — this is what cron-job.org pings to keep the
//    free Render instance awake and to verify the relay is alive ────────────
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", time: new Date().toISOString() });
});
app.get("/", (req, res) => res.redirect("/health"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Relay listening on port ${PORT}`));

// ── Core logic: same as the old Cloud Function, just running here instead ───
async function processQueueDoc(snap) {
  const data = snap.data();
  const { targetUid, title, body, ticketId, ticketDocId } = data || {};

  // Clean up the queue doc immediately (even if push fails), so it never
  // gets processed twice or piles up.
  await snap.ref.delete().catch((e) =>
    console.error(`Failed to delete queue doc ${snap.id}:`, e.message)
  );

  if (!targetUid || !title || !body) return;

  let fcmToken;
  try {
    const userDoc = await db.collection("users").doc(targetUid).get();
    fcmToken = userDoc.data()?.fcmToken;
  } catch (e) {
    console.error(`Failed to read user doc for ${targetUid}:`, e.message);
    return;
  }

  if (!fcmToken) {
    console.log(`No FCM token for uid=${targetUid} — skipping push`);
    return;
  }

  const message = {
    token: fcmToken,
    notification: { title, body },
    data: {
      ticketId: ticketId ?? "",
      ticketDocId: ticketDocId ?? "",
      click_action: "FLUTTER_NOTIFICATION_CLICK",
    },
    android: {
      priority: "high",
      notification: {
        sound: "default",
        channelId: "ticket_notifications", // must match the Flutter app's channel
      },
    },
    apns: {
      payload: { aps: { sound: "default", badge: 1 } },
    },
  };

  try {
    const response = await admin.messaging().send(message);
    console.log(`✅ Push sent to ${targetUid}: ${response}`);
  } catch (e) {
    if (
      e.code === "messaging/registration-token-not-registered" ||
      e.code === "messaging/invalid-registration-token"
    ) {
      console.warn(`Stale FCM token for ${targetUid} — clearing`);
      await db.collection("users").doc(targetUid).update({ fcmToken: null });
    } else {
      console.error(`FCM send failed for ${targetUid}:`, e.message);
    }
  }
}

// ── Realtime listener on fcmQueue — fires within ~1 second of a new doc ─────
console.log("👂 Listening for new docs in fcmQueue …");
db.collection("fcmQueue").onSnapshot(
  (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        processQueueDoc(change.doc).catch((e) =>
          console.error("Error processing queue doc:", e)
        );
      }
    });
  },
  (err) => {
    console.error("fcmQueue listener error:", err);
  }
);

// ── Safety net: also sweep any doc older than 2 minutes every 5 minutes.
//    Covers the rare case where the realtime listener reconnects and misses
//    an event during a Render cold-start. ────────────────────────────────────
setInterval(async () => {
  try {
    const twoMinAgo = admin.firestore.Timestamp.fromMillis(
      Date.now() - 2 * 60 * 1000
    );
    const stale = await db
      .collection("fcmQueue")
      .where("createdAt", "<=", twoMinAgo)
      .get();
    for (const doc of stale.docs) {
      await processQueueDoc(doc);
    }
  } catch (e) {
    console.error("Sweep error:", e.message);
  }
}, 5 * 60 * 1000);
