import { Telegraf } from 'telegraf'

const telegraf = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

const maxSizeBytes = 100 * 1028 * 1024 // 100 MB
const maxDurationSeconds = 60
const maxWidth = 2048
const maxHeight = 1556
const supportedMimeTypes = ['video/quicktime', 'video/mp4']

telegraf.on('video', async context => {
  const durationSeconds = context.message.video.duration
  if (durationSeconds > maxDurationSeconds) {
    await context.reply(`Max duration: ${maxDurationSeconds} seconds (provided: ${durationSeconds})`)
    return
  }

  const sizeBytes = context.message.video.file_size
  if (!sizeBytes) {
    await context.reply('Could not determine video size')
    return
  }

  if (sizeBytes > maxSizeBytes) {
    await context.reply(`Max size: ${maxSizeBytes} bytes (provider: ${sizeBytes})`)
    return
  }

  const width = context.message.video.width
  if (width > maxWidth) {
    await context.reply(`Max width: ${maxWidth} (provided: ${width})`)
    return
  }

  const height = context.message.video.height
  if (height > maxHeight) {
    await context.reply(`Max height: ${maxHeight} (provided: ${height})`)
    return
  }

  const mimeType = context.message.video.mime_type
  if (!mimeType) {
    await context.reply('Could not determine video mime type')
    return
  }

  if (!supportedMimeTypes.includes(mimeType)) {
    await context.reply('Unsupported mime type')
    return
  }

  // TODO: process video
})

telegraf.launch()
