import { getCurrentUser } from '@/app/auth';
import { getDatabase } from '@/db';
import { billingMode, creditConfig, getBalance, grantTrialCredits, listLedger } from '@/lib/credits';
import {
  CHARGE_BONUS_ENABLED, CHARGE_TIERS, KRW_PER_CREDIT, TRIAL_ALLOWED_MODELS, creditRateTable, mcToKrw,
} from '@/lib/credits-pricing';
import { listPayments, paymentsEnabled, refundable } from '@/lib/payments';

/**
 * 크레딧 잔액·내역·단가표 (docs/pricing-credits.md §5 "계정 > 크레딧").
 * GET → { mode, unit, balance, trial, tiers, rates, ledger, payments, checkout }
 *
 * 체험 크레딧은 로그인 콜백에서 주지만, 크레딧 기능 이전에 가입한 사용자를 위해 여기서도 한 번 더 확인합니다 (멱등).
 * 로컬 모드(.env 키)는 크레딧을 쓰지 않으므로 지급하지 않습니다.
 */
export async function GET(request: Request) {
  const user = await getCurrentUser();
  const db = getDatabase();
  const config = creditConfig();
  const mode = await billingMode(db, user.userId);

  const trial = mode === 'local'
    ? { granted: false, amountMc: 0 }
    : await grantTrialCredits(db, user.userId, config);

  const limit = Number(new URL(request.url).searchParams.get('limit')) || 50;
  const [balance, ledger, payments] = await Promise.all([getBalance(db, user.userId), listLedger(db, user.userId, limit), listPayments(db, user.userId)]);

  return Response.json({
    mode,
    unit: { krwPerCredit: KRW_PER_CREDIT },
    balance: { ...balance, availableKrw: mcToKrw(balance.availableMc) },
    trial: { justGranted: trial.granted, credits: config.trialCredits, allowedModels: TRIAL_ALLOWED_MODELS },
    tiers: CHARGE_TIERS.map((t) => ({ ...t, bonusPct: CHARGE_BONUS_ENABLED ? t.bonusPct : 0 })),
    rates: creditRateTable(config),
    ledger,
    payments: payments.map((p) => ({ ...p, refundable: refundable(p, balance.paidMc) })),
    checkout: { enabled: paymentsEnabled() },
  });
}
