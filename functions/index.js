/**
 * saveCurriculum
 * ----------------------------------------------------------------------
 * "강좌 관리" 화면에서 저장을 누르면 브라우저는 이 Cloud Function을 호출합니다.
 * GitHub Personal Access Token은 이 서버 코드(Secret Manager)에만 존재하며,
 * 브라우저(localStorage 등)에는 절대 내려가지 않습니다.
 *
 * 보안 구조:
 *  1) Firebase Authentication 로그인 여부는 Cloud Functions가 자동으로 검증합니다
 *     (onCall 함수는 request.auth 가 없으면 인증되지 않은 호출입니다).
 *  2) GitHub 토큰은 `firebase functions:secrets:set GITHUB_TOKEN` 로 등록한
 *     Secret Manager 값을 사용하며, 코드에는 절대 하드코딩하지 않습니다.
 * ----------------------------------------------------------------------
 */

const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");

if (!admin.apps.length) admin.initializeApp();

const GITHUB_TOKEN = defineSecret("GITHUB_TOKEN");

const GH_OWNER = "khmass-liturgy";
const GH_REPO = "cg";
const GH_FILE = "curriculum.json";
const GH_API = `https://api.github.com/repos/${GH_OWNER}/${GH_REPO}/contents/${GH_FILE}`;

// 운영자로 인정할 구글 계정 이메일 — 브라우저 쪽 목록과 반드시 동일하게 유지하세요.
// (여기가 진짜 권한 검사입니다. 클라이언트 쪽 목록은 화면 표시용일 뿐 보안 경계가 아닙니다.)
const ADMIN_EMAILS = ["trsumun@daum.net", "trsumun@gmail.com"];

exports.saveCurriculum = onCall(
  {
    secrets: [GITHUB_TOKEN],
    // 필요에 맞게 조정하세요. 기본값(us-central1)을 쓰려면 이 줄을 지우세요.
    // region: "asia-northeast3",
  },
  async (request) => {
    // 1) 로그인 여부 확인 — Firebase가 ID 토큰을 검증한 뒤 request.auth 를 채워줍니다.
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "로그인이 필요합니다. 다시 로그인 후 시도해주세요."
      );
    }

    // 2) 로그인한 구글 계정이 운영자 허용 목록에 있는지 확인 (실제 권한 경계)
    const callerEmail = (request.auth.token.email || "").toLowerCase();
    if (!ADMIN_EMAILS.includes(callerEmail)) {
      logger.warn("허용되지 않은 계정의 저장 시도", { email: callerEmail });
      throw new HttpsError(
        "permission-denied",
        "이 계정은 운영자로 등록되어 있지 않습니다."
      );
    }

    const data = request.data;
    if (!data || typeof data !== "object") {
      throw new HttpsError("invalid-argument", "저장할 데이터가 올바르지 않습니다.");
    }

    // 저장 가능한 필드만 화이트리스트로 추림 (임의 필드 주입 방지)
    const payload = {
      videos: data.videos && typeof data.videos === "object" ? data.videos : {},
      scores: data.scores && typeof data.scores === "object" ? data.scores : {},
      titles: data.titles && typeof data.titles === "object" ? data.titles : {},
      extraCourses: Array.isArray(data.extraCourses) ? data.extraCourses : [],
    };

    const token = GITHUB_TOKEN.value();
    const headers = {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "khcg-cg-cloud-function",
    };

    // 2) 현재 파일의 sha 조회 (업데이트 시 GitHub API가 요구함, 최초 생성이면 없을 수 있음)
    let sha;
    try {
      const getRes = await fetch(GH_API, { headers });
      if (getRes.ok) {
        const cur = await getRes.json();
        sha = cur.sha;
      } else if (getRes.status !== 404) {
        logger.warn("curriculum.json sha 조회 실패", { status: getRes.status });
      }
    } catch (e) {
      logger.warn("curriculum.json sha 조회 오류", e);
    }

    const content = JSON.stringify(payload, null, 2);
    const encoded = Buffer.from(content, "utf-8").toString("base64");

    const who = request.auth.token.email || request.auth.uid;
    const body = {
      message: `Update curriculum ${new Date().toISOString().slice(0, 16).replace("T", " ")} (by ${who})`,
      content: encoded,
      ...(sha ? { sha } : {}),
    };

    // 3) 실제 커밋 (PUT)
    const putRes = await fetch(GH_API, {
      method: "PUT",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!putRes.ok) {
      const errText = await putRes.text();
      logger.error("GitHub 저장 실패", { status: putRes.status, errText });
      const msg =
        putRes.status === 401 || putRes.status === 403
          ? "GitHub 토큰 권한이 없습니다. Secret을 다시 확인해주세요."
          : putRes.status === 404
          ? "저장소 또는 파일을 찾을 수 없습니다."
          : `GitHub 저장 실패 (${putRes.status})`;
      throw new HttpsError("internal", msg);
    }

    logger.info("curriculum.json 저장 완료", { by: who });
    return { ok: true };
  }
);

function requireAdmin(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "운영자 로그인이 필요합니다.");
  }
  const email = (request.auth.token.email || "").toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    throw new HttpsError("permission-denied", "이 계정은 월례발표회 저장 권한이 없습니다.");
  }
  return email;
}

function text(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function recitalMonth(value) {
  const month = text(value, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new HttpsError("invalid-argument", "월례발표회 월 형식이 올바르지 않습니다.");
  }
  return month;
}

function recitalPlanPayload(data) {
  const month = recitalMonth(data && data.month);
  const date = text(data.date, 10);
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date)) {
    throw new HttpsError("invalid-argument", "발표일 형식이 올바르지 않습니다.");
  }
  const selectedPieces = Array.isArray(data.selectedPieces) ? data.selectedPieces.slice(0, 20).map((piece) => ({
    sourceId: text(piece && piece.sourceId, 80),
    title: text(piece && piece.title, 160),
    composer: text(piece && piece.composer, 100),
    memberId: text(piece && piece.memberId, 80),
    memberName: text(piece && piece.memberName, 80),
    memberPart: text(piece && piece.memberPart, 30),
    stage: text(piece && piece.stage, 30),
  })).filter((piece) => piece.title) : [];
  const checks = data && data.checks && typeof data.checks === "object" ? {
    memory: !!data.checks.memory,
    recording: !!data.checks.recording,
    feedback: !!data.checks.feedback,
    rehearsal: !!data.checks.rehearsal,
  } : {};
  return { month, date, title: text(data && data.title, 60), dateSource: text(data && data.dateSource, 80), selectedPieces, checks, notes: text(data && data.notes, 500), performed: !!(data && data.performed) };
}

exports.saveMonthlyRecitalPlan = onCall(async (request) => {
  const email = requireAdmin(request);
  const plan = recitalPlanPayload(request.data);
  await admin.firestore().collection("monthlyRecitalPlans").doc(plan.month).set({
    ...plan,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: email,
  }, { merge: true });
  logger.info("월례발표회 공용 저장 완료", { month: plan.month, by: email, pieces: plan.selectedPieces.length });
  return { ok: true, month: plan.month };
});

exports.getMonthlyRecitalPlan = onCall(async (request) => {
  const month = recitalMonth(request.data && request.data.month);
  const snapshot = await admin.firestore().collection("monthlyRecitalPlans").doc(month).get();
  if (!snapshot.exists) return { ok: true, plan: null };
  const data = snapshot.data() || {};
  return {
    ok: true,
    plan: {
      month: text(data.month, 7), date: text(data.date, 10), title: text(data.title, 60), dateSource: text(data.dateSource, 80),
      selectedPieces: Array.isArray(data.selectedPieces) ? data.selectedPieces.map((piece) => ({ sourceId: text(piece && piece.sourceId, 80), title: text(piece && piece.title, 160), composer: text(piece && piece.composer, 100), memberId: text(piece && piece.memberId, 80), memberName: text(piece && piece.memberName, 80), memberPart: text(piece && piece.memberPart, 30), stage: text(piece && piece.stage, 30) })) : [],
      checks: data.checks && typeof data.checks === "object" ? data.checks : {}, notes: text(data.notes, 500), performed: !!data.performed,
    },
  };
});
