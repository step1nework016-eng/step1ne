export const CONFIG = Object.freeze({
  apiBase: 'https://step1ne-backoffice-worker.aiagentg888.workers.dev',
  recruitApiBase: 'https://step1ne-recruit-api.aiagentg888.workers.dev',
  tokenKey: 's1ne_admin_tok',
  analyticsQueueLimit: 500,
  livePollMs: 8000,
  detailPollMs: 5000
});

export const ROUTES = Object.freeze({
  home: '/consultant-beta/',
  board: '/consultant-beta/board/',
  daily: '/consultant-beta/daily/',
  calllist: '/consultant-beta/calllist/',
  bdcalls: '/consultant-beta/bdcalls/',
  recruitment: '/consultant-beta/recruitment/',
  casestatus: '/consultant-beta/case-status/',
  candidates: '/consultant-beta/candidates/',
  jobs: '/consultant-beta/jobs/',
  interviews: '/consultant-beta/interviews/',
  linechat: '/consultant-beta/linechat/',
  social: '/consultant-beta/social/',
  clients: '/consultant-beta/clients-workspace/',
  channels: '/consultant-beta/channels/',
  mail: '/consultant-beta/mail/',
  onboarding: '/consultant-beta/onboarding/',
  roles: '/consultant-beta/agent-roles/',
  system: '/consultant-beta/system/'
});

export const LEGACY_ROUTES = Object.freeze({
  '/consultant-beta/overview/': ['/consultant-beta/', ''],
  '/consultant-beta/tracker/': ['/consultant-beta/candidates/', 'workbench'],
  '/consultant-beta/pipeline/': ['/consultant-beta/candidates/', 'workbench'],
  '/consultant-beta/sourced/': ['/consultant-beta/candidates/', 'pool'],
  '/consultant-beta/reports/': ['/consultant-beta/candidates/', 'reports'],
  '/consultant-beta/checkups/': ['/consultant-beta/candidates/', 'checkups'],
  '/consultant-beta/outreach/': ['/consultant-beta/candidates/', 'outreach'],
  '/consultant-beta/job-intake/': ['/consultant-beta/jobs/', 'intake'],
  '/consultant-beta/job-draft/': ['/consultant-beta/jobs/', 'drafts'],
  '/consultant-beta/must-check/': ['/consultant-beta/jobs/', 'checks'],
  '/consultant-beta/expertise/': ['/consultant-beta/jobs/', 'expertise'],
  '/consultant-beta/social-post/': ['/consultant-beta/social/', 'workbench'],
  '/consultant-beta/client-info/': ['/consultant-beta/clients-workspace/', 'clients'],
  '/consultant-beta/clients/': ['/consultant-beta/clients-workspace/', 'clients'],
  '/consultant-beta/bd/': ['/consultant-beta/clients-workspace/', 'bd'],
  '/consultant-beta/hiring-assessments/': ['/consultant-beta/clients-workspace/', 'hiring'],
  '/consultant-beta/billing/': ['/consultant-beta/clients-workspace/', 'billing'],
  '/consultant-beta/kpi/': ['/consultant-beta/system/', 'kpi'],
  '/consultant-beta/line-followup/': ['/consultant-beta/system/', 'line'],
  '/consultant-beta/line-bindings/': ['/consultant-beta/system/', 'line'],
  '/consultant-beta/token-usage/': ['/consultant-beta/system/', 'token'],
  '/consultant-beta/settings/': ['/consultant-beta/system/', 'settings'],
  '/consultant-beta/interview-spec/': ['/consultant-beta/system/', 'spec']
});
