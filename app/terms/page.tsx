import type { Metadata } from 'next';
import { Clause, LegalPage } from '@/components/legal-page';
import { COMPANY } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Orbit — 서비스 이용약관',
  description: 'Orbit 서비스 이용에 적용되는 약관입니다.',
};

/**
 * 서비스 이용약관. BYOK(이용자 본인의 Anthropic API 키) 구조와 AI 결과물의 한계를 분명히 적는 데 초점을 둡니다.
 * 각 조항 아래 영문 요약을 붙이며, 한글 본문이 우선합니다.
 */
export default function TermsPage() {
  return (
    <LegalPage
      title="서비스 이용약관"
      titleEn="Terms of Service"
      intro={
        <>
          <p>
            이 약관은 {COMPANY.name}(이하 &quot;회사&quot;)가 제공하는 AI 에이전트 워크스페이스 &quot;{COMPANY.service}&quot;(이하 &quot;서비스&quot;)의
            이용 조건을 정합니다. 서비스에 로그인하면 이 약관에 동의한 것으로 봅니다.
          </p>
          <p>
            These terms govern your use of {COMPANY.service}, operated by {COMPANY.nameEn}. By signing in you agree to them. The Korean text
            governs; English summaries are for convenience.
          </p>
        </>
      }
    >
      <Clause
        n="1"
        title="정의"
        titleEn="Definitions"
        en={<p>&quot;Service&quot; is Orbit at {COMPANY.site} and {COMPANY.app}. &quot;Agent&quot; is an AI assistant that Orbit runs on your instruction. &quot;API key&quot; is your own Anthropic API key that you register to power agents. &quot;Content&quot; is anything you enter or upload and anything agents produce for you.</p>}
      >
        <ul>
          <li>&quot;서비스&quot;: {COMPANY.site} 및 {COMPANY.app} 에서 제공되는 Orbit 웹 애플리케이션</li>
          <li>&quot;이용자&quot;: 이 약관에 따라 서비스를 이용하는 사람</li>
          <li>&quot;에이전트&quot;: 이용자의 지시에 따라 서비스가 실행하는 AI 보조자(프로젝트 매니저, 직무 에이전트 등)</li>
          <li>&quot;API 키&quot;: 이용자가 에이전트 실행을 위해 서비스에 등록하는 이용자 본인의 Anthropic API 키</li>
          <li>&quot;콘텐츠&quot;: 이용자가 입력·첨부한 모든 자료와 에이전트가 이용자를 위해 생성한 결과물</li>
        </ul>
      </Clause>

      <Clause
        n="2"
        title="약관의 효력과 변경"
        titleEn="Changes to these terms"
        en={<p>We may change these terms. Changes are posted on this page at least 7 days before taking effect (30 days if unfavorable to you). Continuing to use the service after the effective date means you accept the change; if you do not, stop using the service and delete your account.</p>}
      >
        <p>
          회사는 관련 법령을 위반하지 않는 범위에서 약관을 변경할 수 있습니다. 변경 시 시행일 7일 전(이용자에게 불리한 변경은 30일 전)부터 이 페이지에
          공지합니다. 시행일 이후 서비스를 계속 이용하면 변경에 동의한 것으로 보며, 동의하지 않는 경우 이용을 중단하고 탈퇴할 수 있습니다.
        </p>
      </Clause>

      <Clause
        n="3"
        title="계정"
        titleEn="Accounts"
        en={<p>You sign in with a Google or GitHub account. You must be at least 14 years old and provide accurate information. You are responsible for activity under your account and for keeping your provider account secure. One person per account; accounts are not transferable.</p>}
      >
        <ul>
          <li>서비스는 Google 또는 GitHub 계정으로 로그인하며, 별도의 비밀번호를 만들지 않습니다.</li>
          <li>만 14세 이상만 이용할 수 있습니다.</li>
          <li>이용자는 자신의 계정에서 이루어진 활동에 책임을 지며, 로그인에 사용하는 제공자 계정을 안전하게 관리해야 합니다.</li>
          <li>계정은 본인만 사용할 수 있고 타인에게 양도·대여할 수 없습니다.</li>
        </ul>
      </Clause>

      <Clause
        n="4"
        title="서비스의 내용"
        titleEn="The service"
        en={<p>Orbit lets you create projects, have a manager agent recruit specialist agents, assign tasks, chat with agents, and review results. Features may change over time. The service is currently provided free of charge; we will announce any paid plans in advance.</p>}
      >
        <p>
          서비스는 이용자가 프로젝트를 만들면 프로젝트 매니저 에이전트가 필요한 직무 에이전트를 합류시키고, 업무를 나누어 실행하고, 결과를 검토해 보고하는
          AI 에이전트 워크스페이스입니다. 기능은 개선·변경될 수 있습니다. 서비스는 현재 무료로 제공되며, 유료 요금제를 도입하는 경우 사전에 공지합니다.
        </p>
      </Clause>

      <Clause
        n="5"
        title="API 키와 비용 (BYOK)"
        titleEn="Your API key and costs (BYOK)"
        en={
          <>
            <p>Agents run on the Anthropic API using <b>your own API key</b>. All usage billed to that key is your responsibility and is paid by you to Anthropic under Anthropic&apos;s terms — Orbit does not charge for model usage and cannot refund it. Orbit shows estimated usage for convenience; Anthropic&apos;s invoice is authoritative.</p>
            <p>We store your key encrypted and use it only to make requests you initiate. You may delete it at any time. You must comply with Anthropic&apos;s Usage Policy when using the key through Orbit.</p>
          </>
        }
      >
        <ul>
          <li>에이전트는 이용자가 등록한 <b>이용자 본인의 Anthropic API 키</b>로 Anthropic API 를 호출합니다. 회사는 모델 사용료를 청구하지 않으며, 별도의 공용 키를 제공하지 않습니다.</li>
          <li>API 키로 발생하는 모든 사용량과 비용은 이용자와 Anthropic 사이의 계약에 따라 이용자가 부담합니다. 회사는 이를 환불하거나 보전하지 않습니다.</li>
          <li>서비스가 표시하는 토큰 사용량·추정 비용은 참고용이며, 실제 청구는 Anthropic 의 기록을 따릅니다.</li>
          <li>회사는 API 키를 암호화해 보관하고, 이용자가 시작한 요청에만 사용합니다. 이용자는 언제든 키를 삭제할 수 있습니다.</li>
          <li>이용자는 서비스를 통해 API 키를 사용할 때 Anthropic 의 이용약관과 사용 정책을 준수해야 합니다.</li>
        </ul>
      </Clause>

      <Clause
        n="6"
        title="이용자의 콘텐츠"
        titleEn="Your content"
        en={<p>You own your content. You grant us only the license needed to store, process, and display it to you and to send it to the AI model on your behalf. You are responsible for having the rights to what you upload, including files from folders you connect. We do not use your content to train models.</p>}
      >
        <ul>
          <li>이용자가 입력·첨부한 콘텐츠와 에이전트가 이용자를 위해 생성한 결과물의 권리는 이용자에게 있습니다.</li>
          <li>이용자는 회사에 서비스 제공(저장·처리·표시, AI 모델로 전송)에 필요한 범위에서만 콘텐츠를 이용할 권리를 부여합니다.</li>
          <li>이용자는 연결한 폴더의 파일을 포함해 자신이 올리는 콘텐츠에 대한 정당한 권리를 가지고 있어야 합니다.</li>
          <li>회사는 이용자의 콘텐츠를 AI 모델 학습에 사용하지 않습니다.</li>
        </ul>
      </Clause>

      <Clause
        n="7"
        title="금지 행위"
        titleEn="Prohibited use"
        en={<p>Do not use the service to break the law, infringe others&apos; rights, distribute malware, attack or overload the service, scrape it, share your account, circumvent security, or generate content that violates Anthropic&apos;s Usage Policy. We may suspend or terminate accounts that do.</p>}
      >
        <ul>
          <li>법령 위반, 타인의 권리(저작권·개인정보 등) 침해</li>
          <li>악성 코드 배포, 서비스에 대한 공격·과부하·무단 수집(스크래핑), 보안 우회</li>
          <li>계정 공유·양도, 타인 사칭</li>
          <li>Anthropic 사용 정책에 어긋나는 콘텐츠 생성</li>
        </ul>
        <p>위반 시 회사는 사전 통지 없이 이용을 제한하거나 계정을 해지할 수 있습니다.</p>
      </Clause>

      <Clause
        n="8"
        title="AI 결과물의 한계"
        titleEn="AI output"
        en={<p>Agents can be wrong, incomplete, or biased. Output is provided &quot;as is&quot; and is not professional (legal, medical, financial) advice. Review it before relying on it, especially before acting on it or sharing it. Agents may take actions inside your projects (creating tasks, fields) as you configure; you control the autonomy level.</p>}
      >
        <p>
          에이전트의 응답은 부정확하거나 불완전하거나 편향될 수 있습니다. 결과물은 있는 그대로 제공되며 법률·의료·재무 등 전문적 조언이 아닙니다. 이용자는 결과물을
          검토한 뒤 사용해야 하며, 결과물에 근거한 결정과 그 결과는 이용자의 책임입니다. 에이전트는 이용자가 설정한 자율도 범위 안에서 프로젝트 내
          작업(업무·필드 생성 등)을 수행할 수 있습니다.
        </p>
      </Clause>

      <Clause
        n="9"
        title="서비스의 변경·중단"
        titleEn="Changes and interruptions"
        en={<p>We may modify, suspend, or discontinue the service or any feature, with notice where practical. We may interrupt the service for maintenance, security, or events beyond our control. We are not liable for loss caused by such changes or interruptions except as required by law.</p>}
      >
        <p>
          회사는 서비스 또는 기능을 변경·중단할 수 있으며, 가능한 경우 사전에 공지합니다. 점검, 보안 사고, 통신 장애, 외부 서비스(Anthropic, Cloudflare, Google,
          GitHub) 장애 등으로 서비스가 중단될 수 있습니다. 서비스 종료 시 30일 전에 공지하고, 이용자가 데이터를 내보낼 수 있는 기간을 둡니다.
        </p>
      </Clause>

      <Clause
        n="10"
        title="계약 해지"
        titleEn="Termination"
        en={<p>You may stop using the service and delete your account at any time by emailing {COMPANY.email}. We may terminate accounts that violate these terms. On termination we delete your data as described in the Privacy Policy.</p>}
      >
        <p>
          이용자는 언제든 <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a> 로 요청해 계정을 삭제할 수 있습니다. 회사는 이용자가 약관을 위반한 경우 계정을
          해지할 수 있습니다. 해지 시 이용자의 데이터는 개인정보처리방침에 따라 파기합니다.
        </p>
      </Clause>

      <Clause
        n="11"
        title="보증의 부인과 책임의 제한"
        titleEn="Disclaimer and limitation of liability"
        en={<p>The service is provided &quot;as is&quot; without warranties of any kind. To the extent permitted by law, we are not liable for indirect, incidental, or consequential damages, loss of data, or costs incurred on your API key. Nothing here limits liability that cannot be limited by law, including for our intent or gross negligence.</p>}
      >
        <p>
          서비스는 &quot;있는 그대로&quot; 제공되며, 회사는 서비스가 특정 목적에 적합하거나 오류가 없다는 점을 보증하지 않습니다. 관련 법령이 허용하는 범위에서 회사는
          간접 손해, 데이터 손실, 이용자의 API 키로 발생한 비용에 대해 책임을 지지 않습니다. 다만 회사의 고의 또는 중대한 과실로 인한 손해 등 법령상 제한할 수 없는
          책임은 그러하지 않습니다.
        </p>
      </Clause>

      <Clause
        n="12"
        title="준거법과 분쟁 해결"
        titleEn="Governing law"
        en={<p>These terms are governed by the laws of the Republic of Korea. Disputes are first addressed by good-faith discussion; failing that, the court having jurisdiction under the Korean Civil Procedure Act.</p>}
      >
        <p>
          이 약관은 대한민국 법을 준거법으로 합니다. 서비스 이용과 관련한 분쟁은 회사와 이용자가 성실히 협의해 해결하며, 협의가 되지 않는 경우
          「민사소송법」에 따른 관할 법원에 제기합니다.
        </p>
      </Clause>

      <Clause
        n="13"
        title="사업자 정보 및 문의"
        titleEn="Operator"
        en={<p>{COMPANY.nameEn} · Representative {COMPANY.ceoEn} · Business registration {COMPANY.registration} · {COMPANY.addressEn} · {COMPANY.email}</p>}
      >
        <ul>
          <li>상호: {COMPANY.name}</li>
          <li>대표자: {COMPANY.ceo}</li>
          <li>사업자등록번호: {COMPANY.registration}</li>
          <li>사업장 소재지: {COMPANY.address}</li>
          <li>문의: <a href={`mailto:${COMPANY.email}`}>{COMPANY.email}</a></li>
        </ul>
      </Clause>
    </LegalPage>
  );
}
