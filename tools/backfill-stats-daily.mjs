/**
 * Backfill collection statsDaily từ toàn bộ submissions.
 * Dùng credential Firebase CLI (firebase login) qua Firestore REST API.
 *
 * Chạy:
 *   npm run backfill:stats
 *   npm run backfill:stats -- --dry-run
 */

import {
  PROJECT_ID,
  firestoreRequest,
  listCollectionDocuments,
  toFirestoreFields
} from "./firebase-cli-rest.mjs";

function pad2(value) {
  return String(value).padStart(2, "0");
}

function sanitizeMapKey(value) {
  return String(value || "unknown")
    .trim()
    .replace(/[./~[\]#]/g, "_")
    .slice(0, 120) || "unknown";
}

function getDateKeyFromDate(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function buildStatsDocId(dateKey, khuVuc) {
  return `${dateKey}_${encodeURIComponent(khuVuc || "_")}`;
}

function getDateKeyFromSubmission(submission) {
  if (submission?.createdAtText) {
    const match = String(submission.createdAtText).match(/^(\d{4}-\d{2}-\d{2})/);
    if (match) return match[1];
  }

  if (submission?.createdAt) {
    const date = new Date(submission.createdAt);
    if (!Number.isNaN(date.getTime())) {
      return getDateKeyFromDate(date);
    }
  }

  return null;
}

function getSubmissionSummaryCounts(submission) {
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
    if (answer?.result === "OK") okCount += 1;
    if (answer?.result === "NG") ngCount += 1;
    if (answer?.result === "N/A") naCount += 1;
  });

  return { okCount, ngCount, naCount };
}

function createEmptyBucket(dateKey, khuVuc) {
  return {
    dateKey,
    khuVuc,
    submissionCount: 0,
    okCount: 0,
    ngCount: 0,
    naCount: 0,
    ngByCategory: {},
    ngByQuestion: {},
    ngCategoryLabels: {},
    ngQuestionLabels: {},
    discovererCounts: {},
    discovererNames: {}
  };
}

function addSubmissionToBucket(bucket, submission) {
  const counts = getSubmissionSummaryCounts(submission);

  bucket.submissionCount += 1;
  bucket.okCount += counts.okCount;
  bucket.ngCount += counts.ngCount;
  bucket.naCount += counts.naCount;

  (submission.answers || []).forEach((answer) => {
    if (answer?.result !== "NG") return;

    const categoryKey = sanitizeMapKey(answer.category || "other");
    const questionKey = sanitizeMapKey(answer.questionId || answer.question || "unknown");

    bucket.ngByCategory[categoryKey] = (bucket.ngByCategory[categoryKey] || 0) + 1;
    bucket.ngByQuestion[questionKey] = (bucket.ngByQuestion[questionKey] || 0) + 1;

    if (answer.category) {
      bucket.ngCategoryLabels[categoryKey] = answer.category;
    }
    if (answer.question) {
      bucket.ngQuestionLabels[questionKey] = answer.question;
    }
  });

  if (counts.ngCount > 0) {
    const discovererKey = sanitizeMapKey(submission.uid || submission.taiKhoan || submission.hoTen || "unknown");
    bucket.discovererCounts[discovererKey] = (bucket.discovererCounts[discovererKey] || 0) + counts.ngCount;
    if (submission.hoTen) {
      bucket.discovererNames[discovererKey] = submission.hoTen;
    }
  }
}

function aggregateSubmissions(submissions) {
  const buckets = new Map();
  let skipped = 0;

  submissions.forEach((submission) => {
    const dateKey = getDateKeyFromSubmission(submission);
    const khuVuc = String(submission.khuVuc || "").trim();

    if (!dateKey || !khuVuc) {
      skipped += 1;
      return;
    }

    const docId = buildStatsDocId(dateKey, khuVuc);
    if (!buckets.has(docId)) {
      buckets.set(docId, createEmptyBucket(dateKey, khuVuc));
    }

    addSubmissionToBucket(buckets.get(docId), submission);
  });

  return { buckets, skipped };
}

async function writeStatsDailyDoc(docId, stats, dryRun) {
  const payload = {
    ...stats,
    updatedAt: new Date().toISOString(),
    backfilledAt: new Date().toISOString(),
    source: "firebase-cli-backfill"
  };

  if (dryRun) {
    console.log(
      `  [dry-run] statsDaily/${docId}: submissions=${stats.submissionCount}, ok=${stats.okCount}, ng=${stats.ngCount}, na=${stats.naCount}`
    );
    return;
  }

  const encodedDocId = encodeURIComponent(docId);
  await firestoreRequest("PATCH", `statsDaily/${encodedDocId}`, {
    fields: toFirestoreFields(payload)
  });
}

async function backfillStatsDaily() {
  const dryRun = process.argv.includes("--dry-run");

  console.log(`Project: ${PROJECT_ID}`);
  console.log(`Mode: ${dryRun ? "DRY RUN" : "WRITE"}`);
  console.log("Đang đọc submissions qua Firebase CLI token...\n");

  const submissions = await listCollectionDocuments("submissions", 300);
  console.log(`Đã đọc ${submissions.length} submission(s).`);

  const { buckets, skipped } = aggregateSubmissions(submissions);
  console.log(`Tổng hợp thành ${buckets.size} document statsDaily.`);
  if (skipped) {
    console.log(`Bỏ qua ${skipped} submission thiếu dateKey hoặc khuVuc.`);
  }

  let totalSubmissions = 0;
  let totalOk = 0;
  let totalNg = 0;
  let totalNa = 0;

  for (const stats of buckets.values()) {
    totalSubmissions += stats.submissionCount;
    totalOk += stats.okCount;
    totalNg += stats.ngCount;
    totalNa += stats.naCount;
  }

  console.log(
    `Tổng sau aggregate: ${totalSubmissions} phiếu, OK=${totalOk}, NG=${totalNg}, N/A=${totalNa}\n`
  );

  let written = 0;
  for (const [docId, stats] of buckets.entries()) {
    await writeStatsDailyDoc(docId, stats, dryRun);
    written += 1;
  }

  console.log(`\nHoàn tất: ${written} document statsDaily ${dryRun ? "(chưa ghi)" : "đã cập nhật"}.`);
}

backfillStatsDaily().catch((error) => {
  console.error("Backfill thất bại:", error.message);
  process.exit(1);
});
