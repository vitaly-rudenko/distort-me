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

// TODO: don't let one person fill up the queue
// TODO: support in groups

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
      await fs.mkdir(`./local/operations/${operationId}`, { recursive: true })

      await notify('Downloading...')
      const url = await telegraf.telegram.getFileLink(fileId)
      await downloadFile({ url, path: inputPath })

      await notify('Verifying...')
      const sampleRate = await getAudioSampleRate({ path: inputPath })

      await notify('Distorting...')
      await distortAudio({ inputPath, outputPath, sampleRate, percentage: 0.7, pitch: 1.25, format: 'ogg' })

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

  const message = await context.reply('Warming up...', {
    reply_parameters: { message_id: context.message.message_id },
    disable_notification: true,
  })

  async function notify(text: string) {
    await telegraf.telegram.editMessageText(message.chat.id, message.message_id, undefined, text).catch(() => {})
  }

  const position = queue.enqueue(async () => {
    const fileId = context.message.audio.file_id
    const operationId = uuid.v4()
    const inputPath = `./local/operations/${operationId}/input.mp3`
    const outputPath = `./local/operations/${operationId}/output.mp3`

    try {
      await fs.mkdir(`./local/operations/${operationId}`, { recursive: true })

      await notify('Downloading...')
      const url = await telegraf.telegram.getFileLink(fileId)
      await downloadFile({ url, path: inputPath })

      await notify('Verifying...')
      const sampleRate = await getAudioSampleRate({ path: inputPath })

      await notify('Distorting...')
      await distortAudio({ inputPath, outputPath, sampleRate, percentage: 0.7, pitch: 1.25, format: 'mp3' })

      await notify('Sending...')
      await telegraf.telegram.sendAudio(
        context.message.chat.id,
        {
          source: outputPath,
          filename: context.message.audio.file_name
            ? context.message.audio.file_name.replace(/\.mp3$/, ' (distorted).mp3')
            : 'distorted.mp3',
        },
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

  if (position.index > 0) {
    await notify('Queued...')
  }
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

  if (context.message.sticker.is_video) {
    await context.reply('Sorry, video stickers are not supported yet. Coming soon!')
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

  const message = await context.reply('Warming up...', {
    reply_parameters: { message_id: context.message.message_id },
    disable_notification: true,
  })

  async function notify(text: string) {
    await telegraf.telegram.editMessageText(message.chat.id, message.message_id, undefined, text).catch(() => {})
  }

  const position = queue.enqueue(async () => {
    const fileId = context.message.sticker.file_id
    const operationId = uuid.v4()
    const inputPath = `./local/operations/${operationId}/input.webp`
    const outputPath = `./local/operations/${operationId}/output.webp`

    try {
      await fs.mkdir(`./local/operations/${operationId}`, { recursive: true })

      await notify('Downloading...')
      const url = await telegraf.telegram.getFileLink(fileId)
      await downloadFile({ url, path: inputPath })

      await notify('Verifying...')
      const [width, height] = await getImageDimensions({ path: inputPath })

      await notify('Distorting...')
      await distortImage({ inputPath, outputPath, rescale: 50, width, height })

      await notify('Sending...')
      await telegraf.telegram.sendSticker(
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
      await fs.mkdir(`./local/operations/${operationId}`, { recursive: true })

      await notify('Downloading...')
      const url = await telegraf.telegram.getFileLink(fileId)
      await downloadFile({ url, path: inputPath })

      await notify('Verifying...')
      const [width, height] = await getImageDimensions({ path: inputPath })

      await notify('Distorting...')
      await distortImage({ inputPath, outputPath, rescale: 50, width, height })

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

    try {
      await fs.mkdir(`./local/operations/${operationId}/original`, { recursive: true })
      await fs.mkdir(`./local/operations/${operationId}/distorted`, { recursive: true })

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

      let lastUpdatedAt = 0
      for (const [i, filename] of filenames.entries()) {
        if (Date.now() - lastUpdatedAt >= 5000) {
          lastUpdatedAt = Date.now()
          await notify(`Distorting frames (${Math.floor((i / filenames.length) * 100)}%)`)
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

      await notify('Creating a video note')
      await combineFrames({
        inputPath,
        outputPath,
        inputDirectory: `./local/operations/${operationId}/distorted`,
        percentage: 0.7,
        pitch: 1.25,
        sampleRate,
        audio: true,
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
      await fs.rm(`./local/operations/${operationId}`, { recursive: true, force: true }).catch(() => {})
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

  const message = await context.reply('Queued...', {
    reply_parameters: { message_id: context.message.message_id },
    disable_notification: true,
  })

  async function notify(text: string) {
    await telegraf.telegram.editMessageText(message.chat.id, message.message_id, undefined, text).catch(() => {})
  }

  const position = queue.enqueue(async () => {
    const fileId = context.message.video.file_id
    const operationId = uuid.v4()
    const inputPath = `./local/operations/${operationId}/input.mp4`
    const outputPath = `./local/operations/${operationId}/output.mp4`

    try {
      await fs.mkdir(`./local/operations/${operationId}/original`, { recursive: true })
      await fs.mkdir(`./local/operations/${operationId}/distorted`, { recursive: true })

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

      let lastUpdatedAt = 0
      for (const [i, filename] of filenames.entries()) {
        if (Date.now() - lastUpdatedAt >= 5000) {
          lastUpdatedAt = Date.now()
          await notify(`Distorting frames (${Math.floor((i / filenames.length) * 100)}%)`)
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
        pitch: 1.25,
        sampleRate,
        audio: true,
      })

      await notify('Sending')
      await telegraf.telegram.sendVideo(
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
})

telegraf.on(message('animation'), async context => {
  const durationSeconds = context.message.animation.duration
  if (durationSeconds > maxDurationSeconds) {
    await context.reply(`Max duration: ${maxDurationSeconds} seconds (provided: ${durationSeconds})`)
    return
  }

  const sizeBytes = context.message.animation.file_size
  if (!sizeBytes) {
    await context.reply('Could not determine file size')
    return
  }
  if (sizeBytes > maxSizeBytes) {
    await context.reply(`Max size: ${maxSizeBytes} bytes (provided: ${sizeBytes})`)
    return
  }

  const width = context.message.animation.width
  if (width > maxWidth) {
    await context.reply(`Max width: ${maxWidth} (provided: ${width})`)
    return
  }

  const height = context.message.animation.height
  if (height > maxHeight) {
    await context.reply(`Max height: ${maxHeight} (provided: ${height})`)
    return
  }

  const mimeType = context.message.animation.mime_type
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

  const message = await context.reply('Queued...', {
    reply_parameters: { message_id: context.message.message_id },
    disable_notification: true,
  })

  async function notify(text: string) {
    await telegraf.telegram.editMessageText(message.chat.id, message.message_id, undefined, text).catch(() => {})
  }

  const position = queue.enqueue(async () => {
    const fileId = context.message.animation.file_id
    const operationId = uuid.v4()
    const inputPath = `./local/operations/${operationId}/input.mp4`
    const outputPath = `./local/operations/${operationId}/output.mp4`

    try {
      await fs.mkdir(`./local/operations/${operationId}/original`, { recursive: true })
      await fs.mkdir(`./local/operations/${operationId}/distorted`, { recursive: true })

      await notify('Downloading')
      const url = await telegraf.telegram.getFileLink(fileId)
      await downloadFile({ url, path: inputPath })

      await notify('Extracting frames')
      await extractFrames({
        inputPath,
        outputDirectory: `./local/operations/${operationId}/original`,
      })

      await notify('Verifying')
      const [width, height] = await getImageDimensions({
        path: `./local/operations/${operationId}/original/1.jpg`,
      })

      const filenames = await fs.readdir(`./local/operations/${operationId}/original`)

      // Sort frames by sequence instead of alphabetically
      // 1.jpg, 2.jpg, 3.jpg, etc.
      filenames.sort((a, b) => parseInt(a) - parseInt(b))

      let lastUpdatedAt = 0
      for (const [i, filename] of filenames.entries()) {
        if (Date.now() - lastUpdatedAt >= 5000) {
          lastUpdatedAt = Date.now()
          await notify(`Distorting frames (${Math.floor((i / filenames.length) * 100)}%)`)
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

      await notify('Creating an animation')
      await combineFrames({
        inputPath,
        outputPath,
        inputDirectory: `./local/operations/${operationId}/distorted`,
        percentage: -1,
        pitch: -1,
        sampleRate: -1,
        audio: false,
      })

      await notify('Sending')
      await telegraf.telegram.sendAnimation(
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
})

telegraf.on(message('document'), async context => {
  await context.reply('Sorry, documents not supported.')
})

await new Promise<void>(resolve => telegraf.launch(() => resolve()))

console.log('Bot started')
