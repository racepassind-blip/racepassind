export function productOrderReference(orderId: string): string {
  return `SPM-${orderId.replace(/-/g, "").slice(0, 12).toUpperCase()}`;
}
