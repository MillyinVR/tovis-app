// lib/media/processImageForUpload.ts

export const IMAGE_UPLOAD_MAX_BYTES = 25 * 1024 * 1024
export const VIDEO_UPLOAD_MAX_BYTES = 200 * 1024 * 1024

const DEFAULT_OUTPUT_MIME_TYPE = 'image/jpeg'
const DEFAULT_OUTPUT_QUALITY = 0.9
const MIN_OUTPUT_QUALITY = 0.58
const OUTPUT_QUALITY_STEP = 0.07
const OUTPUT_SCALE_STEP = 0.85
const DEFAULT_MAX_WIDTH = 2200
const DEFAULT_MAX_HEIGHT = 2200
const MIN_LONG_EDGE = 900

export type ImageCropPreset =
  | 'ORIGINAL'
  | 'PORTRAIT_4_5'
  | 'TALL_9_16'
  | 'SQUARE_1_1'

export type ImageEditState = {
  preset: ImageCropPreset
  zoom: number
  offsetX: number
  offsetY: number
}

export type ProcessImageOptions = {
  maxBytes?: number
  maxWidth?: number
  maxHeight?: number
  outputMimeType?: string
  edit?: ImageEditState
}

export type ProcessedImageResult = {
  file: File
  width: number
  height: number
  originalBytes: number
  processedBytes: number
  mimeType: string
}

export const DEFAULT_IMAGE_EDIT_STATE: ImageEditState = {
  preset: 'ORIGINAL',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
}

export const IMAGE_CROP_PRESET_OPTIONS: Array<{
  value: ImageCropPreset
  label: string
}> = [
  { value: 'ORIGINAL', label: 'Original' },
  { value: 'PORTRAIT_4_5', label: 'Portrait 4:5' },
  { value: 'TALL_9_16', label: 'Tall 9:16' },
  { value: 'SQUARE_1_1', label: 'Square 1:1' },
]

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

function getFileBaseName(fileName: string): string {
  const trimmed = fileName.trim()
  if (!trimmed) return 'upload'

  const lastDot = trimmed.lastIndexOf('.')
  if (lastDot <= 0) return trimmed

  return trimmed.slice(0, lastDot) || 'upload'
}

function getExtensionForMimeType(mimeType: string): string {
  switch (mimeType) {
    case 'image/webp':
      return 'webp'
    case 'image/png':
      return 'png'
    case 'image/jpeg':
    default:
      return 'jpg'
  }
}

function buildOutputFileName(originalName: string, mimeType: string): string {
  const base = getFileBaseName(originalName)
  const ext = getExtensionForMimeType(mimeType)
  return `${base}.${ext}`
}

function readFileAsObjectUrl(file: File): string {
  return URL.createObjectURL(file)
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load image.'))
    image.src = src
  })
}

async function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('Could not encode image.'))
          return
        }
        resolve(blob)
      },
      mimeType,
      quality,
    )
  })
}

function getAspectRatioForPreset(
  preset: ImageCropPreset,
  originalAspectRatio: number,
): number {
  switch (preset) {
    case 'PORTRAIT_4_5':
      return 4 / 5
    case 'TALL_9_16':
      return 9 / 16
    case 'SQUARE_1_1':
      return 1
    case 'ORIGINAL':
    default:
      return originalAspectRatio
  }
}

function computeCropRect(args: {
  sourceWidth: number
  sourceHeight: number
  aspectRatio: number
  zoom: number
  offsetX: number
  offsetY: number
}) {
  const sourceAspectRatio = args.sourceWidth / args.sourceHeight

  let baseCropWidth = args.sourceWidth
  let baseCropHeight = args.sourceHeight

  if (sourceAspectRatio > args.aspectRatio) {
    baseCropHeight = args.sourceHeight
    baseCropWidth = baseCropHeight * args.aspectRatio
  } else {
    baseCropWidth = args.sourceWidth
    baseCropHeight = baseCropWidth / args.aspectRatio
  }

  const safeZoom = clamp(args.zoom, 1, 3)
  const cropWidth = baseCropWidth / safeZoom
  const cropHeight = baseCropHeight / safeZoom

  const maxOffsetX = (args.sourceWidth - cropWidth) / 2
  const maxOffsetY = (args.sourceHeight - cropHeight) / 2

  const normalizedOffsetX = clamp(args.offsetX, -100, 100) / 100
  const normalizedOffsetY = clamp(args.offsetY, -100, 100) / 100

  const cropX = (args.sourceWidth - cropWidth) / 2 + normalizedOffsetX * maxOffsetX
  const cropY = (args.sourceHeight - cropHeight) / 2 + normalizedOffsetY * maxOffsetY

  return {
    x: clamp(cropX, 0, args.sourceWidth - cropWidth),
    y: clamp(cropY, 0, args.sourceHeight - cropHeight),
    width: cropWidth,
    height: cropHeight,
  }
}

function computeOutputSize(args: {
  cropWidth: number
  cropHeight: number
  maxWidth: number
  maxHeight: number
}) {
  const aspectRatio = args.cropWidth / args.cropHeight

  let width = Math.min(args.cropWidth, args.maxWidth)
  let height = Math.round(width / aspectRatio)

  if (height > args.maxHeight) {
    height = args.maxHeight
    width = Math.round(height * aspectRatio)
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

function scaleOutputSizeDown(size: {
  width: number
  height: number
}): { width: number; height: number } {
  const longEdge = Math.max(size.width, size.height)

  if (longEdge <= MIN_LONG_EDGE) {
    return size
  }

  const shrinkFactor = Math.max(MIN_LONG_EDGE / longEdge, OUTPUT_SCALE_STEP)

  return {
    width: Math.max(1, Math.round(size.width * shrinkFactor)),
    height: Math.max(1, Math.round(size.height * shrinkFactor)),
  }
}

async function renderProcessedBlob(args: {
  image: HTMLImageElement
  crop: { x: number; y: number; width: number; height: number }
  output: { width: number; height: number }
  mimeType: string
  quality: number
}): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = args.output.width
  canvas.height = args.output.height

  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('Could not create image editor canvas.')
  }

  context.drawImage(
    args.image,
    args.crop.x,
    args.crop.y,
    args.crop.width,
    args.crop.height,
    0,
    0,
    args.output.width,
    args.output.height,
  )

  return canvasToBlob(canvas, args.mimeType, args.quality)
}

export async function readImageDimensions(
  file: File,
): Promise<{ width: number; height: number }> {
  const objectUrl = readFileAsObjectUrl(file)

  try {
    const image = await loadImageElement(objectUrl)
    return {
      width: image.naturalWidth,
      height: image.naturalHeight,
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  }

  if (bytes >= 1024) {
    return `${Math.round(bytes / 1024)}KB`
  }

  return `${bytes}B`
}

export async function processImageForUpload(
  file: File,
  options?: ProcessImageOptions,
): Promise<ProcessedImageResult> {
  const maxBytes = options?.maxBytes ?? IMAGE_UPLOAD_MAX_BYTES
  const maxWidth = options?.maxWidth ?? DEFAULT_MAX_WIDTH
  const maxHeight = options?.maxHeight ?? DEFAULT_MAX_HEIGHT
  const mimeType = options?.outputMimeType ?? DEFAULT_OUTPUT_MIME_TYPE
  const edit = options?.edit ?? DEFAULT_IMAGE_EDIT_STATE

  const objectUrl = readFileAsObjectUrl(file)

  try {
    const image = await loadImageElement(objectUrl)
    const originalAspectRatio = image.naturalWidth / image.naturalHeight
    const aspectRatio = getAspectRatioForPreset(edit.preset, originalAspectRatio)

    const crop = computeCropRect({
      sourceWidth: image.naturalWidth,
      sourceHeight: image.naturalHeight,
      aspectRatio,
      zoom: edit.zoom,
      offsetX: edit.offsetX,
      offsetY: edit.offsetY,
    })

    let output = computeOutputSize({
      cropWidth: crop.width,
      cropHeight: crop.height,
      maxWidth,
      maxHeight,
    })

    let quality = DEFAULT_OUTPUT_QUALITY
    let blob = await renderProcessedBlob({
      image,
      crop,
      output,
      mimeType,
      quality,
    })

    while (blob.size > maxBytes) {
      const canLowerQuality = quality > MIN_OUTPUT_QUALITY
      const scaledOutput = scaleOutputSizeDown(output)
      const canScaleDown =
        scaledOutput.width < output.width || scaledOutput.height < output.height

      if (!canLowerQuality && !canScaleDown) {
        break
      }

      if (canLowerQuality) {
        quality = Math.max(MIN_OUTPUT_QUALITY, quality - OUTPUT_QUALITY_STEP)
      } else {
        output = scaledOutput
      }

      blob = await renderProcessedBlob({
        image,
        crop,
        output,
        mimeType,
        quality,
      })
    }

    const outputName = buildOutputFileName(file.name, mimeType)
    const processedFile = new File([blob], outputName, {
      type: mimeType,
      lastModified: Date.now(),
    })

    return {
      file: processedFile,
      width: output.width,
      height: output.height,
      originalBytes: file.size,
      processedBytes: processedFile.size,
      mimeType,
    }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}