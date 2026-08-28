/**
 * Limits shared between the composer and the API.
 *
 * The cap lives here rather than inline in the route because the composer now
 * has three ways to put text in the box that a person never typed -- speech,
 * OCR and PDF extraction -- and any of them can overrun a limit the client
 * cannot see. Sharing the constant means the box truncates and says so,
 * instead of the request coming back 400.
 */

export const MAX_QUESTION_CHARS = 1000;
