const RESPONSE_TEMPLATES = {
  default: {
    text: 'I can help with services, order tracking, payments, revisions, delivery, and support. Tell me what you need and I will guide you to the next best step.',
    suggestions: ['Show services', 'Track my order', 'Open Support'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  },
  tracking: {
    text: 'I can help you track your order status, delivery timeline, and next milestones. If you have an Order ID, keep it ready or open support for a faster update.',
    suggestions: ['Track my order', 'Open Support', 'Check delivery'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  },
  payment: {
    text: 'I can help with payment options, invoice reminders, deposit balances, and payment confirmation for your order.',
    suggestions: ['Payment help', 'Open Support', 'Check order summary'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  },
  revisions: {
    text: 'I can explain your revision allowance, what is included in your package, and how to request changes to your design.',
    suggestions: ['Request revisions', 'Open Support', 'Review package'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  },
  services: {
    text: 'I can guide you through our services and pricing, recommend the right package, and connect you to support for a custom quote.',
    suggestions: ['Show services', 'Get a quote', 'Open Support'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  },
  delivery: {
    text: 'I can help you understand delivery timelines, turnaround expectations, and how to escalate priority support if needed.',
    suggestions: ['Delivery timeline', 'Open Support', 'Order update'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  },
  escalation: {
    text: 'If this is urgent or needs escalation, I can connect you to support and ask the team to prioritize your issue.',
    suggestions: ['Open Support', 'Escalate issue', 'Track my order'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  }
};

const PATTERNS = [
  { regex: /(track|status|progress|where is my order|order update|delivery|timeline|due date|deadline)/, template: 'tracking' },
  { regex: /(pay|payment|invoice|deposit|balance|funds|checkout|billing)/, template: 'payment' },
  { regex: /(revision|revise|redo|change|edit|correction|feedback)/, template: 'revisions' },
  { regex: /(service|services|quote|pricing|package|design|video|branding|logo|identity|website|graphic)/, template: 'services' },
  { regex: /(portfolio|examples|work|samples|gallery)/, template: 'services' },
  { regex: /(delivery|timeline|turnaround|deadline|due date|ship|finish|complete)/, template: 'delivery' },
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
