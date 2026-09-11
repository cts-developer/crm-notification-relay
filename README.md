# Free Push Notification Relay (No Blaze Plan, No Card)

Cloud Functions ke liye Firebase **hamesha** Blaze plan (card) maangta hai —
chahe aap free quota ke andar hi rahen. Lekin FCM se push **bhejna** khud
bilkul FREE hai, kisi bhi plan pe, hamesha. Toh idea simple hai: Cloud
Function ko Firebase pe deploy karne ke bajaye, wahi code kisi FREE server
(Render.com) pe chala do — bina card ke.

## Kya karega ye server
- `fcmQueue` collection ko real-time watch karega (jaise Cloud Function karta tha)
- Naya doc aate hi target user ka `fcmToken` Firestore se nikaal ke FCM push bhej dega
- Phir queue doc delete kar dega

Isse **koi Flutter code change nahi karna** — `notification_service.dart`
pehle jaisa hi kaam karega, bas push ab Firebase Functions ki jagah is
relay se jayega.

---

## STEP 1 — Firebase Service Account Key nikaalo (Free, no card)

1. https://console.firebase.google.com kholo → apna project (`crm-app-17145`)
2. ⚙️ Settings → **Project settings** → **Service accounts** tab
3. **Generate new private key** button dabao → ek `.json` file download hogi
4. Ye file kisi ko mat dena, GitHub pe bhi commit mat karna — isko hum sirf
   Render ke "Environment Variable" mein paste karenge (Step 4)

## STEP 2 — Is code ko GitHub pe daalo

1. https://github.com pe naya **private** repo banao, e.g. `crm-notification-relay`
2. Is `notification-relay` folder (jo maine banayi hai) ko us repo mein push karo:
   ```bash
   cd notification-relay
   git init
   git add .
   git commit -m "free fcm relay"
   git branch -M main
   git remote add origin https://github.com/<your-username>/crm-notification-relay.git
   git push -u origin main
   ```

## STEP 3 — Render.com pe free deploy karo (bina card ke)

1. https://render.com pe jao → **Get Started** → GitHub se sign up karo
   (card kahin nahi maangega)
2. Dashboard mein **New +** → **Web Service**
3. Apna `crm-notification-relay` GitHub repo select/connect karo
4. Settings:
   - **Name:** `crm-notification-relay` (ya kuch bhi)
   - **Region:** jo bhi nazdeek ho (Singapore best for India)
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** **Free**
5. Abhi deploy mat karo — pehle env variable set karna hai (Step 4)

## STEP 4 — Service Account JSON ko Environment Variable mein daalo

1. Render service page → **Environment** tab → **Add Environment Variable**
2. Key: `FIREBASE_SERVICE_ACCOUNT`
3. Value: Step 1 mein jo `.json` file download hui thi, **uska pura content**
   ek hi line mein copy-paste kar do (poora JSON `{...}` including curly braces)
4. **Save Changes** → Render khud rebuild + deploy kar dega

## STEP 5 — Test karo

1. Render dashboard → **Logs** tab kholo, ye dikhna chahiye:
   ```
   Relay listening on port 10000
   👂 Listening for new docs in fcmQueue …
   ```
2. Apne app se ek naya ticket create karo (customer ki taraf se)
3. Logs mein turant dikhega: `✅ Push sent to <uid>: projects/.../messages/...`
4. Admin/employee ke phone pe notification aani chahiye 🎉

## STEP 6 — Server ko "sona" (sleep) na dene do (Free tier limitation)

Render ka FREE web service 15 min tak koi request na aane par so jaata hai,
aur wapas uthne mein ~30-60 sec lagte hain. Isse bachne ke liye ek FREE
uptime pinger use karo:

1. https://cron-job.org pe free account banao (koi card nahi)
2. Naya cronjob banao:
   - URL: `https://<your-render-app>.onrender.com/health`
   - Interval: **every 5 minutes**
3. Save karo — bas, ab server active rahega aur notifications turant (~1-2
   second) mein aayengi.

> Note: Render free tier 750 hours/month deta hai — ek hi service 24x7
> chalane ke liye kaafi hai, bilkul free, bina card ke.

---

## FAQ

**Q: Kya ye sach me free hai, hidden charge toh nahi?**
FCM push bhejna hamesha free hai (koi plan ho). Render free tier bhi bina
card ke hai — limit cross hone par charge nahi hota, service bas pause ho
jaati hai. cron-job.org bhi free hai.

**Q: Purana `cloud_functions/functions/index.js` ka kya karu?**
Usko deploy mat karo (usse Blaze maangega). Chaho toh rakh sakte ho as
backup/reference, ya delete kar do — is naye relay ne uski jagah le li hai.

**Q: Agar future me paise kama ke Blaze afford ho jaye?**
Tab bas is relay ko band karke asli Cloud Function deploy kar dena —
Flutter app ka code bilkul same rahega, kyunki dono `fcmQueue` collection
ka hi structure use karte hain.
