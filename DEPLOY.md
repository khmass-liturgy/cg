# saveCurriculum Cloud Function 배포 가이드

이 폴더를 배포하면, 지금까지 브라우저(localStorage)에 저장하던 GitHub 토큰을
**Firebase 서버 쪽(Secret Manager)** 으로 옮길 수 있습니다. 브라우저에는 토큰이
전혀 내려가지 않고, 로그인한 운영자만 "저장"을 호출할 수 있습니다.

이 작업은 `index.html`(GitHub Pages)과는 별개로, **컴퓨터에서 한 번만** 진행하면 됩니다.

---

## 0) 새 GitHub 토큰 먼저 발급 (기존 토큰은 이미 폐기하셨다고 하셨죠 — 잘하셨어요)

1. GitHub → 우측 상단 프로필 → **Settings** → **Developer settings** → **Personal access tokens**
   → **Fine-grained tokens** → **Generate new token**
2. 설정값:
   - **Repository access**: "Only select repositories" → `khmass-liturgy/cg` 만 선택
   - **Permissions** → Repository permissions → **Contents: Read and write** 로 설정 (나머지는 전부 No access)
   - **Expiration**: 90일 정도로 설정 (만료되면 다시 발급해서 아래 3번 과정만 다시 하면 됩니다)
3. 생성된 토큰(`github_pat_...`)을 복사해두세요. **이 토큰은 다시는 화면에 표시되지 않습니다.**

## 1) 준비물 설치 (컴퓨터에 한 번만)

```bash
npm install -g firebase-tools
firebase login
```

## 2) 이 폴더에서 의존성 설치

```bash
cd cg-functions/functions
npm install
cd ..
```

## 3) Blaze(종량제) 요금제로 전환

Cloud Functions가 GitHub 같은 외부 서버로 요청을 보내려면 Blaze 요금제가 필요합니다.
Firebase 콘솔(https://console.firebase.google.com/project/khcg-cg/usage/details) 에서
**Blaze로 업그레이드**를 눌러주세요. 무료 사용량(월 2백만 호출 등)이 넉넉해서,
이 정도 규모의 앱은 실사용료가 거의 0원입니다. 카드 등록만 필요합니다.

## 4) GitHub 토큰을 Secret으로 등록 (브라우저에는 절대 안 보이는 값)

```bash
firebase functions:secrets:set GITHUB_TOKEN
```

프롬프트가 뜨면 0번에서 복사해둔 새 토큰(`github_pat_...`)을 붙여넣고 Enter.

## 5) 배포

```bash
firebase deploy --only functions
```

배포가 끝나면 `saveCurriculum` 함수가 만들어집니다.

## 6) 구글 로그인 설정 확인

이미 Firebase 콘솔에서 로그인 방법에 "Google"을 추가하고 사용자를 등록해두셨다고 하셨죠 — 아래 2가지만 다시 한번 확인해주세요.

1. **khcg-cg** 프로젝트 → **Authentication** → **Sign-in method** → **Google** 제공업체가 **사용 설정**으로 되어 있는지 확인
2. **Authentication** → **Settings** → **승인된 도메인(Authorized domains)** 목록에
   **`khmass-liturgy.github.io`** 가 들어있는지 확인 (없으면 추가). 이게 없으면
   GitHub Pages에서 구글 로그인 팝업이 "이 도메인은 허용되지 않았습니다" 오류로 실패합니다.

운영자로 인정할 구글 계정은 `functions/index.js`의 `ADMIN_EMAILS` 배열과
`index.html`의 `ADMIN_EMAILS` 상수(브라우저 쪽은 화면 표시용) 두 곳에 이미
`trsumun@daum.net` 으로 넣어뒀습니다. 계정을 추가/변경하실 때는
**두 곳 모두** 같이 고쳐주세요 (Cloud Function 쪽이 실제 권한 검사입니다).

## 7) 확인

1. `https://khmass-liturgy.github.io/cg/` 접속 → "🔒 강좌 관리" 클릭
2. 방금 만든 이메일/비밀번호로 로그인
3. 영상이나 강의명을 하나 수정하고 "💾 지금 저장" 클릭
4. "저장 완료" 메시지가 뜨고, GitHub 저장소의 `curriculum.json` 커밋 내역에
   반영됐는지 확인 (커밋 메시지에 로그인한 이메일이 남습니다)

---

### 참고 — 왜 이 구조가 더 안전한가요?

- 예전: 브라우저가 GitHub 토큰을 직접 들고 있다가 GitHub API를 호출 → 토큰이 기기에
  그대로 남아있고, 탈취되면 저장소 쓰기 권한이 통째로 넘어감.
- 지금: 브라우저는 "로그인했는지"만 증명하고, 실제 GitHub 커밋은 Cloud Function이
  서버에서 대신 처리 → 토큰은 Secret Manager에만 있고 브라우저로는 절대 전송되지 않음.
  로그인 계정이 털려도 GitHub 토큰 자체는 노출되지 않습니다.
