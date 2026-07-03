import {
  db,
  doc,
  setDoc,
  collection,
  query,
  where,
  orderBy,
  getDocs,
  serverTimestamp,
  increment
} from "./firebase-config.js";

export const STATS_DAILY_COLLECTION = "statsDaily";

function pad2(value) {
  return String(value).padStart(2, "0");
}

export function sanitizeMapKey(value) {
  return String(value || "unknown")
    .trim()
    .replace(/[./~[\]#]/g, "_")
    .slice(0, 120) || "unknown";
}

export function getDateKeyFromDate(date = new Date()) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function buildStatsDocId(dateKey, khuVuc) {
  return `${dateKey}_${encodeURIComponent(khuVuc || "_")}`;
}

export function getPeriodRange(period, now = new Date()) {
  if (period === "week") {
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    from.setHours(0, 0, 0, 0);
    const to = new Date(now);
    to.setHours(23, 59, 59, 999);
    return { from, to, dateKeyFrom: getDateKeyFromDate(from), dateKeyTo: getDateKeyFromDate(to) };
  }

  if (period === "month") {
    const from = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
    return { from, to, dateKeyFrom: getDateKeyFromDate(from), dateKeyTo: getDateKeyFromDate(to) };
  }

  if (period === "year") {
    const from = new Date(now.getFullYear(), 0, 1, 0, 0, 0, 0);
    const to = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
    return { from, to, dateKeyFrom: getDateKeyFromDate(from), dateKeyTo: getDateKeyFromDate(to) };
  }

  const from = new Date(0);
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  return { from, to, dateKeyFrom: "1970-01-01", dateKeyTo: getDateKeyFromDate(to) };
}

function mergeCountMaps(target, source) {
  if (!source || typeof source !== "object") return;
  Object.entries(source).forEach(([key, value]) => {
    target[key] = (target[key] || 0) + (Number(value) || 0);
  });
}

function mergeLabelMaps(target, source) {
  if (!source || typeof source !== "object") return;
  Object.entries(source).forEach(([key, value]) => {
    if (value) target[key] = value;
  });
}

export function aggregateDailyStats(dailyDocs = []) {
  const result = {
    submissionCount: 0,
    okCount: 0,
    ngCount: 0,
    naCount: 0,
    ngByCategory: {},
    ngByQuestion: {},
    ngCategoryLabels: {},
    ngQuestionLabels: {},
    discovererCounts: {},
    discovererNames: {},
    byDateKey: new Map()
  };

  dailyDocs.forEach((item) => {
    result.submissionCount += Number(item.submissionCount) || 0;
    result.okCount += Number(item.okCount) || 0;
    result.ngCount += Number(item.ngCount) || 0;
    result.naCount += Number(item.naCount) || 0;

    mergeCountMaps(result.ngByCategory, item.ngByCategory);
    mergeCountMaps(result.ngByQuestion, item.ngByQuestion);
    mergeLabelMaps(result.ngCategoryLabels, item.ngCategoryLabels);
    mergeLabelMaps(result.ngQuestionLabels, item.ngQuestionLabels);
    mergeCountMaps(result.discovererCounts, item.discovererCounts);
    mergeLabelMaps(result.discovererNames, item.discovererNames);

    if (!item.dateKey) return;

    const existing = result.byDateKey.get(item.dateKey) || { ngCount: 0, submissionCount: 0 };
    existing.ngCount += Number(item.ngCount) || 0;
    existing.submissionCount += Number(item.submissionCount) || 0;
    result.byDateKey.set(item.dateKey, existing);
  });

  return result;
}

export function getSubmissionSummaryCounts(submission) {
  const summary = submission?.summary;
  if (summary && typeof summary === "object") {
    return {
      okCount: Number(summary.okCount) || 0,
      ngCount: Number(summary.ngCount) || 0,
      naCount: Number(summary.naCount) || 0
    };
  }

  let okCount = 0;
  let ngCount = 0;
  let naCount = 0;

  (submission?.answers || []).forEach((answer) => {
    if (answer.result === "OK") okCount += 1;
    if (answer.result === "NG") ngCount += 1;
    if (answer.result === "N/A") naCount += 1;
  });

  return { okCount, ngCount, naCount };
}

export function aggregateFromSubmissions(submissions = []) {
  const result = aggregateDailyStats([]);

  submissions.forEach((submission) => {
    const counts = getSubmissionSummaryCounts(submission);
    result.submissionCount += 1;
    result.okCount += counts.okCount;
    result.ngCount += counts.ngCount;
    result.naCount += counts.naCount;

    const dateKey = getDateKeyFromSubmission(submission);
    if (dateKey) {
      const existing = result.byDateKey.get(dateKey) || { ngCount: 0, submissionCount: 0 };
      existing.ngCount += counts.ngCount;
      existing.submissionCount += 1;
      result.byDateKey.set(dateKey, existing);
    }

    (submission.answers || []).forEach((answer) => {
      if (answer.result !== "NG") return;

      const categoryKey = sanitizeMapKey(answer.category || "other");
      const questionKey = sanitizeMapKey(answer.questionId || answer.question || "unknown");
      result.ngByCategory[categoryKey] = (result.ngByCategory[categoryKey] || 0) + 1;
      result.ngByQuestion[questionKey] = (result.ngByQuestion[questionKey] || 0) + 1;
      if (answer.category) {
        result.ngCategoryLabels[categoryKey] = answer.category;
      }
      if (answer.question) {
        result.ngQuestionLabels[questionKey] = answer.question;
      }
    });

    if (counts.ngCount > 0) {
      const discovererKey = sanitizeMapKey(submission.uid || submission.taiKhoan || submission.hoTen || "unknown");
      result.discovererCounts[discovererKey] = (result.discovererCounts[discovererKey] || 0) + counts.ngCount;
      if (submission.hoTen) {
        result.discovererNames[discovererKey] = submission.hoTen;
      }
    }
  });

  return result;
}

export function getDateKeyFromSubmission(submission) {
  if (submission?.createdAtText) {
    const match = String(submission.createdAtText).match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }

  if (submission?.createdAt?.toDate) {
    return getDateKeyFromDate(submission.createdAt.toDate());
  }

  if (submission?.createdAt?.seconds != null) {
    return getDateKeyFromDate(new Date(submission.createdAt.seconds * 1000));
  }

  return null;
}

export async function incrementDailyStats({ khuVuc, summary, ngAnswers = [], uid, hoTen }) {
  const dateKey = getDateKeyFromDate(new Date());
  const docId = buildStatsDocId(dateKey, khuVuc);
  const ref = doc(db, STATS_DAILY_COLLECTION, docId);

  const updates = {
    dateKey,
    khuVuc: khuVuc || "",
    submissionCount: increment(1),
    okCount: increment(Number(summary?.okCount) || 0),
    ngCount: increment(Number(summary?.ngCount) || 0),
    naCount: increment(Number(summary?.naCount) || 0),
    updatedAt: serverTimestamp()
  };

  ngAnswers.forEach((answer) => {
    const categoryKey = sanitizeMapKey(answer.category || "other");
    const questionKey = sanitizeMapKey(answer.questionId || answer.question || "unknown");
    updates[`ngByCategory.${categoryKey}`] = increment(1);
    updates[`ngByQuestion.${questionKey}`] = increment(1);
    if (answer.category) {
      updates[`ngCategoryLabels.${categoryKey}`] = String(answer.category).slice(0, 200);
    }
    if (answer.question) {
      updates[`ngQuestionLabels.${questionKey}`] = String(answer.question).slice(0, 500);
    }
  });

  const ngTotal = Number(summary?.ngCount) || 0;
  if (uid && ngTotal > 0) {
    const discovererKey = sanitizeMapKey(uid);
    updates[`discovererCounts.${discovererKey}`] = increment(ngTotal);
    updates[`discovererNames.${discovererKey}`] = hoTen || "";
  }

  await setDoc(ref, updates, { merge: true });
}

export async function fetchDailyStatsInRange({ khuVuc, dateKeyFrom, dateKeyTo }) {
  const constraints = [where("dateKey", ">=", dateKeyFrom), where("dateKey", "<=", dateKeyTo), orderBy("dateKey", "asc")];

  if (khuVuc && khuVuc !== "ALL") {
    constraints.unshift(where("khuVuc", "==", khuVuc));
  }

  const snapshot = await getDocs(query(collection(db, STATS_DAILY_COLLECTION), ...constraints));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}
