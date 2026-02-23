import fs from 'fs/promises'
import { Context, Telegraf } from 'telegraf'
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
import pAll from 'p-all'
import type { Message, ReplyParameters } from 'telegraf/types'

// TODO: telegram debug chat error logs

const telegraf = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)

async function shutdown(signal?: string) {
  console.log(`Received ${signal || 'NOSIGNAL'}, shutting down gracefully`)

  try {
    telegraf.stop()
  } catch {}

  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))

await telegraf.telegram.setMyCommands([
  { command: 'distort', description: 'Reply with /distort to a media file to distort it' },
])

// Telegram Bot API has a download limit of 20 MB, so we can't exceed that
const maxSizeBytes = 20 * 1028 * 1024 // 20 MB
const maxVideoDurationSeconds = 90
const maxAudioDurationSeconds = 300
const maxWidth = 2048
const maxHeight = 2048
const maxDiameter = Math.ceil(Math.sqrt(maxWidth ** 2 + maxHeight ** 2))
const supportedMimeTypes = ['video/quicktime', 'video/mp4', 'audio/ogg', 'audio/mpeg']
const concurrency = 4

// TODO: add support for parallel processing of multiple files
const queue = new Queue({ limit: 100 })

type DistortableMessage = NonNullable<Context['message']> | NonNullable<Message.CommonMessage['reply_to_message']>
async function handleDistortMedia(
  message: DistortableMessage,
  context: Context,
  respondToMessage: Message.CommonMessage = message,
) {
  const reply_parameters: ReplyParameters = {
    chat_id: respondToMessage.chat.id,
    message_id: respondToMessage.message_id,
    allow_sending_without_reply: true,
  }

  if ('voice' in message) {
    const durationSeconds = message.voice.duration
    if (durationSeconds > maxAudioDurationSeconds) {
      await context.reply(`Max duration: ${maxAudioDurationSeconds} seconds (provided: ${durationSeconds})`, {
        reply_parameters,
      })
      return
    }

    const mimeType = message.voice.mime_type
    if (!mimeType) {
      await context.reply('Could not determine file mime type', { reply_parameters })
      // TODO: log
      return
    }
    if (!supportedMimeTypes.includes(mimeType)) {
      await context.reply(`Unsupported mime type: ${mimeType}`, { reply_parameters })
      // TODO: log
      return
    }

    const sizeBytes = message.voice.file_size
    if (!sizeBytes) {
      await context.reply('Could not determine file size', { reply_parameters })
      return
    }
    if (sizeBytes > maxSizeBytes) {
      await context.reply(`Max size: ${maxSizeBytes} bytes (provided: ${sizeBytes})`, { reply_parameters })
      return
    }
  } else if ('audio' in message) {
    const durationSeconds = message.audio.duration
    if (durationSeconds > maxAudioDurationSeconds) {
      await context.reply(`Max duration: ${maxAudioDurationSeconds} seconds (provided: ${durationSeconds})`, {
        reply_parameters,
      })
      return
    }

    const mimeType = message.audio.mime_type
    if (!mimeType) {
      await context.reply('Could not determine file mime type', { reply_parameters })
      // TODO: log
      return
    }
    if (!supportedMimeTypes.includes(mimeType)) {
      await context.reply(`Unsupported mime type: ${mimeType}`, { reply_parameters })
      // TODO: log
      return
    }

    const sizeBytes = message.audio.file_size
    if (!sizeBytes) {
      await context.reply('Could not determine file size', { reply_parameters })
      return
    }
    if (sizeBytes > maxSizeBytes) {
      await context.reply(`Max size: ${maxSizeBytes} bytes (provided: ${sizeBytes})`, { reply_parameters })
      return
    }
  } else if ('sticker' in message) {
    if (message.sticker.type !== 'regular') {
      await context.reply('Masks and custom emojis are not supported', { reply_parameters })
      return
    }

    if (message.sticker.is_animated) {
      await context.reply('Animated stickers are not supported', { reply_parameters })
      return
    }

    if (message.sticker.is_video) {
      await context.reply('Sorry, video stickers are not supported yet. Coming soon!', { reply_parameters })
      return
    }

    const sizeBytes = message.sticker.file_size
    if (!sizeBytes) {
      await context.reply('Could not determine file size', { reply_parameters })
      return
    }
    if (sizeBytes > maxSizeBytes) {
      await context.reply(`Max size: ${maxSizeBytes} bytes (provided: ${sizeBytes})`, { reply_parameters })
      return
    }
  } else if ('photo' in message) {
    const photo = message.photo
      .sort((a, b) => b.width * b.height - a.width * a.height)
      .filter(p => p.file_size && p.file_size <= maxSizeBytes && p.width <= maxWidth && p.height <= maxHeight)[0]
    if (!photo) {
      await context.reply('Photo is too large or invalid', { reply_parameters })
      return
    }
  } else if ('video_note' in message) {
    const durationSeconds = message.video_note.duration
    if (durationSeconds > maxVideoDurationSeconds) {
      await context.reply(`Max duration: ${maxVideoDurationSeconds} seconds (provided: ${durationSeconds})`, {
        reply_parameters,
      })
      return
    }

    const sizeBytes = message.video_note.file_size
    if (!sizeBytes) {
      await context.reply('Could not determine file size', { reply_parameters })
      return
    }
    if (sizeBytes > maxSizeBytes) {
      await context.reply(`Max size: ${maxSizeBytes} bytes (provided: ${sizeBytes})`, { reply_parameters })
      return
    }

    const diameter = message.video_note.length
    if (diameter > maxDiameter) {
      await context.reply(`Max diameter: ${maxDiameter} (provided: ${diameter})`, { reply_parameters })
      return
    }
  } else if ('video' in message) {
    const durationSeconds = message.video.duration
    if (durationSeconds > maxVideoDurationSeconds) {
      await context.reply(`Max duration: ${maxVideoDurationSeconds} seconds (provided: ${durationSeconds})`, {
        reply_parameters,
      })
      return
    }

    const sizeBytes = message.video.file_size
    if (!sizeBytes) {
      await context.reply('Could not determine file size', { reply_parameters })
      return
    }
    if (sizeBytes > maxSizeBytes) {
      await context.reply(`Max size: ${maxSizeBytes} bytes (provided: ${sizeBytes})`, { reply_parameters })
      return
    }

    if (message.video.width > maxWidth) {
      await context.reply(`Max width: ${maxWidth} (provided: ${message.video.width})`, { reply_parameters })
      return
    }

    if (message.video.height > maxHeight) {
      await context.reply(`Max height: ${maxHeight} (provided: ${message.video.height})`, { reply_parameters })
      return
    }

    const mimeType = message.video.mime_type
    if (!mimeType) {
      await context.reply('Could not determine file mime type', { reply_parameters })
      // TODO: log
      return
    }
    if (!supportedMimeTypes.includes(mimeType)) {
      await context.reply('Unsupported mime type', { reply_parameters })
      // TODO: log
      return
    }
  } else if ('animation' in message) {
    const durationSeconds = message.animation.duration
    if (durationSeconds > maxVideoDurationSeconds) {
      await context.reply(`Max duration: ${maxVideoDurationSeconds} seconds (provided: ${durationSeconds})`, {
        reply_parameters,
      })
      return
    }

    const sizeBytes = message.animation.file_size
    if (!sizeBytes) {
      await context.reply('Could not determine file size', { reply_parameters })
      return
    }
    if (sizeBytes > maxSizeBytes) {
      await context.reply(`Max size: ${maxSizeBytes} bytes (provided: ${sizeBytes})`, { reply_parameters })
      return
    }

    if (message.animation.width > maxWidth) {
      await context.reply(`Max width: ${maxWidth} (provided: ${message.animation.width})`, { reply_parameters })
      return
    }

    if (message.animation.height > maxHeight) {
      await context.reply(`Max height: ${maxHeight} (provided: ${message.animation.height})`, { reply_parameters })
      return
    }

    const mimeType = message.animation.mime_type
    if (!mimeType) {
      await context.reply('Could not determine file mime type', { reply_parameters })
      // TODO: log
      return
    }
    if (!supportedMimeTypes.includes(mimeType)) {
      await context.reply('Unsupported mime type', { reply_parameters })
      // TODO: log
      return
    }
  } else {
    await context.reply('This message type cannot be distorted', { reply_parameters })
    return
  }

  const statusMessage = await context.reply('Queued', { reply_parameters, disable_notification: true })

  async function notify(text: string) {
    await telegraf.telegram
      .editMessageText(statusMessage.chat.id, statusMessage.message_id, undefined, text)
      .catch(() => {})
  }

  const enqueued = queue.enqueue(async () => {
    const operationId = uuid.v4()

    try {
      if ('voice' in message) {
        const inputPath = `./local/operations/${operationId}/input.ogg`
        const outputPath = `./local/operations/${operationId}/output.ogg`

        await fs.mkdir(`./local/operations/${operationId}`, { recursive: true })

        await notify('Downloading')
        const url = await telegraf.telegram.getFileLink(message.voice.file_id)
        await downloadFile({ url, path: inputPath })

        await notify('Verifying')
        const sampleRate = await getAudioSampleRate({ path: inputPath })
        if (!sampleRate) throw new Error('Could not determine sample rate')

        await notify('Distorting')
        await distortAudio({ inputPath, outputPath, sampleRate, percentage: 0.7, pitch: 1.25, format: 'ogg' })

        await notify('Sending')
        await telegraf.telegram.sendVoice(message.chat.id, { source: outputPath }, { reply_parameters })
      } else if ('audio' in message) {
        const inputPath = `./local/operations/${operationId}/input.mp3`
        const outputPath = `./local/operations/${operationId}/output.mp3`

        await fs.mkdir(`./local/operations/${operationId}`, { recursive: true })

        await notify('Downloading')
        const url = await telegraf.telegram.getFileLink(message.audio.file_id)
        await downloadFile({ url, path: inputPath })

        await notify('Verifying')
        const sampleRate = await getAudioSampleRate({ path: inputPath })
        if (!sampleRate) throw new Error('Could not determine sample rate')

        await notify('Distorting')
        await distortAudio({ inputPath, outputPath, sampleRate, percentage: 0.7, pitch: 1.25, format: 'mp3' })

        await notify('Sending')
        await telegraf.telegram.sendAudio(
          message.chat.id,
          {
            source: outputPath,
            filename: message.audio.file_name
              ? message.audio.file_name.replace(/\.mp3$/, ' (distorted).mp3')
              : 'distorted.mp3',
          },
          { reply_parameters },
        )
      } else if ('sticker' in message) {
        const inputPath = `./local/operations/${operationId}/input.webp`
        const outputPath = `./local/operations/${operationId}/output.webp`

        await fs.mkdir(`./local/operations/${operationId}`, { recursive: true })

        await notify('Downloading')
        const url = await telegraf.telegram.getFileLink(message.sticker.file_id)
        await downloadFile({ url, path: inputPath })

        await notify('Verifying')
        const [width, height] = await getImageDimensions({ path: inputPath })

        await notify('Distorting')
        await distortImage({ inputPath, outputPath, rescale: 50, width, height })

        await notify('Sending')
        await telegraf.telegram.sendSticker(message.chat.id, { source: outputPath }, { reply_parameters })
      } else if ('photo' in message) {
        const photo = message.photo
          .sort((a, b) => b.width * b.height - a.width * a.height)
          .filter(p => p.file_size && p.file_size <= maxSizeBytes && p.width <= maxWidth && p.height <= maxHeight)[0]!

        const inputPath = `./local/operations/${operationId}/input.jpeg`
        const outputPath = `./local/operations/${operationId}/output.jpeg`

        await fs.mkdir(`./local/operations/${operationId}`, { recursive: true })

        await notify('Downloading')
        const url = await telegraf.telegram.getFileLink(photo.file_id)
        await downloadFile({ url, path: inputPath })

        await notify('Verifying')
        const [width, height] = await getImageDimensions({ path: inputPath })

        await notify('Distorting')
        await distortImage({ inputPath, outputPath, rescale: 50, width, height })

        await notify('Sending')
        await telegraf.telegram.sendPhoto(message.chat.id, { source: outputPath }, { reply_parameters })
      } else if ('video_note' in message) {
        const inputPath = `./local/operations/${operationId}/input.mp4`
        const outputPath = `./local/operations/${operationId}/output.mp4`

        await fs.mkdir(`./local/operations/${operationId}/original`, { recursive: true })
        await fs.mkdir(`./local/operations/${operationId}/distorted`, { recursive: true })

        await notify('Downloading')
        const url = await telegraf.telegram.getFileLink(message.video_note.file_id)
        await downloadFile({ url, path: inputPath })

        await notify('Extracting frames')
        await extractFrames({ inputPath, outputDirectory: `./local/operations/${operationId}/original` })

        await notify('Verifying')
        const sampleRate = await getAudioSampleRate({ path: inputPath })
        const [width, height] = await getImageDimensions({ path: `./local/operations/${operationId}/original/1.jpg` })

        const filenames = await fs.readdir(`./local/operations/${operationId}/original`)
        // Sort frames by sequence instead of alphabetically
        // 1.jpg, 2.jpg, 3.jpg, etc.
        filenames.sort((a, b) => parseInt(a) - parseInt(b))

        let lastUpdatedAt = 0
        let processed = 0

        await pAll(
          filenames.map((filename, i) => async () => {
            processed++
            if (Date.now() - lastUpdatedAt >= 3000) {
              lastUpdatedAt = Date.now()
              await notify(`Distorting frames (${Math.floor((processed / filenames.length) * 100)}%)`)
            }
            const percentage = i / (filenames.length - 1)
            const rescale = 40 + 50 * (1 - percentage)
            await distortImage({
              inputPath: `./local/operations/${operationId}/original/${filename}`,
              outputPath: `./local/operations/${operationId}/distorted/${filename}`,
              width,
              height,
              rescale,
            })
          }),
          { concurrency },
        )

        await notify('Creating a video note')
        await combineFrames({
          inputPath,
          outputPath,
          inputDirectory: `./local/operations/${operationId}/distorted`,
          percentage: 0.7,
          pitch: 1.25,
          sampleRate,
          audio: Boolean(sampleRate),
        })

        await notify('Sending')
        await telegraf.telegram.sendVideoNote(message.chat.id, { source: outputPath }, { reply_parameters })
      } else if ('video' in message) {
        const inputPath = `./local/operations/${operationId}/input.mp4`
        const outputPath = `./local/operations/${operationId}/output.mp4`

        await fs.mkdir(`./local/operations/${operationId}/original`, { recursive: true })
        await fs.mkdir(`./local/operations/${operationId}/distorted`, { recursive: true })

        await notify('Downloading')
        const url = await telegraf.telegram.getFileLink(message.video.file_id)
        await downloadFile({ url, path: inputPath })

        await notify('Extracting frames')
        await extractFrames({ inputPath, outputDirectory: `./local/operations/${operationId}/original` })

        await notify('Verifying')
        const sampleRate = await getAudioSampleRate({ path: inputPath })
        const [width, height] = await getImageDimensions({ path: `./local/operations/${operationId}/original/1.jpg` })

        const filenames = await fs.readdir(`./local/operations/${operationId}/original`)
        // Sort frames by sequence instead of alphabetically
        // 1.jpg, 2.jpg, 3.jpg, etc.
        filenames.sort((a, b) => parseInt(a) - parseInt(b))

        let lastUpdatedAt = 0
        let processed = 0

        await pAll(
          filenames.map((filename, i) => async () => {
            processed++
            if (Date.now() - lastUpdatedAt >= 3000) {
              lastUpdatedAt = Date.now()
              await notify(`Distorting frames (${Math.floor((processed / filenames.length) * 100)}%)`)
            }
            const percentage = i / (filenames.length - 1)
            const rescale = 40 + 50 * (1 - percentage)
            await distortImage({
              inputPath: `./local/operations/${operationId}/original/${filename}`,
              outputPath: `./local/operations/${operationId}/distorted/${filename}`,
              width,
              height,
              rescale,
            })
          }),
          { concurrency },
        )

        await notify('Creating a video')
        await combineFrames({
          inputPath,
          outputPath,
          inputDirectory: `./local/operations/${operationId}/distorted`,
          percentage: 0.7,
          pitch: 1.25,
          sampleRate,
          audio: Boolean(sampleRate),
        })

        await notify('Sending')
        await telegraf.telegram.sendVideo(message.chat.id, { source: outputPath }, { reply_parameters })
      } else if ('animation' in message) {
        const inputPath = `./local/operations/${operationId}/input.mp4`
        const outputPath = `./local/operations/${operationId}/output.mp4`

        await fs.mkdir(`./local/operations/${operationId}/original`, { recursive: true })
        await fs.mkdir(`./local/operations/${operationId}/distorted`, { recursive: true })

        await notify('Downloading')
        const url = await telegraf.telegram.getFileLink(message.animation.file_id)
        await downloadFile({ url, path: inputPath })

        await notify('Extracting frames')
        await extractFrames({ inputPath, outputDirectory: `./local/operations/${operationId}/original` })

        await notify('Verifying')
        const [width, height] = await getImageDimensions({ path: `./local/operations/${operationId}/original/1.jpg` })

        const filenames = await fs.readdir(`./local/operations/${operationId}/original`)
        // Sort frames by sequence instead of alphabetically
        // 1.jpg, 2.jpg, 3.jpg, etc.
        filenames.sort((a, b) => parseInt(a) - parseInt(b))

        let lastUpdatedAt = 0
        let processed = 0

        await pAll(
          filenames.map((filename, i) => async () => {
            processed++
            if (Date.now() - lastUpdatedAt >= 3000) {
              lastUpdatedAt = Date.now()
              await notify(`Distorting frames (${Math.floor((processed / filenames.length) * 100)}%)`)
            }
            const percentage = i / (filenames.length - 1)
            const rescale = 40 + 50 * (1 - percentage)
            await distortImage({
              inputPath: `./local/operations/${operationId}/original/${filename}`,
              outputPath: `./local/operations/${operationId}/distorted/${filename}`,
              width,
              height,
              rescale,
            })
          }),
          { concurrency },
        )

        await notify('Creating an animation')
        await combineFrames({
          inputPath,
          outputPath,
          inputDirectory: `./local/operations/${operationId}/distorted`,
          percentage: null,
          pitch: -1,
          sampleRate: null,
          audio: false,
        })

        await notify('Sending')
        await telegraf.telegram.sendAnimation(message.chat.id, { source: outputPath }, { reply_parameters })
      }

      await telegraf.telegram.deleteMessage(statusMessage.chat.id, statusMessage.message_id).catch(() => {})
    } catch (err) {
      console.warn(err)
      await notify('Sorry, something went wrong. Please try another file!')
    } finally {
      await fs.rm(`./local/operations/${operationId}`, { recursive: true, force: true }).catch(() => {})
    }
  })

  if (!enqueued) {
    await notify('Sorry, the queue is full. Please try again later!')
  }
}

// TODO: don't let one person fill up the queue
// TODO: support in groups
// TODO: add support for video stickers

// Clean up
await fs.rm('./local/operations', { recursive: true, force: true })

// Bot should not work in channels
telegraf.use((context, next) => {
  if (context.chat?.type === 'channel') return
  return next()
})

telegraf.command('distort', async context => {
  if (!context.message.reply_to_message) {
    await context.reply('Reply to a media using /distort command', {
      reply_parameters: {
        chat_id: context.message.chat.id,
        message_id: context.message.message_id,
        allow_sending_without_reply: true,
      },
    })
    return
  }

  await handleDistortMedia(context.message.reply_to_message, context, context.message)
})

// Direct media messages should only be handled in private chats
telegraf.use((context, next) => {
  if (context.chat?.type !== 'private') return
  return next()
})

telegraf.on(message('voice'), async context => await handleDistortMedia(context.message, context))
telegraf.on(message('audio'), async context => await handleDistortMedia(context.message, context))
telegraf.on(message('sticker'), async context => await handleDistortMedia(context.message, context))
telegraf.on(message('photo'), async context => await handleDistortMedia(context.message, context))
telegraf.on(message('video_note'), async context => await handleDistortMedia(context.message, context))
telegraf.on(message('video'), async context => await handleDistortMedia(context.message, context))
telegraf.on(message('animation'), async context => await handleDistortMedia(context.message, context))
telegraf.on(message('document'), async context => await context.reply('Sorry, documents not supported.'))

await new Promise<void>(resolve => telegraf.launch(() => resolve()))

console.log('Bot started')
