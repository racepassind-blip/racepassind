export const INDIAN_MOBILE_PATTERN = /^(?:\+91|0091|0)?[6-9]\d{9}$/;

export const isValidIndianMobile = (value: string) =>
  INDIAN_MOBILE_PATTERN.test(value.replace(/[\s()-]/g, ""));

