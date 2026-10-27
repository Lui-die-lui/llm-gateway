// Seed data for the mock server. All names, mails and codes are fake (example.com, HANBIT-7Q2K).
import type {
  AdminLogEntry,
  Anomaly,
  Company,
  DeptHeatmap,
  ExceptionRequest,
  HistoryEntry,
  JoinRequest,
  Member,
  PolicyRule,
  PortalProfile,
  PortalRecent,
  PortalRequest,
  ReportSchedule,
  RuleOptions,
  Settings,
  TrainingCandidate,
} from '../api/consoleTypes';

export const company = (): Company => ({
  name: '한빛코스메틱 (가상)',
  code: 'HANBIT-7Q2K',
  industry: 'cosmetics',
  mailDomain: '@example.com',
  members: 48,
  admins: 2,
});

export const settings = (): Settings => ({
  companyName: '한빛코스메틱 (가상)',
  industry: 'cosmetics',
  mailDomain: '@example.com',
  mailOnly: true,
  lockout: true,
  twoFactor: false,
  idleMinutes: 30,
  sites: { chatgpt: true, claude: true, gemini: true },
  slackConnected: true,
  slackWorkspace: 'hanbit-example',
  slackAppName: 'Gateway 보안 알림',
  slackUnmatched: 2,
  retentionDays: 90,
  deviceHistory: '7일',
});

export const joinRequests = (): JoinRequest[] => [
  { id: 'j1', name: '이서준', email: 'seojun.lee@example.com', dept: '영업', when: '10분 전', check: '회사 메일 ✓', warn: false },
  { id: 'j2', name: '박하은', email: 'haeun.park@example.com', dept: '연구소', when: '1시간 전', check: '회사 메일 ✓', warn: false },
  { id: 'j3', name: 'minji.k', email: 'minji.k@gmail.example', dept: '연구소', when: '어제', check: '회사 메일 아님 · 비슷한 이름의 구성원 있음', warn: true },
  { id: 'j4', name: '정우진', email: 'woojin.jung@example.com', dept: '개발', when: '어제', check: '회사 메일 ✓', warn: false },
];

export const members = (): Member[] => [
  { id: 'm1', name: '보안관리자', email: 'admin@example.com', dept: '정보보호팀', role: 'admin', owner: true, status: 'active', last: '방금' },
  { id: 'm2', name: '박서연', email: 'seoyeon.park@example.com', dept: '정보보호팀', role: 'admin', owner: false, status: 'active', last: '12분 전' },
  { id: 'm3', name: '김민지', email: 'minji.kim@example.com', dept: '연구소', role: 'member', owner: false, status: 'active', last: '방금' },
  { id: 'm4', name: '이도윤', email: 'doyun.lee@example.com', dept: '개발', role: 'member', owner: false, status: 'active', last: '8분 전' },
  { id: 'm5', name: '한지호', email: 'jiho.han@example.com', dept: '영업', role: 'member', owner: false, status: 'idle', last: '34일 전' },
  { id: 'm6', name: '오세빈', email: 'sebin.oh@example.com', dept: '연구소', role: 'member', owner: false, status: 'inactive', last: '—' },
];

const opts = (action: PolicyRule['action']): RuleOptions => ({ ask: action !== 'block', exc: action === 'block', notify: false });

const rule = (
  n: number,
  name: string,
  kind: PolicyRule['kind'],
  cond: string,
  action: PolicyRule['action'],
  scope: string,
  hits: string,
  enabled: boolean,
  extra: Partial<PolicyRule>,
): PolicyRule => ({
  id: `r${n}`,
  prio: n,
  name,
  kind,
  cond,
  action,
  scope: [scope],
  hits,
  enabled,
  builtins: [],
  words: '',
  pattern: '',
  ai: '',
  tag: '[이름표_n]',
  options: opts(action),
  ...extra,
});

export const policyRules = (): PolicyRule[] => [
  rule(10, 'API 키 · 비밀번호', 'builtin', 'API 키, 비밀번호, 접속 주소', 'block', '전사', '143', true, { builtins: ['API 키', '비밀번호'] }),
  rule(20, '주민등록번호', 'builtin', '주민등록번호', 'block', '전사', '41', true, { builtins: ['주민등록번호'] }),
  rule(30, '이름 · 연락처', 'builtin', '이름, 전화번호, 이메일', 'redact', '전사', '1,204', true, { builtins: ['이름', '전화번호', '이메일'], tag: '[사람_n]' }),
  rule(40, '계좌 · 카드번호', 'builtin', '계좌번호, 카드번호', 'redact', '전사', '36', true, { builtins: ['계좌번호', '카드번호'], tag: '[계좌_n]' }),
  rule(50, '미공개 프로젝트 이름', 'words', '회사 단어 목록 12개', 'redact', '전사', '58', true, { words: '프로젝트 블루문\n코드명 HB-21\n하반기 신제품 라인', tag: '[프로젝트_n]' }),
  rule(60, '사번 · 문서번호', 'pattern', 'EMP-0000 · DOC-0000 모양', 'redact', '전사', '92', true, { pattern: '(EMP|DOC)-\\d{4}', tag: '[번호_n]' }),
  rule(70, '거래 단가 · 원가', 'ai', '"단가, 원가, 마진 같은 거래 금액"', 'redact', '영업', '27', true, { ai: '거래처에 주는 단가, 원가, 마진처럼 공개되면 안 되는 금액', tag: '[금액_n]' }),
  rule(80, '업종 묶음 · 화장품 조성비', 'ai', '업종 묶음에서 켜진 규칙', 'redact', '연구소', '612', true, { ai: '제품 배합 비율이나 원료 함량', tag: '[조성비_n]' }),
  rule(90, '거래처 이름 (변경)', 'words', '회사 단어 목록 31개', 'redact', '영업', '—', false, { words: '거래처A\n거래처B', tag: '[거래처_n]' }),
];

export const policyPending = () => [
  { ruleId: 'r50', note: '미공개 프로젝트 이름 단어 2개 추가' },
  { ruleId: 'r60', note: '사번 · 문서번호 모양 수정' },
  { ruleId: 'r90', note: '거래처 이름 규칙 새로 만듦' },
];

export const exceptions = (): ExceptionRequest[] => [
  {
    id: 'EXC-0142', user: 'kim.mj', dept: '연구소', title: '조성비 포함 문서를 ChatGPT로 번역', sev: 'CRITICAL', sla: '38분 남음', slaUrgent: 2,
    entity: '조성비 ×6', scope: '1회', rule: 'cos.formula.redact', target: 'ChatGPT · 브라우저 확장', history: '최근 30일 예외 승인 2회 · 오남용 기록 없음',
    reason: '해외 OEM 파트너에게 보낼 배합 변경 요청서를 영문으로 번역해야 합니다. 자리표시자로 가리면 번역 결과에 수치가 빠져 다시 손으로 넣어야 해서 오류가 생깁니다.',
    alt: '외부 전송 없이 내부 Ollama 번역 모델로 같은 문서를 처리할 수 있습니다. 번역 품질이 충분한지 먼저 확인을 권합니다.',
    status: 'pending', requestedAt: '오늘 14:05',
  },
  {
    id: 'EXC-0141', user: 'han.jh', dept: '영업', title: '고객 계좌번호 포함 견적서 요약', sev: 'CRITICAL', sla: '52분 남음', slaUrgent: 1,
    entity: '계좌번호', scope: '24시간', rule: 'pii.account.block', target: 'Claude · 브라우저 확장', history: '최근 30일 차단 7회 · 교육 대상 후보',
    reason: '견적서 PDF를 요약하는데 하단에 입금 계좌가 있어 계속 막힙니다.',
    alt: '계좌번호는 요약에 필요 없는 정보입니다. 반려하고 해당 줄을 지운 뒤 다시 요청하도록 안내하는 편이 맞습니다.',
    status: 'pending', requestedAt: '오늘 13:40',
  },
  {
    id: 'EXC-0140', user: 'rnd-summarizer', dept: '연구소', title: '서비스 계정의 공급처 정보 외부 전송', sev: 'HIGH', sla: '3시간', slaUrgent: 0,
    entity: '원료 공급처', scope: '7일', rule: 'cos.supplier.internal', target: 'GPT-4.1 · API 프록시', history: '서비스 계정 · 소유자 jung.hr',
    reason: '주간 원료 리포트 자동화에서 내부 모델 응답 품질이 낮아 외부 모델 사용이 필요합니다.',
    alt: '서비스 계정에 7일 예외는 범위가 넓습니다. 공급처 엔티티만 가림으로 바꾸는 규칙 초안을 검토하세요.',
    status: 'pending', requestedAt: '오늘 11:20',
  },
  {
    id: 'EXC-0139', user: 'oh.sb', dept: '의료사업', title: '익명화된 진단 통계 요약', sev: 'MEDIUM', sla: '6시간', slaUrgent: 0,
    entity: '진단명 ×12', scope: '1회', rule: 'med.dx.redact', target: 'Claude · 브라우저 확장', history: '최근 30일 예외 없음',
    reason: '개인 식별 정보가 없는 집계 통계입니다. 진단명이 가려지면 통계 의미가 사라집니다.',
    alt: '집계 데이터라면 "doc_label = aggregated" 조건으로 허용 규칙을 만들 수 있습니다.',
    status: 'pending', requestedAt: '오늘 09:12',
  },
  {
    id: 'EXC-0138', user: 'yoon.ka', dept: '마케팅', title: '출시 일정 포함 캘린더 작성', sev: 'MEDIUM', sla: '1일', slaUrgent: 0,
    entity: '출시 일정', scope: '1회', rule: 'cos.launch.redact', target: 'ChatGPT · 브라우저 확장', history: '최근 30일 예외 승인 1회',
    reason: '마케팅 캘린더를 만들려면 실제 날짜가 필요합니다.',
    alt: '날짜를 가린 채 생성하고 복원해도 결과가 같습니다. 가림 상태로 다시 시도하도록 안내하세요.',
    status: 'pending', requestedAt: '어제 17:30',
  },
  {
    id: 'EXC-0137', user: 'kim.mj', dept: '연구소', title: 'OEM 배합 변경 요청서 번역', sev: 'CRITICAL', sla: '—', slaUrgent: 0,
    entity: '조성비 ×4', scope: '1회', rule: 'cos.formula.redact', target: 'ChatGPT · 브라우저 확장', history: '최근 30일 예외 승인 1회',
    reason: 'OEM 파트너에게 보낼 요청서 번역에 수치가 필요합니다.', alt: '내부 번역 모델을 먼저 써 보세요.',
    status: 'approved', ttl: '1x', memo: '다음엔 내부 번역 모델을 먼저 써 보세요.', requestedAt: '10.24',
  },
  {
    id: 'EXC-0121', user: 'kim.mj', dept: '연구소', title: '고객 연락처 포함 메일 초안', sev: 'HIGH', sla: '—', slaUrgent: 0,
    entity: '전화번호', scope: '24시간', rule: 'pii.contact.redact', target: 'Claude · 브라우저 확장', history: '최근 30일 예외 없음',
    reason: '고객에게 보낼 메일 초안에 연락처가 들어가야 합니다.', alt: '연락처 없이 초안을 만들고 붙여 넣으세요.',
    status: 'rejected', memo: '연락처 없이도 초안 작성이 가능해요.', requestedAt: '10.18',
  },
  {
    id: 'EXC-0110', user: 'park.sj', dept: '마케팅', title: '이벤트 당첨자 명단 정리', sev: 'HIGH', sla: '—', slaUrgent: 0,
    entity: '이름 ×30', scope: '24시간', rule: 'pii.name.redact', target: 'ChatGPT · 브라우저 확장', history: '최근 30일 예외 승인 1회',
    reason: '당첨자 이름을 표로 정리해야 합니다.', alt: '이름을 가린 채 정리하고 화면에서 복원 받으세요.',
    status: 'expired', ttl: '24h', requestedAt: '10.11',
  },
];

export const adminLog = (): AdminLogEntry[] => [
  { t: '14:40', who: '보안관리자', act: '가입 승인', target: '이서준 · 영업', note: '회사 메일 확인 후 승인', tone: 'clean' },
  { t: '14:12', who: '박서연', act: '규칙 적용', target: '버전 14', note: '미공개 프로젝트 이름 단어 2개 추가 · 거래처 이름 규칙 새로 만듦', tone: 'accent' },
  { t: '13:58', who: '박서연', act: '예외 승인', target: '김민지 · 조성비', note: '1회 원문 전송 허용', tone: 'redact' },
  { t: '11:20', who: '보안관리자', act: '가입 거절', target: 'minji.k@gmail.example', note: '회사 메일 아님 · 사유 전달', tone: 'block' },
  { t: '10:05', who: '보안관리자', act: '역할 변경', target: '박서연', note: '직원 → 보안 관리자', tone: 'accent' },
  { t: '어제 18:30', who: '보안관리자', act: '설정 변경', target: '기록 보관', note: '전송 기록 보관 기간 30일 → 90일', tone: 'muted' },
  { t: '어제 09:12', who: '박서연', act: '회사 코드', target: 'HANBIT-7Q2K', note: '새 코드 발급 · 이전 코드 중지', tone: 'muted' },
  { t: '3일 전', who: '보안관리자', act: '로그인 실패 잠금', target: 'admin@example.com', note: '비밀번호 5회 틀림 · 15분 잠김', tone: 'block' },
];

export const trainingCandidates = (): TrainingCandidate[] => [
  { id: 't1', user: 'lee.dy', dept: '개발', why: 'API 키 붙여넣기', n: 6 },
  { id: 't2', user: 'han.jh', dept: '영업', why: '계좌번호가 든 견적 요청', n: 4 },
  { id: 't3', user: 'oh.sr', dept: '고객지원', why: '주민번호가 든 상담 요약', n: 3 },
];

export const anomalies = (): Anomaly[] => [
  { id: 'a1', sev: 'HIGH', t: '14:07', title: '동일 사용자 시크릿 반복 전송 시도', desc: 'lee.dy · 10분 내 API 키 차단 4회. 자동화 스크립트에서 키를 붙여넣는 패턴으로 보입니다.', primary: '사용자 일시 제한', acked: false },
  { id: 'a2', sev: 'MEDIUM', t: '13:52', title: '조성비 가림 건수 평시 3배', desc: '연구소 부서 · 신제품 안정성 테스트 시즌. 정상 업무일 가능성이 높으나 확인 필요.', primary: '로그 보기', primaryHref: '/console/logs', acked: false },
  { id: 'a3', sev: 'LOW', t: '13:40', title: 'Gemini 화면이 바뀌어 검사 보류 12건', desc: '입력창 위치가 바뀌어 일부 전송을 검사하지 못하고 보류했어요. 확장 업데이트가 필요해요.', primary: '기록 보기', primaryHref: '/console/logs', acked: false },
];

export const deptHeatmap = (): DeptHeatmap => ({
  cols: ['조성비', '프로젝트', '이름·연락처', '주민번호', '문서번호', '계좌', 'API 키'],
  rows: [
    { dept: '연구소', values: [612, 254, 40, 6, 22, 0, 12] },
    { dept: '영업', values: [20, 30, 210, 40, 18, 61, 0] },
    { dept: '마케팅', values: [12, 4, 388, 22, 9, 8, 2] },
    { dept: '개발', values: [3, 41, 20, 4, 30, 0, 96] },
    { dept: '고객지원', values: [0, 0, 420, 118, 12, 22, 0] },
    { dept: '정보보호', values: [0, 2, 14, 3, 6, 0, 4] },
  ],
});

export const schedules = (): ReportSchedule[] => [
  { name: '주간 보안 요약', when: '매주 월 08:30', to: '보안팀 · Slack #sec-gateway', on: true },
  { name: '월간 경영 보고', when: '매월 1일 09:00', to: 'CISO 외 3명 · 이메일 PDF', on: true },
  { name: '부서장 월간 리포트', when: '매월 첫 영업일', to: '부서장 6명 · 본인 부서만', on: false },
];

export const portalProfile = (): PortalProfile => ({ name: '김민지', dept: '연구소', extension: 'v0.3.1', policyRev: 14 });

export const portalRecent = (): PortalRecent[] => [
  { id: 'p1', t: '14:32', site: 'chatgpt.com', what: '조성비 3 · 공급처 1', result: 'redact', flagged: false },
  { id: 'p2', t: '13:05', site: 'claude.ai', what: '파일 2개 · 계좌번호 1', result: 'file', flagged: false },
  { id: 'p3', t: '11:48', site: 'chatgpt.com', what: 'API 키', result: 'block', flagged: false },
  { id: 'p4', t: '10:20', site: 'chatgpt.com', what: '이름 1 · 이메일 1', result: 'redact', flagged: false },
  { id: 'p5', t: '어제 17:02', site: 'claude.ai', what: '탐지 없음', result: 'clean', flagged: false },
  { id: 'p6', t: '어제 15:40', site: 'chatgpt.com', what: '회의실 사용률 72.4% (조성비로 판단)', result: 'redact', flagged: false },
];

export const portalRequests = (): PortalRequest[] => [
  { id: 'EXC-0142', status: 'PENDING', title: '조성비 포함 문서 번역 (1회)', note: '보안관리자 결정 대기 중이에요. 보통 2시간 안에 결정돼요.', when: '오늘 14:05', scope: 'ChatGPT · 1회' },
  { id: 'EXC-0137', status: 'APPROVED', title: 'OEM 배합 변경 요청서 번역', note: '1회 허용 · 사용 완료. 다음엔 내부 번역 모델을 먼저 써 보라는 메모가 있어요.', when: '10.24', scope: 'ChatGPT · 1회' },
  { id: 'EXC-0121', status: 'REJECTED', title: '고객 연락처 포함 메일 초안', note: '연락처 없이도 초안 작성이 가능해 반려됐어요. 가림 상태로 보내면 답변에서 복원돼요.', when: '10.18', scope: 'Claude · 24시간' },
];

export const history = (): HistoryEntry[] => [
  {
    id: 'h1', title: '고객 안내문 초안', when: '오늘 14:32', day: 0, site: 'chatgpt.com', kind: '텍스트', icon: 'TXT',
    rows: [
      { masked: '홍*동', type: '이름', to: '[사람_1]', how: 'ph', result: '복원됨' },
      { masked: 'kim@c••••.co.kr', type: '이메일', to: 'customer@example.com', how: 'alias', result: '복원됨' },
      { masked: '정제수 7•.•%', type: '조성비', to: '[조성비_1]', how: 'ph', result: '복원됨' },
    ],
    wire: [{ t: '고객 ' }, { t: '[사람_1]', how: 'ph' }, { t: ' 메일 ' }, { t: 'customer@example.com', how: 'alias' }, { t: ' ' }, { t: '[조성비_1]', how: 'ph' }, { t: ' 배합' }],
  },
  {
    id: 'h2', title: '견적서 · 배합표 비교', when: '오늘 13:05', day: 0, site: 'claude.ai', kind: '파일 2개', icon: 'FILE',
    rows: [
      { masked: '계좌번호 1건', type: '계좌번호', to: '■■■ (검은 박스)', how: 'ph', result: '해당 없음' },
      { masked: '한빛케••', type: '공급처', to: '공급사A', how: 'alias', result: '복원됨' },
      { masked: '조성비 48건', type: '조성비', to: '[조성비_1…48]', how: 'ph', result: '복원 12건' },
    ],
    wire: [{ t: '견적서_한빛케미칼_가림.pdf · 배합표_v3_가림.xlsx 첨부 + "원가 차이 정리해줘"' }],
  },
  {
    id: 'h3', title: 'INCI 성분표 번역', when: '어제 16:20', day: 1, site: 'chatgpt.com', kind: '텍스트', icon: 'TXT',
    rows: [
      { masked: '나이아신아마이드 5%', type: '조성비', to: '원료 X%', how: 'alias', result: '복원됨' },
      { masked: '회의실 72.4%', type: '조성비로 판단', to: '회의실 72.4%', how: 'keep', result: '원문 전송' },
    ],
    wire: [{ t: '원료 X%', how: 'alias' }, { t: ' 기준 영문 표기 정리, ' }, { t: '회의실 72.4%', how: 'keep' }, { t: ' 사용률은 참고만' }],
  },
  {
    id: 'h4', title: '거래처 메일 회신', when: '10.23 11:02', day: 4, site: 'claude.ai', kind: '텍스트', icon: 'TXT',
    rows: [
      { masked: '박*연', type: '이름', to: '[사람_1]', how: 'ph', result: '복원 안 됨 (모델 미사용)' },
      { masked: '010-••••-5678', type: '휴대폰번호', to: '[전화_1]', how: 'ph', result: '복원됨' },
    ],
    wire: [{ t: '[사람_1]', how: 'ph' }, { t: ' 님께 ' }, { t: '[전화_1]', how: 'ph' }, { t: '로 연락 가능하다고 회신' }],
  },
];

export const aliases = () => [
  { type: '이름', to: '고객A · 고객B …' },
  { type: '이메일', to: 'customer@example.com' },
  { type: '조성비', to: '원료 X%' },
  { type: '원료 공급처', to: '공급사A' },
  { type: '휴대폰번호', to: '010-0000-0000' },
];
