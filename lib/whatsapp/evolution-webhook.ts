import { NextResponse } from 'next/server'
import { handleInboundMessage, handleDeliveryStatus } from '@/lib/inbox/inbox-webhook'

export async function handleEvolutionWebhook(body: any) {
    try {
        const { event, instance, data } = body

        if (!data) {
            return NextResponse.json({ status: 'ignored' })
        }

        if (event === 'messages.upsert') {
            const msgData = data.message || data
            const key = msgData?.key

            // Ignore messages sent by the bot itself
            if (key?.fromMe) {
                return NextResponse.json({ status: 'ignored', reason: 'fromMe' })
            }

            const remoteJid = key?.remoteJid || ''
            // Ignore group messages (usually ends with @g.us)
            if (remoteJid.includes('@g.us')) {
                return NextResponse.json({ status: 'ignored', reason: 'group message' })
            }

            const phoneNumber = remoteJid.replace('@s.whatsapp.net', '')
            const messageObj = msgData?.message || {}

            let text = ''
            let type = 'text'
            let mediaUrl = null

            if (messageObj.conversation) {
                text = messageObj.conversation
            } else if (messageObj.extendedTextMessage?.text) {
                text = messageObj.extendedTextMessage.text
            } else if (messageObj.imageMessage) {
                type = 'image'
                text = messageObj.imageMessage.caption || ''
                // Evolution API usually sends base64 or requires fetching media via endpoint.
                // For now we leave mediaUrl null or handle it if Evolution includes URL.
            } else if (messageObj.audioMessage) {
                type = 'audio'
            } else if (messageObj.videoMessage) {
                type = 'video'
                text = messageObj.videoMessage.caption || ''
            } else if (messageObj.documentMessage) {
                type = 'document'
                text = messageObj.documentMessage.fileName || ''
            } else {
                type = 'unknown'
            }

            await handleInboundMessage({
                messageId: key?.id || '',
                from: phoneNumber,
                type,
                text,
                timestamp: (msgData?.messageTimestamp || Math.floor(Date.now() / 1000)).toString(),
                mediaUrl,
                phoneNumberId: instance // Use instance name as phoneNumberId for identification
            })

            return NextResponse.json({ status: 'success' })
        }

        if (event === 'messages.update') {
            // data is usually an array
            const updates = Array.isArray(data) ? data : [data]

            for (const updateObj of updates) {
                const key = updateObj?.key
                const statusVal = updateObj?.update?.status

                if (!key?.id || statusVal === undefined) continue

                let mappedStatus: 'sent' | 'delivered' | 'read' | 'failed' | null = null

                // Baileys enum: 2 = Server (sent), 3 = Delivery (delivered), 4 = Read, 5 = Played
                if (statusVal === 2) mappedStatus = 'sent'
                else if (statusVal === 3) mappedStatus = 'delivered'
                else if (statusVal >= 4) mappedStatus = 'read'
                else if (statusVal === 0) mappedStatus = 'failed' // Usually errors are represented differently

                if (mappedStatus) {
                    await handleDeliveryStatus({
                        messageId: key.id,
                        status: mappedStatus,
                        timestamp: new Date().toISOString()
                    })
                }
            }

            return NextResponse.json({ status: 'success' })
        }

        return NextResponse.json({ status: 'ignored', reason: 'unhandled event' })
    } catch (error) {
        console.error('Evolution Webhook Error:', error)
        return NextResponse.json({ status: 'error' }, { status: 500 })
    }
}
