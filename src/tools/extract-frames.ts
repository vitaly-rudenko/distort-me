import fs from 'fs/promises'
import { exec } from 'node:child_process'

export async function extractFrames(input: { inputPath: string; outputDirectory: string }) {
  await fs.mkdir(input.outputDirectory, { recursive: true })

  await new Promise<void>((resolve, reject) => {
    exec(
      `ffmpeg \
       -i "${input.inputPath}"\
       -r 24 \
       "${input.outputDirectory}/%d.jpg"`,
      err => (err ? reject(err) : resolve()),
    )
  })
}
