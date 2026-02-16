import fs from 'fs/promises'
import { Telegraf } from 'telegraf'
import { message } from 'telegraf/filters'
import * as uuid from 'uuid'
import { Queue } from './utils/queue.ts'
import { downloadFile } from './tools/download-file.ts'
import { getImageDimensions } from './tools/get-image-dimensions.ts'
import { distortImage } from './tools/distort-image.ts'
import { distortAudio } from './tools/distort-audio.ts'
import { getAudioSampleRate } from './tools/get-audio-sample-rate.ts'
import { extractFrames } from './tools/extract-frames.ts'
import { combineFrames } from './tools/combine-frames.ts'

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

  const message = await context.reply('Warming up...', {
    reply_parameters: { message_id: context.message.message_id },
    disable_notification: true,
  })

  async function notify(text: string) {
    await telegraf.telegram.editMessageText(message.chat.id, message.message_id, undefined, text).catch(() => {})
  }

  const position = queue.enqueue(async () => {
    const fileId = context.message.voice.file_id
    const operationId = uuid.v4()
    const inputPath = `./local/operations/${operationId}/input.ogg`
    const outputPath = `./local/operations/${operationId}/output.ogg`

    try {
      await notify('Downloading...')
      const url = await telegraf.telegram.getFileLink(fileId)
      await downloadFile({ url, path: inputPath })

      await notify('Verifying...')
      const sampleRate = await getAudioSampleRate({ path: inputPath })

      await notify('Distorting...')
      await distortAudio({ inputPath, outputPath, sampleRate, percentage: 0.7, pitch: 1.5 })

      await notify('Sending...')
      await telegraf.telegram.sendVoice(
        context.message.chat.id,
        { source: outputPath },
        { reply_parameters: { message_id: context.message.message_id } },
      )
    } catch (err) {
      console.warn(err)
      await notify('Sorry, something went wrong. Please try another file!')
    } finally {
      await telegraf.telegram.deleteMessage(message.chat.id, message.message_id).catch(() => {})
      await fs.rm(`./local/operations/${operationId}`, { recursive: true, force: true }).catch(() => {})
    }
  })

  if (!position) {
    await notify('Sorry, the queue is full. Please try again later!')
    return
  }

  if (position.index > 0) {
    await notify('Queued...')
  }
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

  async function notify(text: string) {
    await telegraf.telegram.editMessageText(message.chat.id, message.message_id, undefined, text).catch(() => {})
  }

  const position = queue.enqueue(async () => {
    const fileId = photo.file_id
    const operationId = uuid.v4()
    const inputPath = `./local/operations/${operationId}/input.jpeg`
    const outputPath = `./local/operations/${operationId}/output.jpeg`

    try {
      await notify('Downloading...')
      const url = await telegraf.telegram.getFileLink(fileId)
      await downloadFile({ url, path: inputPath })

      await notify('Verifying...')
      const [width, height] = await getImageDimensions({ path: inputPath })

      await notify('Distorting...')
      await distortImage({ inputPath, outputPath, percentage: 0.5, width, height })

      await notify('Sending...')
      await telegraf.telegram.sendPhoto(
        context.message.chat.id,
        { source: outputPath },
        { reply_parameters: { message_id: context.message.message_id } },
      )
    } catch (err) {
      console.warn(err)
      await notify('Sorry, something went wrong. Please try another file!')
    } finally {
      await telegraf.telegram.deleteMessage(message.chat.id, message.message_id).catch(() => {})
      await fs.rm(`./local/operations/${operationId}`, { recursive: true, force: true }).catch(() => {})
    }
  })

  if (!position) {
    await notify('Sorry, the queue is full. Please try again later!')
    return
  }

  if (position.index > 0) {
    await notify('Queued...')
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

  const message = await context.reply('Queued...', {
    reply_parameters: { message_id: context.message.message_id },
    disable_notification: true,
  })

  async function notify(text: string) {
    await telegraf.telegram.editMessageText(message.chat.id, message.message_id, undefined, text).catch(() => {})
  }

  const position = queue.enqueue(async () => {
    const fileId = context.message.video_note.file_id
    const operationId = uuid.v4()
    const inputPath = `./local/operations/${operationId}/input.mp4`
    const outputPath = `./local/operations/${operationId}/output.mp4`

    await fs.mkdir(`./local/operations/${operationId}/original`, { recursive: true })
    await fs.mkdir(`./local/operations/${operationId}/distorted`, { recursive: true })

    try {
      await notify('Downloading')
      const url = await telegraf.telegram.getFileLink(fileId)
      await downloadFile({ url, path: inputPath })

      await notify('Extracting frames')
      await extractFrames({
        inputPath,
        outputDirectory: `./local/operations/${operationId}/original`,
      })

      await notify('Verifying')
      const sampleRate = await getAudioSampleRate({ path: inputPath })
      const [width, height] = await getImageDimensions({
        path: `./local/operations/${operationId}/original/1.jpg`,
      })

      const filenames = await fs.readdir(`./local/operations/${operationId}/original`)

      // Sort frames by sequence instead of alphabetically
      // 1.jpg, 2.jpg, 3.jpg, etc.
      filenames.sort((a, b) => parseInt(a) - parseInt(b))

      for (const [i, filename] of filenames.entries()) {
        if (i % 30 === 0) {
          await notify(`Distorting frames (${Math.floor(i / filenames.length * 100)}%)`)
        }

        const percentage = i / (filenames.length - 1)
        const rescale = 40 + 50 * (1 - percentage)

        const filePath = `./local/operations/${operationId}/original/${filename}`

        await distortImage({
          inputPath: filePath,
          outputPath: `./local/operations/${operationId}/distorted/${filename}`,
          width,
          height,
          rescale,
        })
      }

      await notify('Creating a video')
      await combineFrames({
        inputPath,
        outputPath,
        inputDirectory: `./local/operations/${operationId}/distorted`,
        percentage: 0.7,
        pitch: 1.5,
        sampleRate,
      })

      await notify('Sending')
      await telegraf.telegram.sendVideoNote(
        context.message.chat.id,
        { source: outputPath },
        { reply_parameters: { message_id: context.message.message_id } },
      )
    } catch (err) {
      console.warn(err)
      await notify('Sorry, something went wrong. Please try another file!')
    } finally {
      await telegraf.telegram.deleteMessage(message.chat.id, message.message_id).catch(() => {})
      // await fs.rm(`./local/operations/${operationId}`, { recursive: true, force: true }).catch(() => {})
    }
  })

  if (!position) {
    await notify('Sorry, the queue is full. Please try again later!')
    return
  }
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

telegraf.launch(() => {
  console.log('Bot started')
})
