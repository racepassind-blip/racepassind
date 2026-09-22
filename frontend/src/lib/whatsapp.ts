/** WhatsApp support configuration for SportPass India */

export const SPORTPASS_WHATSAPP_NUMBER = "917975374933";

/**
 * Create a WhatsApp support URL with the given message.
 * The URL opens WhatsApp web/app with a pre-filled message.
 */
export const createWhatsAppUrl = (message: string) => {
  return `https://wa.me/${SPORTPASS_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
};

/**
 * Default messages for different contexts
 */
export const WHATSAPP_MESSAGES = {
  /** For floating support button on any public page */
  generalSupport:
    "Hi SportPass India,\n\nI am a: Participant / Organizer\nName:\nClub / Organization Name:\nQuery:",

  /** For organizer landing page */
  organizerInterest:
    "Hi SportPass India,\n\nI am a: Organizer\nName:\nClub / Organization Name:\nQuery:\n\nI'm interested in using SportPass for my event.",

  /**
   * For event pages with dynamic event name
   * @param eventName - The name of the event
   */
  eventSupport: (eventName: string) =>
    `Hi SportPass India,\n\nI am a: Participant\nName:\nClub / Organization Name:\nQuery:\n\nI need help regarding ${eventName}.`,
};
