import { solve } from './solver';
import { validateAndNormalize } from './validate';
import type { AuditResult } from './types';

/** 审计入口：先完整校验，再精确求解。全程同步、纯本地计算，无任何网络请求。 */
export function audit(rawInput: unknown): AuditResult {
  const checked = validateAndNormalize(rawInput);
  if ('errors' in checked) {
    return { verdict: 'invalid', errors: checked.errors };
  }
  const result = solve(checked.model);
  switch (result.status) {
    case 'infeasible':
      return { verdict: 'infeasible', solve: result, model: checked.model };
    case 'limit':
      return { verdict: 'limit', solve: result, model: checked.model };
    case 'unique':
      return { verdict: 'unique', solve: result, model: checked.model };
    case 'multiple':
      return { verdict: 'multiple', solve: result, model: checked.model };
  }
}
