import { repairPaddleLines } from '../../utils/paddle_lines.mjs';

export async function prepareOcrImage(base64) {
    const image = new Image();
    image.src = base64.startsWith('data:') ? base64 : `data:image/png;base64,${base64}`;
    try {
        await image.decode();
    } catch {
        throw new Error('图片数据无效，请重新截图。');
    }
    // Compress the upload, not the screenshot displayed to the user. Geometry is
    // mapped from the uploaded image dimensions back to the original crop by layout.
    const scale = Math.min(1, 2560 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { base64: canvas.toDataURL('image/jpeg', 0.92), width: canvas.width, height: canvas.height, canvas };
}

export async function recognizePreparedImage(base64, recognize, isCurrent) {
    const image = await prepareOcrImage(base64);
    if (!isCurrent()) throw new Error('已取消文字识别。');
    const result = await recognize(image.base64);
    let pixels;
    const repaired = await repairPaddleLines(
        result,
        {
            width: image.width,
            height: image.height,
            get pixels() {
                return (pixels ||= image.canvas.getContext('2d').getImageData(0, 0, image.width, image.height).data);
            },
            crop: async ({ x, y, width, height }) => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                canvas.getContext('2d').drawImage(image.canvas, x, y, width, height, 0, 0, width, height);
                return canvas.toDataURL('image/jpeg', 0.92);
            },
        },
        { recognize, isCurrent }
    );
    return { ...repaired, width: repaired.width || image.width, height: repaired.height || image.height };
}
