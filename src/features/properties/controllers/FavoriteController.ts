import { Response } from 'express';
import { prisma } from '../../../database/prisma';
import { AuthenticatedRequest } from '../../../middlewares/AuthMiddleware';

export class FavoriteController {
  // GET /api/favorites
  async getFavorites(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized: User ID missing from token' });
        return;
      }

      // Fetch favorites with index-optimized join
      const favorites = await prisma.favorite.findMany({
        where: { userId, property: { deletedAt: null } },
        orderBy: { createdAt: 'desc' },
        include: {
          property: {
            include: {
              category: true,
              rooms: {
                where: { deletedAt: null }
              }
            }
          }
        }
      });

      const propertyIds = favorites.map(f => f.propertyId);

      // Avoid N+1 query: Group by propertyId to calculate ratings & reviewCount in a single db hit
      const reviewAggregates = propertyIds.length > 0
        ? await prisma.review.groupBy({
            by: ['propertyId'],
            where: { propertyId: { in: propertyIds }, deletedAt: null },
            _avg: { rating: true },
            _count: { id: true }
          })
        : [];

      const reviewMap = new Map<string, { rating: number; reviewCount: number }>();
      for (const agg of reviewAggregates) {
        reviewMap.set(agg.propertyId, {
          rating: agg._avg.rating ? Math.round(Number(agg._avg.rating) * 100) / 100 : 0,
          reviewCount: agg._count.id || 0
        });
      }

      const formatted = favorites.map(f => {
        const p = f.property;
        
        // Calculate dynamic lowest room price
        let lowestPrice = p.basePrice || 0;
        if (p.rooms && p.rooms.length > 0) {
          const roomPrices = p.rooms.map(r => r.basePrice).filter(price => price > 0);
          if (roomPrices.length > 0) {
            lowestPrice = Math.min(...roomPrices);
          }
        }

        const reviewMeta = reviewMap.get(p.id) || { rating: 0, reviewCount: 0 };

        return {
          favoriteId: f.id,
          id: p.id,
          slug: p.slug,
          name: p.name,
          city: p.city,
          province: p.province,
          address: p.address,
          imageUrls: p.imageUrls,
          status: p.status,
          lowestRoomPrice: lowestPrice,
          rating: reviewMeta.rating,
          reviewCount: reviewMeta.reviewCount,
          categoryName: p.category?.name || '',
          createdAt: f.createdAt
        };
      });

      res.json({
        success: true,
        data: formatted,
        total: formatted.length
      });
    } catch (err: any) {
      console.error('[FavoriteController.getFavorites] Error:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch favorites' });
    }
  }

  // GET /api/favorites/count
  async getFavoritesCount(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized: User ID missing from token' });
        return;
      }

      const count = await prisma.favorite.count({
        where: { 
          userId, 
          property: { deletedAt: null }
        }
      });

      res.json({
        success: true,
        count
      });
    } catch (err: any) {
      console.error('[FavoriteController.getFavoritesCount] Error:', err);
      res.status(500).json({ error: err.message || 'Failed to fetch favorites count' });
    }
  }

  // POST /api/favorites/toggle
  async toggleFavorite(req: AuthenticatedRequest, res: Response): Promise<void> {
    try {
      const userId = req.userId;
      const { propertyId } = req.body;

      if (!userId) {
        res.status(401).json({ error: 'Unauthorized: Please authenticate.' });
        return;
      }

      if (!propertyId) {
        res.status(400).json({ error: 'propertyId is required in the request body.' });
        return;
      }

      // Check if property exists and not deleted
      const propertyExists = await prisma.property.findFirst({
        where: { id: propertyId, deletedAt: null }
      });

      if (!propertyExists) {
        res.status(404).json({ error: 'Property not found or deleted.' });
        return;
      }

      // Check if already favorited
      const existingFavorite = await prisma.favorite.findUnique({
        where: {
          userId_propertyId: {
            userId,
            propertyId
          }
        }
      });

      if (existingFavorite) {
        // Delete favorite record
        await prisma.favorite.delete({
          where: {
            id: existingFavorite.id
          }
        });

        res.json({
          success: true,
          action: 'removed',
          message: 'Property removed from favorites'
        });
      } else {
        // Insert new favorite record
        const newFav = await prisma.favorite.create({
          data: {
            userId,
            propertyId
          }
        });

        res.json({
          success: true,
          action: 'added',
          message: 'Property added to favorites',
          favorite: newFav
        });
      }
    } catch (err: any) {
      console.error('[FavoriteController.toggleFavorite] Error:', err);
      res.status(500).json({ error: err.message || 'Failed to toggle favorite' });
    }
  }
}

export const favoriteController = new FavoriteController();
