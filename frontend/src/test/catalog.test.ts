import { describe, expect, it } from 'vitest';
import { industryDesc, industryGroup } from '../features/catalog';
import type { Industry, IndustryEntity } from '../api/types';

const entity = (over: Partial<IndustryEntity>): IndustryEntity => ({
  id: 'x', label: '조성비', sensitivity: 'critical', action: 'redact', regulation: [], keywords: [], example: null, detected: [], ...over,
});

describe('industryDesc', () => {
  it('shows the rule\'s risk keywords first', () => {
    expect(industryDesc(entity({ keywords: ['배합', '함량'], regulation: ['영업비밀보호법', 'CPNP'] }))).toBe('위험 키워드 배합, 함량 · 영업비밀보호법, CPNP · 민감도 critical');
  });
  it('shows what a regex-only rule blocked in the template tests when it has no keywords', () => {
    expect(industryDesc(entity({ detected: ['LOT240315A', 'LOT240316B'] }))).toBe('막히는 값 LOT240315A, LOT240316B · 민감도 critical');
  });
  it('leaves out an empty law list instead of printing a dangling separator', () => {
    expect(industryDesc(entity({ keywords: ['배합'], regulation: [] }))).toBe('위험 키워드 배합 · 민감도 critical');
  });
});

describe('industryGroup', () => {
  it('uses a sentence from the template tests instead of a count', () => {
    const ind: Industry = { industry: 'cosmetics', applies_to: null, test_cases: 4, entities: [entity({ example: { text: '정제수 72.4% 배합', detect: ['72.4%'] } }), entity({ id: 'y', label: '공급처' })] };
    const rules = industryGroup([ind]).rules;
    expect(rules[0]?.example).toBe('정제수 72.4% 배합');
    expect(rules[1]?.example).toBe('정제수 72.4% 배합'); // a rule with no example of its own falls back to the industry's
    expect(rules.every((r) => !r.example?.includes('시험 문장'))).toBe(true);
  });
});
