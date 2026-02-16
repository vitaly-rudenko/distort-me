import fs from 'node:fs/promises'
import { exec } from 'node:child_process'
import { dirname } from 'node:path'

export async function distortImage(input: {
  inputPath: string
  outputPath: string
  width: number
  height: number
  percentage: number
}) {
  await fs.mkdir(dirname(input.outputPath), { recursive: true })

  await new Promise<void>((resolve, reject) => {
    exec(
      `magick "${input.inputPath}" -liquid-rescale '${Math.floor(input.percentage * 100)}%' -resize '${input.width}x${input.height}' "${input.outputPath}"`,
      err => (err ? reject(err) : resolve()),
    )
  })
}
