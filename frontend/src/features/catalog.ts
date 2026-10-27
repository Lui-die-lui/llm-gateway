// Rule catalog for 정책 엔진 2. Industry rules come from GET /v1/industries; the built-in rules are not exposed by
// the API, so they are listed here to match app/detector.py and app/secret_rules.py (README "탐지").
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { gateway } from '../api/gateway';
import type { Action, Industry } from '../api/types';
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

/** Built-in detector rules (always on in today's server; the on/off switch is a console-side mock). */
export const BUILTIN_GROUPS: CatalogGroup[] = [
  {
    id: 'basic',
    name: '기본 정보 (개인정보)',
    desc: '어느 회사나 지켜야 하는 정보예요',
    rules: [
      { id: 'b:사람', name: '이름', desc: '직함이 붙은 이름 · "고객 홍길동", "김부장님"', example: '고객 홍길동', action: 'redact', defaultOn: true },
      { id: 'b:전화번호', name: '전화번호', desc: '휴대폰 번호', example: '010-0000-0000', action: 'redact', defaultOn: true },
      { id: 'b:이메일', name: '이메일', desc: '회사 · 개인 메일 주소', example: 'name@example.com', action: 'redact', defaultOn: true },
      { id: 'b:주민번호', name: '주민등록번호', desc: '앞 6자리 + 뒤 7자리', example: '000000-1000000', action: 'redact', defaultOn: true },
      { id: 'b:외국인등록번호', name: '외국인등록번호', desc: '뒤 7자리가 5~8로 시작', example: '900101-5000000', action: 'redact', defaultOn: true },
      { id: 'b:법인등록번호', name: '법인등록번호', desc: '"법인번호" 같은 말 뒤의 번호', example: '법인번호 000000-0000000', action: 'redact', defaultOn: true },
      { id: 'b:사업자번호', name: '사업자번호', desc: '000-00-00000 모양', example: '000-00-00000', action: 'redact', defaultOn: true },
      { id: 'b:여권번호', name: '여권 · 운전면허 번호', desc: '"여권", "면허" 같은 말 근처의 번호', example: 'M00000000', action: 'redact', defaultOn: true },
      { id: 'b:차량번호', name: '차량번호', desc: '번호판 모양', example: '00가 0000', action: 'redact', defaultOn: true },
    ],
  },
  {
    id: 'secret',
    name: '보안 정보',
    desc: '밖으로 나가면 바로 사고가 나는 정보예요',
    rules: [
      { id: 's:apikey', name: 'API 키', desc: 'gitleaks 기본 규칙 · sk-, AKIA 등으로 시작하는 키', example: 'sk-EXAMPLE••••', action: 'block', defaultOn: true },
      { id: 's:password', name: '비밀번호', desc: '"비밀번호:", "password=" 뒤의 값', example: 'password=••••••', action: 'block', defaultOn: true },
      { id: 's:dburl', name: '서버 · DB 접속 주소', desc: '아이디·비밀번호가 들어간 주소', example: 'db://user:••••@host', action: 'block', defaultOn: true },
      { id: 's:privkey', name: '개인 키 파일 내용', desc: '-----BEGIN PRIVATE KEY-----', example: '-----BEGIN …', action: 'block', defaultOn: true },
    ],
  },
];

export const INDUSTRY_KO: Record<string, string> = {
  cosmetics: '화장품',
  medical: '의료',
  manufacturing: '제조',
  finance: '금융',
  hr: '인사',
  legal: '법무',
  it_dev: 'IT 개발',
  ecommerce: '이커머스',
};
export const industryName = (id: string): string => INDUSTRY_KO[id] ?? id;

export function industryGroup(list: Industry[], companyIndustry: string): CatalogGroup {
  return {
    id: 'industry',
    name: '업종 묶음',
    desc: '회사 업종에 맞는 영업기밀이에요 · 회사 등록 때 고른 업종이 켜져 있어요',
    rules: list.flatMap((ind) =>
      ind.entities.map((e) => ({
        id: `i:${ind.industry}:${e.id}`,
        name: `${industryName(ind.industry)} · ${e.label}`,
        desc: [e.regulation, `민감도 ${e.sensitivity}`].filter(Boolean).join(' · '),
        example: `템플릿 시험 문장 ${ind.test_cases}개`,
        action: e.action,
        defaultOn: ind.industry === companyIndustry,
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
