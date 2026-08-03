function mergeOrderForPersistence(existingOrder, incomingOrder = {}, updatePayload = {}) {
  const base = existingOrder && typeof existingOrder === 'object' ? { ...existingOrder } : {};
  const incoming = incomingOrder && typeof incomingOrder === 'object' ? { ...incomingOrder } : {};
  const updates = updatePayload && typeof updatePayload === 'object' ? { ...updatePayload } : {};

  const merged = { ...base, ...incoming, ...updates };

  if (!merged.order_id) {
    merged.order_id = incoming.order_id || base.order_id || updates.order_id || null;
  }

  if (merged.client_name == null || merged.client_name === '') {
    merged.client_name = base.client_name || incoming.client_name || updates.client_name || null;
  }

  if (merged.client_email == null || merged.client_email === '') {
    merged.client_email = base.client_email || incoming.client_email || updates.client_email || null;
  }

  if (merged.whatsapp_number == null || merged.whatsapp_number === '') {
    merged.whatsapp_number = base.whatsapp_number || incoming.whatsapp_number || updates.whatsapp_number || null;
  }

  if (merged.service_name == null || merged.service_name === '') {
    merged.service_name = base.service_name || incoming.service_name || updates.service_name || null;
  }

  if (merged.amount == null && typeof base.amount !== 'undefined') {
    merged.amount = base.amount;
  }

  if (merged.amount_paid == null && typeof base.amount_paid !== 'undefined') {
    merged.amount_paid = base.amount_paid;
  }

  if (merged.amount_remaining == null && typeof base.amount_remaining !== 'undefined') {
    merged.amount_remaining = base.amount_remaining;
  }

  if (merged.payment_type == null || merged.payment_type === '') {
    merged.payment_type = base.payment_type || incoming.payment_type || updates.payment_type || null;
  }

  if (merged.payment_plan == null || merged.payment_plan === '') {
    merged.payment_plan = base.payment_plan || incoming.payment_plan || updates.payment_plan || null;
  }

  if (merged.payment_status == null || merged.payment_status === '') {
    merged.payment_status = base.payment_status || incoming.payment_status || updates.payment_status || 'Pending';
  }

  if (merged.payment_reference == null || merged.payment_reference === '') {
    merged.payment_reference = base.payment_reference || incoming.payment_reference || updates.payment_reference || null;
  }

  if (merged.order_status == null || merged.order_status === '') {
    merged.order_status = base.order_status || incoming.order_status || updates.order_status || 'Pending';
  }

  if (merged.latest_progress == null || merged.latest_progress === '') {
    merged.latest_progress = base.latest_progress || incoming.latest_progress || updates.latest_progress || 'Order created';
  }

  if (merged.created_at == null || merged.created_at === '') {
    merged.created_at = base.created_at || incoming.created_at || updates.created_at || new Date().toISOString();
  }

  return merged;
}

export { mergeOrderForPersistence };
