// lediary の Cloud Functions。HTTP API は rarejob-plus-api Cloud Run に統合済みなので、
// このファイルに残るのは Cloud Scheduler 駆動の毎朝のプッシュ通知だけ。

import { onSchedule } from "firebase-functions/v2/scheduler";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";

initializeApp();
const db = getFirestore();

// ─── Push notification scheduler ───
// 毎朝 7:00 JST に発火。push_tokens 全件を取り、ユーザごとに未習得カードを数えて
// due > 0 なら FCM 通知を送る。死んだトークンは GC する。
export const sendDailyReminder = onSchedule(
  { schedule: "0 22 * * *", region: "asia-northeast1", timeZone: "Asia/Tokyo" },
  async () => {
    const now = Date.now();

    const tokensSnap = await db.collection("push_tokens").get();
    if (tokensSnap.empty) return;

    const userTokens = new Map<string, string[]>();
    for (const doc of tokensSnap.docs) {
      const data = doc.data();
      const tokens = userTokens.get(data.userId) || [];
      tokens.push(data.token);
      userTokens.set(data.userId, tokens);
    }

    const messaging = getMessaging();

    for (const [userId, tokens] of userTokens) {
      const bookmarksSnap = await db.collection("rjplus_users").doc(userId).collection("bookmarks")
        .where("mastered", "!=", true)
        .get();
      const dueCount = bookmarksSnap.docs.filter((d) => {
        const data = d.data();
        return !data.nextReviewAt || data.nextReviewAt <= now;
      }).length;

      if (dueCount === 0) continue;

      const response = await messaging.sendEachForMulticast({
        tokens,
        notification: {
          title: "Flashcards",
          body: `${dueCount}枚のカードが復習待ちです`,
        },
        webpush: {
          fcmOptions: { link: "https://rjplus-flashcards.web.app" },
        },
      });

      response.responses.forEach((resp, i) => {
        if (resp.error?.code === "messaging/registration-token-not-registered" ||
            resp.error?.code === "messaging/invalid-registration-token") {
          db.collection("push_tokens").doc(tokens[i]!).delete().catch(() => {});
        }
      });
    }
  },
);
