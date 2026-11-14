// Kiểm tra giá, khả năng bán theo công thức và phản hồi danh mục.
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { CatalogService } from '../../src/modules/catalog/services/catalog.service.js';
import type { CatalogRepository } from '../../src/modules/catalog/repositories/catalog.repository.js';

const product = {
  id: 'product-1', sku: 'COFFEE', name: 'Coffee', description: null, imageUrl: '/coffee.png',
  variants: [
    { id: 'large', size: 'L', price: 40000n, recipeItems: [{ quantity: 10, ingredient: { stockQuantity: 10, isActive: true } }] },
    { id: 'small', size: 'S', price: 25000n, recipeItems: [] },
  ],
  productToppings: [{ topping: {
    id: 'topping-1', code: 'PEARL', name: 'Pearl', price: 5000n, isActive: true,
    recipeItems: [{ quantity: 1, ingredient: { stockQuantity: 0, isActive: true } }],
  } }],
};

function setup() {
  const repository = { findAllProducts: vi.fn(), findDetailById: vi.fn() };
  return { repository, service: new CatalogService(repository as unknown as CatalogRepository) };
}

describe('catalog service', () => {
  it('maps minimum price, JSON-safe money and recipe availability', async () => {
    const { service, repository } = setup();
    repository.findAllProducts.mockResolvedValue([product]);
    const result = await service.getProducts();
    expect(result[0]).toMatchObject({ basePrice: 25000, description: '', variants: [
      { size: 'L', price: 40000, available: true }, { size: 'S', price: 25000, available: false },
    ], toppings: [{ price: 5000, available: false }] });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it('returns an empty menu when the repository is empty', async () => {
    const { service, repository } = setup();
    repository.findAllProducts.mockResolvedValue([]);
    expect(await service.getProducts()).toEqual([]);
  });

  it('returns product detail and forwards its ID', async () => {
    const { service, repository } = setup();
    repository.findDetailById.mockResolvedValue(product);
    expect(await service.getProductDetailById('product-1')).toMatchObject({ id: 'product-1', basePrice: 25000 });
    expect(repository.findDetailById).toHaveBeenCalledWith('product-1');
  });

  it('rejects a missing or inactive product with 404', async () => {
    const { service, repository } = setup();
    repository.findDetailById.mockResolvedValue(null);
    await expect(service.getProductDetailById('missing')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('propagates database errors instead of returning an empty success', async () => {
    const { service, repository } = setup();
    repository.findAllProducts.mockRejectedValue(new Error('database unavailable'));
    await expect(service.getProducts()).rejects.toThrow('database unavailable');
  });
});
