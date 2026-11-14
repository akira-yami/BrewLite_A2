// Kiểm tra số ly có thể bán dựa trên tồn của tất cả nguyên liệu trong công thức.
import { describe, expect, it } from 'vitest';
import { canPrepare, type RecipeLine } from '../../src/common/utils/recipe-capacity.js';

describe('catalog recipe availability', () => {
  it.each<[RecipeLine[], boolean]>([
    [[], false],
    [[{ quantity: 10, ingredient: { stockQuantity: 10, isActive: true } }], true],
    [[{ quantity: 10, ingredient: { stockQuantity: 9, isActive: true } }], false],
    [[{ quantity: 10, ingredient: { stockQuantity: 20, isActive: false } }], false],
    [[{ quantity: 0, ingredient: { stockQuantity: 20, isActive: true } }], false],
    [[{ quantity: -1, ingredient: { stockQuantity: 20, isActive: true } }], false],
  ])('evaluates recipe %j as %s', (recipe, expected) => {
    expect(canPrepare(recipe)).toBe(expected);
  });

  it('requires all ingredients to be available', () => {
    expect(canPrepare([
      { quantity: 10, ingredient: { stockQuantity: 100, isActive: true } },
      { quantity: 1, ingredient: { stockQuantity: 0, isActive: true } },
    ])).toBe(false);
  });
});
