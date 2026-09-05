import { PROVIDER_LABEL, authMode, configuredProviders } from '@/lib/auth';

/** 로그인 화면이 어떤 버튼을 보여줄지 정하는 데 씁니다. */
export function GET() {
  return Response.json({
    mode: authMode(),
    providers: configuredProviders().map((id) => ({ id, label: PROVIDER_LABEL[id] })),
  });
}
