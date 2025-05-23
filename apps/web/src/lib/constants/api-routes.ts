export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

export const API_ROUTES = {
  AUTH: {
    LOGIN: '/users/login',
    REGISTER: '/users/register',
    VERIFY_EMAIL: '/users/verify-email',
    RESEND_VERIFICATION: '/users/resend-verification',
    PROFILE: '/users/profile',
    CHANGE_PASSWORD: '/users/change-password',
    FORGOT_PASSWORD: '/users/forgot-password',
    RESET_PASSWORD: '/users/reset-password',
    GOOGLE: '/auth/google',
    FACEBOOK: '/auth/facebook',
    GITHUB: '/auth/github',
    SOCIAL_CALLBACK: '/auth/social-callback',
  },

  ACCOUNTS: {
    BASE: '/accounts',
    DETAIL: (id: string) => `/accounts/${id}`,
    SUMMARY: '/accounts/summary',
  },

  CONTACT: {
    SEND: '/contact/send',
    SUPPORT: '/contact/support',
    FEEDBACK: '/contact/feedback',
  },

  TRANSACTIONS: {
    BASE: '/transactions',
    DETAIL: (id: string) => `/transactions/${id}`,
    STATS: '/transactions/stats',
    ATTACHMENT: (transactionId: string, attachmentId: string) => 
      `/transactions/${transactionId}/attachments/${attachmentId}`,
  },

  CREDIT_CARDS: {
  BASE: '/credit-card',
  DETAIL: (id: string) => `/credit-card/${id}`,
  SUMMARY: '/credit-card/summary',
  BILLINGS: '/credit-card/billings',
  VALIDATE_SECURITY_CODE: (id: string) => `/credit-card/${id}/validate-security-code`,
  },

  CATEGORIES: {
    BASE: '/categories',
    DETAIL: (id: string) => `/categories/${id}`,
  },

  GOALS: {
    BASE: '/goals',
    DETAIL: (id: string) => `/goals/${id}`,
    STATS: '/goals/stats',
  },

  INVESTMENTS: {
    BASE: '/investments',
    DETAIL: (id: string) => `/investments/${id}`,
    SUMMARY: '/investments/summary',
    PERFORMANCE: '/investments/performance',
  },

  REPORTS: {
    GENERATE: '/reports/generate',
    INSIGHTS: '/reports/insights',
  },

  SUBSCRIPTIONS: {
    BASE: '/subscriptions',
    TRIAL: '/subscriptions/trial',
    CANCEL: '/subscriptions/cancel',
    PLAN: '/subscriptions/plan',
  },
  
  PAYMENTS: {
    CHECKOUT: '/payments/checkout',
    METHODS: '/payments/methods',
  },

  NOTIFICATIONS: {
    BASE: '/notifications',
    MARK_AS_READ: (id: string) => `/notifications/${id}/mark-as-read`,
    MARK_ALL_AS_READ: '/notifications/mark-all-as-read',
  },

  FILES: {
    AVATAR: (filename: string) => `/files/avatar/${filename}`,
    ATTACHMENT: (transactionId: string, attachmentId: string) => 
      `/files/attachment/${transactionId}/${attachmentId}`,
    DOWNLOAD: (transactionId: string, attachmentId: string) => 
      `/files/download/attachment/${transactionId}/${attachmentId}`,
  },
};