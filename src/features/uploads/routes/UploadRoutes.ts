import { Router, Request, Response, NextFunction } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../../../middlewares/AuthMiddleware';
import { uploadController } from '../controllers/UploadController';

const router = Router();

// Determine custom dynamic local uploads folder
export const getUploadDir = () => {
  const customPath = process.env.UPLOAD_DIR;
  if (customPath) {
    const fullPath = path.isAbsolute(customPath) ? customPath : path.resolve(process.cwd(), customPath);
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true });
    }
    return fullPath;
  }
  
  // Default to backend/src/uploads or uploads in root depending on working directory
  const possiblePaths = [
    path.join(process.cwd(), 'backend', 'src', 'uploads'),
    path.join(process.cwd(), 'uploads'),
    path.resolve(__dirname, '../../uploads'),
    path.resolve(__dirname, '../../../uploads')
  ];

  for (const p of possiblePaths) {
    try {
      if (!fs.existsSync(p)) {
        fs.mkdirSync(p, { recursive: true });
      }
      return p;
    } catch (e) {
      // Continue searching
    }
  }
  return '/tmp'; // Fallback for servers
};

export const getPropertiesUploadDir = () => {
  const baseDir = getUploadDir();
  const propDir = path.join(baseDir, 'properties');
  if (!fs.existsSync(propDir)) {
    fs.mkdirSync(propDir, { recursive: true });
  }
  return propDir;
};

const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, getPropertiesUploadDir());
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanExt = ALLOWED_EXTENSIONS.includes(ext) ? ext : '.webp';
    cb(null, `prop-${uniqueSuffix}${cleanExt}`);
  }
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = (file.mimetype || '').toLowerCase();

  if (!ALLOWED_EXTENSIONS.includes(ext) || (!ALLOWED_MIME_TYPES.includes(mime) && mime !== 'application/octet-stream')) {
    return cb(new Error('INVALID_FILE_TYPE'));
  }
  cb(null, true);
};

const uploadInstance = multer({
  storage,
  limits: { fileSize: 1 * 1024 * 1024 }, // 1 MB Maximum Limit
  fileFilter
});

const uploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
  uploadInstance.single('file')(req, res, (err: any) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'File size exceeds 1 MB maximum limit.' });
      }
      if (err.message === 'INVALID_FILE_TYPE') {
        return res.status(400).json({ error: 'Invalid file type. Only JPG, JPEG, PNG, and WEBP images are allowed.' });
      }
      return res.status(400).json({ error: err.message || 'File upload failed.' });
    }
    next();
  });
};

router.post(
  '/upload',
  requireAuth as any,
  uploadMiddleware,
  (req, res) => uploadController.handleUpload(req, res)
);

export default router;

