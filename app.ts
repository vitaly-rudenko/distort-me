import { execSync } from 'node:child_process'
import fs from 'fs/promises'

async function extractFrames() {
  await fs.rm('./frames', { recursive: true, force: true })
  await fs.mkdir('./frames', { recursive: true })

  execSync(`ffmpeg -i ./video.mp4 -r 24 ./frames/$filename%03d.jpg`)
}

async function distortFrames() {
  await fs.rm('./distorted', { recursive: true, force: true })
  await fs.mkdir('./distorted', { recursive: true })

  const filenames = await fs.readdir('./frames')
  for (const [i, filename] of filenames.entries()) {
    console.log(`Distorting frame ${i + 1} of ${filenames.length}`)

    execSync(
      `docker run --rm \
        -v "./frames:/frames" -v "./distorted:/distorted" \
       imagemagick "/frames/${filename}" -liquid-rescale '50%' -resize '200%' "/distorted/${filename}"`,
    )
  }
}

async function combineFrames() {
  await fs.rm('./combined.mp4', { force: true })

  execSync(
    `ffmpeg -framerate 24 -pattern_type glob -i "./distorted/*.jpg" \
     -i video.mp4 -filter:a "vibrato=f=10:d=0.7" -c:a libopus -shortest \
     -c:v libx264 -pix_fmt yuv420p combined.mp4`,
  )
}

console.log('Extracting frames...')
await extractFrames()

console.log('Distorting frames...')
await distortFrames()

console.log('Combining frames...')
await combineFrames()

console.log('Done!')
