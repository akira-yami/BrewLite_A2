import { orderMoney } from '../../../common/utils/order-money.js';
import type { Prisma } from '../../../generated/prisma/client.js';
import type { OrderItemResponseDto } from '../dto/order-item-response.dto.js';

type OrderItemWithToppings = Prisma.OrderItemGetPayload<{
  include: { orderItemToppings: true };
}>;

// Only persisted snapshots are used, so later catalog changes cannot alter history.
export function toOrderItemResponse(
  item: OrderItemWithToppings,
): OrderItemResponseDto {
  const toppingsTotal = item.orderItemToppings.reduce(
    (sum, topping) => sum + topping.unitPrice * BigInt(topping.quantity),
    0n,
  );

  return {
    id: item.id,
    productName: item.productNameSnapshot,
    size: item.variantNameSnapshot,
    unitPrice: orderMoney(item.unitPrice),
    quantity: item.quantity,
    sugarLevel: item.sugarLevel,
    iceLevel: item.iceLevel,
    note: item.note,
    toppings: item.orderItemToppings.map((topping) => ({
      name: topping.toppingNameSnapshot,
      unitPrice: orderMoney(topping.unitPrice),
      quantity: topping.quantity,
    })),
    lineTotal: orderMoney(
      (item.unitPrice + toppingsTotal) * BigInt(item.quantity),
    ),
  };
}
