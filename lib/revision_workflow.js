function getRevisionCount(paymentType = '') {
  const normalized = String(paymentType || '').toLowerCase();
  if (normalized.includes('deposit')) return 2;
  if (normalized.includes('preview')) return 2;
  return 4;
}

function computeRevisionState(order = {}) {
  const paymentType = String(order.payment_type || order.paymentType || order.payment_plan || order.paymentPlan || '').trim();
  const allowed = Number.isFinite(Number(order.revisions_allowed))
    ? Number(order.revisions_allowed)
    : (Number.isFinite(Number(order.revision_count)) ? Number(order.revision_count) : getRevisionCount(paymentType));
  const used = Number.isFinite(Number(order.revisions_used))
    ? Number(order.revisions_used)
    : (Number.isFinite(Number(order.revision_count)) ? Number(order.revision_count) : 0);
  const remaining = Math.max(allowed - used, 0);
  return { allowed, used, remaining };
}

function getVisibleRevisionOptions(order = {}) {
  const state = computeRevisionState(order);
  const options = [];
  const used = Math.max(state.used, 0);
  const remaining = Math.max(state.remaining, 0);
  for (let index = used + 1; index <= state.allowed; index += 1) {
    options.push(`Revision Preview ${index}`);
  }
  if (remaining > 0 || options.length === 0) {
    options.push('Final Delivery');
    options.push('Receipt');
  }
  return options;
}

function getFileCategoryLabel(fileType = '') {
  const normalized = String(fileType || '').trim().toLowerCase();
  if (normalized === 'final') return 'Final Delivery';
  if (normalized === 'receipt' || normalized === 'receipts') return 'Receipts';
  if (normalized === 'revision' || normalized === 'preview' || normalized === 'revision preview' || normalized === 'revision preview files') return 'Revision Preview Files';
  return 'Attachment';
}

function getUploadFileType(fileCategory = '') {
  const normalized = String(fileCategory || '').trim().toLowerCase();
  if (normalized.includes('final')) return 'final';
  if (normalized.includes('receipt')) return 'receipt';
  return 'revision';
}

export {
  getRevisionCount,
  computeRevisionState,
  getVisibleRevisionOptions,
  getFileCategoryLabel,
  getUploadFileType
};
