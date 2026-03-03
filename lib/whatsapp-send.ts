/**
 * WhatsApp Send Message Utility
 * Unified interface for sending WhatsApp messages from the Inbox
 */

import { getWhatsAppCredentials, type WhatsAppCredentials } from '@/lib/whatsapp-credentials'
import { buildTextMessage } from '@/lib/whatsapp/text'
import { fetchWithTimeout, safeJson, safeText } from '@/lib/server-http'
import { normalizePhoneNumber } from '@/lib/phone-formatter'

export interface SendWhatsAppMessageOptions {
  to: string
  type: 'text' | 'template'
  // Text message
  text?: string
  previewUrl?: boolean
  replyToMessageId?: string
  // Template message
  templateName?: string
  templateParams?: Record<string, string[]>
  // Credentials override (optional - will fetch from settings if not provided)
  credentials?: WhatsAppCredentials
}

export interface SendWhatsAppMessageResult {
  success: boolean
  messageId?: string
  error?: string
  details?: unknown
}

/**
 * Send a WhatsApp message (text or template)
 *
 * @param options - Message options
 * @returns Result with messageId on success or error on failure
 */
export async function sendWhatsAppMessage(
  options: SendWhatsAppMessageOptions
): Promise<SendWhatsAppMessageResult> {
  // Get credentials
  const credentials = options.credentials || await getWhatsAppCredentials()

  if (!credentials) {
    return { success: false, error: 'WhatsApp credentials not found in database' }
  }

  // Normalize phone number
  const normalizedTo = normalizePhoneNumber(options.to)
  if (!normalizedTo || !/^\+\d{8,15}$/.test(normalizedTo)) {
    return { success: false, error: `Invalid phone number: ${options.to}` }
  }

  // --- Evolution API Routing ---
  if (credentials.evolutionApiUrl && credentials.evolutionApiKey && credentials.evolutionInstanceName) {
    return sendEvolutionWhatsAppMessage(options, credentials as Required<Pick<WhatsAppCredentials, 'evolutionApiUrl' | 'evolutionApiKey' | 'evolutionInstanceName'>>, normalizedTo);
  }

  // --- Meta API Routing ---
  if (!credentials.accessToken || !credentials.phoneNumberId) {
    return { success: false, error: 'Meta WhatsApp credentials not configured' }
  }

  // Build payload based on type
  let payload: Record<string, unknown>

  if (options.type === 'template' && options.templateName) {
    payload = buildTemplatePayload(normalizedTo, options.templateName, options.templateParams)
  } else {
    // Default to text
    const textPayload = buildTextMessage({
      to: normalizedTo,
      text: options.text || '',
      previewUrl: options.previewUrl,
      replyToMessageId: options.replyToMessageId,
    })
    payload = textPayload as unknown as Record<string, unknown>
  }

  // Send to WhatsApp API
  try {
    const response = await fetchWithTimeout(
      `https://graph.facebook.com/v24.0/${credentials.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeoutMs: 8000,
      }
    )

    const data = await safeJson(response)

    if (!response.ok) {
      const details = data ?? (await safeText(response))
      const metaError =
        typeof details === 'object' && details !== null && 'error' in details
          ? (details as { error?: { message?: string; code?: number } }).error
          : undefined

      return {
        success: false,
        error: metaError?.message || 'WhatsApp send failed',
        details,
      }
    }

    // Extract message ID from response
    const messageId = extractMessageId(data)
    return { success: true, messageId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send message',
    }
  }
}

/**
 * Handle Evolution API Sending Logic
 */
async function sendEvolutionWhatsAppMessage(
  options: SendWhatsAppMessageOptions,
  credentials: Required<Pick<WhatsAppCredentials, 'evolutionApiUrl' | 'evolutionApiKey' | 'evolutionInstanceName'>>,
  normalizedTo: string
): Promise<SendWhatsAppMessageResult> {
  const number = normalizedTo.replace('+', '') // Evolution typically expects number without +
  const url = `${credentials.evolutionApiUrl}/message/sendText/${credentials.evolutionInstanceName}`

  let text = options.text || ''

  // Format Template to Text if Evolution is used (Evolution doesn't use Meta Templates)
  if (options.type === 'template' && options.templateName) {
    text = `[Template: ${options.templateName}]`
    if (options.templateParams?.header) text += `\n${options.templateParams.header.join(' ')}`
    if (options.templateParams?.body) text += `\n${options.templateParams.body.join(' ')}`
  }

  const payload: Record<string, unknown> = {
    number,
    text,
    options: {
      delay: 1200,
    }
  }

  if (options.replyToMessageId) {
    payload.quoted = { key: { id: options.replyToMessageId } }
  }

  try {
    const response = await fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'apikey': credentials.evolutionApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      timeoutMs: 8000,
    })

    const data = await safeJson(response)
    if (!response.ok) {
      return { success: false, error: 'Evolution API send failed', details: data }
    }

    const messageId = (data as any)?.key?.id || undefined
    return { success: true, messageId }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Evolution API send error' }
  }
}

/**
 * Build template message payload
 */
function buildTemplatePayload(
  to: string,
  templateName: string,
  params?: Record<string, string[]>
): Record<string, unknown> {
  const components: Array<{ type: string; parameters: Array<{ type: string; text: string }> }> = []

  // Add body parameters if provided
  if (params?.body && params.body.length > 0) {
    components.push({
      type: 'body',
      parameters: params.body.map((text) => ({ type: 'text', text })),
    })
  }

  // Add header parameters if provided
  if (params?.header && params.header.length > 0) {
    components.push({
      type: 'header',
      parameters: params.header.map((text) => ({ type: 'text', text })),
    })
  }

  return {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'pt_BR' },
      ...(components.length > 0 ? { components } : {}),
    },
  }
}

/**
 * Extract message ID from WhatsApp API response
 */
function extractMessageId(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined

  const response = data as { messages?: Array<{ id?: string }> }
  return response.messages?.[0]?.id
}

// =============================================================================
// TYPING INDICATOR
// =============================================================================

export interface SendTypingIndicatorOptions {
  /** The message ID from the received message (required by Meta API) */
  messageId: string
  /** Credentials override */
  credentials?: WhatsAppCredentials
}

/**
 * Send a typing indicator ("digitando...") to the user
 *
 * According to Meta docs (Oct 2025):
 * - Requires the message_id from a received message
 * - Typing indicator is dismissed after response OR after 25 seconds
 * - Only show if you're going to respond
 *
 * @param options - Typing indicator options
 * @returns Result with success status
 */
export async function sendTypingIndicator(
  options: SendTypingIndicatorOptions
): Promise<{ success: boolean; error?: string }> {
  const credentials = options.credentials || await getWhatsAppCredentials()
  if (credentials?.evolutionApiUrl && credentials?.evolutionApiKey && credentials?.evolutionInstanceName) {
    // Evolution API Typing Indicator
    try {
      const url = `${credentials.evolutionApiUrl}/chat/sendPresence/${credentials.evolutionInstanceName}`
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'apikey': credentials.evolutionApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          number: options.messageId, // Note: Evolution uses remoteJid/number here usually
          presence: "composing",
          delay: 5000
        }),
        timeoutMs: 5000,
      })
      if (!response.ok) return { success: false, error: 'Typing indicator failed (Evolution API)' }
      return { success: true }
    } catch {
      return { success: false, error: 'Typing indicator error (Evolution API)' }
    }
  }

  if (!credentials?.accessToken || !credentials?.phoneNumberId) {
    return { success: false, error: 'WhatsApp credentials not configured' }
  }

  try {
    const response = await fetchWithTimeout(
      `https://graph.facebook.com/v24.0/${credentials.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: options.messageId,
          typing_indicator: {
            type: 'text',
          },
        }),
        timeoutMs: 5000,
      }
    )

    if (!response.ok) {
      const data = await safeJson(response)
      const metaError = data?.error?.message || 'Typing indicator failed'
      console.warn(`[whatsapp-send] Typing indicator failed: ${metaError}`)
      return { success: false, error: metaError }
    }

    return { success: true }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.warn(`[whatsapp-send] Typing indicator error: ${errorMsg}`)
    return { success: false, error: errorMsg }
  }
}

// =============================================================================
// REACTION MESSAGE
// =============================================================================

export interface SendReactionOptions {
  /** Recipient phone number */
  to: string
  /** The message ID to react to (whatsapp_message_id from inbound message) */
  messageId: string
  /** The emoji to react with */
  emoji: string
  /** Credentials override */
  credentials?: WhatsAppCredentials
}

/**
 * Send a reaction (emoji) to a user's message
 *
 * According to Meta docs:
 * - Reaction appears attached to the original message
 * - Only works on messages less than 30 days old
 * - To remove a reaction, send an empty emoji string
 *
 * @param options - Reaction options
 * @returns Result with success status
 */
export async function sendReaction(
  options: SendReactionOptions
): Promise<{ success: boolean; error?: string }> {
  const credentials = options.credentials || await getWhatsAppCredentials()
  // Normalize phone number
  const normalizedTo = normalizePhoneNumber(options.to)
  if (!normalizedTo || !/^\+\d{8,15}$/.test(normalizedTo)) {
    return { success: false, error: `Invalid phone number: ${options.to}` }
  }

  if (credentials?.evolutionApiUrl && credentials?.evolutionApiKey && credentials?.evolutionInstanceName) {
    try {
      const url = `${credentials.evolutionApiUrl}/message/sendReaction/${credentials.evolutionInstanceName}`
      const response = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'apikey': credentials.evolutionApiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          number: normalizedTo.replace('+', ''),
          reaction: options.emoji,
          messageId: options.messageId
        }),
        timeoutMs: 5000,
      })
      if (!response.ok) return { success: false, error: 'Reaction failed (Evolution API)' }
      return { success: true }
    } catch (e) {
      return { success: false, error: 'Reaction error (Evolution API)' }
    }
  }

  if (!credentials?.accessToken || !credentials?.phoneNumberId) {
    return { success: false, error: 'WhatsApp credentials not configured' }
  }

  try {
    const response = await fetchWithTimeout(
      `https://graph.facebook.com/v24.0/${credentials.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: normalizedTo.replace('+', ''), // API expects without +
          type: 'reaction',
          reaction: {
            message_id: options.messageId,
            emoji: options.emoji,
          },
        }),
        timeoutMs: 5000,
      }
    )

    if (!response.ok) {
      const data = await safeJson(response)
      const metaError = data?.error?.message || 'Reaction failed'
      console.warn(`[whatsapp-send] Reaction failed: ${metaError}`)
      return { success: false, error: metaError }
    }

    console.log(`[whatsapp-send] Reaction ${options.emoji} sent to message ${options.messageId}`)
    return { success: true }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    console.warn(`[whatsapp-send] Reaction error: ${errorMsg}`)
    return { success: false, error: errorMsg }
  }
}

// =============================================================================
// FLOW MESSAGE
// =============================================================================

export interface SendFlowMessageOptions {
  /** Recipient phone number */
  to: string
  /** Meta Flow ID (from published flow) */
  flowId: string
  /** Unique token for this flow session */
  flowToken?: string
  /** Body text shown before the CTA button */
  bodyText: string
  /** Call-to-action button text */
  ctaText?: string
  /** Header text (optional) */
  headerText?: string
  /** Footer text (optional, max 60 chars) */
  footerText?: string
  /** Flow action type */
  flowAction?: 'navigate' | 'data_exchange'
  /** Credentials override */
  credentials?: WhatsAppCredentials
}

/**
 * Send a WhatsApp Flow (interactive form) message
 *
 * @param options - Flow message options
 * @returns Result with messageId on success or error on failure
 */
export async function sendFlowMessage(
  options: SendFlowMessageOptions
): Promise<SendWhatsAppMessageResult> {
  // Get credentials
  const credentials = options.credentials || (await getWhatsAppCredentials())
  // Normalize phone number
  const normalizedTo = normalizePhoneNumber(options.to)
  if (!normalizedTo || !/^\+\d{8,15}$/.test(normalizedTo)) {
    return { success: false, error: `Invalid phone number: ${options.to}` }
  }

  if (credentials?.evolutionApiUrl && credentials?.evolutionApiKey && credentials?.evolutionInstanceName) {
    // Flow/Interactive messages are handled differently in Evolution API (Baileys).
    // Let's send a fallback text message with the CTA since true "Meta Flows" might not be compatible.
    const url = `${credentials.evolutionApiUrl}/message/sendText/${credentials.evolutionInstanceName}`
    const text = `[Flow: ${options.flowId}]\n${options.headerText ? options.headerText + '\n' : ''}${options.bodyText}\nAcesse o flow via link.\n${options.footerText || ''}`

    try {
      const resp = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'apikey': credentials.evolutionApiKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ number: normalizedTo.replace('+', ''), text }),
        timeoutMs: 8000,
      })
      const data = await safeJson(resp)
      if (!resp.ok) return { success: false, error: 'Evolution flow text failed', details: data }
      return { success: true, messageId: (data as any)?.key?.id }
    } catch (e) {
      return { success: false, error: 'Failed to send Evolution flow message' }
    }
  }

  if (!credentials?.accessToken || !credentials?.phoneNumberId) {
    return { success: false, error: 'Meta WhatsApp credentials not configured' }
  }

  // Generate flow token if not provided
  const flowToken = options.flowToken || `smartzap:${options.flowId}:${Date.now()}`

  // Build flow message payload
  const payload: Record<string, unknown> = {
    messaging_product: 'whatsapp',
    to: normalizedTo,
    type: 'interactive',
    interactive: {
      type: 'flow',
      body: { text: options.bodyText },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_id: options.flowId,
          flow_token: flowToken,
          flow_cta: options.ctaText || 'Abrir',
          flow_action: options.flowAction || 'navigate',
        },
      },
    },
  }

  // Add optional header
  if (options.headerText) {
    ; (payload.interactive as Record<string, unknown>).header = {
      type: 'text',
      text: options.headerText,
    }
  }

  // Add optional footer
  if (options.footerText) {
    const footer = options.footerText.substring(0, 60)
      ; (payload.interactive as Record<string, unknown>).footer = { text: footer }
  }

  // Send to WhatsApp API
  try {
    const response = await fetchWithTimeout(
      `https://graph.facebook.com/v24.0/${credentials.phoneNumberId}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        timeoutMs: 8000,
      }
    )

    const data = await safeJson(response)

    if (!response.ok) {
      const details = data ?? (await safeText(response))
      const metaError =
        typeof details === 'object' && details !== null && 'error' in details
          ? (details as { error?: { message?: string; code?: number } }).error
          : undefined

      return {
        success: false,
        error: metaError?.message || 'WhatsApp flow send failed',
        details,
      }
    }

    const messageId = extractMessageId(data)
    return { success: true, messageId }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send flow message',
    }
  }
}
