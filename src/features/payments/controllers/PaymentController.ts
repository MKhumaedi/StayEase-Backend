import { Request, Response } from 'express';
import { midtransService } from '../services/MidtransService';
import { CreateTransactionSchema } from '../validators/PaymentValidator';

export class PaymentController {
  async createTransaction(req: Request, res: Response) {
    try {
      const parsed = CreateTransactionSchema.parse(req.body);
      const data = await midtransService.createSnapToken(parsed.bookingId);
      res.json(data);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async handleWebhook(req: Request, res: Response) {
    try {
      const result = await midtransService.handleNotification(req.body);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }

  async syncTransaction(req: Request, res: Response) {
    try {
      const { bookingId, orderId } = req.body;
      if (!bookingId) {
        res.status(400).json({ error: 'bookingId is required' });
        return;
      }
      const result = await midtransService.syncPaymentStatus(bookingId, orderId);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
}

export const paymentController = new PaymentController();
