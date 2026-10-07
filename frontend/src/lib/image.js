const COMPRESS_ABOVE_BYTES = 1024 * 1024;
const MAX_DIMENSION = 2048;
const JPEG_QUALITY = 0.85;

const loadImage = (file) =>
  new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => resolve({ image, release: () => URL.revokeObjectURL(url) });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not decode image"));
    };
    image.src = url;
  });

// Phone cameras produce photos far bigger than a clipboard needs. Scale large images down
// and re-encode them as JPEG so they fit the size limit and sync quickly on mobile data.
// Returns the original file when it is already small, animated, or can't be processed.
export const prepareImage = async (file) => {
  if (file.size <= COMPRESS_ABOVE_BYTES || file.type === "image/gif" || file.type === "image/svg+xml") {
    return file;
  }
  try {
    const { image, release } = await loadImage(file);
    try {
      const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext("2d");
      // JPEG has no transparency
      context.fillStyle = "#FFFFFF";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
      return blob && blob.size < file.size ? blob : file;
    } finally {
      release();
    }
  } catch (error) {
    return file;
  }
};

export const readAsDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
