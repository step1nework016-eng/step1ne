export const CONFIG = Object.freeze({
  apiBase: 'https://step1ne-backoffice-worker.aiagentg888.workers.dev',
  recruitApiBase: 'https://step1ne-recruit-api.aiagentg888.workers.dev',
  tokenKey: 's1ne_admin_tok',
  analyticsQueueLimit: 500,
  livePollMs: 8000,
  detailPollMs: 5000
});

export const ROUTES = Object.freeze({
  home: '/consultant/',
  board: '/consultant/board/',
  daily: '/consultant/daily/',
  calllist: '/consultant/calllist/',
  bdcalls: '/consultant/bdcalls/',
  recruitment: '/consultant/recruitment/',
  casestatus: '/consultant/case-status/',
  seoreport: '/consultant/seo-report/',   // 2026-11-02 Jacky：搜尋成效週報放進帶案進度
  candidates: '/consultant/candidates/',
  jobs: '/consultant/jobs/',
  interviews: '/consultant/interviews/',
  linechat: '/consultant/linechat/',
  social: '/consultant/social/',
  clients: '/consultant/clients-workspace/',
  channels: '/consultant/channels/',
  mail: '/consultant/mail/',
  library: '/consultant/library/',
  clientboard: '/consultant/client-board/',
  onboarding: '/consultant/onboarding/',
  roles: '/consultant/agent-roles/',
  paths: '/consultant/candidate-paths/',
  billflow: '/consultant/billing-flow/',
  system: '/consultant/system/',
  // 2026-11-04 派遣模式
  d_today: '/consultant/dispatch/today/',
  d_people: '/consultant/dispatch/people/',
  d_jobs: '/consultant/dispatch/jobs/',
  d_clients: '/consultant/dispatch/clients/',
  d_settlement: '/consultant/dispatch/settlement/',
  d_guide: '/consultant/dispatch/guide/'
});

export const LEGACY_ROUTES = Object.freeze({
  '/consultant/dispatch/progress/': ['/consultant/dispatch/people/', ''],
  '/consultant/dispatch/billing/': ['/consultant/dispatch/settlement/', ''],
  '/consultant/overview/': ['/consultant/', ''],
  '/consultant/tracker/': ['/consultant/candidates/', 'workbench'],
  '/consultant/pipeline/': ['/consultant/candidates/', 'workbench'],
  '/consultant/sourced/': ['/consultant/candidates/', 'pool'],
  '/consultant/reports/': ['/consultant/candidates/', 'reports'],
  '/consultant/checkups/': ['/consultant/candidates/', 'checkups'],
  '/consultant/outreach/': ['/consultant/candidates/', 'outreach'],
  '/consultant/job-intake/': ['/consultant/jobs/', 'intake'],
  '/consultant/job-draft/': ['/consultant/jobs/', 'drafts'],
  '/consultant/must-check/': ['/consultant/jobs/', 'checks'],
  '/consultant/expertise/': ['/consultant/jobs/', 'expertise'],
  '/consultant/social-post/': ['/consultant/social/', 'workbench'],
  '/consultant/client-info/': ['/consultant/clients-workspace/', 'clients'],
  '/consultant/clients/': ['/consultant/clients-workspace/', 'clients'],
  '/consultant/bd/': ['/consultant/clients-workspace/', 'bd'],
  '/consultant/hiring-assessments/': ['/consultant/clients-workspace/', 'hiring'],
  '/consultant/billing/': ['/consultant/clients-workspace/', 'billing'],
  '/consultant/kpi/': ['/consultant/system/', 'kpi'],
  '/consultant/line-followup/': ['/consultant/system/', 'line'],
  '/consultant/line-bindings/': ['/consultant/system/', 'line'],
  '/consultant/token-usage/': ['/consultant/system/', 'token'],
  '/consultant/settings/': ['/consultant/system/', 'settings'],
  '/consultant/interview-spec/': ['/consultant/system/', 'spec']
});
