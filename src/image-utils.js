export const IMAGE_BUCKET='ipos-images';
export const IMAGE_PREFIX='storage://ipos-images/';
export function validateImage(file){if(!file||!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Choose a PNG, JPG or WebP image.');if(!file.size||file.size>5*1024*1024)throw Error('Choose an image smaller than 5 MB.');return {'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type];}
