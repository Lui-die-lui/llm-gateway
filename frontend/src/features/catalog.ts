// Rule catalog for 정책 엔진 2. Industry rules come from GET /v1/industries; the built-in rules are not exposed by
// the API, so they are listed here to match app/detector.py and app/secret_rules.py (README "탐지").
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { gateway } from '../api/gateway';
import type { Action, Industry, IndustryEntity } from '../api/types';
import { qk } from './queries';

export interface CatalogRule {
  id: string;
  name: string;
  desc: string;
  example: string;
  action: Action;
  defaultOn: boolean;
}

export interface CatalogGroup {
  id: 'basic' | 'secret' | 'industry';
  name: string;
  desc: string;
  rules: CatalogRule[];
}

/** Built-in rules come from GET /v1/rules/builtin (app/rules_catalog.py), so this list cannot drift from the detector. */
export function useBuiltinGroups(): CatalogGroup[] | undefined {
  const q = useQuery({ queryKey: qk.builtinRules, queryFn: gateway.builtinRules, staleTime: 5 * 60_000 });
  return useMemo(
    () => q.data?.map((g) => ({ id: g.id, name: g.name, desc: g.desc, rules: g.rules.map((r) => ({ ...r, defaultOn: true })) })),
    [q.data],
  );
}

export const INDUSTRY_KO: Record<string, string> = {
  cosmetics: '화장품',
  medical: '의료',
  manufacturing: '제조',
  finance: '금융',
  hr: '인사',
  legal: '법무',
  it_dev: 'IT 개발',
  ecommerce: '이커머스',
  logistics: '물류',
};
export const industryName = (id: string): string => INDUSTRY_KO[id] ?? id;

/** "위험 키워드 …" from the rule's context words; a regex-only rule has none, so show what it blocked in the template's tests. */
export function industryDesc(e: IndustryEntity): string {
  const looks = e.keywords.length ? `위험 키워드 ${e.keywords.join(', ')}` : e.detected.length ? `막히는 값 ${e.detected.slice(0, 4).join(', ')}` : '';
  // the gateway sends the laws as a list (a template without any sends []), the type says string
  const laws = ([] as string[]).concat(e.regulation ?? []).filter(Boolean).join(', ');
  return [looks, laws, `민감도 ${e.sensitivity}`].filter(Boolean).join(' · ');
}

export function industryGroup(list: Industry[]): CatalogGroup {
  return {
    id: 'industry',
    name: '업종 묶음',
    desc: '회사 업종에 맞는 영업기밀이에요 · 회사 등록 때 고른 업종이 켜져 있어요',
    rules: list.flatMap((ind) =>
      ind.entities.map((e) => ({
        id: `i:${ind.industry}:${e.id}`,
        name: `${industryName(ind.industry)} · ${e.label}`,
        desc: industryDesc(e),
        example: e.example?.text ?? ind.entities.find((x) => x.example)?.example?.text ?? '',
        action: e.action,
        defaultOn: true, // the gateway applies every rule it is not told to switch off
      })),
    ),
  };
}

export const useIndustries = () => useQuery({ queryKey: qk.industries, queryFn: gateway.industries, staleTime: 5 * 60_000 });

/** "업종 묶음" when the label belongs to an industry template, otherwise "기본 정보". */
export function useLabelCategory() {
  const ind = useIndustries();
  return useCallback(
    (label: string) => {
      if (label === '시크릿') return '보안 정보';
      for (const i of ind.data ?? []) if (i.entities.some((e) => (e.label || e.id) === label)) return `업종 묶음 · ${industryName(i.industry)}`;
      return '기본 정보';
    },
    [ind.data],
  );
}
