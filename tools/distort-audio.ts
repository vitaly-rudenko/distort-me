import fs from 'fs/promises'
import { dirname } from 'path'
import { execSync } from 'node:child_process'
import { getAudioSampleRate } from './get-audio-sample-rate.ts'

export async function distortAudio(input: {
  inputPath: string
  outputPath: string
  percentage: number
  pitch: number
}) {
  await fs.mkdir(dirname(input.outputPath), { recursive: true })

  const sampleRate = await getAudioSampleRate({ path: input.inputPath })

  const filters = [
    //
    input.percentage !== 0 && `vibrato=f=10:d=${input.percentage}`,
    input.pitch !== 1 && `asetrate=${sampleRate}*${input.pitch},aresample=${sampleRate},atempo=1/${input.pitch}`,
  ].filter(Boolean)

  const filterArgument = filters.length > 0 ? ` -filter:a "${filters.join(',')}"` : ''

  execSync(
    `ffmpeg \
     -i "${input.inputPath}" \
     ${filterArgument} \
     -c:a libopus \
     -shortest \
     "${input.outputPath}"`,
  )
}
