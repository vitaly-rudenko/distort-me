import { execSync } from 'node:child_process'
import fs from 'fs/promises'

let id = 5

async function extractFrames() {
  await fs.rm('./frames', { recursive: true, force: true })
  await fs.mkdir('./frames', { recursive: true })

  execSync(`ffmpeg -i ./video_${id}.mp4 -r 24 ./frames/%03d.jpg`)
}

async function getFrameSize() {
  const results = execSync(
    `docker run --rm \
     -v "./frames:/frames" \
     imagemagick identify -ping -format '%wx%h' "/frames/001.jpg"`,
  )

  const dimensions = results.toString('utf-8')
  return dimensions.split('x').map(Number) as [number, number]
}

async function distortFrames(dimensions: [number, number]) {
  await fs.rm('./distorted', { recursive: true, force: true })
  await fs.mkdir('./distorted', { recursive: true })

  const filenames = await fs.readdir('./frames')
  for (const [i, filename] of filenames.entries()) {
    const percentage = i / (filenames.length - 1)
    const rescale = Math.floor(40 + 50 * (1 - percentage))

    console.log(`Distorting frame ${i + 1} of ${filenames.length} ${rescale}%`)

    execSync(
      `docker run --rm \
       -v "./frames:/frames" -v "./distorted:/distorted" \
       imagemagick "/frames/${filename}" -liquid-rescale '${rescale}%' -resize '${dimensions[0]}x${dimensions[1]}' "/distorted/${filename}"`,
    )
  }
}

async function combineFrames() {
  await fs.rm('./combined.mp4', { force: true })

  execSync(
    `ffmpeg -framerate 24 -pattern_type glob -i "./distorted/*.jpg" \
     -i video_${id}.mp4 -filter:a "vibrato=f=10:d=0.7" -c:a libopus -shortest \
     -c:v libx264 -pix_fmt yuv420p combined_${id}.mp4`,
  )
}

console.log('Extracting frames...')
await extractFrames()

const dimensions = await getFrameSize()

console.log('Distorting frames...')
await distortFrames(dimensions)

console.log('Combining frames...')
await combineFrames()

console.log('Done!')
