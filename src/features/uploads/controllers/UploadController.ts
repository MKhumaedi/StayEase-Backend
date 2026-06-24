import { Request, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { getSupabaseAdmin } from '../../auth/services/supabase';

export class UploadController {
  async handleUpload(req: Request, res: Response): Promise<void> {
    try {
      const file = req.file;
      if (!file) {
        res.status(400).json({ error: 'No file received' });
        return;
      }
      const ext = path.extname(file.originalname).toLowerCase();
      const valid = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'].includes(ext);
      if (!valid) {
        res.status(400).json({ error: 'Allowed types: JPG, JPEG, PNG, WEBP, PDF' });
        return;
      }

      const uploadProvider = process.env.UPLOAD_PROVIDER || 'local';
      let fileUrl = '';

      if (uploadProvider === 'supabase') {
        const supabase = getSupabaseAdmin();
        const bucketName = process.env.SUPABASE_UPLOAD_BUCKET || 'stayease-uploads';
        
        // Ensure bucket exists or create it
        try {
          await supabase.storage.createBucket(bucketName, {
            public: true,
            fileSizeLimit: 10 * 1024 * 1024
          });
        } catch (e) {
          // Bucket might already exist, which is fine
        }

        const fileContent = fs.readFileSync(file.path);
        const fileName = `${Date.now()}-${path.basename(file.filename)}`;
        
        const { data, error } = await supabase.storage
          .from(bucketName)
          .upload(fileName, fileContent, {
            contentType: file.mimetype,
            upsert: true
          });

        if (error) {
          throw new Error(`Supabase upload failed: ${error.message}`);
        }

        const { data: { publicUrl } } = supabase.storage
          .from(bucketName)
          .getPublicUrl(fileName);

        fileUrl = publicUrl;

        // Clean up the temporary local file written by multer
        try {
          fs.unlinkSync(file.path);
        } catch (err) {
          // ignore cleanup errors
        }
      } else {
        // Local mode url
        fileUrl = `/uploads/${file.filename}`;
      }

      const cleanWebpName = file.filename.replace(ext, '.webp');
      const response = {
        originalName: file.originalname,
        webpName: cleanWebpName,
        size: file.size,
        timestamp: new Date().toISOString(),
        url: fileUrl
      };
      res.json(response);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
}

export const uploadController = new UploadController();
