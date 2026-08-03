const RESPONSE_TEMPLATES = {
  default: {
    text: 'I can help you learn about Matex services, payment plans, revisions, delivery times, order tracking, and the Pay After Preview option. I can also guide you toward a stronger brief or connect you to support if you need a human.',
    suggestions: ['Show services', 'Explain payment plans', 'Track my order', 'Open Support'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  },
  tracking: {
    text: 'You can track your order using your Order ID in the tracking section. If you do not have it handy, I can help you find it or connect you to support for a quicker follow-up.',
    suggestions: ['Find my Order ID', 'Track my order', 'Open Support'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  },
  payment: {
    text: 'Matex offers full payment, deposit options, and Pay After Preview. Pay After Preview lets you submit your project brief first and pay later after preview approval, while full payment and deposit use Paystack.',
    suggestions: ['Explain payment plans', 'What is Pay After Preview?', 'Open Support'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  },
  revisions: {
    text: 'Revision allowances depend on the package you choose. Full payment projects usually include more revision rounds, while smaller packages have fewer included changes. I can help explain which option fits your project best.',
    suggestions: ['Review package', 'Request revisions', 'Open Support'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  },
  services: {
    text: 'Matex Creations can help with brand identity, graphic design, video editing, and more. I can recommend the service that best matches your goal and help you write a stronger brief.',
    suggestions: ['Recommend a service', 'Help me write a brief', 'Open Support'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  },
  delivery: {
    text: 'Delivery times vary by service and complexity, but I can help you estimate the turnaround and explain the next steps once your brief is submitted.',
    suggestions: ['Delivery timeline', 'Open Support', 'Track my order'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  },
  escalation: {
    text: 'If this is urgent or needs a human, I can escalate it to support and make sure the team reviews it quickly.',
    suggestions: ['Open Support', 'Escalate issue', 'Track my order'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  }
};

const PATTERNS = [
  { regex: /(pay after preview|preview|pay-preview|preview approval|pay later)/, template: 'payment' },
  { regex: /(order id|find my order id|where is my order id|order number)/, template: 'tracking' },
  { regex: /(delivery|timeline|turnaround|deadline|due date|ship|finish|complete)/, template: 'delivery' },
  { regex: /(track|status|progress|where is my order|order update|due date|deadline)/, template: 'tracking' },
  { regex: /(pay|payment|invoice|deposit|balance|funds|checkout|billing)/, template: 'payment' },
  { regex: /(revision|revise|redo|change|edit|correction|feedback)/, template: 'revisions' },
  { regex: /(service|services|quote|pricing|package|design|video|branding|logo|identity|website|graphic|recommend)/, template: 'services' },
  { regex: /(portfolio|examples|work|samples|gallery|brief|project brief|write a brief)/, template: 'services' },
  { regex: /(support|help|issue|problem|urgent|escalate|priority|admin|customer space|dashboard)/, template: 'escalation' }
];

export function buildAssistantResponse(rawQuery) {
  const query = String(rawQuery || '').trim().toLowerCase();
  if (!query) {
    return { ...RESPONSE_TEMPLATES.default, template: 'default' };
  }

  for (const pattern of PATTERNS) {
    if (pattern.regex.test(query)) {
      const template = pattern.template || 'default';
      return { ...RESPONSE_TEMPLATES[template] || RESPONSE_TEMPLATES.default, template };
    }
  }

  return { ...RESPONSE_TEMPLATES.default, template: 'default' };
}
