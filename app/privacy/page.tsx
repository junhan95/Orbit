import type { Metadata } from 'next';
import { Clause, LegalPage } from '@/components/legal-page';
import { COMPANY, CREDIT_TERMS } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'orbitcrew.ai — 개인정보처리방침',
  description: 'orbitcrew 가 어떤 개인정보를 어떤 목적으로 처리하고 어떻게 보호하는지 안내합니다.',
};

/**
 * 개인정보처리방침. 「개인정보 보호법」 제30조가 요구하는 항목을 순서대로 담고, 각 조항 아래 영문 요약을 붙입니다.
 * 사업자 정보·시행일은 lib/legal.ts 에서 읽습니다.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="개인정보처리방침"
      titleEn="Privacy Policy"
      intro={
        <>
          <p>
            {COMPANY.name}(이하 &quot;회사&quot;)는 AI 에이전트 워크스페이스 &quot;{COMPANY.service}&quot;(이하 &quot;서비스&quot;)를 제공하면서
            「개인정보 보호법」 등 관련 법령을 준수하며, 이용자의 개인정보를 아래와 같이 처리합니다.
          </p>
          <p>
            {COMPANY.nameEn} (&quot;we&quot;) operates {COMPANY.service}, an AI agent workspace. This policy explains what personal data we
            process, why, and how it is protected. The Korean text governs; the English summaries are provided for convenience.
          </p>
        </>
      }
    >
      <Clause
        n="1"
        title="수집하는 개인정보의 항목과 방법"
        titleEn="What we collect"
        en={
          <>
            <p><b>Sign-in (Google / GitHub):</b> account ID, name, email address, profile picture — received from the provider you choose. We never see your password.</p>
            <p><b>Profile you enter:</b> company, department, job title, phone number, short bio, profile photo (optional).</p>
            <p><b>Your Anthropic API key</b>, if you choose to register one instead of using credits (stored encrypted; see §6).</p>
            <p><b>Payments (credit top-ups):</b> order number, amount, payment method type (card issuer or easy-pay provider), the payment provider&apos;s approval key, approval time, receipt URL, and refund records — received from {CREDIT_TERMS.pgEn}. Card numbers are entered on the provider&apos;s payment window and never reach us.</p>
            <p><b>Credit ledger:</b> credits granted, spent per agent call (model and token counts), and refunded.</p>
            <p><b>Data created while using the service:</b> projects, tasks, chat messages, files you attach to a message (sent to the model for that turn only and not stored), agent run logs, token usage.</p>
            <p><b>Automatically:</b> a session cookie and standard access logs (IP address, browser, timestamp).</p>
          </>
        }
      >
        <div className="legal-tablewrap">
          <table>
            <thead>
              <tr><th>구분</th><th>항목</th><th>수집 방법</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>회원 식별(필수)</td>
                <td>소셜 로그인 제공자(Google 또는 GitHub)의 계정 식별자, 이름, 이메일 주소, 프로필 사진</td>
                <td>이용자가 선택한 제공자의 OAuth 로그인 시 제공자로부터 전달. 비밀번호는 수집하지 않음</td>
              </tr>
              <tr>
                <td>프로필(선택)</td>
                <td>회사명, 소속, 직급, 연락처, 한 줄 소개, 프로필 사진</td>
                <td>이용자가 계정 화면에서 직접 입력</td>
              </tr>
              <tr>
                <td>API 키(선택)</td>
                <td>이용자가 등록하는 Anthropic API 키</td>
                <td>이용자가 API 키 등록 창에서 직접 입력 (암호화 저장, 제6조)</td>
              </tr>
              <tr>
                <td>결제(선택)</td>
                <td>주문번호, 결제 금액, 결제수단 종류(카드사·간편결제사), 결제대행사 승인 키, 승인 일시, 영수증 주소, 환불 기록</td>
                <td>이용자가 크레딧을 충전할 때 결제대행사({CREDIT_TERMS.pg})로부터 전달. 카드번호·계좌번호는 결제대행사 결제창에서만 입력되며 회사에 전달되지 않음</td>
              </tr>
              <tr>
                <td>크레딧 원장</td>
                <td>크레딧 지급·차감(호출별 모델·토큰 수)·환불 기록</td>
                <td>서비스 이용 과정에서 생성</td>
              </tr>
              <tr>
                <td>서비스 이용 데이터</td>
                <td>프로젝트·업무·대화 내용, 대화에 첨부한 파일(해당 턴에만 모델에 전달되며 저장하지 않음), 에이전트 실행 기록, 토큰 사용량</td>
                <td>서비스 이용 과정에서 생성</td>
              </tr>
              <tr>
                <td>자동 수집</td>
                <td>세션 쿠키, 접속 로그(IP 주소, 브라우저 정보, 접속 일시)</td>
                <td>서비스 접속 시 자동 생성</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>회사는 주민등록번호, 카드번호·계좌번호 등 결제수단 정보, 위치 정보를 수집하지 않으며, 광고·행태 추적 목적의 쿠키를 사용하지 않습니다.</p>
      </Clause>

      <Clause
        n="2"
        title="개인정보의 처리 목적"
        titleEn="Why we use it"
        en={
          <p>To identify you and keep you signed in; to provide the service (project management, agent runs, chat); to include your name and profile in the instructions given to your agents so they can address you properly; to call the Anthropic API — with the key you registered, or with the company&apos;s operator key when you pay with credits — and show you usage and credit deductions; to process credit top-ups and refunds and keep the transaction records the law requires; to answer your inquiries; and to keep the service secure.</p>
        }
      >
        <ul>
          <li>회원 식별, 로그인 상태 유지, 부정 이용 방지</li>
          <li>서비스 제공 — 프로젝트·업무 관리, 에이전트 실행, 대화</li>
          <li>이용자가 입력한 이름·소속·소개를 에이전트 지시문에 포함해 이용자에게 맞는 응답을 생성</li>
          <li>이용자가 등록한 API 키 또는(키를 등록하지 않은 경우) 회사의 운영 키로 Anthropic API 를 호출하고, 토큰 사용량·크레딧 차감 내역을 이용자에게 표시</li>
          <li>크레딧 충전 결제의 처리·승인 확인·환불, 거래 기록의 보관, 결제 관련 문의 응대</li>
          <li>문의 응대, 공지 전달</li>
          <li>서비스 안정성·보안 확보, 장애 분석</li>
        </ul>
      </Clause>

      <Clause
        n="3"
        title="개인정보의 보유 및 이용 기간"
        titleEn="How long we keep it"
        en={
          <p>We keep your data while your account exists. When you delete your account or ask us to, we delete it without undue delay. Sessions expire on logout or after 30 days. Access logs are kept for up to 3 months for security. Payment, refund and credit-ledger records are kept for 5 years and records of consumer complaints or disputes for 3 years, as required by the Korean e-commerce act, even after account deletion. Where another law requires longer retention, we keep only the data that law names for the period it sets.</p>
        }
      >
        <ul>
          <li>회원 정보·프로필·서비스 이용 데이터: 회원 탈퇴 또는 삭제 요청 시 지체 없이 파기</li>
          <li>API 키: 이용자가 삭제하거나 회원 탈퇴 시 즉시 파기</li>
          <li>세션: 로그아웃 또는 30일 경과 시 만료·삭제</li>
          <li>접속 로그: 보안 목적으로 최대 3개월</li>
          <li>결제·환불 기록 및 크레딧 원장: 「전자상거래 등에서의 소비자보호에 관한 법률」에 따라 5년 (회원 탈퇴 후에도 보관)</li>
          <li>소비자 불만·분쟁 처리 기록: 같은 법률에 따라 3년</li>
          <li>관련 법령(「통신비밀보호법」 등)에 보존 의무가 있는 경우 해당 법령이 정한 기간 동안 해당 항목만 보관</li>
        </ul>
      </Clause>

      <Clause
        n="4"
        title="개인정보의 제3자 제공 및 국외 이전"
        titleEn="Sharing and international transfer"
        en={
          <>
            <p>We do not sell personal data and do not share it with third parties for their own purposes. Because the service runs on infrastructure abroad and sends your prompts to an AI model, the following transfers occur:</p>
            <p><b>Anthropic, PBC (USA)</b> — the content of your chats, tasks, project context, and the profile fields you entered are sent to the Anthropic API each time an agent runs: using <i>your own</i> API key if you registered one (Anthropic then processes it under its terms for your account), or otherwise using the company&apos;s operator key (Anthropic then processes it as our API customer data, which Anthropic does not use for model training under its commercial terms).</p>
            <p><b>Cloudflare, Inc. (USA)</b> — hosts the application and database (Cloudflare Workers / D1) and therefore stores all data listed in §1.</p>
            <p><b>Google LLC / GitHub, Inc. (USA)</b> — provide sign-in; we receive the profile fields listed in §1.</p>
            <p>Our use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.</p>
          </>
        }
      >
        <p>회사는 이용자의 개인정보를 판매하지 않으며, 제3자가 자신의 목적으로 이용하도록 제공하지 않습니다. 다만 서비스의 성격상 아래와 같은 국외 이전이 발생합니다.</p>
        <div className="legal-tablewrap">
          <table>
            <thead>
              <tr><th>이전받는 자</th><th>이전 항목</th><th>이전 국가·시점·방법</th><th>목적</th><th>보유 기간</th></tr>
            </thead>
            <tbody>
              <tr>
                <td>Anthropic, PBC<br />(privacy@anthropic.com)</td>
                <td>대화·업무·프로젝트 내용, 첨부 파일, 이용자가 입력한 프로필(이름·소속·소개)</td>
                <td>미국 · 에이전트 실행 시마다 · 이용자 본인의 API 키 또는(키 미등록 시) 회사의 운영 키로 HTTPS 전송</td>
                <td>AI 모델 응답 생성</td>
                <td>Anthropic 의 약관·정책에 따름</td>
              </tr>
              <tr>
                <td>Cloudflare, Inc.<br />(privacyquestions@cloudflare.com)</td>
                <td>제1조의 모든 항목</td>
                <td>미국 · 서비스 이용 시 · 네트워크를 통한 저장</td>
                <td>애플리케이션·데이터베이스 호스팅</td>
                <td>제3조와 동일</td>
              </tr>
              <tr>
                <td>Google LLC, GitHub, Inc.</td>
                <td>계정 식별자, 이름, 이메일, 프로필 사진</td>
                <td>미국 · 로그인 시 · OAuth</td>
                <td>본인 확인·로그인</td>
                <td>각 제공자의 정책에 따름</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          이용자가 API 키를 등록한 경우 Anthropic 으로의 전송은 그 키로, 이용자의 Anthropic 계정 아래에서 이루어지며 Anthropic 의 이용약관·개인정보 정책을 따릅니다.
          키를 등록하지 않고 크레딧으로 이용하는 경우에는 회사의 운영 키로 전송되며, 이때 Anthropic 은 회사의 API 고객 데이터로서 상업 이용약관에 따라 처리하고
          모델 학습에 사용하지 않습니다. 어느 경우든 이용자의 콘텐츠는 이용자가 요청한 응답을 생성하는 목적으로만 전송됩니다.
        </p>
        <p>회사의 Google API 로부터 받은 정보의 사용은 Google API 서비스 사용자 데이터 정책(제한적 사용 요건 포함)을 준수합니다.</p>
      </Clause>

      <Clause
        n="5"
        title="개인정보 처리의 위탁"
        titleEn="Processors"
        en={<p>Cloudflare, Inc. (hosting, database, DNS) and {CREDIT_TERMS.pgEn} (Toss Payments Co., Ltd., Korea — payment processing, approval and refunds for credit top-ups). We will update this section if we add processors.</p>}
      >
        <div className="legal-tablewrap">
          <table>
            <thead><tr><th>수탁자</th><th>위탁 업무</th></tr></thead>
            <tbody>
              <tr><td>Cloudflare, Inc.</td><td>애플리케이션 호스팅, 데이터베이스(D1) 운영, DNS·보안</td></tr>
              <tr><td>{CREDIT_TERMS.pg}(주)</td><td>크레딧 충전 결제의 처리·승인·취소(환불), 결제 영수증 발급</td></tr>
            </tbody>
          </table>
        </div>
        <p>수탁자가 추가·변경되는 경우 본 방침을 갱신해 공개합니다.</p>
      </Clause>

      <Clause
        n="6"
        title="개인정보의 안전성 확보 조치"
        titleEn="Security"
        en={
          <p>All traffic is HTTPS. Your API key is encrypted at rest (AES-256-GCM) with a server-side master secret that is never stored alongside the data; only the last characters are shown back to you. Session tokens are stored as hashes. Card details are entered only on the payment provider&apos;s window and never pass through our servers. Access to production systems is limited to the operator. Passwords are never collected.</p>
        }
      >
        <ul>
          <li>모든 통신은 HTTPS 로 암호화</li>
          <li>이용자가 등록한 API 키는 AES-256-GCM 으로 암호화해 저장하며, 복호화 키(마스터 시크릿)는 데이터와 분리해 보관. 화면에는 키의 끝 일부만 표시</li>
          <li>세션 토큰은 해시 값만 저장, 로그아웃 시 즉시 폐기</li>
          <li>운영 시스템 접근 권한을 운영자로 한정, 접근 기록 보관</li>
          <li>비밀번호를 수집·저장하지 않음 (소셜 로그인만 제공)</li>
          <li>카드번호 등 결제수단 정보는 결제대행사의 결제창에서만 입력되어 회사 서버를 거치지 않음. 결제대행사 API 호출용 비밀키는 서버 비밀값으로만 보관</li>
        </ul>
      </Clause>

      <Clause
        n="7"
        title="개인정보의 파기"
        titleEn="Deletion"
        en={<p>Electronic records are deleted so they cannot be recovered. Deletion happens without undue delay once the retention period ends or you request it.</p>}
      >
        <p>보유 기간이 끝나거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다. 전자적 파일은 복구할 수 없는 방법으로 삭제합니다.</p>
      </Clause>

      <Clause
        n="8"
        title="정보주체의 권리와 행사 방법"
        titleEn="Your rights"
        en={
          <p>You can view and edit your profile, delete your API key, and view your payment and credit history (and refund unused payments) at any time in the app (Account). To access, correct, delete, or restrict processing of any other data, or to delete your account, email {COMPANY.email}; we respond within 10 days. Withdrawing consent may make parts of the service unavailable.</p>
        }
      >
        <ul>
          <li>프로필 열람·수정, API 키 삭제, 결제·크레딧 내역 열람과 미사용 결제의 취소(환불): 앱의 <b>계정</b> 화면에서 직접</li>
          <li>그 외 열람·정정·삭제·처리정지 요구, 회원 탈퇴: <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> 로 요청 (10일 이내 조치)</li>
          <li>대리인을 통한 요구 시 위임장 등 확인 서류 필요</li>
          <li>동의 철회 시 서비스의 일부 또는 전부를 이용할 수 없을 수 있음</li>
        </ul>
      </Clause>

      <Clause
        n="9"
        title="쿠키의 사용"
        titleEn="Cookies"
        en={<p>We set one cookie: a session cookie that keeps you signed in (HttpOnly, Secure). We use no advertising or analytics cookies. Blocking cookies prevents sign-in. The payment provider&apos;s window opened for top-ups follows the provider&apos;s own cookie policy.</p>}
      >
        <p>
          서비스는 로그인 상태 유지를 위한 세션 쿠키 1종만 사용합니다(HttpOnly, Secure). 광고·분석 목적의 쿠키는 사용하지 않습니다. 브라우저에서 쿠키를 차단하면
          로그인이 불가능합니다. 테마·언어 같은 화면 설정은 이용자 브라우저의 로컬 저장소에만 보관되며 서버로 전송되지 않습니다. 크레딧 충전 시 열리는
          결제대행사({CREDIT_TERMS.pg})의 결제창은 결제대행사의 쿠키 정책을 따릅니다.
        </p>
      </Clause>

      <Clause
        n="10"
        title="아동의 개인정보"
        titleEn="Children"
        en={<p>The service is not directed to children under 14 (or the applicable age in your country). We do not knowingly collect their data; if you believe we have, contact us and we will delete it.</p>}
      >
        <p>서비스는 만 14세 미만 아동을 대상으로 하지 않으며 아동의 개인정보를 의도적으로 수집하지 않습니다. 수집 사실을 알게 되면 즉시 삭제합니다.</p>
      </Clause>

      <Clause
        n="11"
        title="개인정보 보호책임자 및 문의"
        titleEn="Contact"
        en={<p>Data protection officer: {COMPANY.ceoEn}, {COMPANY.nameEn} — {COMPANY.email}. You may also lodge a complaint with the Korean Personal Information Protection Commission (privacy.go.kr, +82-118).</p>}
      >
        <ul>
          <li>개인정보 보호책임자: {COMPANY.ceo} ({COMPANY.name} 대표)</li>
          <li>이메일: <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a></li>
          <li>사업장: {COMPANY.address}</li>
        </ul>
        <p>
          권익 침해에 대한 상담·신고는 개인정보침해신고센터(privacy.kisa.or.kr, 국번 없이 118), 개인정보분쟁조정위원회(kopico.go.kr, 1833-6972),
          대검찰청 사이버수사과(spo.go.kr, 1301), 경찰청 사이버수사국(ecrm.police.go.kr, 182)에서도 가능합니다.
        </p>
      </Clause>

      <Clause
        n="12"
        title="방침의 변경"
        titleEn="Changes"
        en={<p>We will post changes on this page at least 7 days before they take effect (30 days for material changes to what we collect or share).</p>}
      >
        <p>본 방침의 내용이 추가·삭제·수정되는 경우 시행 7일 전(수집 항목·제3자 제공 등 중요한 변경은 30일 전)부터 이 페이지에 공지합니다.</p>
      </Clause>
    </LegalPage>
  );
}
