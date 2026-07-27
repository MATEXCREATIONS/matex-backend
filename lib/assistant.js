export function buildAssistantResponse(rawQuery) {
  const query = String(rawQuery || '').trim().toLowerCase();

  if (!query) {
    return {
      text: 'I can help with services, order tracking, payments, revisions, and support. Tell me what you need and I will guide you to the next step.',
      suggestions: ['Show services', 'Track my order', 'Open Support'],
      actions: [{ type: 'open_support', label: 'Open Support' }]
    };
  }

  if (/(track|status|progress|where is my order|order update|delivery)/.test(query)) {
    return {
      text: 'I can help you track your order progress and keep you updated on delivery, revisions, and next steps.',
      suggestions: ['Track my order', 'Open Support', 'Check revisions'],
      actions: [{ type: 'open_support', label: 'Open Support' }]
    };
  }

  if (/(pay|payment|invoice|deposit|balance|funds)/.test(query)) {
    return {
      text: 'I can help you with payment steps, balance reminders, invoice questions, and the next best action for your order.',
      suggestions: ['Payment help', 'Open Support', 'Check order summary'],
      actions: [{ type: 'open_support', label: 'Open Support' }]
    };
  }

  if (/(revision|revise|redo|change|edit)/.test(query)) {
    return {
      text: 'I can help you request revisions and explain what is included in your current package.',
      suggestions: ['Request revisions', 'Open Support', 'Review package'],
      actions: [{ type: 'open_support', label: 'Open Support' }]
    };
  }

  if (/(service|services|quote|pricing|package|design|video|branding|logo)/.test(query)) {
    return {
      text: 'I can guide you through our services, recommend the right package, and connect you to support for the next step.',
      suggestions: ['Show services', 'Get a quote', 'Open Support'],
      actions: [{ type: 'open_support', label: 'Open Support' }]
    };
  }

  return {
    text: 'I can help with services, order tracking, payments, revisions, and support. Tell me what you need and I will guide you to the right next step.',
    suggestions: ['Show services', 'Track my order', 'Open Support'],
    actions: [{ type: 'open_support', label: 'Open Support' }]
  };
}
