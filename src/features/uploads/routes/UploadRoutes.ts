import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { requireAuth } from '../../../middlewares/AuthMiddleware';
import { uploadController } from '../controllers/UploadController';

const router = Router();

// Determine custom dynamic local uploads folder
const getUploadDir = () => {
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, getUploadDir());
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `proof-${uniqueSuffix}${ext}`);
  }
});

const uploadInstance = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.post(
  '/upload',
  requireAuth as any,
  uploadInstance.single('file'),
  (req, res) => uploadController.handleUpload(req, res)
);

export default router;
