import { exec } from 'node:child_process'

export async function extractFrames(input: { inputPath: string; outputDirectory: string }) {
  await new Promise<void>((resolve, reject) => {
    exec(
      `ffmpeg \
       -i "${input.inputPath}"\
       -q:v 1 \
       -r 24 \
       "${input.outputDirectory}/%d.jpg"`,
      err => (err ? reject(err) : resolve()),
    )
  })
}
