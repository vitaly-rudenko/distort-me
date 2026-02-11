import fs from 'fs/promises'
import { dirname } from 'path'
import { createWriteStream } from 'fs'
import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import * as uuid from 'uuid'
import { exec, execSync } from 'node:child_process'
import { Queue } from './queue.ts'

const telegraf = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

const maxSizeBytes = 512 * 1028 * 1024 // 512 MB
const maxDurationSeconds = 90
const maxWidth = 2048
const maxHeight = 1556
const maxDiameter = Math.ceil(Math.sqrt(maxWidth ** 2 + maxHeight ** 2))
const supportedMimeTypes = ['video/quicktime', 'video/mp4', 'audio/ogg', 'audio/mpeg']

const queue = new Queue({ limit: 100 })

// TODO: support uncompressed images (documents)

telegraf.on(message('voice'), async context => {
  const durationSeconds = context.message.voice.duration
  if (durationSeconds > maxDurationSeconds) {
    await context.reply(`Max duration: ${maxDurationSeconds} seconds (provided: ${durationSeconds})`)
    return
  }

  const mimeType = context.message.voice.mime_type
  if (!mimeType) {
    await context.reply('Could not determine file mime type')
    // TODO: log
    return
  }
  if (!supportedMimeTypes.includes(mimeType)) {
    await context.reply(`Unsupported mime type: ${mimeType}`)
    // TODO: log
    return
  }

  const sizeBytes = context.message.voice.file_size
  if (!sizeBytes) {
    await context.reply('Could not determine file size')
    return
  }
  if (sizeBytes > maxSizeBytes) {
    await context.reply(`Max size: ${maxSizeBytes} bytes (provided: ${sizeBytes})`)
    return
  }

  // TODO:
})

telegraf.on(message('audio'), async context => {
  const durationSeconds = context.message.audio.duration
  if (durationSeconds > maxDurationSeconds) {
    await context.reply(`Max duration: ${maxDurationSeconds} seconds (provided: ${durationSeconds})`)
    return
  }

  const mimeType = context.message.audio.mime_type
  if (!mimeType) {
    await context.reply('Could not determine file mime type')
    // TODO: log
    return
  }
  if (!supportedMimeTypes.includes(mimeType)) {
    await context.reply(`Unsupported mime type: ${mimeType}`)
    // TODO: log
    return
  }

  const sizeBytes = context.message.audio.file_size
  if (!sizeBytes) {
    await context.reply('Could not determine file size')
    return
  }
  if (sizeBytes > maxSizeBytes) {
    await context.reply(`Max size: ${maxSizeBytes} bytes (provided: ${sizeBytes})`)
    return
  }

  // TODO:
})

telegraf.on(message('sticker'), async context => {
  if (context.message.sticker.type !== 'regular') {
    await context.reply('Masks and custom emojis are not supported')
    return
  }

  if (context.message.sticker.is_animated) {
    await context.reply('Animated stickers are not supported')
    return
  }

  const sizeBytes = context.message.sticker.file_size
  if (!sizeBytes) {
    await context.reply('Could not determine file size')
    return
  }
  if (sizeBytes > maxSizeBytes) {
    await context.reply(`Max size: ${maxSizeBytes} bytes (provided: ${sizeBytes})`)
    return
  }

  // TODO:
})

async function downloadFile(input: { fileId: string; path: string }) {
  await fs.mkdir(dirname(input.path), { recursive: true })

  const url = await telegraf.telegram.getFileLink(input.fileId)
  const response = await fetch(url)
  if (String(response.status)[0] !== '2') {
    throw new Error(`Failed to download file due to invalid status code: ${response.status} (fileId: ${input.fileId})`)
  }
  if (!response.body) {
    throw new Error(`Failed to download file due to empty response body (fileId: ${input.fileId})`)
  }

  const file = Readable.from(response.body)
  const writeStream = createWriteStream(input.path)
  file.pipe(writeStream)

  await Promise.all([finished(file, { cleanup: true }), finished(writeStream, { cleanup: true })])
}

async function getImageDimensions(input: { path: string }) {
  const results = execSync(
    `docker run --rm \
    -v "./local:/local" \
    imagemagick identify -format '%w %h' "${input.path}"`,
  )

  const dimensions = results.toString('utf-8')
  const [width, height] = dimensions.split(' ').map(Number)

  return [width, height] as [number, number]
}

async function distortImage(input: {
  inputPath: string
  outputPath: string
  width: number
  height: number
  percentage: number
}) {

  await fs.mkdir(dirname(input.outputPath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    exec(
      `docker run --rm \
       -v "./local:/local" \
       imagemagick "${input.inputPath}" -liquid-rescale '${Math.floor(input.percentage * 100)}%' -resize '${input.width}x${input.height}' "${input.outputPath}"`,
      err => (err ? reject(err) : resolve()),
    )
  })
}

telegraf.on(message('photo'), async context => {
  const photo = context.message.photo
    .sort((a, b) => b.width * b.height - a.width * a.height)
    .filter(p => p.file_size && p.file_size <= maxSizeBytes && p.width <= maxWidth && p.height <= maxHeight)[0]
  if (!photo) {
    await context.reply('Photo is too large or invalid')
    return
  }

  const message = await context.reply('Warming up...', {
    reply_parameters: { message_id: context.message.message_id },
    disable_notification: true,
  })

  const position = queue.enqueue(async () => {
    const fileId = photo.file_id
    const operationId = uuid.v4()
    const inputPath = `local/operations/${operationId}/input.jpeg`
    const outputPath = `local/operations/${operationId}/output.jpeg`

    try {
      await telegraf.telegram.editMessageText(message.chat.id, message.message_id, undefined, 'Downloading...')
      await downloadFile({ fileId, path: `./${inputPath}` })

      await telegraf.telegram.editMessageText(message.chat.id, message.message_id, undefined, 'Verifying...')
      const [width, height] = await getImageDimensions({ path: `/${inputPath}` })

      await telegraf.telegram.editMessageText(message.chat.id, message.message_id, undefined, 'Rescaling...')
      await distortImage({
        inputPath: `/${inputPath}`,
        outputPath: `/${outputPath}`,
        percentage: 0.5,
        width,
        height,
      })

      await telegraf.telegram.editMessageText(message.chat.id, message.message_id, undefined, 'Sending...')
      await telegraf.telegram.sendPhoto(
        context.message.chat.id,
        { source: `./${outputPath}` },
        { reply_parameters: { message_id: context.message.message_id } },
      )
    } catch (err) {
      console.warn(err)

      await telegraf.telegram.editMessageText(
        message.chat.id,
        message.message_id,
        undefined,
        'Sorry, something went wrong. Please try another file!',
      )
    } finally {
      await telegraf.telegram.deleteMessage(message.chat.id, message.message_id).catch(() => {})
      await fs.rm(`./local/operations/${operationId}`, { recursive: true, force: true }).catch(() => {})
    }
  })

  if (!position) {
    await telegraf.telegram.editMessageText(
      message.chat.id,
      message.message_id,
      undefined,
      'Sorry, the queue is full. Please try again later!',
    )
    return
  }

  if (position.index > 0) {
    await telegraf.telegram.editMessageText(message.chat.id, message.message_id, undefined, 'Queued...')
  }
})

telegraf.on(message('video_note'), async context => {
  const durationSeconds = context.message.video_note.duration
  if (durationSeconds > maxDurationSeconds) {
    await context.reply(`Max duration: ${maxDurationSeconds} seconds (provided: ${durationSeconds})`)
    return
  }

  const sizeBytes = context.message.video_note.file_size
  if (!sizeBytes) {
    await context.reply('Could not determine file size')
    return
  }
  if (sizeBytes > maxSizeBytes) {
    await context.reply(`Max size: ${maxSizeBytes} bytes (provided: ${sizeBytes})`)
    return
  }

  const diameter = context.message.video_note.length
  if (diameter > maxDiameter) {
    await context.reply(`Max diameter: ${maxDiameter} (provided: ${diameter})`)
    return
  }

  // TODO:
})

telegraf.on(message('video'), async context => {
  const durationSeconds = context.message.video.duration
  if (durationSeconds > maxDurationSeconds) {
    await context.reply(`Max duration: ${maxDurationSeconds} seconds (provided: ${durationSeconds})`)
    return
  }

  const sizeBytes = context.message.video.file_size
  if (!sizeBytes) {
    await context.reply('Could not determine file size')
    return
  }
  if (sizeBytes > maxSizeBytes) {
    await context.reply(`Max size: ${maxSizeBytes} bytes (provided: ${sizeBytes})`)
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
    await context.reply('Could not determine file mime type')
    // TODO: log
    return
  }
  if (!supportedMimeTypes.includes(mimeType)) {
    await context.reply('Unsupported mime type')
    // TODO: log
    return
  }

  // TODO:
})

telegraf.launch()
